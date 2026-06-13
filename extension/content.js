// TokenCodec content script. GENERATED from engine.mjs + extension/build-extension.mjs.
// Do not edit by hand; edit the engine or the build script and rebuild.
// Prompt Optimizer engine. Pure string logic, no dependencies.
//
// The star move: losslessly re-encode a JSON array of flat records into a
// compact typed table (drops repeated keys/braces/quotes). Plus filler
// stripping and an advisory "query, don't paste" flag.
//
// Hardened against hostile and malformed input:
// - only re-encodes TOP-LEVEL arrays (never an array nested inside an object),
// - single-pass O(n) scan with size caps (no quadratic blow-up),
// - control chars in string cells are escaped (untrusted data cannot forge
//   prompt structure / fake SYSTEM turns),
// - decoder validates version, type tags, row width, bool/null grammar,
// - rejects __proto__/CR keys, non-finite numbers and unsafe (>2^53) integers.
// Reversible at the JSON-VALUE level (object key order is normalised to row 0).

// FILLERS: meaning-neutral padding the model does not need. One combined regex
// for a single pass. "the following" was removed after review (it can change
// referential meaning, e.g. "do not do the following:").
const FILLER_RE = /\bcould you please\b|\bcould you\b|\bi would like you to\b|\bi want you to\b|\bas you can see,?\b|\bplease note that\b|\bmake sure to\b|\bin order to\b|\bkindly\b|\bplease\b|\bthank you so much\b/gi;

const MAX_JSON_CANDIDATE_CHARS = 1_000_000; // ignore absurdly large bracketed spans
const MAX_JSON_ARRAYS = 128;                // cap how many arrays we transform

// ---- lossless table codec (@T1 dialect) ----
function inferType(values) {
  let seenBool = false, seenNum = false, seenStr = false, seenFloat = false, allNull = true;
  for (const v of values) {
    if (v === null) continue;
    allNull = false;
    if (typeof v === "boolean") seenBool = true;
    else if (typeof v === "number") {
      if (!Number.isFinite(v)) return null;                          // NaN/Infinity are not JSON
      seenNum = true;
      if (!Number.isInteger(v)) seenFloat = true;
      else if (Math.abs(v) > Number.MAX_SAFE_INTEGER) return null;   // unsafe int -> fall back to JSON
    } else if (typeof v === "string") seenStr = true;
    else return null;                                                // nested object/array -> not convertible
  }
  if (allNull) return "s";
  const typeCount = [seenBool, seenNum, seenStr].filter(Boolean).length;
  if (typeCount > 1) return null;                                    // mixed column -> skip for safety
  if (seenBool) return "b";
  if (seenNum) return seenFloat ? "f" : "i";
  return "s";
}

