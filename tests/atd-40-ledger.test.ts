// URN: test:pi-atdd:source-catalog:E001-UNIT-002
// Acceptance: acc:pi-atdd:E001-UNIT-002
// Acceptance: acc:pi-atdd:E001-UNIT-004
// Phase: GREEN
// Layer: integration
// ATD-29/Acceptance-01: supplemental source accounting, not admission.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  assert.match(result.stdout, /339 \/ NO_CANDIDATE 31 \/ UNRESOLVED 6/);
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

test("all authored Bun/local relationships are represented, without type coercion", () => {
  const rows = ledger.trimEnd().split("\n").filter(line => line && !line.startsWith("#"));
  const columns = rows.shift()!.split("\t");
  const witnessColumn = columns.indexOf("graph_witnesses_out_and_in");
  assert.ok(witnessColumn >= 0);
  const witnesses = rows.flatMap(row => row.split("\t")[witnessColumn]!.split(";").filter(Boolean));
  // Source-locked corpus: 508 Bun + 14 local edge objects, 1,000
  // in-corpus directional witnesses. Missing external endpoints remain gaps.
  assert.equal(witnesses.length, 1000);
  assert.ok(witnesses.some(value => value.includes("out:runs_alongside/discretionary:")));
  assert.ok(witnesses.some(value => value.includes("in:enables/discretionary:")));
  assert.ok(witnesses.some(value => value.includes("out:requires/mandatory:")));
  assert.ok(witnesses.some(value => value.includes("default:mandatory:")));
});

test("removing a source-authored edge witness fails closed", () => {
  const lines = ledger.trimEnd().split("\n");
  const index = lines.findIndex(line => line.startsWith("planner.acceptance.well-formed\t"));
  assert.ok(index >= 0);
  const row = lines[index]!.split("\t");
  assert.ok(row[7] && row[7].includes(";"), "source rule must have multiple witnesses");
  row[7] = row[7]!.split(";").slice(1).join(";");
  lines[index] = row.join("\t");
  const result = runMutant(lines.join("\n") + "\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authored graph witness mismatch/);
});

test("a changed authored edge type cannot be laundered into mandatory requires", () => {
  const lines = ledger.trimEnd().split("\n");
  const index = lines.findIndex(line => line.startsWith("shared.tracker.issue-mandatory\t"));
  assert.ok(index >= 0);
  const row = lines[index]!.split("\t");
  assert.ok(row[7]?.includes("out:runs_alongside/discretionary:shared.tracker.unconfigured-notice"));
  row[7] = row[7]!.replace(
    "out:runs_alongside/discretionary:shared.tracker.unconfigured-notice",
    "out:requires/mandatory:shared.tracker.unconfigured-notice",
  );
  lines[index] = row.join("\t");
  const result = runMutant(lines.join("\n") + "\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authored graph witness mismatch/);
});

test("quoted field-qualified targets are not conflated with convention nodes", () => {
  const entries = ledger.split("\n").filter(row => row && !row.startsWith("#"));
  const from = entries.find(row => row.startsWith("planner.desired-outcome.must-have-smoke-acceptance\t"));
  const harness = entries.find(row => row.startsWith("planner.acceptance.harness\t"));
  const vocabulary = entries.find(row => row.startsWith("planner.acceptance.harness-vocabulary\t"));
  assert.ok(from && harness && vocabulary);
  assert.ok(from.includes("planner.acceptance.harness#harness_type"));
  assert.ok(from.includes("planner.acceptance.harness-vocabulary#harness_code"));
  // A fragment target is a source referent, not a second convention node.
  assert.ok(!harness.includes("in:requires/mandatory:planner.desired-outcome.must-have-smoke-acceptance@"));
  assert.ok(!vocabulary.includes("in:requires/mandatory:planner.desired-outcome.must-have-smoke-acceptance@"));
});

test("ATD-40 research artifacts respect the authored docs path scope", () => {
  const rule = readFileSync(join(root,
    "vendor/atdd-bun/conventions/planner/docs/planner.docs.asciidoc-only.convention.yaml"), "utf8");
  assert.match(rule, /authored.*docs\//);
  assert.match(rule, /Markdown OUTSIDE.*docs\//);
  for (const file of [
    "ATD-40-PASS-A-LEDGER.tsv", "ATD-40-PASS-A-EVIDENCE.md",
    "ATD-40-PROVISIONAL-T9-HANDOFF.md",
  ]) {
    assert.ok(existsSync(join(root, "research/atd-40", file)));
    // An authored Markdown/TSV under docs/ would violate the pinned Bun rule.
    assert.ok(!existsSync(join(root, "docs", file)));
  }
});

test("ATD-40's new TypeScript tools retain meaningful comment coverage", () => {
  const rule = readFileSync(join(root,
    "vendor/atdd-bun/conventions/coder/quality/coder.quality.comments.convention.yaml"), "utf8");
  assert.match(rule, /at least 10%/);
  for (const file of ["atd-40-verify-ledger.ts", "atd-40-source-evidence.ts"]) {
    const nonblank = readFileSync(join(root, "tools", file), "utf8")
      .split("\n").filter(line => line.trim());
    // A bounded mechanical check; qualitative review is still independent.
    const commented = nonblank.filter(line => /^\s*(?:\/\/|\/\*|\*)/.test(line));
    assert.ok(commented.length / nonblank.length >= 0.10,
      "source context below declared Bun comment floor: " + file);
  }
});
