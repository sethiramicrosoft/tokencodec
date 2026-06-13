# Token Diet

Put every AI coding agent on a token diet **before** you start vibe coding.

One command writes a battle-tested set of token-efficiency rules into the config
file of every major agent, so Claude Code, Codex, Copilot CLI, Gemini CLI, Cursor
and Aider all stop wasting tokens (and your money) by default.

## Why

Measured, reproducible, deterministic (see `proofs/`):

| Move | Before | After | Result |
|------|--------|-------|--------|
| Re-encode a 600-row JSON array as a lossless table | 41,971 tok | ~12,500 tok | **~70% smaller**, fully reversible |
| Answer a question by querying data instead of pasting it | 41,971 tok | 249 tok | **169x fewer**, identical answer |
| Same at 60,000 rows | 4,188,096 tok | 259 tok | **16,170x fewer**, ~$12,500 saved / 1,000 calls |

The savings are arithmetic (a tokenizer is deterministic) and the table transform
is reversible (proven by 8,000 adversarial fuzz trials, 0 data loss). Not a summary.
A re-encode.

## Quick start

```bash
npx token-diet          # or: node install.mjs
```

Writes/updates (idempotent, preserves your existing content):

- `AGENTS.md` — the cross-tool standard (Codex, Cursor, Aider, Copilot, Gemini fallback)
- `CLAUDE.md` — Claude Code
- `GEMINI.md` — Gemini CLI
- `.github/copilot-instructions.md` — GitHub Copilot
- `.cursor/rules/token-diet.mdc` — Cursor native rules

Preview changes first, and keep it enforced in CI:

```bash
node install.mjs --dry-run # show what would change, write nothing
node install.mjs --check   # exit 1 if any file is missing or outdated (CI gate)
node install.mjs --remove  # cleanly strip everything it added
```

The installer is hardened: it refuses to write through symlinks or outside the
target directory, skips (never crashes on) a bad target, repairs malformed marker
blocks instead of duplicating them, and `--check` rejects forged or duplicated
blocks rather than trusting the first one it sees.

## The web tool

`web/index.html` — paste a prompt, see the tokens you are wasting, get a smaller
version back. Runs fully in your browser; nothing is uploaded. Generate it with:

```bash
npm run build:web
```

## How the re-encode works

JSON repeats every key on every row. A header-once typed table does not:

```
@T1(name:s,score:i,csat:f,remote:b)
Jordan Avery,87,4.6,1
Sam Rivera,92,4.9,0
```

`engine.mjs` does this losslessly: strings, ints, floats, booleans and nulls all
round-trip exactly, including commas, quotes, newlines, tabs and unicode inside
values.

### Format details

The header is `@T<version>(name:type,...)`. Current version is `1`. Types:

- `s` — string (always quoted; `"` is doubled, control chars are backslash-escaped)
- `i` — integer
- `f` — float
- `b` — boolean (`1` or `0`)
- null — the unquoted sentinel `\N` (a quoted `"\N"` is the literal string)

The codec only transforms a **top-level** JSON array of flat records that all
share the same keys; anything nested inside an object is left untouched. To stay
provably lossless it refuses (and falls back to plain JSON) on: mixed-type
columns, non-finite numbers, integers beyond `Number.MAX_SAFE_INTEGER` (pass
those as strings), and reserved keys like `__proto__`. On decode it validates the
version, the type tags, row width, and each cell's grammar. Object key order is
normalised to the first record's order — lossless at the JSON-value level, not
necessarily byte-identical key ordering.

## Safety

- Idempotent: re-running is byte-identical, never duplicates a block.
- Surgical: only touches its own managed block; your content is preserved.
- Reversible: `--remove` deletes only what it created.
- Contained: never writes through a symlink or outside the target directory.

## Tests

```bash
npm test   # engine: 8,000-trial fuzz + hostile-input regressions; installer: idempotency, content, check, remove, symlink, malformed-block, directory-target
```

## License

MIT
