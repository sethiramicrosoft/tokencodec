import { encode } from "gpt-tokenizer/model/gpt-4o";
import { compressText, compressMessages, withCompression, decodeResponse, withRoundTrip, OUTPUT_FORMAT_HINT, getLegacyFormatCount } from "./compress.mjs";

const tok = s => encode(s).length;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };

// build a realistic data-heavy user message (the runtime case)
const rows = Array.from({ length: 60 }, (_, i) => ({ id: i, region: ["APAC", "EMEA", "NA"][i % 3], amount: 100 + i, ok: i % 2 === 0 }));
const dataMsg = "Summarize this data:\n" + JSON.stringify(rows, null, 2);

// 1. compressText shrinks and reports real token savings
{
  const r = compressText(dataMsg, { tokenizer: tok });
  ok(r.text.includes("@T2 "), "embedded JSON re-encoded to a table");
  ok(r.after < r.before, `tokens reduced (${r.before} -> ${r.after})`);
  ok(r.saved === r.before - r.after, "saved = before - after");
  console.log(`  compressText: ${r.before} -> ${r.after} tokens (${Math.round(100*r.saved/r.before)}% less)`);
}

// 2. compressMessages handles string content and preserves roles/order
{
  const messages = [
    { role: "system", content: "You are a helpful analyst." },
    { role: "user", content: dataMsg },
  ];
  const { messages: out, saved } = compressMessages(messages, { tokenizer: tok });
  ok(out.length === 2 && out[0].role === "system" && out[1].role === "user", "roles and order preserved");
  ok(out[1].content.includes("@T2 "), "user data message compressed");
  ok(saved > 0, "reported aggregate savings > 0");
}

// 3. array-style content (OpenAI/Anthropic parts) - text compressed, non-text untouched
{
  const messages = [{ role: "user", content: [
    { type: "text", text: dataMsg },
    { type: "image_url", image_url: { url: "https://x/y.png" } },
  ]}];
  const { messages: out } = compressMessages(messages, { tokenizer: tok });
  ok(out[0].content[0].text.includes("@T2 "), "text part compressed");
  ok(out[0].content[1].type === "image_url" && out[0].content[1].image_url.url === "https://x/y.png", "non-text part untouched");
}

// 4. skipRoles leaves chosen roles alone
{
  const messages = [{ role: "system", content: dataMsg }, { role: "user", content: dataMsg }];
  const { messages: out } = compressMessages(messages, { tokenizer: tok, skipRoles: ["system"] });
  ok(!out[0].content.includes("@T2 "), "system message left untouched when skipped");
  ok(out[1].content.includes("@T2 "), "user message still compressed");
}

// 5. lossless: the compressed data decodes back to the original rows
{
  const r = compressText(dataMsg, { tokenizer: tok });
  // pull the table out and decode it to prove no data was lost
  const start = r.text.indexOf("@T2 ");
  const tbl = r.text.slice(start);
  import("../engine.mjs").then(({ tableDecode }) => {
    const back = tableDecode(tbl);
    ok(JSON.stringify(back) === JSON.stringify(rows), "runtime-compressed data round-trips to original");
    finish();
  });
}

// 6. withCompression calls the send function with compressed messages
let asyncDone = false;
let roundTripDone = false;
{
  const messages = [{ role: "user", content: dataMsg }];
  withCompression(messages, async (compressed) => {
    ok(compressed[0].content.includes("@T2 "), "send() receives compressed messages");
    return { ok: true };
  }, { tokenizer: tok }).then(({ response, stats }) => {
    ok(response.ok === true && stats.saved > 0, "withCompression returns response + stats");
    asyncDone = true;
  });
}

// 7. OUTPUT side: decodeResponse expands a model's @T2 reply back into JSON
{
  import("../engine.mjs").then(({ tableEncode }) => {
    const recs = [{ city: "Oslo", pop: 700000 }, { city: "Bergen", pop: 280000 }];
    const modelReply = "Here you go:\n" + tableEncode(recs);
    const back = decodeResponse(modelReply);
    ok(!back.includes("@T2 "), "model's @T2 reply expanded to JSON");
    ok(JSON.stringify(JSON.parse(back.match(/\[.*\]/s)[0])) === JSON.stringify(recs), "decoded reply equals the model's data");
    ok(decodeResponse("just prose, no table") === "just prose, no table", "prose reply returned unchanged");
  });
}

