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

  function getEditable() {
    const a = document.activeElement;
    if (a && (a.tagName === "TEXTAREA" || a.isContentEditable)) return a;
    return document.querySelector('textarea, div[contenteditable="true"], [role="textbox"]');
  }
  function readText(el) {
    if (!el) return "";
    return (el.tagName === "TEXTAREA" || el.tagName === "INPUT") ? el.value : el.innerText;
  }
  function writeText(el, text) {
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
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "\\u{1F343} Shrink prompt";
  btn.setAttribute("aria-label", "Shrink the current prompt with TokenCodec");
  Object.assign(btn.style, {
    position: "fixed", right: "18px", bottom: "96px", zIndex: 2147483647,
    padding: "8px 12px", borderRadius: "8px", border: "none", background: "#1452d9",
    color: "#fff", font: "600 13px system-ui, sans-serif", cursor: "pointer",
    boxShadow: "0 2px 10px rgba(0,0,0,.35)"
  });

  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  Object.assign(toast.style, {
    position: "fixed", right: "18px", bottom: "138px", zIndex: 2147483647,
    padding: "8px 11px", borderRadius: "8px", background: "#161922", color: "#e7e9ee",
    font: "12px system-ui, sans-serif", display: "none", maxWidth: "280px",
    boxShadow: "0 2px 10px rgba(0,0,0,.35)"
  });
  function show(msg) { toast.textContent = msg; toast.style.display = "block"; clearTimeout(show._t); show._t = setTimeout(() => (toast.style.display = "none"), 7000); }

  btn.addEventListener("click", () => {
    const el = getEditable();
    const text = readText(el);
    if (!text || !text.trim()) { show("Click into the prompt box first, then press Shrink."); return; }
    let result;
    try { result = optimize(text); } catch (e) { show("Could not shrink this prompt."); return; }
    const before = estimate(text), after = estimate(result.optimized);
    if (after >= before) { show("Already tight \\u2014 nothing to remove."); return; }
    writeText(el, result.optimized);
    const pct = Math.round(100 * (before - after) / before);
    show("Shrunk ~" + pct + "% (about " + (before - after) + " fewer tokens)." + (result.flags.length ? " Tip: " + result.flags[0].message : ""));
  });

  function mount() {
    if (!document.body) return;
    if (!btn.isConnected) document.body.appendChild(btn);
    if (!toast.isConnected) document.body.appendChild(toast);
  }
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

const banner = "// TokenCodec content script. GENERATED from engine.mjs + extension/build-extension.mjs.\n// Do not edit by hand; edit the engine or the build script and rebuild.\n";
fs.writeFileSync(path.join(dir, "content.js"), banner + engine + "\n" + ui);
console.log("extension/content.js generated (" + (banner.length + engine.length + ui.length) + " bytes)");
