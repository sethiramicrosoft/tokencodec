// Token Diet — API-side prompt compressor.
//
// For production apps that burn tokens at RUNTIME (not just while you code).
// Drop this in front of your LLM call to shrink prompts before they are billed.
// Dependency-free: it reuses the same lossless engine the CLI and web tool use.
//
// It compresses the *text* of your messages (re-encoding embedded JSON/NDJSON
// data into a compact lossless table, stripping filler). It never invents or
// drops information, so the model sees the same facts for fewer tokens.

import { optimize } from "../engine.mjs";

// Rough, dependency-free token estimate (~4 chars/token). Pass your real
// tokenizer via { tokenizer } for exact numbers (e.g. gpt-tokenizer's encode).
const estimateTokens = s => Math.ceil([...s].length / 4);

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
export function compressMessages(messages, { tokenizer, skipRoles = [] } = {}) {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  let before = 0, after = 0;
  const flags = [];
  const collect = (role, r) => { before += r.before; after += r.after; for (const f of r.flags) flags.push({ role, ...f }); };

  const out = messages.map(m => {
    if (!m || skipRoles.includes(m.role)) return m;
    if (typeof m.content === "string") {
      const r = compressText(m.content, { tokenizer });
      collect(m.role, r);
      return { ...m, content: r.text };
    }
    if (Array.isArray(m.content)) {
      const content = m.content.map(part => {
        if (part && part.type === "text" && typeof part.text === "string") {
          const r = compressText(part.text, { tokenizer });
          collect(m.role, r);
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
