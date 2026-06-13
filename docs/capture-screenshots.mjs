// Capture the README screenshots of the BROWSER EXTENSION by loading the REAL
// unpacked extension (extension/manifest.json + extension/content.js) into
// Chromium and letting its content script run on a chat-style composer - the
// same code path that runs on chatgpt.com, claude.ai and gemini.google.com.
//
// We point the real extension at a local look-alike composer because the live
// sites require a login and actively block automation, so they cannot be driven
// in a test. Everything overlaid on the page (the floating buttons, the toast,
// the in-place re-encode) is the genuine extension, not a mockup.
//
// Re-runnable: `node docs/capture-screenshots.mjs` (or `npm run screenshots`).
// Output: docs/screenshots/extension-before.png, docs/screenshots/extension-after.png
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "screenshots");
fs.mkdirSync(outDir, { recursive: true });

// A realistic, vendor-neutral chat composer. The data below is what a person
// would actually paste; the leading line is a normal instruction.
const orders = [
  { id: 1001, customer: "Ava Mehta", region: "APAC", total: 248.5, paid: true },
  { id: 1002, customer: "Liam Walsh", region: "EMEA", total: 76.0, paid: false },
  { id: 1003, customer: "Noah Kim", region: "NA", total: 512.25, paid: true },
  { id: 1004, customer: "Mia Rossi", region: "EMEA", total: 134.9, paid: true },
  { id: 1005, customer: "Ethan Cole", region: "NA", total: 89.99, paid: false },
  { id: 1006, customer: "Sara Haidar", region: "APAC", total: 320.0, paid: true },
  { id: 1007, customer: "Omar Diaz", region: "EMEA", total: 58.4, paid: true },
  { id: 1008, customer: "Ivy Chen", region: "APAC", total: 195.75, paid: false }
];
const PROMPT = "Total revenue by region for these orders, paid only:\n" +
  JSON.stringify(orders, null, 2);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Assistant</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:#0f1014;color:#ececf1;font:15px/1.55 system-ui,"Segoe UI",sans-serif;display:flex;flex-direction:column}
  header{padding:12px 18px;border-bottom:1px solid #23252b;font-weight:600;display:flex;align-items:center;gap:9px;flex:0 0 auto}
  .dot{width:10px;height:10px;border-radius:50%;background:#10a37f;display:inline-block}
  main{flex:1 1 auto;overflow:auto;padding:24px 18px;display:flex;flex-direction:column;gap:18px;width:100%;max-width:780px;margin:0 auto}
  .msg{display:flex;gap:12px;align-items:flex-start}
  .av{width:30px;height:30px;border-radius:7px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
  .av.ai{background:#10a37f;color:#06281f}
  .bubble{padding:3px 0}
  footer{flex:0 0 auto;padding:10px 18px 20px;width:100%;max-width:780px;margin:0 auto}
  .composer{border:1px solid #3a3d46;border-radius:16px;background:#1a1c22;padding:11px 12px 11px 16px;display:flex;gap:10px;align-items:flex-end}
  .editor{flex:1 1 auto;min-height:24px;max-height:230px;overflow:auto;outline:none;white-space:pre-wrap;word-break:break-word;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#ececf1}
  .editor:empty:before{content:attr(data-ph);color:#8a8d96}
  .send{flex:0 0 auto;width:34px;height:34px;border-radius:10px;border:none;background:#ececf1;color:#111;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .foot{width:100%;max-width:780px;margin:8px auto 0;color:#8a8d96;font-size:12px;text-align:center}
</style></head>
<body>
  <header><span class="dot"></span> Assistant</header>
  <main>
    <div class="msg"><div class="av ai">AI</div><div class="bubble">Sure. Paste your data and tell me what you want from it.</div></div>
  </main>
  <footer>
    <div class="composer">
      <div id="editor" class="editor" contenteditable="true" role="textbox" data-ph="Message Assistant..."></div>
      <button class="send" title="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg></button>
    </div>
    <div class="foot">Assistant can make mistakes. Check important info.</div>
  </footer>
</body></html>`;

(async () => {
  // 1. Real extension, with localhost added to the match list so the genuine
  //    content script runs on our local composer exactly as it would on a chat site.
  const tmpExt = fs.mkdtempSync(path.join(os.tmpdir(), "tc-ext-"));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension", "manifest.json"), "utf8"));
  manifest.content_scripts[0].matches.push("http://127.0.0.1/*", "http://localhost/*");
  fs.writeFileSync(path.join(tmpExt, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.copyFileSync(path.join(root, "extension", "content.js"), path.join(tmpExt, "content.js"));

  // 2. Serve the composer over http (content scripts do not run on data: URLs).
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(PAGE);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-prof-"));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    viewport: { width: 920, height: 600 },
    deviceScaleFactor: 2,
    args: [`--headless=new`, `--disable-extensions-except=${tmpExt}`, `--load-extension=${tmpExt}`]
  });
  try {
    await new Promise(r => setTimeout(r, 1000)); // let the extension register
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForSelector("button:has-text('Shrink prompt')", { timeout: 8000 });

    // Type the bloated prompt into the real contenteditable composer.
    await page.evaluate((text) => {
      const el = document.getElementById("editor");
      el.focus();
      el.innerText = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      el.scrollTop = 0;
    }, PROMPT);
    await page.waitForTimeout(300);

    // BEFORE: bloated JSON in the box, the extension's floating buttons in view.
    await page.screenshot({ path: path.join(outDir, "extension-before.png") });

    // One click - the genuine extension re-encodes the prompt in place and toasts.
    await page.locator("button", { hasText: "Shrink prompt" }).click();
    await page.waitForFunction(() => {
      const t = document.querySelector('div[role="status"]');
      return t && t.style.display !== "none" && /Shrunk/.test(t.textContent || "");
    }, { timeout: 8000 });
    await page.waitForTimeout(200);

    // AFTER: compact @T1 table in the box + the savings toast.
    await page.screenshot({ path: path.join(outDir, "extension-after.png") });

    const names = fs.readdirSync(outDir).filter(f => f.endsWith(".png")).sort();
    console.log("wrote screenshots to docs/screenshots:\n  " + names.join("\n  "));
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(tmpExt, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})();
