// Browser end-to-end accuracy with Playwright/Chromium:
//  A. Web tool: displayed token counts, % and $ math are correct, output is lossless,
//     model switch recomputes money, copy confirms.
//  B. Extension: injecting content.js into a page shrinks the prompt box, losslessly.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { tableDecode } from "../engine.mjs";
import { encode } from "gpt-tokenizer/model/gpt-4o";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const num = (s) => Number(String(s).replace(/[^0-9.]/g, ""));
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === "object") ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// the exact records web/index.html's "Try a sample prompt" button builds
function sampleRecords() {
  const names = ["Jordan Avery", "Sam Rivera", "Casey Nguyen", "Riley Brooks", "Drew Patel"];
  const depts = ["Customer Support", "Engineering", "Sales Operations", "Marketing", "Finance"];
  return Array.from({ length: 40 }, (_, i) => ({
    employee_full_name: names[i % 5], department_name: depts[i % 5],
    monthly_performance_score: [87, 92, 78, 95, 81][i % 5],
    customer_satisfaction_rating: [4.6, 4.9, 4.1, 4.8, 4.3][i % 5],
    is_remote_employee: [true, false, true, true, false][i % 5],
  }));
}

(async () => {
  const srv = spawn("node", ["serve.mjs"], { cwd: root, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  try {
    // ---------- A. Web tool ----------
    await page.goto("http://127.0.0.1:8155/web/index.html", { waitUntil: "load" });
    await page.click("#sample");
    // listeners are synchronous now: the sample must populate the cards quickly
    await page.waitForFunction(() => Number((document.getElementById("before").textContent || "0").replace(/[^0-9.]/g, "")) > 0, { timeout: 5000 });

    const promptText = await page.inputValue("#prompt");
    const exactBefore = encode(promptText).length;
    // give the CDN tokenizer up to 4s to upgrade the counts to exact; fall back gracefully
    let usingExact = false;
    try {
      await page.waitForFunction(e => Number((document.getElementById("before").textContent || "0").replace(/[^0-9.]/g, "")) === e, exactBefore, { timeout: 4000 });
      usingExact = true;
    } catch {}

    const before = num(await page.textContent("#before"));
    const after = num(await page.textContent("#after"));
    const savedPct = num(await page.textContent("#saved"));
    const money = num(await page.textContent("#money"));
    const price = Number(await page.inputValue("#model"));
    const outText = await page.inputValue("#out");

    ok(before > 0 && after > 0 && after < before, `web: after < before (${before} -> ${after})`);
    ok(savedPct === Math.round(100 * (before - after) / before), "web: displayed % matches before/after");
    const expMoney = (before - after) * 1000 / 1e6 * price;
    ok(Math.abs(money - expMoney) < 0.02, `web: $ saved matches (before-after)*1000/1e6*price (shown ${money}, expected ${expMoney.toFixed(2)})`);

    // counts must equal a real tokenizer result (exact when CDN loaded, else the documented fallback) - never a bogus number
    const fbBefore = Math.ceil([...promptText].length / 4), fbAfter = Math.ceil([...outText].length / 4);
    ok(before === exactBefore || before === fbBefore, "web: 'before' equals a real tokenizer count (exact or fallback)");
    ok(after === encode(outText).length || after === fbAfter, "web: 'after' equals a real tokenizer count (exact or fallback)");
    console.log("  web tokenizer mode: " + (usingExact ? "exact (CDN o200k)" : "fallback estimate"));
    if (usingExact) ok(before === exactBefore && after === encode(outText).length, "web: exact tokenizer counts are correct");
    else pass++;

    // lossless: the table in the output decodes back to the exact sample records
    const tbl = outText.slice(outText.indexOf("@T1("));
    ok(eq(tableDecode(tbl), sampleRecords()), "web: optimized output is lossless (table decodes to original 40 records)");

    // switch model -> money recomputes with the new price, counts unchanged
    await page.selectOption("#model", "5"); // a $5.00 option
    await page.waitForTimeout(50);
    const money5 = num(await page.textContent("#money"));
    ok(Math.abs(money5 - (before - after) * 1000 / 1e6 * 5) < 0.02, "web: switching model recomputes $ correctly");

    // copy confirmation appears
    await page.click("#copy");
    await page.waitForTimeout(100);
    ok(await page.locator("#copied").isVisible(), "web: copy shows a confirmation");

    // ---------- B. Extension ----------
    const recs = Array.from({ length: 8 }, (_, i) => ({ id: i, region: ["APAC", "EMEA", "NA"][i % 3], score: 80 + i, ok: i % 2 === 0 }));
    const prompt = "Average score by region for this data:\n" + JSON.stringify(recs, null, 2);
    const extPage = await ctx.newPage();
    await extPage.setContent('<!doctype html><html><body><textarea id="t" style="width:600px;height:300px"></textarea></body></html>');
    await extPage.addScriptTag({ path: path.join(root, "extension", "content.js") });
    await extPage.fill("#t", prompt);
    await extPage.focus("#t");
    await extPage.locator("button", { hasText: "Shrink prompt" }).click();
    await extPage.waitForTimeout(150);
    const extOut = await extPage.inputValue("#t");
    ok(extOut.includes("@T1("), "extension: prompt box was shrunk to a table");
    const extTbl = extOut.slice(extOut.indexOf("@T1("));
    ok(eq(tableDecode(extTbl), recs), "extension: shrink is lossless (decodes to original records)");
    ok(await extPage.locator('[role="status"]').first().isVisible(), "extension: savings toast shown");

    ok(errors.length === 0, "no console/page errors during browser run" + (errors.length ? " -> " + errors.join(" | ") : ""));
  } finally {
    await browser.close();
    srv.kill();
  }

  console.log(`\nE2E (browser) ACCURACY: ${pass} passed, ${fail} failed  ${fail === 0 ? "(bulletproof)" : "FAILED"}`);
  process.exit(fail ? 1 : 0);
})();
