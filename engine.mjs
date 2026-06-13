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

export function tableEncode(arr) {
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

export function tableDecode(text) {
  const nl = text.indexOf("\n");
  const header = nl === -1 ? text : text.slice(0, nl);
  const body = nl === -1 ? "" : text.slice(nl + 1);
  const m = header.match(/^@T(\d+)\((.*)\)$/);
  if (!m) throw new Error("bad table header");
  const version = Number(m[1]);
  if (version !== 1) throw new Error(`unsupported table version ${version}`);
  const cols = m[2].split(",").map(s => { const idx = s.lastIndexOf(":"); return [s.slice(0, idx), s.slice(idx + 1)]; });
  for (const [, t] of cols) {
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
        obj[name] = n;
      }
    });
    out.push(obj);
  }
  return out;
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

const QUERY_WORDS = /\b(average|avg|sum|total|count|how many|which|list|top|max|min|maximum|minimum|group|per |highest|lowest|sort)\b/i;

export function optimize(text) {
  const passes = [];
  const flags = [];
  const arrays = findJsonArrays(text);
  let segments = [];
  let cursor = 0;
  let tablesConverted = 0;
  for (const span of arrays) {
    if (span.start < cursor) continue;
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
    passes.push({ id: "table", label: `Re-encoded ${tablesConverted} JSON block(s) into a lossless table`, detail: "Repeated keys, braces and quotes removed. Same values, fully reversible." });

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
  for (const span of arrays) {
    if (span.value.length >= 20) {
      const around = text.slice(Math.max(0, span.start - 300), span.start) + text.slice(span.end, span.end + 300);
      if (QUERY_WORDS.test(around) || QUERY_WORDS.test(text.slice(0, 300))) {
        flags.push({ id: "query", level: "high", message: "You're pasting a large dataset to answer a math question (average, count, sum...). The model is billed for every row it reads. Better: ask the model to write a script, run it on your own machine, then paste back only the result. That is 10x to 1000x fewer tokens." });
        break;
      }
    }
  }

  return { optimized, passes, flags };
}
