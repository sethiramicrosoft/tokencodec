// CLI integration tests: every subcommand (encode, decode, install) exercised
// via real process spawning with real data. No mocks, no imports - the binary is
// invoked the same way a user would invoke it from the terminal.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "cli.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };

function run(args, input) {
  const r = spawnSync("node", [cli, ...args], {
    input: input ?? undefined,
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
  });
  return { stdout: r.stdout || "", stderr: r.stderr || "", status: r.status ?? 1 };
}

const canon = v =>
  Array.isArray(v) ? v.map(canon)
  : (v && typeof v === "object") ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
  : v;
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// 1. --help exits 0 and describes all subcommands
{
  const r = run(["--help"]);
  ok(r.status === 0, "--help exits 0");
  ok(r.stdout.includes("TokenCodec"), "--help mentions TokenCodec");
  ok(r.stdout.includes("encode") && r.stdout.includes("decode") && r.stdout.includes("install"),
    "--help lists all three subcommands");
}

// 2. no args shows help and exits 0
{
  const r = run([]);
  ok(r.status === 0, "no-args exits 0");
  ok(r.stdout.includes("encode"), "no-args shows help with subcommand list");
}

// 3. unknown subcommand exits 1 with an error message
{
  const r = run(["explode"]);
  ok(r.status === 1, "unknown subcommand exits 1");
  ok(r.stderr.includes("unknown subcommand"), "unknown subcommand prints error to stderr");
}

// 4. encode: JSON array via stdin produces @T2 on stdout
{
  const rows = [
    { name: "Alice", score: 95, passed: true },
    { name: "Bob",   score: 87, passed: true },
    { name: "Carol", score: 61, passed: false },
  ];
  const r = run(["encode"], JSON.stringify(rows));
  ok(r.status === 0, "encode JSON array: exits 0");
  ok(r.stdout.includes("@T2 "), "encode JSON array: @T2 in output");
  ok(r.stdout.includes("name string") && r.stdout.includes("score int") && r.stdout.includes("passed bool"),
    "encode JSON array: header names and types correct");
}

// 5. encode: NDJSON (newline-delimited) via stdin produces @T2
{
  const rows = [{ x: 1, y: "alpha" }, { x: 2, y: "beta" }, { x: 3, y: "gamma" }];
  const ndjson = rows.map(r => JSON.stringify(r)).join("\n");
  const r = run(["encode"], ndjson);
  ok(r.status === 0, "encode NDJSON: exits 0");
  ok(r.stdout.includes("@T2 "), "encode NDJSON: produces @T2 output");
}

// 6. encode → decode pipeline: byte-exact round-trip
{
  const original = [
    { id: 1, city: "Oslo",       pop: 700000,  active: true  },
    { id: 2, city: "Bergen",     pop: 280000,  active: false },
    { id: 3, city: "Stavanger",  pop: 144000,  active: true  },
    { id: 4, city: "Trondheim",  pop: 205000,  active: true  },
    { id: 5, city: "Tromsø",     pop:  79000,  active: false },
  ];
  const enc = run(["encode"], JSON.stringify(original));
  ok(enc.status === 0, "encode step exits 0");
  ok(enc.stdout.includes("@T2 "), "encode step outputs @T2");

  const dec = run(["decode"], enc.stdout);
  ok(dec.status === 0, "decode step exits 0");

  try {
    const recovered = JSON.parse(dec.stdout);
    ok(eq(recovered, original), "encode → decode round-trip: records identical to original");
    ok(recovered[0].id === 1 && recovered[4].city === "Tromsø", "spot-check: first and last records correct");
  } catch {
    ok(false, "decode output is not valid JSON");
  }
}

// 7. encode: a single JSON object (not an array) is passed through unchanged
{
  const obj = { not: "an-array", scalar: 42 };
  const r = run(["encode"], JSON.stringify(obj));
  ok(r.status === 0, "encode single-object: exits 0");
  ok(!r.stdout.includes("@T2"), "encode single-object: no @T2 (passthrough)");
}

