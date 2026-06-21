#!/usr/bin/env node
// TokenCodec CLI - encode, decode, and install subcommands.
//
// tokencodec encode [file]    Re-encode JSON/NDJSON to a compact @T2 table.
//                             Reads from file or stdin. Writes @T2 to stdout.
// tokencodec decode [file]    Expand @T2 tables back to readable JSON.
//                             Reads from file or stdin. Writes JSON to stdout.
// tokencodec install [flags]  Install token-efficiency rules into AI agent configs.
//                             Accepts the same flags as the standalone installer:
//                             --global, --check, --remove, --list, --dir, --dry-run
//
// Pipe-friendly: all subcommands read stdin when no file argument is given.

import fs from "node:fs";
import { optimize, decodeTables } from "./engine.mjs";

const [, , sub, ...rest] = process.argv;

function readInput(fileArg) {
  if (fileArg && !fileArg.startsWith("--")) {
    return fs.readFileSync(fileArg, "utf8");
  }
  // stdin - read synchronously via fd 0
  return fs.readFileSync(0, "utf8");
}

function printHelp() {
  console.log(`
TokenCodec — lossless JSON/NDJSON codec for LLM prompts

Usage:
  tokencodec encode [file]    Compress JSON/NDJSON to a compact @T2 table
  tokencodec decode [file]    Expand @T2 tables back to JSON
  tokencodec install [flags]  Install token-efficiency rules into AI agent configs

Options for install:
  --global      Install into user-level files (all repos)
  --check       Report status and exit 1 if outdated (CI)
  --remove      Strip the managed block from every target
  --list        List target files
  --dir <path>  Operate on <path> instead of current directory
  --dry-run     Preview without writing

Examples:
  cat data.json | tokencodec encode
  tokencodec encode data.json > compressed.txt
  tokencodec decode reply.txt
  echo '[{"x":1},{"x":2},{"x":3}]' | tokencodec encode | tokencodec decode
  tokencodec install
  tokencodec install --global
  tokencodec install --check
`.trim());
}

switch (sub) {
  case "encode": {
    const input = readInput(rest[0]);
    const { optimized } = optimize(input);
    process.stdout.write(optimized);
    if (!optimized.endsWith("\n")) process.stdout.write("\n");
    break;
  }

  case "decode": {
    const input = readInput(rest[0]);
    const expanded = decodeTables(input, { space: 2 });
    process.stdout.write(expanded);
    if (!expanded.endsWith("\n")) process.stdout.write("\n");
    break;
  }

  case "install": {
    // Delegate to the full installer, forwarding all flags.
    // Re-inject "install" into argv so install.mjs sees a clean process.argv.
    process.argv = [process.argv[0], "install.mjs", ...rest];
    await import("./install.mjs");
    break;
  }

  case undefined:
  case "--help":
  case "-h":
  case "help":
    printHelp();
    break;

  default:
    console.error(`tokencodec: unknown subcommand '${sub}'\nRun 'tokencodec --help' for usage.`);
    process.exit(1);
}
