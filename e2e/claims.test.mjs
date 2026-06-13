// Claims test (fleet TD-2): every concrete number in README.md / RESULTS.md / the web
// page is recomputed here and asserted against the prose, so the docs can never silently
// drift. If you change a benchmark, a suite, or a price, this fails until the words match.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encode } from "gpt-tokenizer/model/gpt-4o";
import { tableEncode, tableDecode, optimize } from "../engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tok = s => encode(s).length;
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const node = (...a) => execFileSync("node", a, { cwd: root, encoding: "utf8" });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === "object") ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const readme = read("README.md");
const results = read("benchmark/RESULTS.md");
const web = read("web/index.html");

// 1. The wire-format example in the README actually decodes to the records it shows.
{
  const m = readme.match(/@T1\(name:s,score:i,csat:f,remote:b\)\r?\n[^\r\n]+\r?\n[^\r\n]+/);
  ok(!!m, "README wire-format example block found");
  if (m) {
    const decoded = tableDecode(m[0].replace(/\r/g, ""));
    ok(eq(decoded, [
      { name: "Jordan Avery", score: 87, csat: 4.6, remote: true },
      { name: "Sam Rivera", score: 92, csat: 4.9, remote: false },
    ]), "README wire-format example decodes losslessly to the records it shows (strings quoted)");
  }
}

// 2. Input benchmark: 1,960 -> 900 tokens (54% smaller), and the prose says so.
{
  node("benchmark/benchmark.mjs", "generate");
  const meta = JSON.parse(read("benchmark/meta.json"));
  ok(meta.tokens_json === 1960 && meta.tokens_table === 900 && meta.saved_pct === 54,
    `input benchmark is 1960 -> 900 (54%) (got ${meta.tokens_json} -> ${meta.tokens_table}, ${meta.saved_pct}%)`);
  ok(results.includes("900 vs 1,960") && results.includes("54% smaller"), "RESULTS.md states 900 vs 1,960 / 54% smaller");
  ok(readme.includes("54%"), "README states 54%");
}

// 3. Output benchmark: the 10-record answer is 192 tokens as compact JSON, 130 as @T1 (32% fewer).
{
  node("benchmark/output_benchmark.mjs", "generate");
  const exp = JSON.parse(read("benchmark/out_truth.json"));
  const j = tok(JSON.stringify(exp)), t = tok(tableEncode(exp));
  ok(j === 192 && t === 130, `output answer is compact-JSON 192 vs @T1 130 (got ${j} vs ${t})`);
  ok(Math.round(100 * (j - t) / j) === 32, "output saving rounds to 32%");
  ok(results.includes("192 -> 130") && results.includes("192 tokens as compact JSON vs 130"), "RESULTS.md states 192 -> 130 / compact JSON");
  ok(readme.includes("130 tokens as") && readme.includes("32% fewer"), "README states 130 vs 192 / 32% fewer");
}

// 4. Pricing snapshot really yields the 4-8x output:input ratio the README cites.
{
  const pricing = JSON.parse(read("benchmark/pricing.snapshot.json"));
  const ratios = pricing.models.map(m => m.output_per_1m / m.input_per_1m);
  const lo = Math.min(...ratios), hi = Math.max(...ratios);
  ok(Math.round(lo) === 4 && Math.round(hi) === 8, `pricing snapshot ratio range rounds to 4-8x (got ${lo.toFixed(2)}-${hi.toFixed(2)})`);
  ok(readme.includes("4 to 8x"), "README states the 4 to 8x output-cost range");
}

// 5. The 8,000-trial fuzz claim matches the actual loop, and the README cites 8,000.
{
  const src = read("engine.test.mjs");
  ok(src.includes("trial < 8000"), "engine.test.mjs really runs 8,000 fuzz trials");
  ok(readme.includes("8,000"), "README cites 8,000");
}

// 6. Engine re-encode on the documented realistic prompt is ~70% (README says ~70%).
{
  const names = ["Jordan Avery", "Sam Rivera", "Casey Nguyen", "Riley Brooks", "Drew Patel"];
  const depts = ["Customer Support", "Engineering", "Sales Operations", "Marketing", "Finance"];
  const records = Array.from({ length: 80 }, (_, i) => ({
    employee_full_name: names[i % 5], department_name: depts[i % 5],
    monthly_performance_score: [87, 92, 78, 95, 81][i % 5],
    customer_satisfaction_rating: [4.6, 4.9, 4.1, 4.8, 4.3][i % 5],
    is_remote_employee: [true, false, true, true, false][i % 5],
  }));
  const prompt = "Could you please look at the data below and list which employees have a score above 90.\n\n" + JSON.stringify(records, null, 2);
  const pct = Math.round(100 * (tok(prompt) - tok(optimize(prompt).optimized)) / tok(prompt));
  ok(pct >= 65 && pct <= 75, `engine re-encode is ~70% on the realistic prompt (got ${pct}%)`);
  ok(readme.includes("~70%"), "README states ~70% for the engine re-encode");
}

// 7. Offline fallback (chars/4) is within ~30% on a data-heavy prompt, matching the page copy.
{
  const dataPrompt = read("benchmark/prompt_json.txt");
  const est = Math.ceil([...dataPrompt].length / 4), exact = tok(dataPrompt);
  const relErr = Math.abs(est - exact) / exact;
  ok(relErr <= 0.30, `chars/4 fallback within 30% on a data-heavy prompt (got ${(relErr * 100).toFixed(0)}%)`);
  ok(web.includes("within about 30% on data-heavy prompts"), "web page states the honest fallback bound");
}

// 8. Suite check-counts in the README match what the suites actually print.
{
  const suites = [
    [/ENGINE TESTS:\s+(\d+) passed/, /\*\*Engine\*\* \((\d+) checks/, "engine.test.mjs", "Engine"],
    [/INSTALLER TESTS:\s+(\d+) passed/, /\*\*Installer\*\* \((\d+) checks/, "install.test.mjs", "Installer"],
    [/MIDDLEWARE TESTS:\s+(\d+) passed/, /\*\*Middleware\*\* \((\d+) checks/, "middleware/compress.test.mjs", "Middleware"],
  ];
  for (const [outRe, readmeRe, file, label] of suites) {
    const actual = Number(node(file).match(outRe)[1]);
    const stated = Number((readme.match(readmeRe) || [])[1]);
    ok(actual === stated, `${label}: README says ${stated} checks, suite runs ${actual}`);
  }
  // node/browser counts are presence-locked here and recomputed inside their own suites
  ok(/\*\*E2E node\*\* \(\d+ checks/.test(readme), "README has an E2E node check count");
  ok(/\*\*E2E browser\*\* \(\d+ checks/.test(readme), "README has an E2E browser check count");
}

console.log(`\nCLAIMS TESTS: ${pass} passed, ${fail} failed  ${fail === 0 ? "(every datapoint validated)" : "FAILED"}`);
process.exit(fail ? 1 : 0);
