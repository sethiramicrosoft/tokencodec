// Accuracy benchmark: does a real LLM answer questions about data just as well
// when the data is given as the compact @T2 table as it does from raw JSON?
//
// This is the decisive test for TokenCodec's "feed it to the model" promise.
// The codec being lossless is already proven by the fuzz tests; this measures
// whether the MODEL reads the compact form as accurately as JSON.
//
// Usage:
//   node benchmark/benchmark.mjs generate     -> writes prompts + ground truth
//   node benchmark/benchmark.mjs score <variant> <answers.json>
//        variant = json | table ; prints per-question correctness and accuracy
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "gpt-tokenizer/model/gpt-4o";
import { tableEncode } from "../engine.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const tok = s => encode(s).length;

// ---- a fixed, deterministic dataset (seeded; no ties on argmax/argmin) ----
const firsts = ["Jordan", "Sam", "Casey", "Riley", "Drew", "Avery", "Quinn", "Reese", "Skyler", "Harper", "Emerson", "Rowan", "Sage", "Blake", "Hayden", "Parker", "Finley", "Tatum", "Marlow", "Ellis", "Cameron", "Dakota", "Lennon", "Monroe", "Sawyer", "Teagan", "Wren", "Zion", "Aubrey", "Briar"];
const lasts = ["Avery", "Rivera", "Nguyen", "Brooks", "Patel", "Okafor", "Santos", "Khan", "Lowe", "Park", "Diaz", "Cole", "Reyes", "Frost", "Mehta", "Bauer", "Ramos", "Nash", "Walsh", "Pierce", "Lyle", "Boone", "Cates", "Vance", "Ford", "Hale", "Ibe", "Jung", "Kerr", "Lund"];
const depts = ["Engineering", "Customer Support", "Sales Operations", "Marketing", "Finance"];
const regions = ["APAC", "EMEA", "NA"];

function buildData() {
  const recs = [];
  for (let i = 0; i < 30; i++) {
    recs.push({
      name: `${firsts[i]} ${lasts[i]}`,
      dept: depts[i % 5],
      score: 70 + ((i * 7 + 3) % 30),           // 70..99, varied
      tickets: 10 + ((i * 13 + 5) % 200),        // spread
      csat: Math.round((3.5 + ((i * 3) % 15) / 10) * 10) / 10, // 3.5..4.9
      remote: i % 3 === 0,
      region: regions[i % 3],
    });
  }
  // guarantee a unique max tickets and unique min score for clean argmax/argmin
  recs[17].tickets = 999;  // unique global max
  recs[8].score = 41;      // unique global min
  return recs;
}

const QUESTIONS = [
  { id: "q1", text: "How many employees work in the Engineering department?", truth: d => d.filter(r => r.dept === "Engineering").length },
  { id: "q2", text: "What is the total of the tickets field across all employees?", truth: d => d.reduce((a, r) => a + r.tickets, 0) },
  { id: "q3", text: "What is the average score across all employees, rounded to 1 decimal place?", truth: d => Math.round((d.reduce((a, r) => a + r.score, 0) / d.length) * 10) / 10 },
  { id: "q4", text: "Which employee has the highest tickets value? Give their full name exactly.", truth: d => d.reduce((m, r) => r.tickets > m.tickets ? r : m).name },
  { id: "q5", text: "Which employee has the lowest score? Give their full name exactly.", truth: d => d.reduce((m, r) => r.score < m.score ? r : m).name },
  { id: "q6", text: "How many employees have a score greater than 90?", truth: d => d.filter(r => r.score > 90).length },
  { id: "q7", text: "How many employees are remote (remote = true)?", truth: d => d.filter(r => r.remote).length },
  { id: "q8", text: "Which region appears most often? Give the region code.", truth: d => { const c = {}; for (const r of d) c[r.region] = (c[r.region] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; } },
  { id: "q9", text: "What is the csat value of the employee whose name is given here: __NAME__? Give just the number.", truth: d => d[12].csat, name: d => d[12].name },
  { id: "q10", text: "How many employees work in Finance?", truth: d => d.filter(r => r.dept === "Finance").length },
];

const LEGEND =
  "The data below is a compact table. The first line `@T2 col type col type ...` names the columns once; " +
  "every following line is one record, space-delimited, in that column order. " +
  "Types: string, int, float, bool (1=true, 0=false); \\N means null; string values are quoted.";

function questionsText(data) {
  return QUESTIONS.map((q, i) => `${q.id}. ${q.text.replace("__NAME__", q.name ? q.name(data) : "")}`).join("\n");
}
const INSTRUCTION = "Answer every question using ONLY the data above. Reply with ONLY a single minified JSON object mapping each id (q1..q10) to its answer value (a number or a string), and nothing else.";

function generate() {
  const data = buildData();
  const json = JSON.stringify(data, null, 2);
  const table = tableEncode(data);
  const qs = questionsText(data);

  const promptJson = `Here is a dataset as JSON:\n\n${json}\n\nQuestions:\n${qs}\n\n${INSTRUCTION}`;
  const promptTable = `${LEGEND}\n\n${table}\n\nQuestions:\n${qs}\n\n${INSTRUCTION}`;

  const truth = {};
  for (const q of QUESTIONS) truth[q.id] = q.truth(data);

  fs.writeFileSync(path.join(dir, "prompt_json.txt"), promptJson);
  fs.writeFileSync(path.join(dir, "prompt_table.txt"), promptTable);
  fs.writeFileSync(path.join(dir, "ground_truth.json"), JSON.stringify(truth, null, 2));
  const meta = { tokens_json: tok(promptJson), tokens_table: tok(promptTable) };
  meta.saved_pct = Math.round(100 * (meta.tokens_json - meta.tokens_table) / meta.tokens_json);
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));

  console.log("ground truth:", JSON.stringify(truth));
  console.log(`tokens  JSON=${meta.tokens_json}  TABLE=${meta.tokens_table}  (table is ${meta.saved_pct}% smaller)`);
  console.log("wrote prompt_json.txt, prompt_table.txt, ground_truth.json, meta.json");
}

const norm = v => String(v).trim().toLowerCase().replace(/^"|"$/g, "");
function score(variant, answersPath) {
  const truth = JSON.parse(fs.readFileSync(path.join(dir, "ground_truth.json"), "utf8"));
  const raw = fs.readFileSync(answersPath, "utf8");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) { console.log("could not find a JSON object in", answersPath); process.exit(2); }
  const ans = JSON.parse(m[0]);
  let correct = 0;
  for (const q of QUESTIONS) {
    const got = ans[q.id], exp = truth[q.id];
    let ok;
    if (typeof exp === "number") ok = Math.abs(Number(got) - exp) < 0.05;
    else ok = norm(got) === norm(exp);
    if (ok) correct++;
    console.log(`  ${ok ? "ok  " : "MISS"} ${q.id}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`);
  }
  console.log(`\n[${variant}] accuracy: ${correct}/${QUESTIONS.length} (${Math.round(100 * correct / QUESTIONS.length)}%)`);
  return correct;
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "generate") generate();
else if (cmd === "score") score(a, b);
else { console.log("usage: node benchmark/benchmark.mjs generate | score <json|table> <answers.json>"); process.exit(1); }
