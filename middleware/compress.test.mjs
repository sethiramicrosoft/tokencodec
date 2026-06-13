import { encode } from "gpt-tokenizer/model/gpt-4o";
import { compressText, compressMessages, withCompression } from "./compress.mjs";

const tok = s => encode(s).length;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };

// build a realistic data-heavy user message (the runtime case)
const rows = Array.from({ length: 60 }, (_, i) => ({ id: i, region: ["APAC", "EMEA", "NA"][i % 3], amount: 100 + i, ok: i % 2 === 0 }));
const dataMsg = "Summarize this data:\n" + JSON.stringify(rows, null, 2);

// 1. compressText shrinks and reports real token savings
{
  const r = compressText(dataMsg, { tokenizer: tok });
  ok(r.text.includes("@T1("), "embedded JSON re-encoded to a table");
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
  ok(out[1].content.includes("@T1("), "user data message compressed");
  ok(saved > 0, "reported aggregate savings > 0");
}

// 3. array-style content (OpenAI/Anthropic parts) — text compressed, non-text untouched
{
  const messages = [{ role: "user", content: [
    { type: "text", text: dataMsg },
    { type: "image_url", image_url: { url: "https://x/y.png" } },
  ]}];
  const { messages: out } = compressMessages(messages, { tokenizer: tok });
  ok(out[0].content[0].text.includes("@T1("), "text part compressed");
  ok(out[0].content[1].type === "image_url" && out[0].content[1].image_url.url === "https://x/y.png", "non-text part untouched");
}

// 4. skipRoles leaves chosen roles alone
{
  const messages = [{ role: "system", content: dataMsg }, { role: "user", content: dataMsg }];
  const { messages: out } = compressMessages(messages, { tokenizer: tok, skipRoles: ["system"] });
  ok(!out[0].content.includes("@T1("), "system message left untouched when skipped");
  ok(out[1].content.includes("@T1("), "user message still compressed");
}

// 5. lossless: the compressed data decodes back to the original rows
{
  const r = compressText(dataMsg, { tokenizer: tok });
  // pull the table out and decode it to prove no data was lost
  const start = r.text.indexOf("@T1(");
  const tbl = r.text.slice(start);
  import("../engine.mjs").then(({ tableDecode }) => {
    const back = tableDecode(tbl);
    ok(JSON.stringify(back) === JSON.stringify(rows), "runtime-compressed data round-trips to original");
    finish();
  });
}

// 6. withCompression calls the send function with compressed messages
let asyncDone = false;
{
  const messages = [{ role: "user", content: dataMsg }];
  withCompression(messages, async (compressed) => {
    ok(compressed[0].content.includes("@T1("), "send() receives compressed messages");
    return { ok: true };
  }, { tokenizer: tok }).then(({ response, stats }) => {
    ok(response.ok === true && stats.saved > 0, "withCompression returns response + stats");
    asyncDone = true;
  });
}

function finish() {
  // give the withCompression promise a tick to resolve
  setTimeout(() => {
    console.log(`\nMIDDLEWARE TESTS: ${pass} passed, ${fail} failed  ${fail === 0 && asyncDone ? "(bulletproof)" : (fail ? "FAILED" : "")}`);
    process.exit(fail ? 1 : 0);
  }, 50);
}
