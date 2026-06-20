import { DEFAULT_SESSION_PROMPT, compressJsonPayload, prependSessionPrompt, proxyBaseUrl, sessionPromptText } from "./proxy.mjs";
import { buildWrapPlan } from "./wrap.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

{
  const body = {
    messages: [
      { role: "user", content: "Could you please summarize this data: " + JSON.stringify([{ id: 1, value: "alpha" }, { id: 2, value: "beta" }]) },
    ],
  };
  const { payload, changed } = compressJsonPayload(body);
  ok(changed, "proxy: messages payload is compressed");
  ok(payload.messages.some(m => typeof m.content === "string" && m.content.includes("@T1(")), "proxy: compressed message content contains @T1 table");
}

{
  const body = { prompt: "Could you please look at this: " + JSON.stringify([{ a: 1 }, { a: 2 }]) };
  const { payload, changed } = compressJsonPayload(body);
  ok(changed, "proxy: prompt field is compressed");
  ok(payload.prompt.includes("@T1("), "proxy: prompt field becomes a table");
}

{
  const plan = buildWrapPlan("codex", 8787, { TOKENCODEC_COMMAND: "codex" });
  ok(plan.command === "codex", "wrap: codex uses the codex command");
  ok(plan.env.OPENAI_BASE_URL === `${proxyBaseUrl("127.0.0.1", 8787)}/v1`, "wrap: codex points OpenAI traffic at the local proxy");
}

{
  const plan = buildWrapPlan("copilot", 8787, {});
  ok(plan.env.OPENAI_BASE_URL.endsWith("/v1"), "wrap: copilot plan sets an OpenAI-compatible base URL");
  ok(plan.env.GITHUB_COPILOT_API_URL === proxyBaseUrl("127.0.0.1", 8787), "wrap: copilot plan exposes a local GitHub Copilot API URL");
  ok(plan.env.OPENAI_TARGET_API_URL === proxyBaseUrl("127.0.0.1", 8787), "wrap: copilot plan exposes the local OpenAI target URL");
  ok(plan.env.COPILOT_PROVIDER_BASE_URL.endsWith("/v1"), "wrap: copilot plan exposes the provider base URL");
}

{
  const messages = [{ role: "user", content: "hello" }];
  const injected = prependSessionPrompt(messages, DEFAULT_SESSION_PROMPT);
  ok(injected.length === 2, "proxy: session prompt is prepended to message arrays");
  ok(injected[0].role === "system" && injected[0].content === DEFAULT_SESSION_PROMPT, "proxy: session prompt uses the expected contract");
  ok(prependSessionPrompt(messages, "") === messages, "proxy: empty session prompt leaves messages unchanged");
}

{
  ok(sessionPromptText({ TOKENCODEC_SESSION_PROMPT: "off" }) === "", "proxy: session prompt can be disabled");
  ok(sessionPromptText({ TOKENCODEC_SESSION_PROMPT: "custom prompt" }) === "custom prompt", "proxy: session prompt can be overridden");
}

console.log(`\nPROXY TESTS: ${pass} passed, ${fail} failed  ${fail === 0 ? "(bulletproof)" : "FAILED"}`);
process.exit(fail ? 1 : 0);
