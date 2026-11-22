// URN: test:pi-atdd:source-catalog:E001-UNIT-006
// Acceptance: acc:pi-atdd:E001-UNIT-006
// Phase: GREEN
// Layer: integration
// ATD-29: mechanical provenance of a *human-readable semantic assessment*.
// These checks cannot independently approve candidate identities or O1–O8.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readPassASourceEvidence } from "../tools/atd-40-source-evidence.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const memo = readFileSync(join(root, "research/atd-29/ATD-29-SEMANTIC-BATCH-01.md"), "utf8");
const ledger = readFileSync(join(root, "research/atd-40/ATD-40-PASS-A-LEDGER.tsv"), "utf8");

const reviewed: Readonly<Record<string, readonly string[]>> = {
  "coach.naming.instance-label": ["PA-C01a", "PA-C01b"],
  "coach.policy.action-tiers": ["PA-C02"],
  "coach.policy.decision-log": ["PA-C03"],
  "coach.policy.trivial-request": ["PA-C02"],
  "coach.policy.unclear-risk-higher-tier": ["PA-C02"],
  "coach.role.orchestrate-not-build": ["PA-C04"],
  "shared.model.escalate-after-two-failures": ["PA-M01"],
  "shared.model.names-only-tiers": ["PA-M02"],
  "shared.model.subscription-providers": ["PA-M03"],
  "shared.model.tier-by-role": ["PA-M04"],
  "shared.vocabulary.legacy-terms": ["PA-V01a", "PA-V01b"],
  "coach.collaboration.accountable-delegation": ["PA-F01", "PA-F02"],
  "coach.workflow.lifecycle": ["PA-F02", "PA-F03", "PA-F04"],
};

test("ATD-29 batch 01: 13 assessed authored sources retain exact candidate aliases", () => {
  const records = new Map(readPassASourceEvidence().map(r => [r.ruleId, r]));
  assert.equal(Object.keys(reviewed).length, 13);
  for (const [id, labels] of Object.entries(reviewed)) {
    const source = records.get(id);
    assert.ok(source, "missing pinned rule: " + id);
    assert.equal(source.disposition, "CANDIDATE", id);
    assert.deepEqual(source.candidateLabels, labels, id);
    assert.ok(source.source.statement.trim(), id);
    assert.ok(source.sourceSpans.statement.startLine > 0);
    assert.ok(memo.includes("**" + String(id).replace(/[$^*+?.()|[\]{}]/g, "\\$&") + "**") ||
      memo.includes("**\`" + id + "\`**"), "missing authored source assessment: " + id);
    assert.equal(source.admission, "NOT_ASSESSED_BY_THIS_EXPORT");
  }
});

test("ATD-29 batch 01: every inspected span points inside the actual original source", () => {
  const rows = ledger.trimEnd().split("\n").filter(row => row && !row.startsWith("#"));
  const heading = rows.shift()!.split("\t");
  const positions = Object.fromEntries(heading.map((key, i) => [key, i])) as Record<string, number>;
  const byId = new Map(rows.map(row => {
    const values = row.split("\t");
    return [values[positions.rule_id_filename_derived!]!, values];
  }));
  for (const id of Object.keys(reviewed)) {
    const row = byId.get(id)!;
    assert.ok(row, id);
    const text = readFileSync(join(root, row[positions.path!]!), "utf8");
    const total = text.split("\n").length;
    const spans = row[positions.inspected_rule_spans!]!.split(";");
    assert.ok(spans.length >= 2);
    for (const span of spans) {
      const match = /^L(\d+)-L(\d+)$/.exec(span);
      assert.ok(match, "bad span for " + id + ": " + span);
      const a = Number(match[1]), b = Number(match[2]);
      assert.ok(a >= 1 && a <= b && b <= total, id + " outside YAML source: " + span);
    }
  }
});

test("ATD-29 batch 01: semantic candidate subjects stay direction-neutral and unadmitted", () => {
  assert.match(memo, /PA-C01a.*Coach session identity labeling state/);
  assert.match(memo, /PA-C02.*Coach action authorization standing/);
  assert.match(memo, /PA-V01b.*Legacy alias resolution continuity/);
  assert.match(memo, /PA-F03.*Seat binding and checkpoint continuity state/);
  assert.match(memo, /no O1–O8 PASS decision/);
  assert.match(memo, /no O1–O8 PASS decision, source-rule change, actor authorization, direct actuation, or admitted engineering OoC/);
  assert.match(memo, /candidate file count is \*\*not\*\* a candidate identity count/i);
});

test("ATD-29 batch 02 records all 70 Bun coder sources with distinct negative boundaries", () => {
  const memo2 = readFileSync(join(root, "research/atd-29/ATD-29-SEMANTIC-BATCH-02.md"), "utf8");
  const pattern = /^\| \[\x60(coder\.[^\x60]+)\x60\]\([^)]+\) \| \x60(PA-B-[^\x60]+)\x60 \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm;
  const entries = [...memo2.matchAll(pattern)];
  assert.equal(entries.length, 70);
  assert.equal(new Set(entries.map(x => x[1])).size, 70);
  const data = new Map(readPassASourceEvidence().map(x => [x.ruleId, x]));
  for (const match of entries) {
    const ruleId = match[1]!;
    const source = data.get(ruleId);
    assert.ok(source, "source absent from original 376 files: " + ruleId);
    assert.equal(source.family, "Bun");
    assert.equal(source.disposition, "CANDIDATE");
    assert.deepEqual(source.candidateLabels, [match[2]!]);
    assert.match(match[3]!, /\w/);
    assert.match(match[4]!, /\w/);
    assert.match(match[5]!, /\w/);
    assert.equal(source.admission, "NOT_ASSESSED_BY_THIS_EXPORT");
  }
  assert.match(memo2, /not admitted engineering OoCs/);
  assert.match(memo2, /does not authorize owner admission/);
});
