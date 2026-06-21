// Output-side benchmark: when the model RETURNS structured data, does emitting the
// compact @T2 table (which we can decode losslessly) save output tokens versus
// returning JSON - and does the model produce the format correctly?
//
// Input compression is proven elsewhere. This measures the harder direction:
// producing a precise compact format is harder for a model than reading one.
//
// Usage:
//   node benchmark/output_benchmark.mjs generate
//   node benchmark/output_benchmark.mjs score <json|table> <reply.txt>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "gpt-tokenizer/model/gpt-4o";
import { tableDecode } from "../engine.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const tok = s => encode(s).length;
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === "object") ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const names = ["Jordan Avery", "Sam Rivera", "Casey Nguyen", "Riley Brooks", "Drew Patel", "Avery Okafor", "Quinn Santos", "Reese Khan", "Skyler Lowe", "Harper Park", "Emerson Diaz", "Rowan Cole", "Sage Reyes", "Blake Frost", "Hayden Mehta", "Parker Bauer", "Finley Ramos", "Tatum Nash", "Marlow Walsh", "Ellis Pierce"];
const depts = ["Engineering", "Support", "Sales", "Marketing", "Finance"];
const regions = ["APAC", "EMEA", "NA"];

function buildData() {
  return names.map((name, i) => ({ name, dept: depts[i % 5], score: 70 + ((i * 9 + 4) % 30), region: regions[i % 3] }));
}
// the task both variants must answer: records with score >= 85, sorted by score desc (then name asc for ties)
function expected(data) {
  return data.filter(r => r.score >= 85).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

const TASK = "From the records, return only those with score of 85 or more, sorted by score from highest to lowest (break ties by name A-Z).";

function generate() {
  const data = buildData();
  const exp = expected(data);
  const input = JSON.stringify(data);

  const promptJson =
    `${TASK}\n\nRecords:\n${input}\n\n` +
    "Return ONLY a JSON array of the matching record objects (same fields: name, dept, score, region). No prose, no code fence.";

  const promptTable =
    `${TASK}\n\nRecords:\n${input}\n\n` +
    "Return ONLY a compact @T2 table of the matching records, no prose and no code fence, in EXACTLY this format:\n" +
    "first line: @T2 name string dept string score int region string\n" +
    "then one record per line, space-delimited, in that column order; quote every string value with double quotes; integers bare.\n" +
    'Example row: "Jane Doe" "Engineering" 91 "NA"';

  fs.writeFileSync(path.join(dir, "prompt_out_json.txt"), promptJson);
  fs.writeFileSync(path.join(dir, "prompt_out_table.txt"), promptTable);
  fs.writeFileSync(path.join(dir, "out_truth.json"), JSON.stringify(exp, null, 2));
  console.log(`expected ${exp.length} records. tokens in: json-prompt=${tok(promptJson)} table-prompt=${tok(promptTable)}`);
  console.log("wrote prompt_out_json.txt, prompt_out_table.txt, out_truth.json");
}

function score(variant, replyPath) {
  const exp = JSON.parse(fs.readFileSync(path.join(dir, "out_truth.json"), "utf8"));
  let raw = fs.readFileSync(replyPath, "utf8").trim();
  raw = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim(); // tolerate accidental fences
  const outTokens = tok(raw);
  let parsed, ok = false, err = "";
  try {
    if (variant === "json") parsed = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    else parsed = tableDecode(raw.slice(raw.indexOf("@T2 ")));
    ok = eq(parsed, exp);
  } catch (e) { err = e.message; }
  console.log(`[${variant}] output tokens: ${outTokens} | correct: ${ok}${err ? " | parse error: " + err : ""}`);
  return { outTokens, ok };
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "generate") generate();
else if (cmd === "score") score(a, b);
else { console.log("usage: node benchmark/output_benchmark.mjs generate | score <json|table> <reply.txt>"); process.exit(1); }
