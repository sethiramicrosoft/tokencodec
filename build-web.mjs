// Generates web/index.html from the tested engine.mjs (single source of truth).
// The engine is inlined so the page is one self-contained file; only the
// tokenizer is loaded from a CDN at runtime (pinned version, with a graceful
// local fallback).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const engine = fs.readFileSync(path.join(dir, "engine.mjs"), "utf8")
  .replace(/^export\s+/gm, ""); // inline: drop export keywords, keep definitions

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TokenCodec - see what your prompt is wasting</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #0f1115; color: #e7e9ee; }
  main { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.05rem; }
  p.sub { color: #aab2c0; margin: 0 0 20px; }
  p.tagline { color: #c2c9d6; margin: 0 0 14px; font-size: .95rem; }
  footer p { margin: 0 0 8px; }
  label { display: block; font-weight: 600; margin: 16px 0 6px; }
  textarea { width: 100%; min-height: 180px; padding: 12px; border-radius: 8px;
    border: 1px solid #3a4150; background: #161922; color: #e7e9ee; font: 13px/1.45 ui-monospace, monospace; resize: vertical; }
  textarea:focus, select:focus, button:focus { outline: 3px solid #8fb0ff; outline-offset: 2px; }
  .skip-link { position: absolute; left: -999px; }
  .skip-link:focus { position: static; display: inline-block; margin-bottom: 8px; color: #8fb0ff; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin-top: 12px; }
  select, button { padding: 10px 14px; border-radius: 8px; border: 1px solid #3a4150; background: #161922; color: #e7e9ee; font: inherit; }
  button.primary { background: #1452d9; border-color: #1452d9; font-weight: 600; cursor: pointer; }
  button.primary:focus { outline-color: #ffffff; }
  button.secondary { background: #161922; cursor: pointer; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 20px 0; }
  .card { background: #161922; border: 1px solid #2a2f3a; border-radius: 10px; padding: 14px; }
  .card .n { font-size: 1.7rem; font-weight: 700; }
  .card .k { color: #c2c9d6; font-size: .85rem; }
  .save .n { color: #54d98c; }
  ul { padding-left: 20px; } li { margin: 4px 0; }
  .flag { background: #2a1f12; border: 1px solid #8a6326; border-radius: 8px; padding: 12px; margin: 8px 0; }
  .warn { background: #2a1212; border: 1px solid #8a2a2a; border-radius: 8px; padding: 10px; margin: 12px 0; }
  footer { color: #aab2c0; font-size: .85rem; margin-top: 28px; }
  a { color: #8fb0ff; }
</style>
</head>
<body>
<main>
  <a class="skip-link" href="#prompt">Skip to prompt</a>
  <h1>TokenCodec</h1>
  <p class="tagline">The lossless prompt and data codec for LLMs. <a href="https://github.com/sethiramicrosoft/tokencodec" target="_blank" rel="noopener">View source on GitHub</a></p>
  <p class="sub">Paste a prompt. See the tokens you are wasting - tokens are the word-chunks AI models charge for, so fewer tokens means a smaller bill. You get back a shorter version that says exactly the same thing. Everything runs in your browser; nothing is uploaded.</p>

  <div id="tokwarn" class="warn" role="alert" hidden><strong>Heads up:</strong> could not load the exact tokenizer (offline?). Showing a rough estimate (characters / 4) - usually within about 30% on data-heavy prompts, looser on short prose.</div>

  <label for="prompt">Your prompt</label>
  <textarea id="prompt" aria-describedby="hint" spellcheck="false" placeholder="Paste a prompt here, including any data you would normally paste in..."></textarea>
  <p id="hint" class="sub" style="margin-top:6px">If your prompt includes JSON data, we shrink it without changing a single value - fully reversible.</p>

  <div class="row">
    <button id="sample" type="button" class="primary">Try a sample prompt</button>
    <div>
      <label for="model" style="margin:0 0 6px">Price model</label>
      <select id="model">
        <optgroup label="OpenAI">
          <option value="5">GPT-5.5: $5.00 per 1M tokens</option>
          <option value="30">GPT-5.5 Pro: $30.00 per 1M tokens</option>
          <option value="2.5">GPT-5.4: $2.50 per 1M tokens</option>
          <option value="0.75">GPT-5.4 mini: $0.75 per 1M tokens</option>
          <option value="0.20">GPT-5.4 nano: $0.20 per 1M tokens</option>
          <option value="1.75">GPT-5.3 Codex: $1.75 per 1M tokens</option>
        </optgroup>
        <optgroup label="Anthropic">
          <option value="5">Claude Opus 4.8: $5.00 per 1M tokens</option>
          <option value="5">Claude Opus 4.7: $5.00 per 1M tokens</option>
          <option value="5">Claude Opus 4.6: $5.00 per 1M tokens</option>
          <option value="3" selected>Claude Sonnet 4.6: $3.00 per 1M tokens</option>
          <option value="1">Claude Haiku 4.5: $1.00 per 1M tokens</option>
          <option value="10">Claude Fable 5: $10.00 per 1M tokens</option>
          <option value="10">Claude Mythos 5: $10.00 per 1M tokens</option>
        </optgroup>
        <optgroup label="Google">
          <option value="2">Gemini 3.1 Pro: $2.00 per 1M tokens</option>
          <option value="2">Gemini 3 Pro: $2.00 per 1M tokens</option>
          <option value="1.5">Gemini 3.5 Flash: $1.50 per 1M tokens</option>
          <option value="0.25">Gemini 3 Flash-Lite: $0.25 per 1M tokens</option>
        </optgroup>
        <optgroup label="xAI">
          <option value="1.25">Grok 4.3: $1.25 per 1M tokens</option>
        </optgroup>
        <optgroup label="DeepSeek">
          <option value="0.44">DeepSeek V4: $0.44 per 1M tokens</option>
        </optgroup>
      </select>
    </div>
    <span style="color:#aab2c0;font-size:.85rem;align-self:center">Results update as you type.</span>
  </div>

  <section class="cards" aria-live="polite" aria-label="Results">
    <p id="empty-hint" style="color:#aab2c0;margin:8px 0;grid-column:1/-1">Paste a prompt above, or load the sample - your token savings will appear here.</p>
    <div class="card" id="card-before" hidden><div class="n" id="before">0</div><div class="k">tokens before</div></div>
    <div class="card" id="card-after" hidden><div class="n" id="after">0</div><div class="k">tokens after</div></div>
    <div class="card save" id="card-pct" hidden><div class="n" id="saved">0%</div><div class="k">smaller</div></div>
    <div class="card save" id="card-money" hidden><div class="n" id="money">$0</div><div class="k">saved per 1,000 API requests</div></div>
  </section>

  <div id="passes" aria-live="polite" aria-atomic="true"></div>
  <div id="flags" aria-live="polite" aria-atomic="true"></div>

  <label for="out">Optimized prompt</label>
  <textarea id="out" readonly aria-label="Optimized prompt output"></textarea>
  <div class="row"><button id="copy" type="button" class="secondary">Copy optimized prompt</button><span id="copied" role="status" hidden></span></div>

  <section aria-labelledby="out-h">
    <h2 id="out-h" style="margin-top:40px">Shrink the reply too (output tokens)</h2>
    <p class="sub" style="margin-bottom:14px">Models charge more for what they write back than for what you send. You cannot losslessly shrink ordinary sentences, but when the answer is a list of records you can ask for it as a compact table - then paste it back here to read it. Both steps run in your browser.</p>

    <label for="hint-out">1. Paste this at the top of your chat (ChatGPT, Claude, Copilot, anything)</label>
    <textarea id="hint-out" readonly aria-label="Instruction to paste into your AI chat" style="min-height:120px">Two quick rules to keep your replies cheap. 1) Be brief: skip the preamble and the recap, just answer. 2) When your answer is a list of items that all share the same fields, give it to me as a compact TokenCodec @T1 table instead of JSON - a header line @T1(col:type,...) where type is s for text, i for whole number, f for decimal, b for true or false, then one comma-separated row per item, text in double quotes, an empty value written as \\N. Use normal sentences for everything else.</textarea>
    <div class="row"><button id="copyhint" type="button" class="secondary">Copy instruction</button><span id="hintcopied" role="status" hidden></span></div>

    <label for="decode-in" style="margin-top:22px">2. Got a compact @T1 reply back? Paste it to read it</label>
    <textarea id="decode-in" spellcheck="false" placeholder="Paste an @T1(...) reply from the assistant here..." style="min-height:120px"></textarea>
    <div class="row"><button id="decsample" type="button" class="secondary">Try a sample reply</button></div>
    <div id="decode-stats" class="sub" style="margin-top:10px" aria-live="polite" hidden></div>
    <label for="decode-out">Readable version</label>
    <textarea id="decode-out" readonly aria-label="Decoded readable output" style="min-height:120px"></textarea>
    <div class="row"><button id="copydec" type="button" class="secondary">Copy readable version</button><span id="deccopied" role="status" hidden></span></div>
  </section>

  <footer>
    <p><strong>TokenCodec</strong> - the lossless prompt and data codec for LLMs.
      <a href="https://github.com/sethiramicrosoft/tokencodec" target="_blank" rel="noopener">GitHub repository</a> -
      <a href="https://github.com/sethiramicrosoft/tokencodec/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a> -
      built by <a href="https://github.com/sethiramicrosoft" target="_blank" rel="noopener">sethiramicrosoft</a>.</p>

    <p>"Lossless" means the data you get back is identical to what you put in - same values, every time, fully reversible.
      Token counts use the o200k tokenizer as a close cross-model approximation. Prices are public June 2026 list prices (input tokens); adjust for your actual tier.</p>

    <p><strong>Disclaimer:</strong> this tool runs entirely in your browser and uploads nothing. Token and cost figures are estimates for guidance only, and are not financial advice. The software is provided "as is", without warranty of any kind. Product and model names (GPT, Claude, Gemini, Grok, DeepSeek and others) are trademarks of their respective owners, used here for identification only.</p>

    <p>&copy; 2026 sethiramicrosoft. Released under the MIT License.</p>
  </footer>
</main>

<script type="module">
${engine}

const $ = id => document.getElementById(id);
let tok = s => Math.ceil([...s].length / 4); // deterministic local fallback, used until (and if) the exact tokenizer loads

// small LRU so we never re-tokenize the same string twice
const tokCache = new Map();
function tokCached(s) {
  const hit = tokCache.get(s);
  if (hit !== undefined) return hit;
  const n = tok(s);
  tokCache.set(s, n);
  if (tokCache.size > 16) tokCache.delete(tokCache.keys().next().value);
  return n;
}
const fmt = n => n.toLocaleString();

let before = 0, after = 0;
function renderMoney() {
  const saved1k = (before - after) * 1000 / 1e6 * parseFloat($('model').value);
  $('money').textContent = '$' + saved1k.toFixed(2);
}

function recompute() {
  const text = $('prompt').value;
  const hasInput = text.trim().length > 0;
  ['card-before','card-after','card-pct','card-money'].forEach(id => $(id).hidden = !hasInput);
  $('empty-hint').hidden = hasInput;

  before = tokCached(text);
  const { optimized, passes, flags } = optimize(text);
  after = tokCached(optimized);
  const pct = before ? Math.round(100 * (before - after) / before) : 0;

  $('before').textContent = fmt(before);
  $('after').textContent = fmt(after);
  $('saved').textContent = pct + '%';
  $('out').value = optimized;
  renderMoney();

  $('passes').innerHTML = passes.length
    ? '<h2>What changed</h2><ul>' + passes.map(p => '<li><strong>' + p.label + '</strong> - ' + p.detail + '</li>').join('') + '</ul>'
    : (hasInput ? '<p style="color:#aab2c0">This prompt is already tight - nothing to remove.</p>' : '');
  $('flags').innerHTML = flags.map(f =>
    '<div class="flag" role="note"><strong>Advisory (' + f.level + '):</strong> ' + f.message + '</div>').join('');
}

let timer = 0;
function scheduleRecompute() { clearTimeout(timer); timer = setTimeout(recompute, 180); }

$('prompt').addEventListener('input', scheduleRecompute);
$('model').addEventListener('change', renderMoney); // price change is just arithmetic; no re-optimize
async function copyText(text, note) {
  try { await navigator.clipboard.writeText(text); note.textContent = 'Copied to clipboard'; }
  catch { note.textContent = 'Copy failed - select the text and copy manually.'; }
  note.hidden = false;
  setTimeout(() => { note.hidden = true; }, 2500);
}
$('copy').addEventListener('click', () => copyText($('out').value, $('copied')));
$('sample').addEventListener('click', () => {
  const recs = [];
  const names = ['Jordan Avery','Sam Rivera','Casey Nguyen','Riley Brooks','Drew Patel'];
  const depts = ['Customer Support','Engineering','Sales Operations','Marketing','Finance'];
  for (let i = 0; i < 40; i++) recs.push({
    employee_full_name: names[i % 5], department_name: depts[i % 5],
    monthly_performance_score: [87,92,78,95,81][i % 5],
    customer_satisfaction_rating: [4.6,4.9,4.1,4.8,4.3][i % 5],
    is_remote_employee: [true,false,true,true,false][i % 5],
  });
  $('prompt').value = 'Could you please look at the data below and tell me the average score per department.\\n\\n' + JSON.stringify(recs, null, 2);
  recompute();
});
recompute(); // render immediately with the fallback so the UI works even if the CDN is slow or blocked

// ---- OUTPUT side: expand a compact @T1 reply back into readable JSON ----
let decTimer = 0;
function renderDecode() {
  const src = $('decode-in').value;
  const stats = $('decode-stats');
  if (!src.trim()) { $('decode-out').value = ''; stats.hidden = true; return; }
  if (src.indexOf('@T1(') === -1) {
    $('decode-out').value = src;
    stats.hidden = false;
    stats.textContent = 'No @T1 table found here - paste a reply that contains an @T1(...) line.';
    return;
  }
  const pretty = decodeTables(src, { space: 2 });
  $('decode-out').value = pretty;
  if (pretty === src) {
    stats.hidden = false;
    stats.textContent = 'Could not read a complete @T1 table here - make sure the header line and all of its rows were pasted.';
    return;
  }
  const tIn = tokCached(src);
  const tJson = tokCached(decodeTables(src, { space: 0 }));
  const saved = tJson - tIn;
  const pct = tJson ? Math.round(100 * saved / tJson) : 0;
  stats.hidden = false;
  stats.textContent = saved > 0
    ? 'That compact reply used ' + fmt(saved) + ' fewer tokens than the ' + fmt(tJson) + '-token JSON version (' + pct + '% smaller) - and the smaller one is what the model billed you for.'
    : 'Expanded to readable JSON.';
}
$('decode-in').addEventListener('input', () => { clearTimeout(decTimer); decTimer = setTimeout(renderDecode, 180); });
$('copyhint').addEventListener('click', () => copyText($('hint-out').value, $('hintcopied')));
$('copydec').addEventListener('click', () => copyText($('decode-out').value, $('deccopied')));
$('decsample').addEventListener('click', () => {
  const recs = [
    { name: 'Riley Brooks', score: 95, remote: true },
    { name: 'Sam Rivera', score: 92, remote: true },
    { name: 'Jordan Avery', score: 87, remote: false },
  ];
  $('decode-in').value = 'Here are the top performers:\\n' + tableEncode(recs) + '\\n\\nLet me know if you want the full list.';
  renderDecode();
});

// upgrade to the exact tokenizer in the background; never block the UI on a network import
import('https://esm.sh/gpt-tokenizer@3.4.0/model/gpt-4o')
  .then(m => { tok = s => m.encode(s).length; tokCache.clear(); recompute(); renderDecode(); })
  .catch(() => { $('tokwarn').hidden = false; });
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(dir, "web"), { recursive: true });
fs.writeFileSync(path.join(dir, "web", "index.html"), html);
console.log("web/index.html generated (" + html.length + " bytes), engine inlined from engine.mjs");
