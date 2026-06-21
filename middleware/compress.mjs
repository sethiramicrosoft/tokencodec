// TokenCodec - API-side prompt compressor.
//
// For production apps that burn tokens at RUNTIME (not just while you code).
// Drop this in front of your LLM call to shrink prompts before they are billed.
// Dependency-free: it reuses the same lossless engine the CLI and web tool use.
//
// It compresses the *text* of your messages (re-encoding embedded JSON/NDJSON
// data into a compact lossless table, stripping filler). It never invents or
// drops information, so the model sees the same facts for fewer tokens.

import { optimize, decodeTables } from "../engine.mjs";
let warnedLegacyFormat = false;

// Rough, dependency-free token estimate (~4 chars/token). Pass your real
// tokenizer via { tokenizer } for exact numbers (e.g. gpt-tokenizer's encode).
const estimateTokens = s => Math.ceil([...s].length / 4);

function decideRoute(text, { tokenizer, router } = {}) {
  const r = compressText(text, { tokenizer });
  const savedPct = r.before > 0 ? Math.round((100 * r.saved) / r.before) : 0;
  const minSavedTokens = router?.minSavedTokens ?? 120;
  const minSavedPct = router?.minSavedPct ?? 15;
  const shouldCompress = r.saved >= minSavedTokens && savedPct >= minSavedPct;
  return { result: r, savedPct, shouldCompress };
}

export function compressText(text, { tokenizer } = {}) {
  if (typeof text !== "string" || text.length === 0)
    return { text, before: 0, after: 0, saved: 0, passes: [], flags: [] };
  const count = tokenizer || estimateTokens;
  const before = count(text);
  const { optimized, passes, flags } = optimize(text);
  const after = count(optimized);
  return { text: optimized, before, after, saved: before - after, passes, flags };
}

// Compress an array of chat messages. `content` may be a plain string or an
// array of parts ({ type: "text", text } ...) as used by OpenAI / Anthropic.
// Non-text parts (images, tool calls) are passed through untouched.
export function compressMessages(messages, { tokenizer, skipRoles = [], router } = {}) {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  let before = 0, after = 0;
  const flags = [];
  const collect = (role, r) => { before += r.before; after += r.after; for (const f of r.flags) flags.push({ role, ...f }); };
  const routerMode = router?.mode || "always"; // always | shadow | enforce
  const collectRouter = (role, d) => {
    flags.push({
      role,
      kind: "router",
      mode: routerMode,
      wouldRoute: d.shouldCompress ? "compress" : "passthrough",
      before: d.result.before,
      after: d.result.after,
      saved: d.result.saved,
      savedPct: d.savedPct,
    });
  };

  const out = messages.map(m => {
    if (!m || skipRoles.includes(m.role)) return m;
    if (typeof m.content === "string") {
      const d = decideRoute(m.content, { tokenizer, router });
      const r = d.result;
      collect(m.role, r);
      if (routerMode === "shadow") {
        collectRouter(m.role, d);
        return { ...m, content: m.content };
      }
      if (routerMode === "enforce" && !d.shouldCompress) {
        collectRouter(m.role, d);
        return { ...m, content: m.content };
      }
      if (routerMode === "enforce") collectRouter(m.role, d);
      return { ...m, content: r.text };
    }
    if (Array.isArray(m.content)) {
      const content = m.content.map(part => {
        if (part && part.type === "text" && typeof part.text === "string") {
          const d = decideRoute(part.text, { tokenizer, router });
          const r = d.result;
          collect(m.role, r);
          if (routerMode === "shadow") {
            collectRouter(m.role, d);
            return part;
          }
          if (routerMode === "enforce" && !d.shouldCompress) {
            collectRouter(m.role, d);
            return part;
          }
          if (routerMode === "enforce") collectRouter(m.role, d);
          return { ...part, text: r.text };
        }
        return part;
      });
      return { ...m, content };
    }
    return m;
  });
  return { messages: out, before, after, saved: before - after, flags };
}

// Convenience wrapper: compress, then hand off to your own send function.
// `send` receives the compressed messages and returns the model response.
export async function withCompression(messages, send, opts = {}) {
  const { messages: compressed, before, after, saved, flags } = compressMessages(messages, opts);
  const response = await send(compressed);
  return { response, stats: { before, after, saved, flags } };
}

// ---------------------------------------------------------------------------
// OUTPUT side. The above shrinks what you SEND. Output is different: the model
// GENERATES it, so it is not redundant data you can losslessly re-pack - the only
// way to spend fewer output tokens is to make the model produce fewer. Two honest
// levers, in order of reliability:
//   1. ENFORCED (the API obeys it): cap max output tokens, and - the big one on
//      reasoning models - lower the reasoning/"thinking" budget. Those hidden
//      reasoning tokens bill at the OUTPUT rate and often dwarf the answer (this is
//      what is behind complaints about premium models burning tokens). Set
//      reasoning_effort / thinking.budget_tokens / thinkingBudget on YOUR request
//      (provider-specific; not wrapped here because it is one line you own).
//   2. BEST-EFFORT (the model may ignore it): the OUTPUT_FORMAT_HINT below asks for
//      a compact @T2 table instead of JSON for uniform lists (measured ~23% fewer
//      output tokens on a tabular task).
// NOTE: decodeResponse() below saves you NOTHING - it runs after the model has
// generated and you have been billed. It is plumbing to read a compact reply, not
// a discount.

// Drop this into your system prompt so the model replies in @T2 for tabular answers
// (best-effort). Pair it with decodeResponse() so your code can read the reply back
// as JSON - the SAVING is the smaller answer the model wrote, not the decode.
export const OUTPUT_FORMAT_HINT =
  "When your answer is a list of records that all share the same fields, reply " +
  "with a single TokenCodec @T2 table instead of JSON, to save output tokens. " +
  "Format: a header line '@T2 col1 int col2 string col3 float ...' where types are " +
  "int, string, float, or bool, then one space-delimited row per record, strings " +
  "double-quoted, null written as \\N, and nothing after the last row. " +
  "Use it only for uniform tabular data; answer normally (prose) for everything else.";

// Receive-side: expand any @T1/@T2 tables the model emitted back into JSON, in place.
// Safe on ordinary prose (returned unchanged); never throws, never invents data.
// This is the OUTPUT half of the round-trip.
export function decodeResponse(text, { space = 0 } = {}) {
  return decodeTables(text, {
    space,
    onLegacyFormat: () => {
      if (!warnedLegacyFormat) {
        warnedLegacyFormat = true;
        console.warn("TokenCodec: parsed legacy @T1(...) table; please migrate emitters to @T2.");
      }
    },
  });
}

// Full round-trip helper: compress the request, ask for @T2 replies, and decode
// the reply. `send` receives the compressed messages and must return the
// assistant's reply TEXT (a string). Returns the decoded text plus stats.
// Pass { injectHint: false } if you manage the system prompt yourself.
export async function withRoundTrip(messages, send, opts = {}) {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  const withHint = opts.injectHint === false
    ? messages
    : [{ role: "system", content: OUTPUT_FORMAT_HINT }, ...messages];
  const { messages: compressed, before, after, saved, flags } = compressMessages(withHint, opts);
  const reply = await send(compressed);
  const text = typeof reply === "string" ? decodeResponse(reply, { space: opts.space }) : reply;
  return { text, raw: reply, stats: { before, after, saved, flags } };
}