// Escape control chars so a string cell can never introduce a real newline/tab
// (which would let untrusted data forge table rows or fake prompt turns).
function escapeCell(v) {
  return v.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
function unescapeCell(v) {
  return v.replace(/\\(\\|r|n|t)/g, (_, c) => (c === "r" ? "\r" : c === "n" ? "\n" : c === "t" ? "\t" : "\\"));
}

function encodeField(v, type) {
  if (v === null) return "\\N";                                       // unquoted null sentinel
  if (type === "s") return '"' + escapeCell(v).replace(/"/g, '""') + '"'; // strings ALWAYS quoted
  if (type === "b") return v ? "1" : "0";
  return Object.is(v, -0) ? "-0" : String(v);                         // i / f, preserve -0
}

function tableEncode(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (!arr.every(o => o && typeof o === "object" && !Array.isArray(o))) return null;
  const keys = Object.keys(arr[0]);
  if (keys.length === 0) return null;
  // reserved/structural keys would corrupt the header or pollute the prototype
  if (keys.some(k => /[,:()"\n\r]/.test(k) || k === "__proto__")) return null;
  const keySet = new Set(keys);
  for (const o of arr) {                                              // every record must share the exact key set
    const k = Object.keys(o);
    if (k.length !== keys.length || !k.every(x => keySet.has(x))) return null;
  }
  const types = Object.create(null);                                  // null-proto: safe to set any key
  for (const key of keys) {
    const t = inferType(arr.map(o => o[key]));
    if (!t) return null;
    types[key] = t;
  }
  const header = "@T1(" + keys.map(k => k + ":" + types[k]).join(",") + ")";
  const rows = arr.map(o => keys.map(k => encodeField(o[k], types[k])).join(","));
  return header + "\n" + rows.join("\n");
}

// State-machine CSV parser. Returns rows of { raw, quoted }.
//   inQuotes    - inside a quoted field (commas are literal)
//   fieldStarted- a quote opened this field (so a later quote is data, not open)
//   pending     - a field is in progress and must be flushed (handles empty fields)
// Cells never contain a raw newline (they are escaped), so rows are line-delimited.
function parseBody(body) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  let inQuotes = false, fieldStarted = false, pending = false, i = 0;
  const flushField = () => { row.push({ raw: field, quoted }); field = ""; quoted = false; fieldStarted = false; pending = false; };
  const flushRow = () => { flushField(); rows.push(row); row = []; };
  while (i < body.length) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && !fieldStarted) { inQuotes = true; quoted = true; fieldStarted = true; pending = true; i++; continue; }
    if (ch === ",") { flushField(); pending = true; i++; continue; }
    if (ch === "\n") { if (pending || row.length > 0) flushRow(); pending = false; i++; continue; }
    if (ch === "\r") { i++; continue; }
    field += ch; fieldStarted = true; pending = true; i++;
  }
  if (pending || row.length > 0) flushRow();
  return rows;
}

function tableDecode(text) {
  const nl = text.indexOf("\n");
  const header = nl === -1 ? text : text.slice(0, nl);
  const body = nl === -1 ? "" : text.slice(nl + 1);
  const m = header.match(/^@T(\d+)\((.*)\)$/);
  if (!m) throw new Error("bad table header");
  const version = Number(m[1]);
  if (version !== 1) throw new Error(`unsupported table version ${version}`);
  const cols = m[2].split(",").map(s => { const idx = s.lastIndexOf(":"); return [s.slice(0, idx), s.slice(idx + 1)]; });
  for (const [name, t] of cols) {
    if (name === "__proto__") throw new Error(`unsafe column name: ${name}`); // symmetric with encode; never put a __proto__ key on a decoded row
    if (t.length !== 1 || !"sifb".includes(t)) throw new Error(`unknown type tag: ${t}`);
  }
  const out = [];
  for (const row of parseBody(body)) {
    if (row.length === 1 && row[0].raw === "" && !row[0].quoted) continue; // skip blank line
    if (row.length !== cols.length) throw new Error(`row width mismatch: expected ${cols.length}, got ${row.length}`);
    const obj = Object.create(null);                                  // defence in depth vs __proto__ cells
    cols.forEach(([name, t], idx) => {
      const cell = row[idx];
      if (!cell.quoted && cell.raw === "\\N") { obj[name] = null; return; }
      if (t === "s") {
        if (!cell.quoted) throw new Error(`unquoted string cell for ${name}`);
        obj[name] = unescapeCell(cell.raw);
      } else if (t === "b") {
        if (cell.raw !== "0" && cell.raw !== "1") throw new Error(`bad bool cell for ${name}: ${cell.raw}`);
        obj[name] = cell.raw === "1";
      } else {
        const n = Number(cell.raw);
        if (!Number.isFinite(n)) throw new Error(`bad numeric cell for ${name}: ${cell.raw}`);
        if (t === "i" && (!Number.isInteger(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER))
          throw new Error(`unsafe int cell for ${name}: ${cell.raw}`);   // decode stays lossless, symmetric with encode's refusal
        obj[name] = n;
      }
    });
    out.push(obj);
  }
  return out;
}

// Receive-side inverse of the table encoder. Scans free-form model OUTPUT for
// embedded @T1(...) blocks and expands each one back into a JSON array, in
// place. This is what makes "reply in @T1 to save output tokens" a real
// round-trip instead of advice: the model emits a compact table, your app still
// gets JSON. Anything that is not a valid table is left exactly as written - it
// never throws, and never invents or drops data.
function decodeTables(text, { space = 0 } = {}) {
  if (typeof text !== "string" || !text.includes("@T")) return text;
  const MAX_SHRINK_ATTEMPTS = 64;       // bound the retry loop on hostile malformed blocks
  const MAX_BLOCK_CHARS = 256_000;      // never spend O(n^2) reparsing an enormous block
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*@T\d+\(.*\)\s*$/.test(lines[i])) { out.push(lines[i]); i++; continue; }
    const trimmed = lines[i].trimStart();
    const indent = lines[i].slice(0, lines[i].length - trimmed.length);
    const header = trimmed.trimEnd();
    // Fail fast on anything that is not a version-1 header: a bogus @T2(...) or a
    // malformed header is left as prose without ever entering the retry loop.
    const hm = header.match(/^@T(\d+)\((.*)\)$/);
    if (!hm || hm[1] !== "1") { out.push(lines[i]); i++; continue; }
    // Gather contiguous candidate rows: stop at a blank line, the next table
    // header, end of input, or once the block grows too large to transform safely.
    let j = i + 1, blockChars = header.length;
    while (j < lines.length && lines[j].trim() !== "" && !/^\s*@T\d+\(/.test(lines[j]) && blockChars <= MAX_BLOCK_CHARS) {
      blockChars += lines[j].length + 1; j++;
    }
    if (blockChars > MAX_BLOCK_CHARS) { out.push(lines[i]); i++; continue; }   // oversized -> leave untouched
    // Largest block first, then shrink from the end (attempt-capped). This recovers
    // when prose is glued on with no blank-line separator: the longest valid prefix
    // wins and the rest is emitted untouched. Empty decodes (a lone header) are
    // rejected. The cap keeps a hostile malformed block from going quadratic.
    let decoded = null, end = i + 1;
    const minK = Math.max(i + 1, j - MAX_SHRINK_ATTEMPTS + 1);
    for (let k = j; k >= minK; k--) {
      const bodyLines = lines.slice(i + 1, k).map(l => (l.startsWith(indent) ? l.slice(indent.length) : l));
      try {
        const v = tableDecode(header + "\n" + bodyLines.join("\n"));
        if (v.length >= 1) { decoded = v; end = k; break; }
      } catch { /* try fewer rows */ }
    }
    if (decoded) {
      const json = JSON.stringify(decoded, null, space);
      out.push(indent + (space ? json.replace(/\n/g, "\n" + indent) : json));
      for (let r = end; r < j; r++) out.push(lines[r]);   // un-consumed trailing lines
      i = j;
    } else { out.push(lines[i]); i++; }
  }
  return out.join("\n");
}

// Find TOP-LEVEL JSON arrays only. An array opened while already inside another
// `{`/`[` is left untouched, so we never splice a table into a containing object.
// Single pass, O(n), with size/count caps.
function findJsonArrays(text) {
  const spans = [];
  let inStr = false, esc = false, depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[" || ch === "{") {
      if (depth === 0 && ch === "[") start = i;                       // candidate top-level array
      depth++;
    } else if (ch === "]" || ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0 && ch === "]") {
          const end = i + 1;
          if (end - start <= MAX_JSON_CANDIDATE_CHARS) {
            const sub = text.slice(start, end);
            try { const v = JSON.parse(sub); if (Array.isArray(v)) spans.push({ start, end, value: v }); } catch {}
          }
          start = -1;
          if (spans.length >= MAX_JSON_ARRAYS) break;
        }
      }
    }
  }
  return spans;
}

