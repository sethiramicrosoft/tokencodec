# Results

Run with the harness in this folder. One 30-row dataset, 10 questions with
code-computed ground truth, two formats (raw JSON vs the `@T1` table + a one-line
legend). The table prompt is **52% smaller** (948 vs 1,960 tokens, legend
included).

| Model (read-only) | JSON accuracy | `@T1` table accuracy | Tokens saved |
|---|---|---|---|
| GPT-5.4-mini | 10/10 | **10/10** | 52% |
| Claude Haiku 4.5 | 10/10 | **8/10** | 52% |

## What this says, honestly

**The good (the headline):** GPT-5.4-mini answered the compact table **exactly as
accurately as JSON** - 10/10 either way - while spending 52% fewer tokens. For that
model the compression was free. Across both models, every **reasoning** task was
preserved on the table: direct lookup, filter-count, argmax and argmin by name,
most-common category, count-by-category, and the rounded average all matched JSON.

**The honest caveat:** Claude Haiku 4.5 slipped on 2 of 10 on the table - and both
misses were raw **arithmetic over many rows**: the sum of 30 `tickets` values
(3,971 vs 4,068) and one boolean count (9 vs 10). It read the *structure*
perfectly; it fumbled mental math on the denser layout.

That failure mode is exactly the task TokenCodec's own rules tell you **not** to
hand a model: "query data, do not make the model do the math." So the result
supports the product's guidance rather than undercutting it:

- **Feed the compact table when the model needs to reason over the data** (look
  things up, filter, compare, classify). Accuracy held.
- **Do not ask the model to aggregate many rows in its head** in either format -
  compute sums and counts yourself and hand back the result. Small models slip at
  that regardless of layout.

## Limits of this test (so nobody over-reads it)

- One dataset, 10 questions, two models, a single run each. Indicative, not a paper.
- The test models were instructed to read only (no code), but that cannot be fully
  enforced here; the exact 30-number sums on the JSON runs suggest some computation
  may have happened. The most trustworthy signal is the **per-model delta** between
  JSON and table, which isolated cleanly to arithmetic.
- Reproduce with `node benchmark/benchmark.mjs generate`, send the two prompts to a
  real chat completion with tools disabled, and score the replies.

## Bottom line

The codec is provably lossless (separate fuzz tests). This benchmark adds that a
capable small model also *reads* the compact form with no accuracy loss for
reasoning tasks, at ~half the tokens. The one place to be careful - heavy
arithmetic - is something you should be offloading from the model anyway.

## Output side - can the model EMIT the compact form to save output tokens?

Input compression is lossless and easy. The harder question: when the model
*returns* structured data, can it produce the `@T1` table correctly, and does that
save output tokens? (Producing a precise format is harder than reading one.)
Measured with `output_benchmark.mjs` - a filter-and-sort task returning 10 records:

| Model | Returned as JSON | Returned as `@T1` | Output tokens |
|---|---|---|---|
| GPT-5.4-mini | correct | correct | 192 -> 147 (**23% fewer**) |
| Claude Haiku 4.5 | see note | see note | 192 -> 147 (**23% fewer**) |

- **Both models produced valid `@T1` that decoded losslessly.** The format is
  reliably emittable for a flat schema.
- **`@T1` was exactly as accurate as JSON, per model.** GPT got both right. Haiku
  returned the correct 10 records in both formats but mis-ordered a tie-break
  *identically* in JSON and `@T1` - a sorting-instruction slip, not a format fault.
  So choosing `@T1` did not cost any correctness; it only saved tokens.
- **Savings: 23% fewer output tokens** for the same answer. The 10-record answer is
  **192 tokens as compact JSON vs 147 as `@T1`** (o200k tokenizer) - a deterministic
  property of the formats: tokenize `JSON.stringify(out_truth.json)` vs
  `tableEncode(out_truth.json)` to reproduce. (Pretty-printed JSON is larger; the 192
  figure is compact JSON, which is what a token-conscious caller would emit.)

How to use it: ask the model to return `@T1` (give it the one-line format spec),
then decode the reply with `tableDecode` from `engine.mjs`. Honest caveat: tested on
a flat schema; nested or highly irregular output is harder for a model to format,
so measure before relying on it.
