// URN: test:pi-atdd:source-catalog:E001-UNIT-006
// Acceptance: acc:pi-atdd:E001-UNIT-006
// Phase: GREEN
// Layer: integration
// ATD-26/27/28/29: triple-lens provenance tests cannot attest independent people.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const content = (path: string) => readFileSync(join(root, path), "utf8");
const jsonl = (path: string): Record<string, unknown>[] =>
  content(path).trimEnd().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
const tabs = (path: string) => content(path).trimEnd().split("\n").map(line => line.split("\t"));
const prefix = "research/atd-28/systematic/ATD-28-O1-O8-";
const list = (head: string, count: number) =>
  Array.from({ length: count }, (_, index) => head + String(index + 1).padStart(2, "0") + ".jsonl");
const bPaths = list(prefix, 6);
const cPaths = list("research/atd-27/ATD-27-PASS-C-CANDIDATES-", 6);
const attackPaths = list("research/atd-26/adversarial/ATD-26-ADVERSARIAL-CANDIDATES-", 4);
const spanPaths = list("research/atd-29/source-spans/part-", 21);

const candidateIndex = tabs("research/atd-29/ATD-29-PROVISIONAL-CANDIDATE-INDEX.tsv").slice(1);
const ledger = tabs("research/atd-40/ATD-40-PASS-A-LEDGER.tsv")
  .filter(row => !row[0]?.startsWith("#")).slice(1);
const systemic = tabs("research/atd-26/systemic/ATD-26-SOURCE-GRAPH-SYSTEMIC.tsv").slice(1);
const allB = bPaths.flatMap(path => jsonl(path).slice(1));
const allC = cPaths.flatMap(path => jsonl(path).slice(1));
const allAttacks = attackPaths.flatMap(path => jsonl(path).slice(1));
const sourceSpans = spanPaths.flatMap(path => jsonl(path));
const negative = JSON.parse(content("research/atd-26/adversarial/ATD-26-NEGATIVE-CONTROLS.json"));
const byRule = new Map(ledger.map(row => [row[0], row]));
const byCandidate = new Map(allB.map(row => [String(row.candidate_id), row]));
const gateCodes = ["O1","O2","O3","O4","O5","O6","O7","O8"];

test("systemic: 376 original rule identities, source/graph scope and exception distinctions", () => {
  assert.equal(ledger.length, 376);
  assert.equal(systemic.length, 376);
  assert.equal(sourceSpans.length, 376);
  assert.equal(new Set(ledger.map(x => x[0])).size, 376);
  assert.deepEqual(
    Object.fromEntries(["CANDIDATE","NO_CANDIDATE","UNRESOLVED"]
      .map(s => [s, ledger.filter(x => x[4] === s).length])),
    { CANDIDATE: 339, NO_CANDIDATE: 31, UNRESOLVED: 6 },
  );
  assert.equal(ledger.reduce((n,r) => n + (r[7] ? r[7]!.split(";").length : 0), 0), 1000);
  assert.deepEqual(systemic.map(x => x[0]), ledger.map(x => x[0]));
  assert.equal(systemic.filter(r => r[11] === "YES").length, 6);
  assert.equal(systemic.filter(r => r[12] === "YES").length, 6);
  assert.equal(systemic.filter(r => r[10] && r[10]!.length > 0).length, 39);
  for (const row of systemic) {
    assert.equal(row[13], "UNKNOWN_UNTIL_TASK_SELECTOR_PROFILE_EVIDENCE");
    assert.ok(row[14]?.trim());
    // A justified negative OoC disposition does not waive a normative rule.
    if (row[3] === "NO_CANDIDATE") assert.match(row[14]!, /NEGATIVE_OOC_ONLY/);
  }
});

