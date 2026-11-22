// URN: test:pi-atdd:source-catalog:E001-UNIT-002
// Acceptance: acc:pi-atdd:E001-UNIT-002
// Acceptance: acc:pi-atdd:E001-UNIT-004
// Phase: GREEN
// Layer: integration
// ATD-29/Acceptance-01: supplemental source accounting, not admission.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = join(root, "tools/atd-40-verify-ledger.ts");
const ledger = readFileSync(join(root, "research/atd-40/ATD-40-PASS-A-LEDGER.tsv"), "utf8");

function run(path?: string) {
  return spawnSync(process.execPath, [
    "--experimental-strip-types", checker, ...(path ? ["--ledger-file", path] : []),
  ], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
}

function runMutant(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "atd-40-locked-ledger-"));
  try {
    const path = join(dir, "mutant.tsv");
    writeFileSync(path, text, "utf8");
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("frozen ATD-29 source ledger and all three vendor locks reproduce", () => {
  const result = run();
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /376 YAML rule IDs \+ Git blobs/);
  assert.match(result.stdout, /13 \/ NO_CANDIDATE 1 \/ UNRESOLVED 362/);
  assert.match(result.stdout, /authorization: NOT VERIFIED/);
});

test("a missing ledger row fails closed instead of claiming corpus completeness", () => {
  const lines = ledger.trimEnd().split("\n");
  const row = lines.findIndex(line => line && !line.startsWith("#") && !line.startsWith("rule_id_filename_derived"));
  assert.ok(row >= 0);
  lines.splice(row, 1);
  const result = runMutant(lines.join("\n") + "\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /376|inventory denominator/);
});

test("a mutated Git blob digest is rejected", () => {
  const lines = ledger.trimEnd().split("\n");
  const row = lines.findIndex(line => line && !line.startsWith("#") && !line.startsWith("rule_id_filename_derived"));
  assert.ok(row >= 0);
  const fields = lines[row]!.split("\t");
  assert.match(fields[3]!, /^[0-9a-f]{40}$/);
  fields[3] = "0".repeat(40);
  lines[row] = fields.join("\t");
  const result = runMutant(lines.join("\n") + "\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Git blob SHA mismatch/);
});

test("a filename identity substituted for an authored YAML rule ID is rejected", () => {
  const lines = ledger.trimEnd().split("\n");
  const row = lines.findIndex(line => line && !line.startsWith("#") && !line.startsWith("rule_id_filename_derived"));
  assert.ok(row >= 0);
  const fields = lines[row]!.split("\t");
  fields[0] = "coder.invalid.fake-identity";
  lines[row] = fields.join("\t");
  const result = runMutant(lines.join("\n") + "\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authored YAML rule_id/);
});
