#!/usr/bin/env node
// Test with structured/repetitive data that TokenCodec can compress

import { compressMessages, compressText } from "./middleware/compress.mjs";

const structuredData = `name,age,email,phone,address,city,state,zip,country,created_at,updated_at,status,role
John,28,john@example.com,555-1001,123 Main St,Boston,MA,02101,USA,2023-01-15,2024-01-15,active,engineer
Sarah,32,sarah@example.com,555-1002,456 Oak Ave,NYC,NY,10001,USA,2023-02-20,2024-02-20,active,senior_engineer
Mike,29,mike@example.com,555-1003,789 Pine Rd,LA,CA,90001,USA,2023-03-10,2024-03-10,active,engineer
Jane,31,jane@example.com,555-1004,321 Elm St,Chicago,IL,60601,USA,2023-04-05,2024-04-05,active,manager
Tom,26,tom@example.com,555-1005,654 Maple Dr,Austin,TX,78701,USA,2023-05-12,2024-05-12,active,junior_engineer
Anna,35,anna@example.com,555-1006,987 Cedar Ln,Seattle,WA,98101,USA,2023-06-01,2024-06-01,active,senior_engineer
David,30,david@example.com,555-1007,135 Birch St,Denver,CO,80202,USA,2023-07-15,2024-07-15,active,engineer
Lisa,27,lisa@example.com,555-1008,246 Oak Ct,Miami,FL,33128,USA,2023-08-20,2024-08-20,active,junior_engineer
Mark,33,mark@example.com,555-1009,369 Pine Ave,Portland,OR,97201,USA,2023-09-10,2024-09-10,active,manager
Carol,28,carol@example.com,555-1010,482 Elm Dr,Phoenix,AZ,85001,USA,2023-10-05,2024-10-05,active,engineer`;

const prompt = `Here is employee data in CSV format:\n\n${structuredData}\n\nWrite Python code to:\n1. Parse this CSV\n2. Find employees with anomalies (salary outliers, missing data)\n3. Generate a report\n4. Export results to JSON`;

console.log("📊 TokenCodec - Structured Data Compression Test\n");

const textResult = compressText(prompt);
console.log(`Original tokens: ${textResult.before}`);
console.log(`Compressed tokens: ${textResult.after}`);
console.log(`Saved: ${textResult.saved} tokens (${Math.round((textResult.saved / textResult.before) * 100)}% reduction)`);
console.log();

if (textResult.flags && textResult.flags.length > 0) {
  console.log(`Optimizations applied:`);
  textResult.flags.slice(0, 5).forEach(f => {
    console.log(`  ✓ ${f.name || f.type || 'optimization'}`);
  });
  if (textResult.flags.length > 5) {
    console.log(`  ... and ${textResult.flags.length - 5} more`);
  }
}
console.log();

console.log("💰 Token Savings Calculation:");
console.log(`  If you use this prompt 100 times:`);
console.log(`    • Without TokenCodec: ${textResult.before * 100} tokens = $${(textResult.before * 100 * 0.00003).toFixed(2)} (at $0.03/1M tokens)`);
console.log(`    • With TokenCodec: ${textResult.after * 100} tokens = $${(textResult.after * 100 * 0.00003).toFixed(2)}`);
console.log(`    • Savings: $${((textResult.before - textResult.after) * 100 * 0.00003).toFixed(2)}`);
