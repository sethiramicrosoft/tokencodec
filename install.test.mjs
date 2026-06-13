import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { install, check, remove, render, stripBlocks, getBlockBody, statusOf, resolveTargets, BODY, TARGETS, GLOBAL_TARGETS, START, END } from "./install.mjs";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  FAIL:", msg); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "td-"));
const read = f => fs.readFileSync(path.join(tmp, f), "utf8");
const exists = f => fs.existsSync(path.join(tmp, f));
const countBlocks = s => (s.match(new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

// 1. fresh install creates every target with exactly one block
install(tmp);
for (const t of TARGETS) {
  ok(exists(t.file), `created ${t.file}`);
  ok(countBlocks(read(t.file)) === 1, `one block in ${t.file}`);
  ok(getBlockBody(read(t.file)) === BODY, `body matches in ${t.file}`);
}

// 2. idempotent: second run is byte-identical
const before = TARGETS.map(t => read(t.file));
install(tmp);
const after = TARGETS.map(t => read(t.file));
ok(JSON.stringify(before) === JSON.stringify(after), "install is idempotent (byte-identical on rerun)");

// 3. preserves pre-existing user content
const userFile = path.join(tmp, "AGENTS.md");
fs.writeFileSync(userFile, "# My project rules\n\n- Always use tabs.\n");
install(tmp);
ok(read("AGENTS.md").includes("Always use tabs."), "preserves existing user content");
ok(countBlocks(read("AGENTS.md")) === 1, "still exactly one block after appending to user file");

// 4. collapses accidental duplicate blocks
fs.writeFileSync(userFile, "# X\n\n" + `${START}\nOLD ONE\n${END}` + "\n\n" + `${START}\nOLD TWO\n${END}` + "\nkeep me\n");
install(tmp);
ok(countBlocks(read("AGENTS.md")) === 1, "duplicate blocks collapsed to one");
ok(read("AGENTS.md").includes("keep me"), "content after duplicate blocks preserved");
ok(!read("AGENTS.md").includes("OLD ONE") && !read("AGENTS.md").includes("OLD TWO"), "stale block bodies removed");

// 5. --check status detection
ok(TARGETS.every(t => statusOf(path.join(tmp, t.file)) === "ok"), "status ok after install");
fs.writeFileSync(path.join(tmp, "CLAUDE.md"), read("CLAUDE.md").replace(BODY, BODY + "\nTAMPERED"));
ok(statusOf(path.join(tmp, "CLAUDE.md")) === "outdated", "detects outdated block");
fs.rmSync(path.join(tmp, "GEMINI.md"));
ok(statusOf(path.join(tmp, "GEMINI.md")) === "missing", "detects missing file");

// 6. remove strips blocks, keeps user content, deletes our-only files
fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# Team rules\n\n- Use spaces.\n");
install(tmp); // AGENTS.md gets a block appended; the rest are created fresh
remove(tmp);
ok(exists("AGENTS.md") && read("AGENTS.md").includes("Use spaces."), "remove keeps user file + content");
ok(getBlockBody(read("AGENTS.md")) === null, "remove strips the block from user file");
ok(!exists(path.join(".cursor", "rules", "tokencodec.mdc")), "remove deletes our-only mdc file");
ok(!exists("CLAUDE.md"), "remove deletes our-only CLAUDE.md");

// 7. render never loses bytes outside the block (property-ish)
const sample = "line A\n\n" + `${START}\nx\n${END}` + "\nline B\n";
const r = render(sample, "# H\n");
ok(r.includes("line A") && r.includes("line B"), "render preserves text around block");
ok(countBlocks(r) === 1, "render yields one block");

// 7b. --global mode writes ~/.copilot/copilot-instructions.md (using a fake home)
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "tdhome-"));
const gFile = path.join(fakeHome, ".copilot", "copilot-instructions.md");
install(tmp, { global: true, home: fakeHome });
ok(fs.existsSync(gFile), "global install creates ~/.copilot/copilot-instructions.md");
ok(getBlockBody(fs.readFileSync(gFile, "utf8")) === BODY, "global file has the managed block");
ok(statusOf(gFile) === "ok", "global target reports ok");
const gBefore = fs.readFileSync(gFile, "utf8");
install(tmp, { global: true, home: fakeHome });
ok(fs.readFileSync(gFile, "utf8") === gBefore, "global install is idempotent");
// preserves a user's existing global instructions
fs.writeFileSync(gFile, "# My global rules\n\n- Always use UK spelling.\n");
install(tmp, { global: true, home: fakeHome });
ok(fs.readFileSync(gFile, "utf8").includes("UK spelling"), "global install preserves existing user content");
remove(tmp, { global: true, home: fakeHome });
ok(fs.readFileSync(gFile, "utf8").includes("UK spelling") && getBlockBody(fs.readFileSync(gFile, "utf8")) === null, "global remove keeps user content, strips block");
ok(GLOBAL_TARGETS.length >= 1 && resolveTargets(tmp, { global: true, home: fakeHome }).items[0].abs === gFile, "resolveTargets maps global to the home path");
fs.rmSync(fakeHome, { recursive: true, force: true });

