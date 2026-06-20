#!/usr/bin/env node
// Local TokenCodec proxy.
//
// This sits in front of supported LLM clients, compresses JSON request bodies,
// then forwards them to the real upstream API. It does not invent a protocol;
// it simply rewrites message text before the model sees it.

import http from "node:http";
import { Readable } from "node:stream";
import { URL } from "node:url";

import { compressMessages, compressText } from "./middleware/compress.mjs";

export const DEFAULT_SESSION_PROMPT =
  "Lead with the outcome. Do not overplan. Act once you have enough information. " +
  "Before reporting progress, verify it against tool output. Delegate independent " +
  "subtasks and keep working while they run. Pause only for destructive actions, " +
  "real scope changes, or user-only input. Avoid extra refactors or abstractions. " +
  "Record useful lessons.";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function proxyDefaults(env = process.env) {
  return {
    host: env.TOKENCODEC_PROXY_HOST || "127.0.0.1",
    port: Number(env.TOKENCODEC_PROXY_PORT || 8787),
    upstream: env.TOKENCODEC_UPSTREAM_URL || "https://api.openai.com",
    mode: env.TOKENCODEC_PROXY_MODE || "token",
  };
}

export function proxyBaseUrl(host, port) {
  return `http://${host}:${port}`;
}

export function compressJsonPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { payload, changed: false, flags: [] };
  }

  const out = { ...payload };
  const flags = [];
  let changed = false;
  const sessionPrompt = sessionPromptText();

  const compressStringField = key => {
    if (typeof out[key] !== "string" || out[key].length === 0) return;
    const result = compressText(out[key]);
    if (result.saved > 0 || result.flags.length > 0) {
      out[key] = result.text;
      changed = true;
      flags.push(...result.flags);
    }
  };

  const compressMessageArray = key => {
    if (!Array.isArray(out[key])) return;
    const withPrompt = prependSessionPrompt(out[key], sessionPrompt);
    const injected = withPrompt !== out[key];
    const result = compressMessages(withPrompt);
    if (injected || result.saved > 0 || result.flags.length > 0) {
      out[key] = result.messages;
      changed = true;
      flags.push(...result.flags);
    }
  };

  compressMessageArray("messages");
  compressMessageArray("input");
  compressStringField("prompt");
  compressStringField("system");
  compressStringField("content");

  return { payload: out, changed, flags };
}

export function sessionPromptText(env = process.env) {
  const raw = env.TOKENCODEC_SESSION_PROMPT;
  if (raw === undefined || raw === null || String(raw).trim() === "") return DEFAULT_SESSION_PROMPT;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "disable") return "";
  return String(raw);
}

export function prependSessionPrompt(messages, prompt) {
  if (!prompt || !Array.isArray(messages)) return messages;
  if (messages.some(m => m && m.role === "system" && typeof m.content === "string" && m.content === prompt)) {
    return messages;
  }
  return [{ role: "system", content: prompt }, ...messages];
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function filteredHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && lower !== "host" && lower !== "content-length") out[key] = value;
  }
  return out;
}

async function forwardRequest(req, res, upstreamBase, mode) {
  const rawBody = await readBody(req);
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  let body = rawBody;

  if (rawBody && contentType.includes("json")) {
    try {
      const parsed = JSON.parse(rawBody);
      const compressed = compressJsonPayload(parsed);
      if (compressed.changed) body = JSON.stringify(compressed.payload);
    } catch {
      // If the request body is not valid JSON, forward it untouched.
    }
  }

  const upstreamUrl = new URL(req.url || "/", upstreamBase);
  const upstreamRes = await fetch(upstreamUrl, {
    method: req.method,
    headers: filteredHeaders(req.headers),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });

  res.writeHead(upstreamRes.status, filteredHeaders(Object.fromEntries(upstreamRes.headers.entries())));
  if (!upstreamRes.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstreamRes.body).on("error", err => res.destroy(err)).pipe(res);
}

export function createProxyServer({ host, port, upstream, mode } = {}) {
  const state = {
    host: host || proxyDefaults().host,
    port: Number(port || proxyDefaults().port),
    upstream: upstream || proxyDefaults().upstream,
    mode: mode || proxyDefaults().mode,
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", proxyBaseUrl(state.host, state.port));
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          status: "healthy",
          proxy: "tokencodec",
          upstream: state.upstream,
          mode: state.mode,
        }));
        return;
      }
      await forwardRequest(req, res, state.upstream, state.mode);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`tokencodec proxy error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return { server, state };
}

export async function startProxy(options = {}) {
  const { server, state } = createProxyServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(state.port, state.host, resolve);
  });
  return {
    ...state,
    server,
    close: () => new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}

async function main(argv) {
  const args = argv.slice(2);
  const host = args.includes("--host") ? args[args.indexOf("--host") + 1] : proxyDefaults().host;
  const port = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : proxyDefaults().port;
  const upstream = args.includes("--upstream") ? args[args.indexOf("--upstream") + 1] : proxyDefaults().upstream;
  const mode = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : proxyDefaults().mode;

  const proxy = await startProxy({ host, port, upstream, mode });
  console.log(`TokenCodec proxy listening on http://${proxy.host}:${proxy.port}`);
  console.log(`Forwarding to ${proxy.upstream}`);

  process.on("SIGINT", async () => { await proxy.close(); process.exit(0); });
  process.on("SIGTERM", async () => { await proxy.close(); process.exit(0); });
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
