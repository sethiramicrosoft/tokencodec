# TokenCodec - browser extension

Adds two buttons inside ChatGPT, Claude and Gemini. **Shrink prompt** rewrites your
prompt smaller - pasted JSON/NDJSON data is re-encoded into a compact lossless table
and filler is stripped - before you ever hit send. **Compact reply** adds a one-line
rule so the model answers tabular data as a compact `@T1` table, which costs fewer
output tokens. Nothing leaves your browser.

## How it works

The whole add-on is one content script, `content.js`: the tested `engine.mjs` inlined
ahead of a small in-page UI (the `export` keywords are stripped because content scripts
are not ES modules, so the engine and UI share one scope). `manifest.json` tells the
browser to inject it only on `chatgpt.com`, `chat.openai.com`, `claude.ai` and
`gemini.google.com`. There is no background page, no server, and no network call.

1. **It mounts one button.** On load it appends a fixed-position "Shrink prompt" button
   and a status toast to the page. These chat apps re-render their DOM constantly, so a
   `MutationObserver` re-appends the button if it ever gets torn out.
2. **It locates your editor.** On click it uses the editor you have focused; if the click
   moved focus, it falls back to the last prompt box you typed in, and only then to the
   first `textarea`, `[contenteditable]` or `[role="textbox"]` on the page. It also avoids
   stealing focus when you press the button. So on a real page with several editors (a
   sidebar search, hidden fields) it still targets your actual prompt, covering both the
   plain `<textarea>` and rich editors (ProseMirror, Lexical) these sites use.
3. **It reads, then runs `optimize()`.** It reads `.value` (textarea/input) or
   `.innerText` (rich editor), then runs the same lossless pass used by the CLI and the
   web tool: JSON arrays and NDJSON blocks become a compact `@T1` table, filler is
   stripped, values are untouched.
4. **It writes the result back so the app notices.** Setting `.value` directly does not
   update React/ProseMirror state, so the site would still send the original text. For
   textareas it calls the native value setter and dispatches a real `input` event; for
   rich editors it selects the contents and uses `execCommand("insertText")`, which keeps
   the editor's internal model in sync. A toast then reports the approximate tokens saved.

**Saving output tokens (the second button).** A raw chat has no system-prompt field, so
the only honest channel to the model is the message itself. **Compact reply** appends a
short rule (`@T1` format spec) to your prompt box - in the same prompt-box-only way,
never touching the page or your account - so tabular answers come back as a compact
table instead of verbose JSON. To read that compact reply, paste it into the hosted
page's *"Shrink the reply too"* decoder (or use the middleware's `decodeResponse`). It is
worth a few input tokens only when you expect a list or table back; for prose the rule
tells the model to answer normally.

Nothing is auto-sent - you review the shrunk prompt in the box and press send yourself.

## Install (takes 30 seconds, no store needed)

1. Build the script (only needed once, or after engine changes):

   ```bash
   npm run build:ext
   ```

   This generates `extension/content.js` from the tested engine.

2. Open your browser's extensions page:
   - **Chrome / Edge / Brave:** go to `chrome://extensions`
   - Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `extension/` folder.
4. Open ChatGPT, Claude or Gemini. You'll see the **Shrink prompt** button at the
   bottom-right. Type or paste your prompt, click it, and watch it shrink.

## What it does

- Re-encodes any JSON array or NDJSON/log block in your prompt into a lossless
  table (same values, far fewer tokens).
- Strips filler phrases.
- Shows roughly how many tokens you saved, and flags when you'd be better off
  asking the model to query the data instead of pasting it.
- **Compact reply** adds a one-line `@T1` rule to your prompt so tabular answers
  come back smaller (fewer output tokens); decode that reply on the hosted page.

## Notes & limits (honest)

- Token counts shown are **approximate** (~4 characters per token), to keep the
  extension lightweight and fully offline. The savings are real; the exact number
  depends on the model's tokenizer.
- The button is a best-effort overlay. These sites change their layout often; if
  the button can't find your prompt box, click into it first, then press Shrink.
- It only rewrites text you can see in the prompt box. It never reads your account,
  your history, or anything on the page, and it makes no network calls.

## Rebuild after engine changes

`content.js` is generated - never edit it by hand. Change `engine.mjs` (or the UI
in `extension/build-extension.mjs`) and run `npm run build:ext` again.