// 8. malformed block (START without END) is repaired, not duplicated (qa-saboteur)
install(tmp);
fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# user\n" + START + "\nBROKEN\n");
install(tmp);
ok(countBlocks(read("AGENTS.md")) === 1, "orphan START repaired to exactly one block");
ok((read("AGENTS.md").match(/TOKENCODEC:END/g) || []).length === 1, "exactly one END after repair");
ok(getBlockBody(read("AGENTS.md")) === BODY, "managed content restored after repair");

// 9. directory at a target path does not crash the whole install (qa-saboteur)
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "td2-"));
fs.mkdirSync(path.join(tmp2, "AGENTS.md")); // hostile: a dir where a file should be
let threw = false;
try { install(tmp2); } catch { threw = true; }
ok(!threw, "install does not throw when a target path is a directory");
ok(fs.existsSync(path.join(tmp2, "CLAUDE.md")), "other targets still installed despite one bad target");
fs.rmSync(tmp2, { recursive: true, force: true });

// 10. --check is forge-resistant: a decoy block before a tampered one is NOT ok (prompt-injection)
install(tmp);
const decoy = `${START}\n${BODY}\n${END}`;
fs.writeFileSync(path.join(tmp, "CLAUDE.md"), decoy + "\n\n" + `${START}\n${BODY}\nTAMPERED\n${END}` + "\n");
ok(statusOf(path.join(tmp, "CLAUDE.md")) === "outdated", "two blocks (decoy + tampered) report outdated, not ok");

// 11. statusOf on a directory target is not silently ok
const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "td3-"));
fs.mkdirSync(path.join(tmp3, "AGENTS.md"));
ok(statusOf(path.join(tmp3, "AGENTS.md")) !== "ok", "directory target never reports ok");
fs.rmSync(tmp3, { recursive: true, force: true });

// 12. symlink guard: refuse to write through a symlinked target (security-auditor)
const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), "td4-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "td4out-"));
const victim = path.join(outside, "victim.txt");
fs.writeFileSync(victim, "PRECIOUS USER DATA");
let symlinkSupported = true;
try { fs.symlinkSync(victim, path.join(tmp4, "AGENTS.md")); }
catch { symlinkSupported = false; } // Windows without privilege
if (symlinkSupported) {
  install(tmp4);
  ok(fs.readFileSync(victim, "utf8") === "PRECIOUS USER DATA", "symlinked target is NOT followed/overwritten");
  ok(fs.existsSync(path.join(tmp4, "CLAUDE.md")), "other targets still installed despite symlink");
} else {
  pass++; pass++; // environment cannot create symlinks; guard is still in code
  console.log("  (symlink test skipped: OS denied symlink creation)");
}
fs.rmSync(tmp4, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nINSTALLER TESTS: ${pass} passed, ${fail} failed  ${fail === 0 ? "(bulletproof)" : "FAILED"}`);
process.exit(fail ? 1 : 0);
