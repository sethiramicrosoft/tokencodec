# Token Diet

**If an AI reads your words or data, you pay for every one. Token Diet cuts the waste.**

**▶ Try it live, no install:** https://sethiramicrosoft.github.io/token-diet/

AI tools charge by the *token* — a token is a small chunk of text, about ¾ of a
word. Every file your AI re-reads, every spreadsheet you paste, every long chat
that resends its whole history: you pay for all of it, every time. On a big
project that quietly runs into millions of tokens and real money.

Token Diet trims that waste. It comes in two pieces, and you can use either or both:

- **The rules installer** — one command that teaches your AI *coding* tools
  (Claude Code, Copilot, Cursor, Codex, Gemini, Aider) to stop wasting tokens by
  default. Best for software, full-stack and data work done through an AI agent.
- **The local optimizer** — a tiny web page (and an importable engine) that takes
  any prompt or dataset and hands back a smaller version that means exactly the
  same thing. Today you run it locally; a hosted, zero-install version is on the
  roadmap below.

Everything runs on your own computer. **Nothing is ever uploaded** — which matters
if your data is medical, financial, legal, or otherwise sensitive.

---

## 5 people who save the most

These are the cases where the savings are biggest *and* the tool already fits how
they work today:

1. **The full-stack / SaaS developer living in an AI agent.**
   All day in Claude Code, Cursor or Copilot. The agent re-reads 2,000-line files,
   reprints them to change five lines, and resends the whole conversation every
   turn — a 200-turn session bills ~24× more than it needs to. The installer makes
   "read only what you need, send small diffs, keep a compact state" the default.
   The difference between hitting your cap by noon and shipping all afternoon.

2. **The data scientist / analyst.**
   Pastes a 10,000-row CSV to ask "average by region?" and pays for all 10,000 rows.
   Token Diet turns it into a 3-line query that returns only the answer — up to
   **1,000× fewer tokens** — and when you must include data, shrinks it ~70% with
   zero values changed.

3. **The AI product builder / indie hacker shipping an LLM feature.**
   Burns tokens twice: building it *and* serving users. The installer cuts the
   build-time burn; the importable engine and its principles ("query, don't paste";
   "don't repeat"; "compact the data") cut the runtime burn when wired into the
   backend. At millions of calls, every trimmed prompt is a line-item saving.

4. **The auditor / accountant / financial analyst.**
   Drops whole ledgers and exports into AI to find anomalies or reconcile. The
   lossless shrink compacts the table **without altering a single number** — the
   part they can't compromise — and "query for the exceptions" returns only the
   rows that matter instead of re-reading the book on every question.

5. **The researcher / scientist with real datasets.**
   Exact numbers, reproducibility, no silent corruption. The codec is provably
   lossless (8,000-trial fuzz, zero loss), refuses rather than mangles unsafe
   values, and the proofs are runnable. And it all runs locally, so sensitive data
   never leaves the machine.

---

## The wider list — if your AI reads it, you're paying for it

