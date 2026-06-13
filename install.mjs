#!/usr/bin/env node
// TokenCodec installer.
// Writes a token-efficiency rules block into every AI coding agent's config
// file, via an idempotent managed block. Safe to run repeatedly: it preserves
// everything outside the block and never keeps duplicates.
//
// Usage:
//   node install.mjs            install/update into this repo
//   node install.mjs --global   install into the user-level files that CLI agents
//                               read for EVERY repo: ~/.copilot/copilot-instructions.md
//                               (Copilot CLI), ~/.claude/CLAUDE.md (Claude Code),
//                               ~/.codex/AGENTS.md (Codex), ~/.gemini/GEMINI.md (Gemini)
//   node install.mjs --check    report status; exit 1 if missing/outdated (CI)
//   node install.mjs --remove   strip the managed block from every target
//   node install.mjs --list     list target files
//   node install.mjs --dir <p>  operate on <p> instead of the current directory
//   (--check / --remove / --dry-run all accept --global too)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const VERSION = "1";
const START = `<!-- TOKENCODEC:START v${VERSION} (managed by tokencodec; edit rules upstream, not here) -->`;
const END = "<!-- TOKENCODEC:END -->";

export const BODY = `# TokenCodec - read this before doing anything

Optimize for tokens. Never trade away correctness to do it. If a step genuinely
needs the whole file or dataset, use it.

## Rules
1. Search before you read. Use ripgrep/grep and open files by line range. Do not
   read a whole file or directory to find one symbol.
2. Query data, do not paste it. To answer anything computable about a CSV, JSON,
   database or log, write a query or a few lines of code, run it, and keep only
   the result. Pasting 600 rows is ~42k tokens; the query is ~250.
3. Compact any data you must include. Use a header-once table (CSV/TSV), not
   indented JSON. Drop whitespace. Same data, ~4x fewer tokens, fully reversible.
4. Do not re-read. Remember what you already opened this session; reopen only on
   change.
5. Trim tool output. Pipe noisy commands through head/grep or use quiet flags.
   Surface failures and summaries, not full build or test logs.
6. Small diffs only. Make surgical edits and show diffs, not whole files. If a
   change exceeds ~400 lines, propose a split first.
7. Keep history short. Maintain a compact running state. A conversation's cost
   grows with the square of its length, so do not re-quote large context or
   restate the whole plan every turn.
8. Cut filler. Terse, direct instructions. No politeness padding, no restating.
9. Keep a stable prefix. Hold system/context constant so the provider can cache
   it; do not reshuffle it on each call.

## Output (what you write back, not just what you read - output tokens are billed ~4-8x input)
10. Be brief. No preamble, no restating the question, no recap of what you just did
    unless asked. Answer in the fewest tokens that fully answer.
11. When you emit structured data, return a compact table (CSV or header-once), not
    pretty-printed JSON.
12. Use the lowest reasoning effort that solves the task, and do not narrate your
    thinking unless asked.

## One-line self-check
Before sending: am I pasting anything the model could fetch, grep, or compute
itself? If yes, do that instead.`;

const MDC_FRONTMATTER = `---
description: Token-efficient behavior for AI coding agents (TokenCodec)
alwaysApply: true
---
`;

// tool -> file, and optional header used only when creating the file fresh
export const TARGETS = [
  { tool: "Universal (Codex, Cursor, Aider, Copilot, Gemini fallback)", file: "AGENTS.md", header: "# AGENTS.md\n" },
  { tool: "Claude Code", file: "CLAUDE.md", header: "# CLAUDE.md\n" },
  { tool: "Gemini CLI", file: "GEMINI.md", header: "# GEMINI.md\n" },
  { tool: "GitHub Copilot", file: path.join(".github", "copilot-instructions.md"), header: "# Copilot instructions\n" },
  { tool: "Cursor (native rules)", file: path.join(".cursor", "rules", "tokencodec.mdc"), header: MDC_FRONTMATTER },
];

