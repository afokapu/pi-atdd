// URN: test:pi-atdd:source-catalog:E001-UNIT-006
// Acceptance: acc:pi-atdd:E001-UNIT-006
// Phase: GREEN
// Layer: integration
// ATD-29: mechanical provenance for Agent A judgments; not admission/O1–O8.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readPassASourceEvidence } from "../tools/atd-40-source-evidence.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(join(root, name), "utf8");
const sources = readPassASourceEvidence();
const byId = new Map(sources.map(r => [r.ruleId, r]));
const conflicts = [
  "planner.artifact-naming.validation-rules",
  "planner.component.structure",
  "planner.user-system-flow.dependencies",
  "planner.user-system-flow.participants",
  "planner.user-system-flow.theme-orchestrator-urn",
  "tester.test.no-self-skip",
];

function tableRows(batch: number): string[][] {
  const name = "research/atd-29/ATD-29-SEMANTIC-BATCH-0" + batch + ".md";
  return read(name).split("\n").filter(line => line.startsWith("| [\x60"))
    .map(line => {
      assert.ok(line.startsWith("| ") && line.endsWith(" |"), name);
      const cells = line.slice(2, -2).split(" | ");
      assert.equal(cells.length, 5, "bad source audit table width " + name);
      return cells;
    });
}

test("ATD-29 complete Pass A source review: no anonymous unreviewed placeholders", () => {
  assert.equal(sources.length, 376);
  assert.equal(byId.size, 376);
  assert.equal(sources.filter(r => r.disposition === "CANDIDATE").length, 339);
  assert.equal(sources.filter(r => r.disposition === "NO_CANDIDATE").length, 31);
  assert.equal(sources.filter(r => r.disposition === "UNRESOLVED").length, 6);

  const reviewed = new Set<string>();
  const perBatch = [0, 0, 70, 29, 24, 42, 36, 54, 53, 41];
  for (let batch = 2; batch <= 9; batch++) {
    const entries = tableRows(batch);
    assert.equal(entries.length, perBatch[batch], "incomplete batch " + batch);
    for (const [sourceCell, standingCell, state, measurement, negative] of entries) {
      const ref = /^\[\x60([^\x60]+)\x60\]\(([^)]+)\)$/.exec(sourceCell!);
      assert.ok(ref, "source anchor absent in batch " + batch);
      const id = ref![1]!;
      const source = byId.get(id);
      assert.ok(source, "unknown source rule: " + id);
      assert.ok(!reviewed.has(id), "source reviewed twice: " + id);
      reviewed.add(id);
      assert.ok(ref![2]!.includes("/567b2e513782b380c18f320d69edf140d61a36d4/"));
      assert.ok(ref![2]!.includes("/" + source.sourcePath + "#L6"),
        "wrong source link for " + id);
      const standing = batch === 2
        ? /^\x60([^\x60]+)\x60$/.exec(standingCell!)
        : /^(CANDIDATE|NO_CANDIDATE|UNRESOLVED)(?: \x60([^\x60]+)\x60)?$/.exec(standingCell!);
      assert.ok(standing, "unreadable disposition: " + id);
      const status = batch === 2 ? "CANDIDATE" : standing![1]!;
      const label = batch === 2 ? standing![1]! : standing![2] ?? "";
      assert.equal(source.disposition, status, "status drift: " + id);
      assert.deepEqual(source.candidateLabels, label ? [label] : [], "candidate identity drift: " + id);
      assert.ok(state?.trim() && measurement?.trim() && negative?.trim(),
        "missing state/measurement/negative " + id);
      assert.ok(source.sourceSpans.statement.startLine > 0, "unlocated statement " + id);
    }
  }
  assert.equal(reviewed.size, 349);
  const batch1 = read("research/atd-29/ATD-29-SEMANTIC-BATCH-01.md");
  let legacy = 0, batchOne = 0;
  for (const source of sources) {
    if (reviewed.has(source.ruleId)) continue;
    const fromBatchOne = batch1.includes(source.ruleId);
    if (fromBatchOne) batchOne++;
    else {
      legacy++;
      assert.ok(source.candidateLabels.every(label => label.startsWith("C-")),
        "old source sample not accounted for: " + source.ruleId);
    }
  }
  assert.equal(batchOne, 13);
  assert.equal(legacy, 14);
});

test("six unresolved source conflicts remain specific, not default omissions", () => {
  const unresolved = sources.filter(x => x.disposition === "UNRESOLVED");
  assert.deepEqual(unresolved.map(x => x.ruleId).sort(), conflicts.slice().sort());
  const ledger = read("research/atd-40/ATD-40-PASS-A-LEDGER.tsv")
    .split("\n").filter(line => line && !line.startsWith("#"));
  const header = ledger.shift()!.split("\t");
  const ruleIndex = header.indexOf("rule_id_filename_derived");
  const reasonIndex = header.indexOf("reason_or_open_question");
  const rows = new Map(ledger.map(line => {
    const f = line.split("\t");
    return [f[ruleIndex]!, f[reasonIndex]!] as const;
  }));
  for (const id of conflicts) {
    const reason = rows.get(id);
    assert.ok(reason && /conflict|contradic|inconsistent/i.test(reason),
      "unresolved row lacks competing source clauses: " + id);
    assert.doesNotMatch(reason, /no independent state\/bearer\/measure assessment recorded/);
  }
});

test("candidate consolidation retains exact source witnesses and never admits", () => {
  const index = read("research/atd-29/ATD-29-PROVISIONAL-CANDIDATE-INDEX.tsv")
    .trimEnd().split("\n");
  const header = index.shift()!.split("\t");
  assert.deepEqual(header, [
    "provisional_candidate_ref", "supporting_source_file_count", "source_rule_ids",
    "frozen_source_paths", "source_state_aspects", "source_measurement_or_proof_paths",
    "negative_controls", "batch_evidence_files", "standing",
  ]);
  const groups = new Map<string, Set<string>>();
  for (const source of sources) for (const label of source.candidateLabels) {
    if (!groups.has(label)) groups.set(label, new Set());
    groups.get(label)!.add(source.ruleId);
  }
  assert.equal(groups.size, 290);
  assert.equal(index.length, 290);
  const seen = new Set<string>();
  let multi = 0;
  for (const line of index) {
    const c = line.split("\t");
    assert.equal(c.length, 9);
    const label = c[0]!;
    assert.ok(!seen.has(label), "duplicate provisional identity " + label);
    seen.add(label);
    assert.equal(c[8], "PROVISIONAL_NOT_ADMITTED");
    const actual = c[2]!.split(";");
    assert.equal(actual.length, Number(c[1]));
    assert.deepEqual(actual.slice().sort(), [...groups.get(label)!].sort(),
      "missing or fabricated support " + label);
    assert.equal(c[3]!.split(";").length, actual.length);
    assert.ok(c[4]?.trim() && c[5]?.trim() && c[6]?.trim());
    if (actual.length > 1) multi++;
  }
  assert.equal(multi, 42);
});