| You are a… | Where your tokens go | What Token Diet does |
|---|---|---|
| **Software / full-stack developer** | The AI agent re-reads whole files, reprints a 500-line file to change 3 lines, dumps giant build/test logs, and resends the entire chat every turn | The rules make it search and read only what it needs, send small diffs, trim logs, and keep a compact running state (kills the quadratic chat-history tax) |
| **Data scientist / analyst** | Pasting a 10,000-row CSV to ask one question makes the model read all 10,000 rows | Flags it and tells the AI to write a query, run it, return only the answer — up to **1,000× fewer tokens** — and shrinks data you must include, losslessly |
| **Auditor** | Pasting whole ledgers and transaction logs to hunt for anomalies | Ask once, query for the exceptions, return only the flagged rows instead of the whole book |
| **Accountant** | Reconciling and summarising big financial tables | Shrinks the table **without altering a single number** (provably lossless), and turns "find the mismatches" into a query, not a full paste |
| **Business analyst** | Dumping dashboards and exports into AI for "what's the trend?" | Compresses the data and pushes the math into a query, so you pay for the answer, not the haystack |
| **Sales professional** | Pasting long call transcripts, email threads and CRM exports | Reads only the relevant slice and stops re-sending the whole thread on every follow-up |
| **Doctor / clinician** | Long patient notes, lab panels and papers pasted to ask a focused question | Reads only the section that answers it and compacts lab tables — and runs **entirely on your machine**, so nothing sensitive leaves it |
| **Engineer (any discipline)** | Sensor logs, bills of materials, simulation output | Lossless table shrink plus query-don't-paste for anything computable |
| **Scientist / researcher** | Exact numerical datasets where a wrong digit is unacceptable | A **proven lossless** codec that refuses rather than corrupts, with reproducible proofs and a precise numerical-fidelity contract (see below) |
| **Writer / student** | Pasting an entire document to ask one thing | The AI searches the text and reads only the part that matters |
| **Artist / worldbuilder** | Re-pasting a huge lore bible or style guide every message | Keeps that reference compact and stable instead of re-sending it each turn |
| **Executive / team lead** | Your whole team's AI bill, multiplied across every repo | Install once, enforce in CI with `--check` — cut spend without changing how anyone works |

The single idea behind all of it: **never make the AI read, reprint, or repeat
anything it doesn't have to.** Token Diet just makes that the default.

---

## An honest note: who this serves *today*

Straight talk beats overselling:

- **Fully served now:** software & full-stack developers, data scientists, and
  anyone comfortable running a small local program. The installer plugs into AI
  coding agents; the engine and optimizer handle pasted data.
- **Served, with a catch:** auditors, accountants, analysts, doctors, lawyers,
  researchers and execs get real value from the optimizer and the
  "query-don't-paste" idea — but today that means running a local page or copying
  prompts by hand. Most non-technical users won't do that yet.
- **Now covered (new):**
  - Mainstream ChatGPT / Claude / Gemini users — the **browser extension** adds a
    one-click *Shrink* button right inside the prompt box.
  - **Production / runtime** spend — the **API-side compressor** (`middleware/`)
    shrinks prompts in your backend before they're billed.
  - **Log / export data** — the engine now also re-encodes **NDJSON / JSON-lines**.
- **Still not addressed (stated, not pretended):**
  - Tokens burned by **images, audio, PDFs and RAG retrieval** — the shrinker only
    compresses flat tabular JSON/NDJSON; prose and binaries are out of scope.
  - AI inside other surfaces (Office, Notion, Slack, IDE side-panels) — no
    integration yet.

"I burnt billions of tokens" means one of two different things. If it was your
**coding agent** while building, the installer is for you. If it's your **app at
runtime**, use the `middleware/` compressor — same ideas, different place.

## What's in the box

| Piece | Who it's for | Where |
|---|---|---|
| **Rules installer** | Anyone using an AI coding agent | `install.mjs` |
| **Lossless engine** (JSON + NDJSON → table) | Importable anywhere | `engine.mjs` |
| **In-browser optimizer** | Anyone, no coding | `web/` (run `node serve.mjs`) |
| **Browser extension** | ChatGPT / Claude / Gemini users | `extension/` |
| **API-side compressor** | Production apps burning tokens at runtime | `middleware/` |
| **Reproducible proofs** | Skeptics & researchers | `proofs/` |

### The hosted page is live

The in-browser optimizer is published (free GitHub Pages) at
**https://sethiramicrosoft.github.io/token-diet/** — zero install, works on any
device, nothing uploaded. It auto-redeploys whenever the web tool changes.

---

# Part 1 — The beginner path

No experience needed. Follow these in order.

## What you need first

**Node.js**, version 18 or newer. It's free.

1. Download it from **https://nodejs.org** (click the **LTS** button) and install.
2. Open a terminal (Windows: press Start, type **PowerShell**, Enter — Mac: open
   **Terminal**) and type:

   ```bash
   node --version
   ```

   A number like `v20.11.0` means you're ready.

## Step 1 — Download Token Diet