// Parse a single line as a FLAT JSON object ({} with no nested object/array
// values), or return null. Used to recognise NDJSON / JSON-lines.
function parseFlatObject(line) {
  const s = line.trim();
  if (s.length < 2 || s[0] !== "{" || s[s.length - 1] !== "}") return null;
  let v;
  try { v = JSON.parse(s); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (val !== null && typeof val === "object") return null; // nested -> not flat
  }
  return v;
}

// Find blocks of >=3 consecutive lines that are each a flat JSON object sharing
// the exact same keys (NDJSON / JSON-lines, the usual shape of logs and exports).
// Returns char spans, same contract as findJsonArrays.
function findNdjsonBlocks(text) {
  const spans = [];
  const lines = [];
  let idx = 0;
  for (const raw of text.split("\n")) { lines.push({ start: idx, end: idx + raw.length, text: raw }); idx += raw.length + 1; }
  let i = 0;
  while (i < lines.length) {
    const first = parseFlatObject(lines[i].text);
    if (!first) { i++; continue; }
    const keySig = Object.keys(first).join("\u0000");
    const recs = [first];
    let j = i + 1;
    while (j < lines.length) {
      const rec = parseFlatObject(lines[j].text);
      if (!rec || Object.keys(rec).join("\u0000") !== keySig) break;
      recs.push(rec); j++;
    }
    if (recs.length >= 3) {
      spans.push({ start: lines[i].start, end: lines[j - 1].end, value: recs });
      i = j;
    } else i++;
  }
  return spans;
}

