#!/usr/bin/env node
// Test with JSON data that TokenCodec can compress

import { compressText } from "./middleware/compress.mjs";

const employees = [
  {"name":"John","age":28,"email":"john@example.com","city":"Boston","status":"active","role":"engineer"},
  {"name":"Sarah","age":32,"email":"sarah@example.com","city":"NYC","status":"active","role":"senior_engineer"},
  {"name":"Mike","age":29,"email":"mike@example.com","city":"LA","status":"active","role":"engineer"},
  {"name":"Jane","age":31,"email":"jane@example.com","city":"Chicago","status":"active","role":"manager"},
  {"name":"Tom","age":26,"email":"tom@example.com","city":"Austin","status":"active","role":"junior_engineer"},
  {"name":"Anna","age":35,"email":"anna@example.com","city":"Seattle","status":"active","role":"senior_engineer"},
  {"name":"David","age":30,"email":"david@example.com","city":"Denver","status":"active","role":"engineer"},
  {"name":"Lisa","age":27,"email":"lisa@example.com","city":"Miami","status":"active","role":"junior_engineer"},
  {"name":"Mark","age":33,"email":"mark@example.com","city":"Portland","status":"active","role":"manager"},
  {"name":"Carol","age":28,"email":"carol@example.com","city":"Phoenix","status":"active","role":"engineer"}
];

const prompt = `Here is employee data:\n\n${JSON.stringify(employees, null, 2)}\n\nAnalyze this data and find anomalies in age, salary levels by role, and generate a report.`;

console.log("📊 TokenCodec - JSON Array Compression Test\n");

const result = compressText(prompt);
console.log(`Original tokens: ${result.before}`);
console.log(`Compressed tokens: ${result.after}`);
console.log(`Saved: ${result.saved} tokens (${Math.round((result.saved / result.before) * 100)}% reduction)`);
console.log();

if (result.flags && result.flags.length > 0) {
  console.log(`✨ Optimizations applied (${result.flags.length} total):`);
  result.flags.slice(0, 8).forEach(f => {
    console.log(`  ✓ ${f.name || f.description || 'optimization'}`);
  });
  if (result.flags.length > 8) {
    console.log(`  ... and ${result.flags.length - 8} more`);
  }
  console.log();
}

if (result.saved > 0) {
  console.log("💰 Token Savings at Scale:");
  console.log(`  Single prompt: ${result.saved} tokens saved`);
  console.log(`  100x prompts: ${result.saved * 100} tokens saved (~$${(result.saved * 100 * 0.00003).toFixed(2)})`);
  console.log(`  1000x prompts: ${result.saved * 1000} tokens saved (~$${(result.saved * 1000 * 0.00003).toFixed(2)})`);
}