Copy-paste these two lines, one at a time:

```bash
git clone https://github.com/sethiramicrosoft/token-diet.git
cd token-diet
```

(No `git`? On the GitHub page click the green **Code** button → **Download ZIP**,
unzip it, then open that folder in your terminal.)

## Step 2 — Put your AI coding tools on a diet

*(Skip to Step 3 if you don't use an AI coding agent.)*

Go into the project you build with AI, and run the installer from there:

```bash
cd /path/to/your-project
node /path/to/token-diet/install.mjs
```

You'll see it create the rule files your AI already reads (`AGENTS.md`,
`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`,
`.cursor/rules/token-diet.mdc`). **That's all.** Keep using your AI exactly as
before — it's now cheaper. Preview first with `--dry-run`; undo anytime with
`--remove`.

## Step 3 — Shrink any prompt in your browser

Works for everyone, coder or not. From inside the `token-diet` folder:

```bash
node serve.mjs
```

Open the link it prints (`http://127.0.0.1:8155/web/index.html`). Paste a prompt —
or click **Try a sample prompt** — and watch the token count and the dollar cost
drop. Nothing leaves your computer. Press `Ctrl+C` to stop.

---

## Why it works — the proof

Measured with a real tokenizer, fully reproducible. Run them yourself: the scripts
live in `proofs/` (`pip install tiktoken`, then `python proofs/<name>.py`).

| What you do | Before | After | Result | Proof |
|---|---|---|---|---|
| Shrink a 600-row data table (no data lost) | 41,971 tok | ~12,500 tok | **~70% smaller** | `lossless_proof.py` |
| Answer a question by querying data, not pasting it | 41,971 tok | 249 tok | **169× fewer** | `query_not_haystack.py` |
| The same at 60,000 rows | 4,188,096 tok | 259 tok | **16,170× fewer** (~$12,500 / 1,000 calls) | `query_not_haystack.py` |
| A 200-turn AI session, compact state vs resending history | 12,240,000 tok | 500,000 tok | **24.5× fewer** | `quadratic_tax.py` |

The savings are arithmetic (a tokenizer counts the same way every time), and the
data shrink is reversible — proven by 8,000 adversarial stress-tests with zero data
loss. It's not a lossy summary. It's the same information, written compactly.

---

> ### Beginners can stop here. Everything below is for power users, integrators and researchers.

---

# Part 2 — Power users & teams

## Command cheat-sheet

| Command | What it does |
|---|---|
| `node install.mjs` | Add the money-saving rules to this project |
| `node install.mjs --dry-run` | Show what would change, write nothing |
| `node install.mjs --check` | Exit code 1 if anything is missing/outdated — drop into CI |
| `node install.mjs --remove` | Cleanly remove everything it added |
| `node install.mjs --list` | List the files it manages |
| `node install.mjs --dir <path>` | Operate on another folder |
| `node serve.mjs` | Open the in-browser optimizer |
| `npm test` | Run the full test suite |

**For teams / orgs:** commit the generated files, then add `node install.mjs --check`
to CI. Every repo stays on the diet, and a drifted or tampered rules block fails
the build. One policy, enforced everywhere, zero day-to-day friction.

## Use the engine in your own code or pipeline

The engine is a dependency-free ES module. Use it programmatically:

```js
import { optimize, tableEncode, tableDecode } from "./engine.mjs";

// Shrink a whole prompt (prose + any embedded JSON arrays) and get advisories:
const { optimized, passes, flags } = optimize(promptString);

// Or use the lossless codec directly on a list of flat records:
const wire = tableEncode(records);   // a compact string, or null if not safely convertible
const back = tableDecode(wire);      // structurally identical records
```

`tableEncode` returns **`null`** whenever it cannot guarantee a perfect round-trip.
Always handle that by keeping your original JSON — which is exactly what
`optimize()` does internally. Never assume conversion happened.

## Shrink prompts in production (runtime compressor)

If your *app* burns tokens serving users, compress messages right before you send
them. `middleware/compress.mjs` is dependency-free:

