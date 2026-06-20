# Copilot instructions

<!-- TOKENCODEC:START v1 (managed by tokencodec; edit rules upstream, not here) -->
# TokenCodec - read this before doing anything

Optimize for tokens. Never trade away correctness to do it. If a step genuinely
needs the whole file or dataset, use it.

## Rules
1. Search before you read. Use ripgrep/grep and open files by line range. Do not
   read a whole file or directory to find one symbol.
2. Query data, do not paste it. To answer anything computable about a CSV, JSON,
   database or log, write a query or a few lines of code, run it, and keep only
   the result. Pasting 600 rows is ~42k tokens; the query is ~250.
3. Compact any data you must include. Use a header-once table (CSV/TSV), not
   indented JSON. Drop whitespace. Same data, ~4x fewer tokens, fully reversible.
4. Do not re-read. Remember what you already opened this session; reopen only on
   change.
5. Trim tool output. Pipe noisy commands through head/grep or use quiet flags.
   Surface failures and summaries, not full build or test logs.
6. Small diffs only. Make surgical edits and show diffs, not whole files. If a
   change exceeds ~400 lines, propose a split first.
7. Keep history short. Maintain a compact running state. A conversation's cost
   grows with the square of its length, so do not re-quote large context or
   restate the whole plan every turn.
8. Cut filler. Terse, direct instructions. No politeness padding, no restating.
9. Keep a stable prefix. Hold system/context constant so the provider can cache
   it; do not reshuffle it on each call.

## Output (what you write back, not just what you read - output tokens are billed ~4-8x input)
10. Be brief. No preamble, no restating the question, no recap of what you just did
    unless asked. Answer in the fewest tokens that fully answer.
11. When you emit structured data, return a compact table (CSV or header-once), not
    pretty-printed JSON.
12. Use the lowest reasoning effort that solves the task, and do not narrate your
    thinking unless asked.

## One-line self-check
Before sending: am I pasting anything the model could fetch, grep, or compute
itself? If yes, do that instead.
<!-- TOKENCODEC:END -->