// 8. decode: @T2 text produces valid JSON array
{
  const rows = [{ a: 10, b: 20 }, { a: 30, b: 40 }, { a: 50, b: 60 }];
  const enc = run(["encode"], JSON.stringify(rows));
  ok(enc.stdout.includes("@T2 "), "decode-test: encode produced @T2");

  const dec = run(["decode"], enc.stdout);
  ok(dec.status === 0, "decode @T2: exits 0");

  try {
    const out = JSON.parse(dec.stdout);
    ok(Array.isArray(out) && out.length === 3, "decode @T2: output is array of 3 records");
    ok(out[0].a === 10 && out[2].b === 60, "decode @T2: values correct");
  } catch {
    ok(false, "decode @T2 output not valid JSON");
  }
}

// 9. decode: plain text with no @T2 tables is returned unchanged
{
  const plain = "This is ordinary prose with no table.\n";
  const r = run(["decode"], plain);
  ok(r.status === 0, "decode plain text: exits 0");
  ok(r.stdout.trim() === plain.trim(), "decode plain text: returned unchanged");
}

// 10. encode: read from a file (not stdin)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-cli-enc-"));
  try {
    const rows = [{ n: 1, v: "x" }, { n: 2, v: "y" }, { n: 3, v: "z" }];
    const file = path.join(tmp, "data.json");
    fs.writeFileSync(file, JSON.stringify(rows));
    const r = run(["encode", file]);
    ok(r.status === 0, "encode from file: exits 0");
    ok(r.stdout.includes("@T2 "), "encode from file: @T2 in output");
    // round-trip from file
    const dec = run(["decode"], r.stdout);
    ok(eq(JSON.parse(dec.stdout), rows), "encode from file → decode: round-trip identical");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 11. decode: read from a file (not stdin)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-cli-dec-"));
  try {
    const rows = [{ p: 100, q: true }, { p: 200, q: false }];
    const enc = run(["encode"], JSON.stringify(rows));
    const file = path.join(tmp, "encoded.txt");
    fs.writeFileSync(file, enc.stdout);
    const dec = run(["decode", file]);
    ok(dec.status === 0, "decode from file: exits 0");
    ok(eq(JSON.parse(dec.stdout), rows), "decode from file: records identical");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 12. install --dry-run: exits 0 and writes no files
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-cli-dry-"));
  try {
    const r = run(["install", "--dry-run", "--dir", tmp]);
    ok(r.status === 0, "install --dry-run: exits 0");
    const written = fs.readdirSync(tmp, { recursive: true });
    ok(written.length === 0, "install --dry-run: no files written to disk");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 13. install --check on empty dir exits 1; install then check exits 0
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-cli-chk-"));
  try {
    const before = run(["install", "--check", "--dir", tmp]);
    ok(before.status === 1, "install --check on empty dir: exits 1 (files missing)");

    run(["install", "--dir", tmp]);
    const after = run(["install", "--check", "--dir", tmp]);
    ok(after.status === 0, "install --check after install: exits 0 (all present)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 14. install is idempotent: running twice leaves files byte-identical
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-cli-idem-"));
  try {
    run(["install", "--dir", tmp]);
    const snapshot = fs.readdirSync(tmp, { recursive: true })
      .filter(f => !fs.statSync(path.join(tmp, f)).isDirectory())
      .sort()
      .map(f => fs.readFileSync(path.join(tmp, f), "utf8"));

    run(["install", "--dir", tmp]);
    const after = fs.readdirSync(tmp, { recursive: true })
      .filter(f => !fs.statSync(path.join(tmp, f)).isDirectory())
      .sort()
      .map(f => fs.readFileSync(path.join(tmp, f), "utf8"));

    ok(JSON.stringify(snapshot) === JSON.stringify(after),
      "install is idempotent: second run produces byte-identical files");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\nCLI INTEGRATION: ${pass} passed, ${fail} failed  ${fail === 0 ? "(bulletproof)" : "FAILED"}`);
process.exit(fail ? 1 : 0);