test("systematic: all 290 candidates have eight source-anchored gate decisions", () => {
  assert.equal(candidateIndex.length, 290);
  assert.equal(allB.length, 290);
  assert.equal(new Set(allB.map(x => String(x.candidate_id))).size, 290);
  for (const [i, row] of candidateIndex.entries()) {
    const b = allB[i]!;
    assert.equal(b.candidate_id, row[0]);
    assert.deepEqual(b.source_ids, row[2]!.split(";"));
    const gates = b.gates as Record<string,{status:string;evidence:string;source_ref:string}>;
    assert.deepEqual(Object.keys(gates), gateCodes);
    for (const code of gateCodes) {
      assert.ok(["PASS","FAILED","REVIEW_REQUIRED"].includes(gates[code]!.status));
      assert.ok(gates[code]!.evidence.length > 65);
      assert.match(gates[code]!.source_ref, /#L\d+-L\d+$/);
    }
    assert.equal(b.admission, "NOT_ADMITTED");
    assert.ok(String(b.authored_source_statement_excerpt).startsWith("statement:"));
    assert.equal(b.source_blob_sha, byRule.get(row[2]!.split(";")[0])![3]);
    // Missing actual use, novelty readback and measured state cannot be converted to PASS.
    for (const code of ["O2","O5","O7"]) assert.equal(gates[code]!.status, "REVIEW_REQUIRED");
  }
  assert.equal(allB.filter(x => (x.gates as Record<string,{status:string}>).O4.status === "FAILED").length, 11);
});

test("source audit: every statement excerpt and inspected line belongs to actual YAML", () => {
  const bySpan = new Map(sourceSpans.map(x => [String(x.rule_id), x]));
  assert.equal(bySpan.size, 376);
  for (const row of ledger) {
    const audit = bySpan.get(row[0]!)!;
    assert.ok(audit);
    assert.equal(audit.path, row[2]);
    assert.equal(audit.source_blob_sha, row[3]);
    const lines = content(row[2]!).split("\n");
    assert.equal(audit.source_line_count, lines.length);
    const start = Number(audit.statement_start_line), end = Number(audit.statement_end_line);
    assert.ok(start > 0 && end >= start && end <= lines.length);
    assert.ok(lines[start - 1]!.startsWith("statement:"));
    assert.ok(lines.slice(start - 1, end).join("\n").startsWith(String(audit.statement_verbatim)));
    const spans = row[6]!.split(";").map(s => /^L(\d+)-L(\d+)$/.exec(s));
    assert.ok(spans.length >= 1 && spans.every(Boolean));
    assert.equal(Number(spans[0]![1]), start);
    assert.equal(Number(spans[0]![2]), end);
    for (const m of spans) {
      assert.ok(Number(m![1])>=1 && Number(m![2])<=lines.length);
    }
    if (Number(audit.terms_header_line)>0) {
      assert.equal(lines[Number(audit.terms_header_line)-1]!.startsWith("terms:"),true);
    }
    if (audit.exception_header_line != null) {
      assert.match(lines[Number(audit.exception_header_line)-1]!, /^\s{2}exceptions:/);
    }
  }
});

test("adversarial: each candidate has six attempted falsifications and exact standing", () => {
  assert.equal(allAttacks.length, 290);
  assert.equal(new Set(allAttacks.map(r => r.candidate_id)).size, 290);
  for (const row of allAttacks) {
    const id = String(row.candidate_id), b = byCandidate.get(id)!;
    assert.ok(b);
    const attacks = row.falsification_cases as Array<{test:string;attack:string;assessment:string}>;
    assert.deepEqual(attacks.map(x => x.test), [
      "SURVIVAL","REAL_REFERRER","INDEPENDENT_VARIATION","ALIAS_COLLISION",
      "MEASUREMENT_REMOVAL","DIRECTION_REVERSAL",
    ]);
    assert.ok(attacks.every(x=>x.attack.length>=55 && x.assessment));
    assert.equal(row.owner_or_steward_decision,"UNOBTAINED");
    assert.equal(row.adversarial_outcome,
      (b.gates as Record<string,{status:string}>).O4.status==="FAILED"
        ? "REFUSE_COMPOSITE_AS_WRITTEN" : "REVIEW_REQUIRED_NO_OWNED_ADMISSION");
  }
  assert.equal(negative.negative_candidates.length,31);
  assert.equal(negative.conflicting_sources.length,6);
  assert.equal(negative.negative_candidates.filter((r:{finding:string})=>r.finding==="REOPEN_FOR_EXPLICIT_STATE_LENS").length,2);
});

test("Pass C: all candidates and all source rules have separate refused/review/negative standing", () => {
  assert.equal(allC.length,290);
  assert.equal(new Set(allC.map(x => x.candidate_id)).size,290);
  assert.equal(allC.filter(x => x.proposed_disposition==="REFUSED_AS_COMPOSITE_AS_WRITTEN").length,11);
  assert.equal(allC.filter(x => x.proposed_disposition==="REVIEW_REQUIRED").length,279);
  for (const r of allC) {
    assert.ok(byCandidate.has(String(r.candidate_id)));
    assert.equal(r.owner_disposition,"UNOBTAINED");
    assert.equal(r.canonical_publication,"BLOCKED");
    assert.deepEqual(r.proposed_realization_bindings,[]);
    assert.deepEqual(r.authorized_action_templates,[]);
    assert.equal(r.directness,"SITUATED_ONLY_NOT_OOC_CRITERION");
    assert.ok(Array.isArray(r.source_ids) && r.source_ids.length > 0);
    assert.ok(Array.isArray(r.adversarial_negative_cases) && r.adversarial_negative_cases.length===6);
  }
  const sourceRows=tabs("research/atd-27/ATD-27-ALL-376-SOURCE-DISPOSITIONS.tsv");
  assert.equal(sourceRows.length,377);
  assert.deepEqual(sourceRows.slice(1).map(r=>r[0]),ledger.map(r=>r[0]));
  assert.ok(sourceRows.slice(1).every(r=>r[12]==="UNOBTAINED" && r[13]==="NONE"));
  assert.equal(sourceRows.slice(1).filter(r=>r[9]==="SOURCE_STEWARD_REVIEW_REQUIRED").length,6);
});

test("fail-closed reviewer verdict: unresolved O2/O5/O7 or owner gate cannot be authorized", () => {
  function admitted(record: Record<string,unknown>) {
    const gates=record.gates as Record<string,{status:string}>;
    const owner=record.owner_disposition;
    return gateCodes.every(code=>gates[code]?.status==="PASS") && owner==="SIGNED";
  }
  for(const row of allB) assert.equal(admitted(row),false);
  const mutant={...allB[0],owner_disposition:"SIGNED"};
  assert.equal(admitted(mutant),false,"a forged signature cannot overcome O2/O5/O7");
});