```js
import { compressMessages } from "./middleware/compress.mjs";

const { messages, saved } = compressMessages(rawMessages, {
  // optional: pass your real tokenizer for exact counts; defaults to an estimate
  // tokenizer: s => encode(s).length,
  skipRoles: ["system"], // leave certain roles untouched if you like
});
// `messages` is your same conversation, smaller. Send it as usual:
const reply = await openai.chat.completions.create({ model, messages });
```

It re-encodes embedded JSON/NDJSON losslessly and strips filler, so the model sees
the same facts for fewer tokens. Image/tool parts pass through untouched.

## Browser extension (ChatGPT / Claude / Gemini)

`npm run build:ext`, then load the `extension/` folder via `chrome://extensions`
(Developer mode → Load unpacked). A **Shrink prompt** button appears in the prompt
box. See `extension/README.md` for details.

---

# Part 3 — The losslessness contract (for high-stakes & scientific data)

If a wrong digit is unacceptable — lab measurements, genomic coordinates, dosages,
financial cents, reactor telemetry — read this. The guarantees are deliberately
conservative and honest about their edges.

- **Determinism.** Encode and decode are pure functions. The same input yields the
  same output on every machine, every run. No clocks, no randomness, no locale.
- **Round-trip guarantee.** For any input `tableEncode` accepts (returns non-null),
  `tableDecode(tableEncode(x))` equals `x` at the JSON-value level (object key order
  is normalised to the first record). Verified by an 8,000-case adversarial fuzzer
  covering commas, quotes, newlines, tabs, unicode, emoji, nulls and `-0`, with zero
  failures. Reproduce with `npm test`.
- **Refuse, don't corrupt.** Rather than risk a silent error, the encoder declines
  (returns `null`, you keep JSON) on: nested objects/arrays, mixed-type columns,
  non-finite numbers (`NaN`, `±Infinity`), integers with `|x| > 2^53−1`
  (`Number.MAX_SAFE_INTEGER`), records with differing key sets, and reserved keys
  such as `__proto__`.
- **Numerical fidelity.** Floats are written with JavaScript's shortest
  round-trippable representation and parsed back with `Number()`, so every IEEE-754
  double survives bit-for-bit; `-0` is preserved. Integers are exact up to ±2^53−1.
- **The boundary that matters (read this).** The codec operates on values that have
  *already passed through* `JSON.parse`. JSON stores every number as an IEEE-754
  double, so a 19-digit ID or a 40-significant-digit decimal in your source text is
  already approximated *before* Token Diet ever sees it. The codec **refuses** such
  unsafe integers instead of emitting a mangled value, but it cannot restore
  precision JSON itself discarded. **For exact arbitrary-precision values, carry them
  as strings** — strings round-trip perfectly, every character.
- **Strict decode.** Decoding validates the format version, every type tag, row
  width, the boolean domain (`{0,1}`) and string quoting, and throws on any malformed
  frame rather than guessing.

## The wire format

JSON repeats every column name on every row. A header-once typed table doesn't:

```
@T1(name:s,score:i,csat:f,remote:b)
Jordan Avery,87,4.6,1
Sam Rivera,92,4.9,0
```

Header is `@T<version>(name:type,...)`, current version `1`. Types: `s` string
(always quoted; `"` doubled, control chars escaped), `i` integer, `f` float,
`b` boolean (`1`/`0`); null is the unquoted sentinel `\N` (a quoted `"\N"` is the
literal text).

## Safety

- **Idempotent:** running it twice changes nothing the second time.
- **Surgical:** edits only its own marked block; your other content is untouched.
- **Reversible:** `--remove` deletes only what it added.
- **Contained:** never writes through a symlink or outside the target folder; never
  crashes on a bad target; repairs malformed blocks instead of duplicating them.

## Tests

```bash
npm test
```

8,000-trial data-integrity fuzz plus installer safety tests (idempotency, content
preservation, check, remove, symlink refusal, malformed-block repair,
directory-target handling).

## License

MIT — free to use, change and share.
