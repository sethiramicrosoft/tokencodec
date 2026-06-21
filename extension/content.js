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

// ---- lossless table codec (@T2 dialect, with @T1 decode compatibility) ----
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
  if (keys.some(k => /[,:()"\n\r\s]/.test(k) || k === "__proto__")) return null;
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
  // Map type codes to English names for better tokenization
  const typeNames = { "i": "int", "s": "string", "f": "float", "b": "bool" };
  const header = "@T2 " + keys.map(k => k + " " + typeNames[types[k]]).join(" ");
  const rows = arr.map(o => keys.map(k => encodeField(o[k], types[k])).join(" "));
  return header + "\n" + rows.join("\n");
}

// Space-delimited parser that respects CSV-style quoted fields
function parseSpaceBody(body) {
  const rows = [];
  const lines = body.split("\n");
  for (const line of lines) {
    if (line === "") continue; // skip blank lines
    const row = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (inQuotes) {
        field += ch;
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false;
        }
        i++; 
        continue;
      }
      if (ch === '"') { inQuotes = true; field += ch; i++; continue; }
      if (ch === " ") { if (field !== "") row.push({ raw: field, quoted: field.startsWith('"') && field.endsWith('"') }); field = ""; i++; continue; }
      field += ch; i++;
    }
    if (field !== "" || row.length > 0) row.push({ raw: field, quoted: field.startsWith('"') && field.endsWith('"') });
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

// Legacy parser for @T1(name:s,...) rows (comma-separated, CSV-style quoted cells).
function parseCsvBody(body) {
  const rows = [];
  const lines = body.split("\n");
  for (const line of lines) {
    if (line === "") continue;
    const row = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (inQuotes) {
        field += ch;
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false;
        }
        i++;
        continue;
      }
      if (ch === '"') { inQuotes = true; field += ch; i++; continue; }
      if (ch === ",") { row.push({ raw: field, quoted: field.startsWith('"') && field.endsWith('"') }); field = ""; i++; continue; }
      field += ch; i++;
    }
    if (field !== "" || row.length > 0) row.push({ raw: field, quoted: field.startsWith('"') && field.endsWith('"') });
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

function parseT2Header(header) {
  const hm = header.match(/^@T2\s+(.+)$/);
  if (!hm) return null;
  const typeMap = { "int": "i", "string": "s", "float": "f", "bool": "b" };
  const headerParts = hm[1].split(/\s+/);
  if (headerParts.length % 2 !== 0) throw new Error("header has odd number of tokens");
  const cols = [];
  for (let i = 0; i < headerParts.length; i += 2) {
    const name = headerParts[i];
    const tn = headerParts[i + 1];
    const t = typeMap[tn];
    if (!t) throw new Error(`unknown type: ${tn}`);
    cols.push([name, t]);
  }
  return { cols, rowParser: parseSpaceBody, legacy: false };
}

function parseT1LegacyHeader(header) {
  const hm = header.match(/^@T1\((.*)\)$/);
  if (!hm) return null;
  const inner = hm[1].trim();
  const cols = inner === "" ? [] : inner.split(",").map(part => {
    const p = part.split(":");
    if (p.length !== 2 || !p[0] || !p[1]) throw new Error("bad legacy header column");
    return [p[0], p[1]];
  });
  return { cols, rowParser: parseCsvBody, legacy: true };
}

function tableDecode(text, { onLegacyFormat } = {}) {
  const nl = text.indexOf("\n");
  const header = nl === -1 ? text : text.slice(0, nl);
  const body = nl === -1 ? "" : text.slice(nl + 1);
  const parsed = parseT2Header(header) || parseT1LegacyHeader(header);
  if (!parsed) throw new Error("bad table header");
  const { cols, rowParser, legacy } = parsed;
  if (legacy && typeof onLegacyFormat === "function") onLegacyFormat();
  for (const [name, t] of cols) {
    if (name === "__proto__") throw new Error(`unsafe column name: ${name}`); // symmetric with encode; never put a __proto__ key on a decoded row
    if (t.length !== 1 || !"sifb".includes(t)) throw new Error(`unknown type tag: ${t}`);
    if (/\s/.test(name)) throw new Error(`unsafe column name: ${name}`);
  }
  const out = [];
  for (const row of rowParser(body)) {
    if (row.length === 1 && row[0].raw === "" && !row[0].quoted) continue; // skip blank line
    if (row.length !== cols.length) throw new Error(`row width mismatch: expected ${cols.length}, got ${row.length}`);
    const obj = Object.create(null);                                  // defence in depth vs __proto__ cells
    cols.forEach(([name, t], idx) => {
      const cell = row[idx];
      if (!cell.quoted && cell.raw === "\\N") { obj[name] = null; return; }
      if (t === "s") {
        if (!cell.quoted) throw new Error(`unquoted string cell for ${name}`);
        // Strip quotes and unescape
        const unquoted = cell.raw.slice(1, -1).replace(/""/g, '"');
        obj[name] = unescapeCell(unquoted);
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
// embedded @T1/@T2 blocks and expands each one back into a JSON array, in
// place. This is what makes "reply in @T2 to save output tokens" a real
// round-trip instead of advice: the model emits a compact table, your app still
// gets JSON. Anything that is not a valid table is left exactly as written - it
// never throws, and never invents or drops data.
function decodeTables(text, { space = 0, onLegacyFormat } = {}) {
  if (typeof text !== "string" || !text.includes("@T")) return text;
  const MAX_SHRINK_ATTEMPTS = 64;       // bound the retry loop on hostile malformed blocks
  const MAX_BLOCK_CHARS = 256_000;      // never spend O(n^2) reparsing an enormous block
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*@T\d+(?:\s+|\()/.test(lines[i])) { out.push(lines[i]); i++; continue; }
    const trimmed = lines[i].trimStart();
    const indent = lines[i].slice(0, lines[i].length - trimmed.length);
    const header = trimmed.trimEnd();
    // Fail fast on anything that is not a recognized table header form.
    if (!/^@T2\s+.+$/.test(header) && !/^@T1\(.+\)$/.test(header)) { out.push(lines[i]); i++; continue; }
    // Gather contiguous candidate rows: stop at a blank line, the next table
    // header, end of input, or once the block grows too large to transform safely.
    let j = i + 1, blockChars = header.length;
    while (j < lines.length && lines[j].trim() !== "" && !/^\s*@T\d+(?:\s+|\()/.test(lines[j]) && blockChars <= MAX_BLOCK_CHARS) {
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
        const v = tableDecode(header + "\n" + bodyLines.join("\n"), { onLegacyFormat });
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
    const norm = s => s.replace(/\s+/g, "");
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

  const btn = mkButton("\u{1F343} Shrink prompt", "96px", "#1452d9");
  btn.setAttribute("aria-label", "Shrink the current prompt with TokenCodec");
  const replyBtn = mkButton("Compact reply", "56px", "#0b7a52");
  replyBtn.setAttribute("aria-label", "Ask the model to reply in a compact @T2 table to save output tokens");

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
  // compact @T2 table (fewer output tokens). Stays entirely inside your prompt box;
  // decode the reply on the hosted page or with the middleware.
  const REPLY_HINT = "Reply rule: when your answer is a list of items that share the same fields, return a compact TokenCodec @T2 table, not JSON - a header line @T2 col1 int col2 string col3 float ... where types are int, string, float, or bool, then one space-delimited row per item, text in double quotes, and null as \\N. Use normal prose otherwise.";
  replyBtn.addEventListener("click", () => {
    const el = getEditable();
    if (!el) { show("Click into the prompt box first, then press Compact reply."); return; }
    const text = readText(el);
    if (text && text.indexOf("Reply rule:") !== -1) { show("The compact-reply rule is already in your prompt."); return; }
    const next = (text && text.trim()) ? text.replace(/\s*$/, "") + "\n\n" + REPLY_HINT : REPLY_HINT;
    if (writeText(el, next)) {
      show("Added a reply-saver: tabular answers come back as a compact @T2 table (cheaper output). Paste the reply into the TokenCodec page to read it. Worth it when you expect a list or table.");
    } else {
      copyText(next).then(ok => show(ok
        ? "This box blocks auto-edit, so I copied your prompt with the reply-saver rule added. Press Ctrl+V to paste it in."
        : "This box blocks auto-edit. Add the @T2 reply rule to your prompt manually."));
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
