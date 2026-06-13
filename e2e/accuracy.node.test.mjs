// End-to-end accuracy checks that need no browser:
//  1. generated artifacts (web/index.html, extension/content.js) are in sync with engine.mjs
//  2. serve.mjs serves real files, 404s missing ones, and blocks path traversal
//  3. the proofs run and emit the exact headline numbers the README cites
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const run = (cmd) => execSync(cmd, { cwd: root }).toString();

// ---------- 1. artifacts in sync ----------
{
  const web = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  const ext = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
  run("node build-web.mjs");
  run("node extension/build-extension.mjs");
  ok(fs.readFileSync(path.join(root, "web/index.html"), "utf8") === web, "web/index.html in sync with source (rebuild = no drift)");
  ok(fs.readFileSync(path.join(root, "extension/content.js"), "utf8") === ext, "extension/content.js in sync with source (rebuild = no drift)");
}

// ---------- 2. serve.mjs ----------
const rawGet = (p) => new Promise((resolve) => {
  const req = http.request({ host: "127.0.0.1", port: 8155, path: p, method: "GET" }, (res) => {
    let body = ""; res.on("data", d => body += d); res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body }));
  });
  req.on("error", () => resolve({ status: 0, body: "" }));
  req.end();
});
async function serveTests() {
  const srv = spawn("node", ["serve.mjs"], { cwd: root, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1200));
  try {
    const idx = await rawGet("/");
    ok(idx.status === 200 && idx.body.includes("Token Diet"), "serve: GET / returns the optimizer page");
    const eng = await rawGet("/engine.mjs");
    ok(eng.status === 200 && /javascript/.test(eng.type || ""), "serve: engine.mjs served as javascript");
    const miss = await rawGet("/does-not-exist.xyz");
    ok(miss.status === 404, "serve: missing file -> 404");
    const trav = await rawGet("/..%2f..%2f..%2fpackage.json");
    ok(trav.status === 404, "serve: path traversal blocked (-> 404, not 200)");
    const trav2 = await rawGet("/..%2f..%2fREADME.md");
    ok(trav2.status === 404, "serve: traversal to README blocked");
  } finally {
    srv.kill();
  }
}

// ---------- 3. proofs emit the README's numbers ----------
function proof(file) { return execSync(`python proofs/${file}`, { cwd: root }).toString(); }
function proofsTests() {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  const q = proof("query_not_haystack.py");
  ok(q.includes("41971") && q.includes("249"), "proof: query_not_haystack shows 41,971 -> 249 tokens");
  ok(q.includes("169x"), "proof: query_not_haystack shows 169x");
  ok(q.includes("16170x"), "proof: query_not_haystack shows 16,170x");
  ok(readme.includes("169x") && readme.includes("16,170x"), "README cites 169x and 16,170x (matches proof)");

  const quad = proof("quadratic_tax.py");
  ok(quad.includes("24.5x"), "proof: quadratic_tax shows 24.5x");
  ok(readme.includes("24.5x"), "README cites 24.5x (matches proof)");

  const loss = proof("lossless_proof.py");
  ok(/lossless round-trip: True/.test(loss), "proof: lossless round-trip is True");
  ok(loss.includes("74% less"), "proof: lossless shows 74% smaller vs pretty JSON");
  ok(/mismatches\s*=\s*0|mismatches:\s*0/.test(loss), "proof: lossless fuzz has 0 mismatches");
}

(async () => {
  await serveTests();
  proofsTests();
  console.log(`\nE2E (node) ACCURACY: ${pass} passed, ${fail} failed  ${fail === 0 ? "(bulletproof)" : "FAILED"}`);
  process.exit(fail ? 1 : 0);
})();
