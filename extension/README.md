# TokenCodec - browser extension

Adds a **Shrink prompt** button inside ChatGPT, Claude and Gemini. Click it and
your prompt is rewritten smaller - pasted JSON/NDJSON data is re-encoded into a
compact lossless table and filler is stripped - before you ever hit send. Nothing
leaves your browser.

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
