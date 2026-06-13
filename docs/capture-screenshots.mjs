// Capture the screenshots used in the README, by driving the REAL web tool and the
// REAL extension content script in headless Chromium - the same journeys the e2e suite
// asserts. Re-runnable: `node docs/capture-screenshots.mjs` (or `npm run screenshots`).
// Output: docs/screenshots/*.png (committed, referenced from README.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "screenshots");
fs.mkdirSync(outDir, { recursive: true });
const shot = (target, name, opts) => target.screenshot({ path: path.join(outDir, name), ...opts });

(async () => {
  const srv = spawn("node", ["serve.mjs"], { cwd: root, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    // 1. Web tool, input side: load the sample, wait for the exact tokenizer, capture the
    //    savings cards + the optimized @T1 output.
    await page.goto("http://127.0.0.1:8155/web/index.html", { waitUntil: "load" });
    await page.click("#sample");
    await page.waitForFunction(() => Number((document.getElementById("before").textContent || "0").replace(/[^0-9.]/g, "")) > 0, { timeout: 6000 });
    await page.waitForTimeout(2500);   // let the CDN tokenizer upgrade the counts to exact for a clean shot
    await shot(page, "web-input.png", { clip: { x: 0, y: 0, width: 1000, height: 950 } });

    // 2. Web tool, output side: load the compact-reply sample and capture the decoder panel.
    await page.click("#decsample");
    await page.waitForFunction(() => (document.getElementById("decode-out").value || "").includes("Riley Brooks"), { timeout: 6000 });
    await page.locator("#decode-out").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const panel = page.locator('section[aria-labelledby="out-h"]');
    await shot(panel, "web-output.png");

    // 3. Extension: load the real content script into a page and shrink a prompt in one
    //    click. Use a small viewport and capture the WHOLE thing so the floating
    //    "Shrink prompt" button (fixed bottom-right) and its savings toast are visible.
    const recs = Array.from({ length: 8 }, (_, i) => ({ id: i, region: ["APAC", "EMEA", "NA"][i % 3], score: 80 + i, ok: i % 2 === 0 }));
    const prompt = "Average score by region for this data:\n" + JSON.stringify(recs, null, 2);
    const extCtx = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 });
    const ext = await extCtx.newPage();
    await ext.setContent(`<!doctype html><html><body style="margin:0;background:#0f1115;color:#e7e9ee;font:14px system-ui">
      <div style="padding:16px 18px 6px;font-weight:600">Your AI chat (illustration)</div>
      <textarea id="t" style="width:560px;height:300px;margin:8px 18px;padding:12px;border-radius:8px;border:1px solid #3a4150;background:#161922;color:#e7e9ee;font:13px ui-monospace,monospace"></textarea>
      </body></html>`);
    await ext.addScriptTag({ path: path.join(root, "extension", "content.js") });
    await ext.fill("#t", prompt);
    await ext.focus("#t");
    await ext.locator("button", { hasText: "Shrink prompt" }).click();
    await ext.waitForTimeout(250);   // capture while the savings toast is still visible
    await shot(ext, "extension.png");   // full viewport: textarea + the floating button + toast
    await extCtx.close();

    const names = fs.readdirSync(outDir).filter(f => f.endsWith(".png")).sort();
    console.log("wrote " + names.length + " screenshots to docs/screenshots:\n  " + names.join("\n  "));
  } finally {
    await browser.close();
    srv.kill();
  }
})();
