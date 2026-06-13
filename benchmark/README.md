# Accuracy benchmark - does the model read the compact table as well as JSON?

TokenCodec's codec is provably **lossless** (the fuzz tests prove encode -> decode
returns the exact input). That guarantees the *data* survives. It does **not** by
itself prove that an LLM **answers questions about the data just as accurately**
when it is given the compact `@T1` table instead of raw JSON.

This benchmark measures exactly that. It is the honest make-or-break test for the
"compress the data, then feed it to the model" use case.

## Method

1. `generate` builds a fixed 30-row dataset and 10 questions whose answers are
   computed in code (the ground truth) - counts, sums, an average, argmax/argmin
   by name, a filter count, a boolean count, the most common category, and a
   direct lookup.
2. It writes two prompts with the **same** questions:
   - `prompt_json.txt` - the data as pretty JSON.
   - `prompt_table.txt` - a one-line legend explaining the format, then the `@T1`
     table. The legend is counted in the table's token total, so the comparison
     is fair.
3. You send each prompt to the model you want to test, reading only (no code), and
   save its JSON answer.
4. `score` compares each answer to the ground truth and reports accuracy.

## Run it with any model

```bash
node benchmark/benchmark.mjs generate
# send benchmark/prompt_json.txt to your model, save its JSON reply to json.answer.json
# send benchmark/prompt_table.txt to your model, save its JSON reply to table.answer.json
node benchmark/benchmark.mjs score json  benchmark/json.answer.json
node benchmark/benchmark.mjs score table benchmark/table.answer.json
```

The bar to clear: **table accuracy should equal JSON accuracy** (within noise). If
it does, the compact form is safe to feed to the model and you keep the token
savings for free. If it does not, treat the codec as lossless *storage/transport*
and decode back to JSON before the model reads it.

## Results

See `RESULTS.md` for the measured numbers, the exact models tested, and an honest
read of what they mean (including the limits of this test).

## Output-side benchmark

`output_benchmark.mjs` tests the reverse direction: when the model *returns*
structured data, can it emit the compact `@T1` table correctly, and does that save
output tokens?

```bash
node benchmark/output_benchmark.mjs generate
# send prompt_out_json.txt and prompt_out_table.txt to your model, save each reply
node benchmark/output_benchmark.mjs score json  benchmark/json.reply.txt
node benchmark/output_benchmark.mjs score table benchmark/table.reply.txt
```

It reports output-token count and whether the returned data is correct (the table
reply is decoded with `tableDecode`, so correctness means it round-tripped). Measured
result is in `RESULTS.md`: ~32% fewer output tokens, no accuracy loss versus JSON.

