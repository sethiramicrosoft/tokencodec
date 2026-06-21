// Middleware HTTP integration tests: withCompression, withRoundTrip, shadow, and
// enforce modes exercised against a real in-process HTTP server built with
// Node.js built-ins only (no Express). The mock server validates the compressed
// payload on arrival, so failures surface at the HTTP level, not just in unit code.
import http from "node:http";
import { compressMessages, withCompression, withRoundTrip, OUTPUT_FORMAT_HINT } from "./compress.mjs";
import { encode } from "gpt-tokenizer/model/gpt-4o";
import { tableEncode } from "../engine.mjs";

const tok = s => encode(s).length;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };

// Realistic 60-row payload: exceeds the enforce router's default thresholds
// (120 tokens saved, 15% reduction) so compress/passthrough behaviour is deterministic.
const rows = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  region: ["APAC", "EMEA", "NA"][i % 3],
  amount: 100 + i,
  active: i % 2 === 0,
}));
const dataMsg = "Summarise this quarterly data:\n" + JSON.stringify(rows, null, 2);

// ---- helpers ----------------------------------------------------------------

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", d => body += d);
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const reply = handler(parsed);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(reply));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function postJSON(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1", port, method: "POST",
        path: "/v1/chat/completions",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
      },
      (res) => {
        let b = "";
        res.on("data", d => b += d);
        res.on("end", () => {
          try { resolve(JSON.parse(b)); } catch { reject(new Error("Non-JSON response: " + b)); }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ---- 1. withCompression: compressed messages arrive at the mock server ------
{
  let serverChecked = false;
  const server = await startServer(body => {
    ok(Array.isArray(body.messages), "server receives messages array");
    ok(body.messages[0].content.includes("@T2 "), "server receives @T2-compressed user message");
    ok(body.messages[0].role === "user", "role preserved through HTTP wire");
    serverChecked = true;
    return { id: "t1", choices: [{ message: { role: "assistant", content: "acknowledged" } }] };
  });
  const { port } = server.address();
  const send = (compressed) => postJSON(port, { model: "gpt-4o", messages: compressed });
  const { response, stats } = await withCompression(
    [{ role: "user", content: dataMsg }],
    send,
    { tokenizer: tok },
  );
  ok(serverChecked, "server handler ran (request reached the server)");
  ok(response?.choices?.[0]?.message?.content === "acknowledged", "withCompression returns the server response");
  ok(stats.saved > 0, "withCompression.stats reports token savings > 0");
  server.close();
}

// ---- 2. withRoundTrip: OUTPUT_FORMAT_HINT injected; @T2 reply decoded -------
{
  const replyRecs = [{ city: "Oslo", pop: 700000 }, { city: "Bergen", pop: 280000 }];
  const t2Reply = "Here you go:\n" + tableEncode(replyRecs);

  let hintSeen = false, dataSeen = false;
  const server = await startServer(body => {
    hintSeen = body.messages[0]?.role === "system" && body.messages[0]?.content?.includes("@T2");
    dataSeen = body.messages[1]?.content?.includes("@T2 ");
    return { id: "t2", choices: [{ message: { role: "assistant", content: t2Reply } }] };
  });
  const { port } = server.address();
  const send = (compressed) =>
    postJSON(port, { messages: compressed }).then(r => r.choices[0].message.content);

  const { text, stats } = await withRoundTrip(
    [{ role: "user", content: dataMsg }],
    send,
    { tokenizer: tok },
  );

  ok(hintSeen, "withRoundTrip injects OUTPUT_FORMAT_HINT as system message");
  ok(dataSeen, "withRoundTrip still compresses the user's data");
  ok(!text.includes("@T2 "), "withRoundTrip decoded the model's @T2 reply into JSON");
  const parsed = JSON.parse(text.match(/\[.*\]/s)[0]);
  ok(
    JSON.stringify(parsed) === JSON.stringify(replyRecs),
    "withRoundTrip decoded reply equals the original records",
  );
  ok(stats.saved > 0, "withRoundTrip stats reports input savings");
  server.close();
}

// ---- 3. shadow mode: server gets UNCOMPRESSED body; flags record decision ---
{
  let bodyWasUncompressed = false;
  const server = await startServer(body => {
    bodyWasUncompressed = !body.messages[0].content.includes("@T2 ");
    return { id: "t3", choices: [{ message: { role: "assistant", content: "ok" } }] };
  });
  const { port } = server.address();
  const send = (compressed) => postJSON(port, { messages: compressed });
  const { response, stats } = await withCompression(
    [{ role: "user", content: dataMsg }],
    send,
    { tokenizer: tok, router: { mode: "shadow" } },
  );
  ok(bodyWasUncompressed, "shadow mode: server receives the original uncompressed message");
  ok(response?.id === "t3", "shadow mode: server response returned correctly");
  const rf = stats.flags.find(f => f.kind === "router" && f.mode === "shadow");
  ok(!!rf, "shadow mode: router flag recorded in stats");
  ok(rf.wouldRoute === "compress" || rf.wouldRoute === "passthrough",
    "shadow mode flag has a valid wouldRoute value");
  server.close();
}

// ---- 4. enforce mode: small payload passes through uncompressed --------------
{
  let bodyWasUncompressed = false;
  const server = await startServer(body => {
    bodyWasUncompressed = !body.messages[0].content.includes("@T2 ");
    return { id: "t4", choices: [{ message: { role: "assistant", content: "hi" } }] };
  });
  const { port } = server.address();
  const send = (compressed) => postJSON(port, { messages: compressed });
  await withCompression(
    [{ role: "user", content: "Hi there." }],
    send,
    { tokenizer: tok, router: { mode: "enforce", minSavedTokens: 120, minSavedPct: 15 } },
  );
  ok(bodyWasUncompressed, "enforce mode: tiny message below threshold passes through uncompressed");
  server.close();
}

// ---- 5. enforce mode: large payload IS compressed ---------------------------
{
  let bodyWasCompressed = false;
  const server = await startServer(body => {
    bodyWasCompressed = body.messages[0].content.includes("@T2 ");
    return { id: "t5", choices: [{ message: { role: "assistant", content: "done" } }] };
  });
  const { port } = server.address();
  const send = (compressed) => postJSON(port, { messages: compressed });
  await withCompression(
    [{ role: "user", content: dataMsg }],
    send,
    { tokenizer: tok, router: { mode: "enforce", minSavedTokens: 120, minSavedPct: 15 } },
  );
  ok(bodyWasCompressed, "enforce mode: large payload above threshold is compressed before sending");
  server.close();
}

// ---- 6. skipRoles: system message skipped, user message compressed ----------
{
  let systemUncompressed = false, userCompressed = false;
  const server = await startServer(body => {
    systemUncompressed = !body.messages[0].content.includes("@T2 ");
    userCompressed = body.messages[1].content.includes("@T2 ");
    return { id: "t6", choices: [{ message: { role: "assistant", content: "noted" } }] };
  });
  const { port } = server.address();
  const messages = [
    { role: "system",  content: dataMsg },
    { role: "user",    content: dataMsg },
  ];
  const send = (compressed) => postJSON(port, { messages: compressed });
  await withCompression(messages, send, { tokenizer: tok, skipRoles: ["system"] });
  ok(systemUncompressed, "skipRoles: system message arrives uncompressed at server");
  ok(userCompressed, "skipRoles: user message arrives compressed at server");
  server.close();
}

// ---- 7. OUTPUT_FORMAT_HINT is a non-empty string naming the @T2 format ------
ok(typeof OUTPUT_FORMAT_HINT === "string" && OUTPUT_FORMAT_HINT.length > 0,
  "OUTPUT_FORMAT_HINT is a non-empty string");
ok(OUTPUT_FORMAT_HINT.includes("@T2"),
  "OUTPUT_FORMAT_HINT references the @T2 format");

console.log(`\nMIDDLEWARE HTTP INTEGRATION: ${pass} passed, ${fail} failed  ${fail === 0 ? "(bulletproof)" : "FAILED"}`);
process.exit(fail ? 1 : 0);
