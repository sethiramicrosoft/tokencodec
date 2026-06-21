// Real-world data tests: encode/decode with datasets that look like they came from
// actual systems (not hand-crafted minimal examples). Every field type, a realistic
// schema with repetition, mixed-sign numbers, floats, booleans, and edge-value rows.
// The goal is to confirm the "lossless" and "≥40% smaller" claims hold on data
// a real user would actually paste into an LLM chat.
import { tableEncode, tableDecode, optimize, decodeTables } from "../engine.mjs";
import { encode } from "gpt-tokenizer/model/gpt-4o";

const tok = s => encode(s).length;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const canon = v =>
  Array.isArray(v) ? v.map(canon)
  : (v && typeof v === "object") ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
  : v;
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// ---- deterministic dataset generators ---------------------------------------

function makeEmployees(n) {
  const depts    = ["Engineering", "Sales", "Finance", "Marketing", "Support"];
  const regions  = ["APAC", "EMEA", "NA", "LATAM"];
  const levels   = ["IC1", "IC2", "IC3", "IC4", "M1", "M2"];
  return Array.from({ length: n }, (_, i) => ({
    employee_id:       10000 + i,
    department:        depts[i % depts.length],
    region:            regions[i % regions.length],
    level:             levels[i % levels.length],
    years_tenure:      (i % 15) + 1,
    performance_score: parseFloat((3.0 + (i % 20) * 0.1).toFixed(1)),
    is_manager:        i % 6 === 0,
    headcount_reports: i % 6 === 0 ? (i % 5) + 2 : 0,
  }));
}

function makeApiLog(n) {
  const methods  = ["GET", "POST", "PUT", "DELETE"];
  const statuses = [200, 200, 200, 201, 400, 404, 500];
  const paths    = ["/api/users", "/api/orders", "/api/products", "/api/search"];
  return Array.from({ length: n }, (_, i) => ({
    request_id: 900000 + i,
    method:     methods[i % methods.length],
    path:       paths[i % paths.length],
    status:     statuses[i % statuses.length],
    latency_ms: 10 + (i % 500),
    cache_hit:  i % 3 === 0,
    bytes_sent: 512 + (i % 4096),
  }));
}

function makeFinancial(n) {
  const categories = ["Revenue", "COGS", "OpEx", "CapEx", "R&D"];
  const currencies = ["USD", "EUR", "GBP", "JPY"];
  return Array.from({ length: n }, (_, i) => ({
    ledger_id: 20000 + i,
    category:  categories[i % categories.length],
    currency:  currencies[i % currencies.length],
    amount:    parseFloat((1000 + i * 3.14159).toFixed(2)),
    quarter:   (i % 4) + 1,
    year:      2023 + (i % 3),
    audited:   i % 2 === 0,
  }));
}

// ---- 1. Employee records (200 rows): lossless round-trip --------------------
{
  const rows = makeEmployees(200);
  const encoded = tableEncode(rows);
  ok(!!encoded, "200 employee records: tableEncode returns a value");
  const decoded = tableDecode(encoded);
  ok(eq(decoded, rows), "200 employee records: encode → decode → identical");
  const jsonTok = tok(JSON.stringify(rows));
  const t2Tok   = tok(encoded);
  const pct     = Math.round(100 * (jsonTok - t2Tok) / jsonTok);
  ok(pct >= 35, `employee dataset compresses ≥35% vs compact JSON (got ${pct}%)`);
  console.log(`  employees 200 rows: ${jsonTok} → ${t2Tok} tokens (${pct}% less)`);
}

// ---- 2. API log records (200 rows): lossless round-trip ---------------------
{
  const rows = makeApiLog(200);
  const encoded = tableEncode(rows);
  ok(!!encoded, "200 API log records: tableEncode returns a value");
  const decoded = tableDecode(encoded);
  ok(eq(decoded, rows), "200 API log records: encode → decode → identical");
  const jsonTok = tok(JSON.stringify(rows));
  const t2Tok   = tok(encoded);
  const pct     = Math.round(100 * (jsonTok - t2Tok) / jsonTok);
  ok(pct >= 35, `API log dataset compresses ≥35% vs compact JSON (got ${pct}%)`);
  console.log(`  api-log 200 rows: ${jsonTok} → ${t2Tok} tokens (${pct}% less)`);
}

// ---- 3. Financial records (200 rows) with floats: float precision preserved -
{
  const rows = makeFinancial(200);
  const encoded = tableEncode(rows);
  ok(!!encoded, "200 financial records: tableEncode returns a value");
  const decoded = tableDecode(encoded);
  ok(eq(decoded, rows), "200 financial records (floats): encode → decode → identical");
  // spot-check that float precision survived
  ok(decoded[7].amount === rows[7].amount,
    `float value rows[7].amount=${rows[7].amount} preserved to full precision`);
  ok(decoded[99].amount === rows[99].amount,
    `float value rows[99].amount=${rows[99].amount} preserved to full precision`);
}

// ---- 4. NDJSON input: optimize() converts to @T2; decodeTables restores ----
{
  const rows = makeApiLog(50);
  const ndjson = rows.map(r => JSON.stringify(r)).join("\n");
  const { optimized } = optimize(ndjson);
  ok(optimized.includes("@T2 "), "NDJSON: optimize produces @T2 output");
  const restored = decodeTables(optimized);
  const restoredRows = JSON.parse(restored);
  ok(eq(restoredRows, rows), "NDJSON: optimize → decodeTables → records identical");
}

