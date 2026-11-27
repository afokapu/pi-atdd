// URN: test:pi-atdd:migration:E001-UNIT-006
// Acceptance: acc:pi-atdd:E001-UNIT-006
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ledger = readFileSync(join(root, "docs/MIGRATION-LEDGER.md"), "utf8");
const candidates = readFileSync(join(root, "docs/CONVENTION-CANDIDATES.md"), "utf8");

test("the migration ledger records explicit source responsibilities and non-equivalent mechanisms", () => {
  for (const prefix of ["P =", "G =", "V =", "R =", "I =", "X ="]) {
    assert.ok(ledger.includes(prefix), "missing migration classification: " + prefix);
  }
  for (const source of [
    "src/profile-registry.ts", "src/ratchet.ts", "src/planner-kernel.ts",
    "src/vcs.ts", "src/reviews.ts", "src/threads.ts",
    "src/linear-mirror.ts", "src/plan.ts",
  ]) assert.ok(ledger.includes(source), "no classification for " + source);
  for (const safety of [
    "Exact-base fingerprint", "durable inbox", "retire separate task/thread DB",
    "ATDD Flow", "ATDD-Bun", "Do not", "role",
  ]) assert.ok(ledger.toLowerCase().includes(safety.toLowerCase()), "missing warning: " + safety);
});
test("integration policy extraction is distinguished from JJ exact-head execution", () => {
  assert.match(candidates, /integration\/\<stream\>/);
  assert.match(candidates, /exact lineage/i);
  assert.match(candidates, /Remain executable|Must remain executable/i);
});