// Global targets live under the user's home and apply across every repo. Each of
// these CLIs reads its file for all sessions, so one --global run covers them.
export const GLOBAL_TARGETS = [
  { tool: "GitHub Copilot CLI (all your repos)", rel: path.join(".copilot", "copilot-instructions.md"), label: "~/.copilot/copilot-instructions.md", header: "# Copilot CLI instructions\n" },
  { tool: "Claude Code (user memory)", rel: path.join(".claude", "CLAUDE.md"), label: "~/.claude/CLAUDE.md", header: "# CLAUDE.md\n" },
  { tool: "OpenAI Codex CLI (global)", rel: path.join(".codex", "AGENTS.md"), label: "~/.codex/AGENTS.md", header: "# AGENTS.md\n" },
  { tool: "Gemini CLI (global)", rel: path.join(".gemini", "GEMINI.md"), label: "~/.gemini/GEMINI.md", header: "# GEMINI.md\n" },
];

// Resolve the active target set and the containment root for the chosen mode.
function resolveTargets(dir, { global = false, home = os.homedir() } = {}) {
  if (global) {
    return { root: home, items: GLOBAL_TARGETS.map(t => ({ tool: t.tool, abs: path.join(home, t.rel), label: t.label, header: t.header })) };
  }
  const root = path.resolve(dir);
  return { root, items: TARGETS.map(t => ({ tool: t.tool, abs: path.join(root, t.file), label: t.file, header: t.header })) };
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex metacharacters
const BLOCK_RE = new RegExp(escapeRe(START) + "[\\s\\S]*?" + escapeRe(END), "g");
const START_RE = new RegExp(escapeRe(START), "g");
const END_RE = new RegExp(escapeRe(END), "g");

const block = () => `${START}\n${BODY}\n${END}`;

// stripBlocks: remove every complete managed block, THEN any orphan marker left
// by a malformed file (a lone START without END, or END without START). This is
// what makes the installer self-healing instead of appending a second block.
const stripBlocks = content => content.replace(BLOCK_RE, "").replace(START_RE, "").replace(END_RE, "");

// All well-formed managed-block bodies in a file (forge-resistant: callers can
// require EXACTLY one, so a decoy block prepended before a tampered one fails).
function getBlockBodies(content) {
  const re = new RegExp(escapeRe(START) + "\\n?([\\s\\S]*?)\\n?" + escapeRe(END), "g");
  return [...content.matchAll(re)].map(m => m[1].replace(/^\n/, "").replace(/\n$/, ""));
}
// First block body, or null. Kept for "is this file ours?" checks.
function getBlockBody(content) {
  const bodies = getBlockBodies(content);
  return bodies.length ? bodies[0] : null;
}

// Refuse to write through a symlink or to any path whose real parent escapes the
// target root. Stops a malicious repo from planting a symlink at a target path to
// clobber files elsewhere. Parent dir must already exist when this is called.
function assertSafeWriteTarget(rootDir, absPath) {
  const rootReal = fs.realpathSync(path.resolve(rootDir));
  const parentReal = fs.realpathSync(path.dirname(absPath));
  const rel = path.relative(rootReal, parentReal);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw new Error(`refusing to write outside target dir: ${absPath}`);
  if (fs.existsSync(absPath) && fs.lstatSync(absPath).isSymbolicLink())
    throw new Error(`refusing to follow symlink: ${absPath}`);
}

function render(existing, header) {
  const stripped = stripBlocks(existing).replace(/[ \t]+\n/g, "\n").replace(/\s+$/, "");
  if (stripped.trim().length === 0) {
    return (header ? header + "\n" : "") + block() + "\n";
  }
  return stripped + "\n\n" + block() + "\n";
}

// Forge-resistant status: a file is "ok" only if it has EXACTLY ONE managed
// block and that block equals the current BODY. Decoy/duplicate/tampered -> not ok.
function statusOf(absPath) {
  if (!fs.existsSync(absPath)) return "missing";
  let content;
  try { content = fs.readFileSync(absPath, "utf8"); }
  catch { return "outdated"; } // unreadable / directory -> needs attention, never silently ok
  const bodies = getBlockBodies(content);
  if (bodies.length === 0) return "missing";
  if (bodies.length !== 1) return "outdated";
  return bodies[0] === BODY ? "ok" : "outdated";
}

function install(dir, { dryRun = false, global = false, home } = {}) {
  const { root, items } = resolveTargets(dir, { global, home });
  fs.mkdirSync(root, { recursive: true });
  console.log(dryRun ? "TokenCodec -> DRY RUN (no files written)\n" : `TokenCodec -> installing token-efficiency rules${global ? " (global: all your repos)" : ""}\n`);
  for (const t of items) {
    const abs = t.abs;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        console.log(`  skipped (path is a directory)  ${t.label}`);
        continue;
      }
      const existed = fs.existsSync(abs);
      const out = render(existed ? fs.readFileSync(abs, "utf8") : "", t.header);
      if (dryRun) { console.log(`  would ${existed ? "update" : "create"}  ${t.label}`); continue; }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      assertSafeWriteTarget(root, abs);
      fs.writeFileSync(abs, out);
      console.log(`  ${existed ? "updated" : "created"}  ${t.label.padEnd(34)} (${t.tool})`);
    } catch (e) {
      console.log(`  skipped (${e.code || e.message})  ${t.label}`); // one bad target never aborts the rest
    }
  }
  if (dryRun) { console.log("\nDry run only. Re-run without --dry-run to apply."); return; }
  console.log(global ? "\nDone. Copilot CLI now runs token-efficient in every repo." : "\nDone. Every agent in this repo now runs token-efficient.");
  console.log("Run with --check in CI to keep it that way.");
}

