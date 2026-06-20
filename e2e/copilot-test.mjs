import { compressMessages } from "../middleware/compress.mjs";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Build realistic data: 300 records
const records = Array.from({ length: 300 }, (_, i) => ({
  id: i + 1,
  region: ["APAC", "EMEA", "NA"][i % 3],
  amount: 5000 + i * 100,
  status: i % 2 === 0 ? "completed" : "pending",
}));

const prompt = "Summarize this sales data. What is the total amount by region? Be very brief.";
const dataPrompt = prompt + "\n" + JSON.stringify(records, null, 2);

console.log("\n════════════════════════════════════════════════════════════");
console.log("  TEST: COPILOT CLI WITH COMPRESSION");
console.log("════════════════════════════════════════════════════════════");

const tmpDir = path.join(process.cwd(), '.tmp-test');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

// TEST 1: UNCOMPRESSED
console.log("\n▶ TEST 1: UNCOMPRESSED");
console.log(`Data size: ${dataPrompt.length} chars`);
console.log(`Estimated tokens: ~${Math.ceil(dataPrompt.length / 4)}`);

const uncompressedFile = path.join(tmpDir, 'prompt-uncompressed.txt');
fs.writeFileSync(uncompressedFile, dataPrompt);

console.log(`Running: copilot -p "..."\n`);

try {
  const result1 = execSync(`copilot -p "$(cat '${uncompressedFile}')"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, shell: '/bin/bash' });
  console.log(result1);
  fs.writeFileSync(path.join(tmpDir, 'output-uncompressed.txt'), result1);
  
  // Extract token usage
  const match1 = result1.match(/AI Credits\s+(\d+\.?\d*)/);
  console.log(`\nTokens used: ${match1 ? match1[1] : 'unknown'}`);
} catch (e) {
  console.error("ERROR:", e.message.substring(0, 200));
}

// TEST 2: COMPRESSED
console.log("\n▶ TEST 2: COMPRESSED");
const { messages: compressed, before, after, saved } = compressMessages([{ role: "user", content: dataPrompt }]);
const compressedPrompt = compressed[0].content;
console.log(`Compression: ${before} → ${after} chars (${Math.round(100 * saved / before)}% saved)`);
console.log(`Estimated tokens: ~${Math.ceil(after / 4)}`);

const compressedFile = path.join(tmpDir, 'prompt-compressed.txt');
fs.writeFileSync(compressedFile, compressedPrompt);

console.log(`Running: copilot -p "..."\n`);

try {
  const result2 = execSync(`copilot -p "$(cat '${compressedFile}')"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, shell: '/bin/bash' });
  console.log(result2);
  fs.writeFileSync(path.join(tmpDir, 'output-compressed.txt'), result2);
  
  // Extract token usage
  const match2 = result2.match(/AI Credits\s+(\d+\.?\d*)/);
  console.log(`\nTokens used: ${match2 ? match2[1] : 'unknown'}`);
} catch (e) {
  console.error("ERROR:", e.message.substring(0, 200));
}

// Cleanup
fs.rmSync(tmpDir, { recursive: true });

console.log("\n════════════════════════════════════════════════════════════");
console.log("  ✓ TEST COMPLETE");
console.log("════════════════════════════════════════════════════════════\n");