// 8. the output hint is a real, paste-able string that names the format
ok(typeof OUTPUT_FORMAT_HINT === "string" && OUTPUT_FORMAT_HINT.includes("@T2 "), "OUTPUT_FORMAT_HINT names the @T2 format");

// 9. withRoundTrip: compress request + inject hint + decode the @T2 reply, end to end
{
  import("../engine.mjs").then(({ tableEncode }) => {
    const recs = [{ id: 1, tag: "a" }, { id: 2, tag: "b" }];
    withRoundTrip([{ role: "user", content: dataMsg }], async (compressed) => {
      ok(compressed[0].role === "system" && compressed[0].content.includes("@T2 "), "output hint injected as a system message");
      ok(compressed[1].content.includes("@T2 "), "request data still compressed");
      return "Result:\n" + tableEncode(recs);   // the model answers in @T2
    }, { tokenizer: tok }).then(({ text, stats }) => {
      ok(!text.includes("@T2 "), "round-trip decoded the model's @T2 reply");
      ok(stats.saved > 0, "round-trip still reports input savings");
      roundTripDone = true;
    });
  });
}

// 10. shadow router mode logs decisions but keeps request text unchanged
{
  const messages = [{ role: "user", content: dataMsg }];
  const { messages: out, flags } = compressMessages(messages, {
    tokenizer: tok,
    router: { mode: "shadow", minSavedTokens: 120, minSavedPct: 15 },
  });
  ok(out[0].content === dataMsg, "shadow mode leaves request content unchanged");
  const rf = flags.find(f => f.kind === "router" && f.mode === "shadow");
  ok(!!rf && (rf.wouldRoute === "compress" || rf.wouldRoute === "passthrough"), "shadow mode records a route decision");
}

// 11. enforce router mode - compresses only when savings clear both thresholds
{
  // big payload that SHOULD clear the threshold (120 tokens saved, 15% saved)
  const { messages: out, flags } = compressMessages(
    [{ role: "user", content: dataMsg }],
    { tokenizer: tok, router: { mode: "enforce", minSavedTokens: 120, minSavedPct: 15 } },
  );
  ok(out[0].content.includes("@T2 "), "enforce mode compresses when savings clear threshold");
  const rf = flags.find(f => f.kind === "router" && f.mode === "enforce");
  ok(!!rf && rf.wouldRoute === "compress", "enforce mode records compress decision for big payload");
}

// 12. enforce router mode - passes through when savings fall below threshold
{
  const tinyMsg = "Hello, how are you?";
  const { messages: out, flags } = compressMessages(
    [{ role: "user", content: tinyMsg }],
    { tokenizer: tok, router: { mode: "enforce", minSavedTokens: 120, minSavedPct: 15 } },
  );
  ok(out[0].content === tinyMsg, "enforce mode passes through message when savings below threshold");
  const rf = flags.find(f => f.kind === "router" && f.mode === "enforce");
  ok(!!rf && rf.wouldRoute === "passthrough", "enforce mode records passthrough decision for tiny payload");
}

// 13. getLegacyFormatCount increments on each legacy @T1(...) decode
{
  const before = getLegacyFormatCount();
  // integer-only CSV avoids the unquoted-string guard in the decoder
  const legacyReply = "@T1(x:i,y:i)\n1,2\n3,4";
  decodeResponse(legacyReply);
  decodeResponse(legacyReply);
  const after = getLegacyFormatCount();
  ok(after === before + 2, "getLegacyFormatCount increments for each legacy decode call");
}

function finish() {
  // give the async promises a tick to resolve
  setTimeout(() => {
    const clean = fail === 0 && asyncDone && roundTripDone;
    console.log(`\nMIDDLEWARE TESTS: ${pass} passed, ${fail} failed  ${clean ? "(bulletproof)" : (fail ? "FAILED" : "")}`);
    process.exit(fail ? 1 : 0);
  }, 100);
}