function check(dir, { global = false, home } = {}) {
  const { items } = resolveTargets(dir, { global, home });
  let bad = 0;
  console.log("TokenCodec -> status\n");
  for (const t of items) {
    const st = statusOf(t.abs);
    if (st !== "ok") bad++;
    const mark = st === "ok" ? "ok      " : st === "outdated" ? "OUTDATED" : "MISSING ";
    console.log(`  ${mark}  ${t.label}`);
  }
  if (bad) { console.log(`\n${bad} file(s) need 'tokencodec'. Run it to fix.`); process.exitCode = 1; }
  else console.log("\nAll targets present and current.");
}

function remove(dir, { global = false, home } = {}) {
  const { root, items } = resolveTargets(dir, { global, home });
  console.log("TokenCodec -> removing managed blocks\n");
  for (const t of items) {
    const abs = t.abs;
    if (!fs.existsSync(abs)) continue;
    try {
      if (fs.statSync(abs).isDirectory()) continue;
      const content = fs.readFileSync(abs, "utf8");
      if (!content.includes(START) && !content.includes(END)) continue; // not ours; leave untouched
      assertSafeWriteTarget(root, abs);
      const cleaned = stripBlocks(content).replace(/[ \t]+\n/g, "\n").replace(/\s+$/, "");
      const headerTrim = (t.header || "").trim();
      if (cleaned.trim() === "" || cleaned.trim() === headerTrim) {
        fs.rmSync(abs);
        console.log(`  removed file  ${t.label}`);
      } else {
        fs.writeFileSync(abs, cleaned + "\n");
        console.log(`  cleaned       ${t.label}`);
      }
    } catch (e) {
      console.log(`  skipped (${e.code || e.message})  ${t.label}`);
    }
  }
}

function list() {
  console.log("TokenCodec targets (per repo):\n");
  for (const t of TARGETS) console.log(`  ${t.file.padEnd(34)} ${t.tool}`);
  console.log("\nGlobal target (--global), applies to every repo:\n");
  for (const t of GLOBAL_TARGETS) console.log(`  ${t.label.padEnd(34)} ${t.tool}`);
}

function main(argv) {
  const args = argv.slice(2);
  const di = args.indexOf("--dir");
  const dir = di >= 0 ? args[di + 1] : process.cwd();
  if (di >= 0 && !dir) { console.error("--dir needs a path"); process.exit(2); }
  const global = args.includes("--global");
  if (args.includes("--list")) return list();
  if (args.includes("--check")) return check(dir, { global });
  if (args.includes("--remove")) return remove(dir, { global });
  return install(dir, { dryRun: args.includes("--dry-run"), global });
}

// run only when invoked directly, so tests can import the helpers
import { fileURLToPath } from "node:url";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}

export { install, check, remove, getBlockBody, getBlockBodies, stripBlocks, render, statusOf, assertSafeWriteTarget, resolveTargets, START, END };