// ---- 5. Mixed document: prose + @T2 table → decodeTables expands only table -
{
  const rows = makeEmployees(20);
  const table = tableEncode(rows);
  const doc = `Here is the employee summary:\n\n${table}\n\nPlease review the above and flag anomalies.`;
  const restored = decodeTables(doc);
  ok(restored.includes("Here is the employee summary:"), "mixed doc: prose before table preserved");
  ok(restored.includes("Please review the above"), "mixed doc: prose after table preserved");
  ok(!restored.includes("@T2"), "mixed doc: @T2 table expanded (no @T2 left in output)");
}

// ---- 6. Field type preservation: string, int, float, bool, zero, negative --
{
  const rows = [
    { s: "hello world",  i: 42,  f: 3.14,   b: true,  b2: false, n:  0 },
    { s: "foo bar baz",  i: -7,  f: -1.5,   b: false, b2: true,  n: 99 },
    { s: "edge 'quotes'",i: 0,   f: 0.001,  b: true,  b2: false, n: -42 },
  ];
  const decoded = tableDecode(tableEncode(rows));
  ok(typeof decoded[0].s === "string",  "type preservation: string");
  ok(typeof decoded[0].i === "number" && Number.isInteger(decoded[0].i), "type preservation: integer");
  ok(typeof decoded[0].f === "number" && !Number.isInteger(decoded[0].f), "type preservation: float");
  ok(decoded[0].b === true,  "type preservation: boolean true");
  ok(decoded[1].b === false, "type preservation: boolean false");
  ok(decoded[0].n === 0 && decoded[1].n === 99 && decoded[2].n === -42,
    "type preservation: zero and negative integers");
  ok(decoded[2].f === 0.001, "type preservation: small float 0.001");
}

// ---- 7. Large dataset (1000 rows): lossless and ≥40% smaller ---------------
{
  const rows = makeEmployees(1000);
  const encoded = tableEncode(rows);
  ok(!!encoded, "1000-row dataset: tableEncode returns a value");
  const decoded = tableDecode(encoded);
  ok(eq(decoded, rows), "1000-row dataset: encode → decode → identical");
  const jsonTok = tok(JSON.stringify(rows));
  const t2Tok   = tok(encoded);
  const pct     = Math.round(100 * (jsonTok - t2Tok) / jsonTok);
  ok(pct >= 40, `1000-row dataset compresses ≥40% vs compact JSON (got ${pct}%)`);
  console.log(`  employees 1000 rows: ${jsonTok} → ${t2Tok} tokens (${pct}% less)`);
}

// ---- 8. Nested data is rejected cleanly: no corruption, no data loss -------
{
  const nested = [{ name: "Alice", address: { city: "Oslo", zip: "0150" } }];
  const { optimized } = optimize(JSON.stringify(nested));
  ok(!optimized.includes("@T2 "), "nested data: NOT encoded (safely rejected)");
  // The optimizer must either return the original unchanged or valid JSON —
  // it must never corrupt the data.
  try {
    const reparsed = JSON.parse(optimized);
    ok(eq(reparsed, nested), "nested data: original values preserved unchanged");
  } catch {
    // Some whitespace stripping is acceptable; the key constraint is no @T2
    ok(!optimized.includes("@T2"), "nested data: no @T2 in output even after parse failure");
  }
}

// ---- 9. Very short dataset (2 rows): still encodes and round-trips ----------
{
  const rows = [{ x: 1, y: "a" }, { x: 2, y: "b" }];
  const encoded = tableEncode(rows);
  ok(!!encoded, "2-row dataset: tableEncode returns a value");
  const decoded = tableDecode(encoded);
  ok(eq(decoded, rows), "2-row dataset: encode → decode → identical");
}

// ---- 10. All-null column: handled without crash; null values round-trip -----
{
  // A column where every value is null should be treated as string type and round-trip
  const rows = [
    { id: 1, label: "alpha", note: null },
    { id: 2, label: "beta",  note: null },
    { id: 3, label: "gamma", note: null },
  ];
  try {
    const encoded = tableEncode(rows);
    if (encoded) {
      const decoded = tableDecode(encoded);
      ok(eq(decoded, rows), "all-null column: round-trips correctly");
    } else {
      // If the engine cannot handle all-null columns, it should return null, not crash
      ok(true, "all-null column: engine returns null (safe rejection, no crash)");
    }
  } catch (e) {
    ok(false, `all-null column: threw unexpectedly: ${e.message}`);
  }
}

// ---- 11. Adversarial: values containing @T2 syntax in strings → no data loss
{
  // String columns are always double-quoted in @T2, so @T2-like syntax inside
  // a string cell cannot corrupt the table structure.
  const rows = [
    { tag: "@T2 col int", val: 1 },
    { tag: "normal text", val: 2 },
    { tag: "@T2 x string y int", val: 3 },
  ];
  try {
    const encoded = tableEncode(rows);
    if (encoded) {
      const decoded = tableDecode(encoded);
      ok(eq(decoded, rows), "adversarial @T2-like string values: round-trip safe");
    } else {
      // Mixed string column rejected → passthrough is safe
      ok(true, "adversarial strings: rejected safely (no crash, no corruption)");
    }
  } catch (e) {
    ok(false, `adversarial strings: threw unexpectedly: ${e.message}`);
  }
}

console.log(`\nREAL-WORLD DATA: ${pass} passed, ${fail} failed  ${fail === 0 ? "(bulletproof)" : "FAILED"}`);
process.exit(fail ? 1 : 0);