const QUERY_WORDS = /\b(average|avg|sum|total|count|how many|which|list|top|max|min|maximum|minimum|group|per |highest|lowest|sort)\b/i;

function optimize(text) {
  const passes = [];
  const flags = [];
  // top-level JSON arrays + NDJSON blocks, in document order, non-overlapping
  const spansAll = [...findJsonArrays(text), ...findNdjsonBlocks(text)].sort((a, b) => a.start - b.start);
  let segments = [];
  let cursor = 0;
  let tablesConverted = 0;
  for (const span of spansAll) {
    if (span.start < cursor) continue; // skip overlaps
    segments.push({ type: "prose", text: text.slice(cursor, span.start) });
    const original = text.slice(span.start, span.end);
    const encoded = tableEncode(span.value);
    if (encoded && encoded.length < original.length) {
      segments.push({ type: "data", text: encoded });
      tablesConverted++;
    } else {
      segments.push({ type: "data", text: original });
    }
    cursor = span.end;
  }
  segments.push({ type: "prose", text: text.slice(cursor) });

  if (tablesConverted > 0)
    passes.push({ id: "table", label: `Re-encoded ${tablesConverted} data block(s) into a lossless table`, detail: "Repeated keys, braces and quotes removed. Same values, fully reversible." });

  // filler + whitespace cleanup on PROSE only (never inside data)
  let fillerCount = 0;
  segments = segments.map(seg => {
    if (seg.type !== "prose") return seg;
    let t = seg.text.replace(FILLER_RE, m => { fillerCount++; return m.toLowerCase() === "in order to" ? "to" : ""; });
    t = t.replace(/[ \t]+/g, " ").replace(/ *\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    return { ...seg, text: t };
  });
  if (fillerCount > 0)
    passes.push({ id: "filler", label: `Stripped ${fillerCount} filler phrase(s)`, detail: "Padding the model does not need." });

  const optimized = segments.map(s => s.text).join("").replace(/[ \t]+\n/g, "\n").trim();

  // advisory: a big dataset pasted to ask a computable question -> query it instead
  for (const span of spansAll) {
    if (span.value.length >= 20) {
      const around = text.slice(Math.max(0, span.start - 300), span.start) + text.slice(span.end, span.end + 300);
      if (QUERY_WORDS.test(around) || QUERY_WORDS.test(text.slice(0, 300))) {
        flags.push({ id: "query", level: "high", message: "You're pasting a large dataset to answer a math question (average, count, sum...). The model is billed for every row it reads. Better: ask the model to write a script, run it on your own machine, then paste back only the result. That is often 100x or more fewer tokens." });
        break;
      }
    }
  }

  return { optimized, passes, flags };
}


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
    return b;
  }

  const btn = mkButton("\u{1F343} Shrink prompt", "96px", "#1452d9");
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
    if (after >= before) { show("Already tight \u2014 nothing to remove."); return; }
    writeText(el, result.optimized);
    const pct = Math.round(100 * (before - after) / before);
    show("Shrunk ~" + pct + "% (about " + (before - after) + " fewer tokens)." + (result.flags.length ? " Tip: " + result.flags[0].message : ""));
  });

  // OUTPUT side: append a one-line rule so the model answers tabular data as a
  // compact @T1 table (fewer output tokens). Stays entirely inside your prompt box;
  // decode the reply on the hosted page or with the middleware.
  const REPLY_HINT = "Reply rule: when your answer is a list of items that share the same fields, return a compact TokenCodec @T1 table, not JSON - a header line @T1(col:type,...) with type s=text i=int f=float b=bool, then one comma-separated row per item, text in double quotes, an empty value as \\N. Use normal prose otherwise.";
  replyBtn.addEventListener("click", () => {
    const el = getEditable();
    if (!el) { show("Click into the prompt box first, then press Compact reply."); return; }
    const text = readText(el);
    if (text && text.indexOf("@T1(col:type") !== -1) { show("The compact-reply rule is already in your prompt."); return; }
    const next = (text && text.trim()) ? text.replace(/\s*$/, "") + "\n\n" + REPLY_HINT : REPLY_HINT;
    writeText(el, next);
    show("Added a reply-saver: tabular answers come back as a compact @T1 table (cheaper output). Paste the reply into the TokenCodec page to read it. Worth it when you expect a list or table.");
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
