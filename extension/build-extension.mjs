// Builds extension/content.js by inlining the tested engine.mjs (single source of
// truth) ahead of the in-page UI logic. Content scripts are not ES modules, so
// the engine's `export` keywords are stripped and everything shares one scope.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const engine = fs.readFileSync(path.join(dir, "..", "engine.mjs"), "utf8").replace(/^export\s+/gm, "");

const ui = `
// ---- TokenCodec in-page UI ----------------------------------------------
(function () {
  const estimate = s => Math.ceil([...s].length / 4); // approximate, no network

  // Remember the last prompt box the user actually focused. Clicking our floating
  // button blurs the composer, and on a real chat page the FIRST contenteditable in
  // the DOM is often not the prompt (a sidebar search box, a hidden field). Tracking
  // the user's own last focus - and not stealing focus on mousedown - keeps us on the
  // box they were typing in (ChatGPT/Claude ProseMirror, Gemini Quill).
  const trackable = el => !!el && (el.tagName === "TEXTAREA" || el.isContentEditable);
  let lastEditable = null;
  document.addEventListener("focusin", e => { if (trackable(e.target)) lastEditable = e.target; }, true);

  function getEditable() {
    const a = document.activeElement;
    if (trackable(a)) return a;
    if (trackable(lastEditable) && lastEditable.isConnected) return lastEditable;
    return document.querySelector('textarea, div[contenteditable="true"], [role="textbox"]');
  }
  function readText(el) {
    if (!el) return "";
    return (el.tagName === "TEXTAREA" || el.tagName === "INPUT") ? el.value : el.innerText;
  }
  function writeText(el, text) {
    if (!el) return false;
    const before = readText(el);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value");
      setter && setter.set ? setter.set.call(el, text) : (el.value = text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else {
      el.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      // execCommand still works in editors like ProseMirror / Lexical and keeps their state in sync
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    // Verify it took. Some sites refuse programmatic edits; if so the caller copies the
    // result to the clipboard instead of failing silently.
    const norm = s => s.replace(/\\s+/g, "");
    const now = readText(el);
    return now !== before && norm(now).indexOf(norm(text).slice(0, 24)) !== -1;
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function mkButton(label, bottomPx, bg) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    Object.assign(b.style, {
      position: "fixed", right: "18px", bottom: bottomPx, zIndex: 2147483647,
      padding: "8px 12px", borderRadius: "8px", border: "none", background: bg,
      color: "#fff", font: "600 13px system-ui, sans-serif", cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,.35)"
    });
    b.addEventListener("mousedown", e => e.preventDefault()); // do not steal focus from the prompt box
    return b;
  }

  const btn = mkButton("\\u{1F343} Shrink prompt", "96px", "#1452d9");
  btn.setAttribute("aria-label", "Shrink the current prompt with TokenCodec");
  const replyBtn = mkButton("Compact reply", "56px", "#0b7a52");
  replyBtn.setAttribute("aria-label", "Ask the model to reply in a compact @T1 table to save output tokens");

  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  Object.assign(toast.style, {
    position: "fixed", right: "18px", bottom: "138px", zIndex: 2147483647,
    padding: "8px 11px", borderRadius: "8px", background: "#161922", color: "#e7e9ee",
    font: "12px system-ui, sans-serif", display: "none", maxWidth: "280px",
    boxShadow: "0 2px 10px rgba(0,0,0,.35)"
  });
  function show(msg) { toast.textContent = msg; toast.style.display = "block"; clearTimeout(show._t); show._t = setTimeout(() => (toast.style.display = "none"), 7000); }

  // INPUT side: re-encode pasted data + strip filler.
  btn.addEventListener("click", () => {
    const el = getEditable();
    const text = readText(el);
    if (!text || !text.trim()) { show("Click into the prompt box first, then press Shrink."); return; }
    let result;
    try { result = optimize(text); } catch (e) { show("Could not shrink this prompt."); return; }
    const before = estimate(text), after = estimate(result.optimized);
    if (after >= before) { show("Already tight \\u2014 nothing to remove."); return; }
    const pct = Math.round(100 * (before - after) / before);
    const tip = result.flags.length ? " Tip: " + result.flags[0].message : "";
    if (writeText(el, result.optimized)) {
      show("Shrunk ~" + pct + "% (about " + (before - after) + " fewer tokens)." + tip);
    } else {
      copyText(result.optimized).then(ok => show(ok
        ? "This box blocks auto-edit, so I copied the shrunk prompt (~" + pct + "% smaller). Press Ctrl+V to paste it in." + tip
        : "This box blocks auto-edit. Select all in the box and replace it with the shrunk prompt."));
    }
  });

  // OUTPUT side: append a one-line rule so the model answers tabular data as a
  // compact @T1 table (fewer output tokens). Stays entirely inside your prompt box;
  // decode the reply on the hosted page or with the middleware.
  const REPLY_HINT = "Reply rule: when your answer is a list of items that share the same fields, return a compact TokenCodec @T1 table, not JSON - a header line @T1(col:type,...) with type s=text i=int f=float b=bool, then one comma-separated row per item, text in double quotes, an empty value as \\\\N. Use normal prose otherwise.";
  replyBtn.addEventListener("click", () => {
    const el = getEditable();
    if (!el) { show("Click into the prompt box first, then press Compact reply."); return; }
    const text = readText(el);
    if (text && text.indexOf("@T1(col:type") !== -1) { show("The compact-reply rule is already in your prompt."); return; }
    const next = (text && text.trim()) ? text.replace(/\\s*$/, "") + "\\n\\n" + REPLY_HINT : REPLY_HINT;
    if (writeText(el, next)) {
      show("Added a reply-saver: tabular answers come back as a compact @T1 table (cheaper output). Paste the reply into the TokenCodec page to read it. Worth it when you expect a list or table.");
    } else {
      copyText(next).then(ok => show(ok
        ? "This box blocks auto-edit, so I copied your prompt with the reply-saver rule added. Press Ctrl+V to paste it in."
        : "This box blocks auto-edit. Add the @T1 reply rule to your prompt manually."));
    }
  });

  function mount() {
    if (!document.body) return;
    if (!btn.isConnected) document.body.appendChild(btn);
    if (!replyBtn.isConnected) document.body.appendChild(replyBtn);
    if (!toast.isConnected) document.body.appendChild(toast);
  }
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

const banner = "// TokenCodec content script. GENERATED from engine.mjs + extension/build-extension.mjs.\n// Do not edit by hand; edit the engine or the build script and rebuild.\n";
fs.writeFileSync(path.join(dir, "content.js"), banner + engine + "\n" + ui);
console.log("extension/content.js generated (" + (banner.length + engine.length + ui.length) + " bytes)");
