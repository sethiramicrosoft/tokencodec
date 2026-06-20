#!/usr/bin/env node
// Launcher wrapper for TokenCodec.
//
// Starts the local proxy, then launches a supported CLI with the env vars that
// point it at the proxy. This is the "single command" front door for users who
// want interception instead of copy/paste.

import { spawn } from "node:child_process";
import process from "node:process";

import { DEFAULT_SESSION_PROMPT, proxyDefaults, proxyBaseUrl, sessionPromptText, startProxy } from "./proxy.mjs";

const PROFILES = {
  claude: {
    command: "claude",
    upstream: "https://api.anthropic.com",
    env: port => ({ ANTHROPIC_BASE_URL: proxyBaseUrl("127.0.0.1", port) }),
    sessionPrompt: DEFAULT_SESSION_PROMPT,
  },
  codex: {
    command: "codex",
    upstream: "https://api.openai.com",
    env: port => ({ OPENAI_BASE_URL: `${proxyBaseUrl("127.0.0.1", port)}/v1` }),
    sessionPrompt: DEFAULT_SESSION_PROMPT,
  },
  openai: {
    command: "openai",
    upstream: "https://api.openai.com",
    env: port => ({ OPENAI_BASE_URL: `${proxyBaseUrl("127.0.0.1", port)}/v1` }),
    sessionPrompt: DEFAULT_SESSION_PROMPT,
  },
  copilot: {
    command: "copilot",
    upstream: "https://api.githubcopilot.com",
    env: port => ({
      GITHUB_COPILOT_API_URL: proxyBaseUrl("127.0.0.1", port),
      OPENAI_TARGET_API_URL: proxyBaseUrl("127.0.0.1", port),
      OPENAI_BASE_URL: `${proxyBaseUrl("127.0.0.1", port)}/v1`,
      COPILOT_PROVIDER_API_URL: `${proxyBaseUrl("127.0.0.1", port)}/v1`,
      COPILOT_PROVIDER_BASE_URL: `${proxyBaseUrl("127.0.0.1", port)}/v1`,
      COPILOT_PROVIDER_TYPE: "openai",
      COPILOT_PROVIDER_WIRE_API: "completions",
      GITHUB_COPILOT_USE_TOKEN_EXCHANGE: "false",
      COPILOT_AUTH_MODE: "github-oauth",
    }),
    sessionPrompt: DEFAULT_SESSION_PROMPT,
  },
};

export function buildWrapPlan(profileName, port, env = process.env) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`unknown profile: ${profileName}`);
  return {
    profile: profileName,
    command: env.TOKENCODEC_COMMAND || profile.command,
    args: [],
    proxy: {
      host: proxyDefaults(env).host,
      port,
      upstream: env.TOKENCODEC_UPSTREAM_URL || profile.upstream,
    },
    env: {
      ...profile.env(port),
      TOKENCODEC_SESSION_PROMPT: sessionPromptText(env) || profile.sessionPrompt || DEFAULT_SESSION_PROMPT,
    },
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const profile = args[0];
  const sep = args.indexOf("--");
  const commandArgs = sep >= 0 ? args.slice(sep + 1) : [];
  const before = sep >= 0 ? args.slice(1, sep) : args.slice(1);
  const portIndex = before.indexOf("--port");
  const port = portIndex >= 0 ? Number(before[portIndex + 1]) : proxyDefaults().port;
  const hostIndex = before.indexOf("--host");
  const host = hostIndex >= 0 ? before[hostIndex + 1] : proxyDefaults().host;
  return { profile, commandArgs, port, host };
}

async function main(argv) {
  const { profile, commandArgs, port, host } = parseArgs(argv);
  if (!profile || !PROFILES[profile]) {
    console.error("Usage: node wrap.mjs <claude|codex|openai|copilot> [--port N] [--host H] [-- command args...]");
    process.exit(2);
  }

  const plan = buildWrapPlan(profile, port);
  plan.proxy.host = host;

  const proxy = await startProxy(plan.proxy);
  const command = process.env.TOKENCODEC_COMMAND || plan.command;
  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...plan.env,
    },
  });

  const shutdown = async code => {
    try { await proxy.close(); } catch {}
    if (typeof code === "number") process.exit(code);
  };

  child.on("exit", (code, signal) => shutdown(typeof code === "number" ? code : (signal ? 130 : 0)));
  child.on("error", async err => {
    try { await proxy.close(); } catch {}
    console.error(err);
    process.exit(1);
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
