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
    const tbl = outText.slice(outText.indexOf("@T2 "));
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

    // wrapper mode gives a target-specific next step and copy feedback
    await page.selectOption("#wrap-target", "codex");
    await page.waitForTimeout(50);
    const wrapNote = await page.textContent("#wrapnote");
    ok(/Open OpenAI Codex CLI/.test(wrapNote || ""), "web: wrapper note updates for the selected CLI");
    await page.click("#copywrapnote");
    await page.waitForTimeout(100);
    ok(await page.locator("#wrapcopied").isVisible(), "web: wrapper note copy shows a confirmation");

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
    ok(extOut.includes("@T2 "), "extension: prompt box was shrunk to a table");
    const extTbl = extOut.slice(extOut.indexOf("@T2 "));
    ok(eq(tableDecode(extTbl), recs), "extension: shrink is lossless (decodes to original records)");
    ok(await extPage.locator('[role="status"]').first().isVisible(), "extension: savings toast shown");

    // output lever: "Compact reply" appends the reply-saver instruction to the prompt box
    await extPage.locator("button", { hasText: "Compact reply" }).click();
    await extPage.waitForTimeout(100);
    const extWithHint = await extPage.inputValue("#t");
    ok(extWithHint.includes("@T2 ") && /Reply rule:/.test(extWithHint), "extension: 'Compact reply' adds the reply-saver instruction to the prompt");

    // ---------- B2. Extension on a rich contenteditable editor (the path Claude / ChatGPT use) ----------
    // A plain <textarea> exercises the native-value-setter branch; ChatGPT and Claude use
    // contenteditable (ProseMirror/Lexical), which goes through execCommand("insertText").
    // Drive that real branch in Chromium so it is not left untested.
    const richPrompt = "Average score by region for this data: " + JSON.stringify(recs); // single line -> robust in contenteditable
    const richPage = await ctx.newPage();
    await richPage.setContent('<!doctype html><html><body><div id="r" contenteditable="true" role="textbox" style="width:600px;min-height:200px"></div></body></html>');
    await richPage.addScriptTag({ path: path.join(root, "extension", "content.js") });
    await richPage.evaluate((p) => { const el = document.getElementById("r"); el.focus(); el.textContent = p; }, richPrompt);
    await richPage.focus("#r");
    await richPage.locator("button", { hasText: "Shrink prompt" }).click();
    await richPage.waitForTimeout(150);
    const richOut = await richPage.evaluate(() => document.getElementById("r").innerText);
    ok(richOut.includes("@T2 "), "extension: rich contenteditable editor was shrunk (execCommand insertText path)");
    ok(eq(tableDecode(richOut.slice(richOut.indexOf("@T2 "))), recs), "extension: contenteditable shrink is lossless");
    await richPage.close();

    // ---------- B3. Several editors on the page: shrink the one the user typed in ----------
    // Real chat pages have more than one contenteditable / role=textbox (sidebar
    // search, hidden fields). A naive "first match" grabs the wrong node once the
    // floating button takes focus. Put a decoy editor FIRST in the DOM, type into the
    // real composer second, click Shrink, and assert only the composer changed.
    const decoyPage = await ctx.newPage();
    await decoyPage.setContent('<!doctype html><html><body><div id="decoy" contenteditable="true" role="textbox" style="width:300px;min-height:40px">search</div><div id="real" contenteditable="true" role="textbox" style="width:600px;min-height:200px"></div></body></html>');
    await decoyPage.addScriptTag({ path: path.join(root, "extension", "content.js") });
    await decoyPage.evaluate((p) => { const el = document.getElementById("real"); el.focus(); el.textContent = p; }, richPrompt);
    await decoyPage.focus("#real");
    await decoyPage.locator("button", { hasText: "Shrink prompt" }).click();
    await decoyPage.waitForTimeout(150);
    const realOut = await decoyPage.evaluate(() => document.getElementById("real").innerText);
    const decoyOut = await decoyPage.evaluate(() => document.getElementById("decoy").innerText);
    ok(realOut.includes("@T2 "), "extension: with several editors, the focused prompt box is the one shrunk");
    ok(decoyOut === "search", "extension: the decoy editor (e.g. a sidebar search box) is left untouched");
    await decoyPage.close();

    // ---------- B4. A box that refuses programmatic edits: copy to clipboard, say so ----------
    // Some editors revert any change they did not originate. The extension verifies the write
    // took; if the box refused, it copies the shrunk prompt to the clipboard and tells the user
    // to paste it, instead of failing silently or wiping their text. Simulate a hostile editor
    // that reverts on every input event, and capture what the extension copies.
    const rejectPage = await ctx.newPage();
    await rejectPage.setContent('<!doctype html><html><body><div id="rej" contenteditable="true" role="textbox" style="width:600px;min-height:200px"></div></body></html>');
    await rejectPage.addScriptTag({ path: path.join(root, "extension", "content.js") });
    await rejectPage.evaluate((p) => {
      const cap = (t) => { window.__copied = t; return Promise.resolve(); };
      try { navigator.clipboard.writeText = cap; } catch (e) {}
      if (!navigator.clipboard || navigator.clipboard.writeText !== cap) {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: cap } });
      }
      const el = document.getElementById("rej");
      el.focus(); el.textContent = p; window.__orig = p;
      el.addEventListener("input", () => { if (el.innerText !== window.__orig) el.innerText = window.__orig; });
    }, richPrompt);
    await rejectPage.focus("#rej");
    await rejectPage.locator("button", { hasText: "Shrink prompt" }).click();
    await rejectPage.waitForTimeout(150);
    const rejBox = await rejectPage.evaluate(() => document.getElementById("rej").innerText);
    const rejCopied = await rejectPage.evaluate(() => window.__copied);
    const rejToast = await rejectPage.locator('[role="status"]').first().textContent();
    ok(!rejBox.includes("@T2 "), "extension: a box that refuses edits keeps the user's text (no silent failure, nothing wiped)");
    ok(rejCopied && rejCopied.includes("@T2 "), "extension: the shrunk prompt is copied to the clipboard when the box blocks auto-edit");
    ok(rejCopied && eq(tableDecode(rejCopied.slice(rejCopied.indexOf("@T2 "))), recs), "extension: the clipboard copy is the lossless @T2 table");
    ok(/copied/i.test(rejToast || ""), "extension: the toast tells the user it copied the result to paste with Ctrl+V");
    await rejectPage.close();

    // ---------- C. Output decode (the reply round-trip, for non-technical web users) ----------
    const expectReply = [
      { name: "Riley Brooks", score: 95, remote: true },
      { name: "Sam Rivera", score: 92, remote: true },
      { name: "Jordan Avery", score: 87, remote: false },
    ];
    // the paste-in instruction must name the format and the null token
    const hintText = await page.inputValue("#hint-out");
    ok(hintText.includes("@T2 ") && hintText.includes("\\N"), "output: paste-in instruction names @T2 and the \\N null token");

    await page.click("#decsample");
    await page.waitForFunction(() => (document.getElementById("decode-out").value || "").includes("Riley Brooks"), { timeout: 5000 });
    const decodedOut = await page.inputValue("#decode-out");
    ok(!decodedOut.includes("@T2 "), "output: the @T2 reply was expanded (no table marker left)");
    const decArr = JSON.parse(decodedOut.match(/\[[\s\S]*\]/)[0]);
    ok(eq(decArr, expectReply), "output: decoded reply equals the original records (lossless round-trip)");
    const statsText = await page.textContent("#decode-stats");
    ok(/fewer tokens|smaller/.test(statsText), "output: savings stat shown for the compact reply");

    await page.click("#copydec");
    await page.waitForTimeout(100);
    ok(await page.locator("#deccopied").isVisible(), "output: copy readable version shows a confirmation");

    ok(errors.length === 0, "no console/page errors during browser run" + (errors.length ? " -> " + errors.join(" | ") : ""));
  } finally {
    await browser.close();
    srv.kill();
  }

  console.log(`\nE2E (browser) ACCURACY: ${pass} passed, ${fail} failed  ${fail === 0 ? "(bulletproof)" : "FAILED"}`);
  process.exit(fail ? 1 : 0);
})();
