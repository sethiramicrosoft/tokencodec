import { compressMessages } from "../middleware/compress.mjs";
import { execSync } from "child_process";
import fs from "fs";

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

// TEST 1: UNCOMPRESSED
console.log("\n▶ TEST 1: UNCOMPRESSED");
console.log(`Data size: ${dataPrompt.length} chars`);
console.log(`Estimated tokens: ~${Math.ceil(dataPrompt.length / 4)}`);
console.log(`Running: copilot -p "..."\n`);

try {
  // Write to temp file and read back
  const tmpFile = '.tmp-prompt.txt';
  fs.writeFileSync(tmpFile, dataPrompt);
  const result1 = execSync(`copilot -p "${fs.readFileSync(tmpFile, 'utf-8').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  console.log(result1.substring(0, 500));
  
  // Extract token info
  const match1 = result1.match(/AI Credits\s+([\d.]+)/);
  console.log(`\n✓ Uncompressed tokens: ${match1 ? match1[1] : 'unknown'}`);
  fs.unlinkSync(tmpFile);
} catch (e) {
  console.error("✗ Failed:", e.message.substring(0, 150));
}

// TEST 2: COMPRESSED
console.log("\n▶ TEST 2: COMPRESSED");
const { messages: compressed, before, after, saved } = compressMessages([{ role: "user", content: dataPrompt }]);
const compressedPrompt = compressed[0].content;
console.log(`Compression: ${before} → ${after} chars (${Math.round(100 * saved / before)}% saved)`);
console.log(`Estimated tokens: ~${Math.ceil(after / 4)}`);
console.log(`Running: copilot -p "..."\n`);

try {
  const tmpFile = '.tmp-prompt-compressed.txt';
  fs.writeFileSync(tmpFile, compressedPrompt);
  const result2 = execSync(`copilot -p "${fs.readFileSync(tmpFile, 'utf-8').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  console.log(result2.substring(0, 500));
  
  // Extract token info
  const match2 = result2.match(/AI Credits\s+([\d.]+)/);
  console.log(`\n✓ Compressed tokens: ${match2 ? match2[1] : 'unknown'}`);
  fs.unlinkSync(tmpFile);
} catch (e) {
  console.error("✗ Failed:", e.message.substring(0, 150));
}

console.log("\n════════════════════════════════════════════════════════════");
console.log("  Compare the 'AI Credits' values to see compression savings");
console.log("════════════════════════════════════════════════════════════\n");
