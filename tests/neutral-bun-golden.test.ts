// Acceptance: acc:pi-atdd:PLT-84-SN-001
// Acceptance: acc:pi-atdd:PLT-84-SN-002
// Rendering a stack-neutral convention for stack=bun returns the frozen 0.2.0 text (golden test), and its core is neutral.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNeutralRecords, renderForStack } from "../src/neutral-render.ts";
import { isVocabularyKey, proposalProblems } from "../src/profile-vocabulary.ts";
import { neutralityLeaks } from "../src/neutral-lint.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(ROOT, "conventions-sidecar/manifest.json"), "utf8"));
const records = loadNeutralRecords();
const partOf: Record<string, any> = {};
for (const se of Object.values<any>(manifest.splits ?? {})) for (const p of se.parts) partOf[p] = se;
const splitPartAliases: Record<string, string> = JSON.parse(readFileSync(join(ROOT, "conventions/aliases.json"), "utf8")).splitParts ?? {};
const goldens = readdirSync(join(ROOT, "tests/golden/bun")).map((f) => f.replace(/\.txt$/, "")).sort();

test("every neutral record has a golden snapshot and every snapshot has a record", () => {
  assert.ok(records.length > 0);
  assert.deepEqual(records.map((r) => r.rule_id).sort(), goldens);
});

test("SN-001: render(stack=bun) equals the frozen v0.2.0-bun-baseline text, per convention", () => {
  for (const r of records) {
    const e = manifest.entries[r.rule_id] ?? partOf[r.rule_id];
    assert.ok(e, r.rule_id + " is a frozen sidecar entry or split part");
    if (manifest.entries[r.rule_id]) {
      assert.equal(r.legacyId, e.legacyId ?? r.rule_id, r.rule_id + ": legacy id");
      assert.equal(r.realizations.bun.part, undefined, r.rule_id + ": single rewrite has no part");
    } else {
      assert.equal(splitPartAliases[r.legacyId], r.rule_id, r.rule_id + ": legacy part id resolves to this part");
      assert.equal(r.realizations.bun.part, r.legacyId, r.rule_id + ": realization is its legacy part");
    }
    assert.equal(r.realizations.bun.sidecar, "conventions-sidecar/" + e.file, r.rule_id + ": realization file");
    assert.equal(r.realizations.bun.sha256, e.sidecarSha256, r.rule_id + ": realization pinned to the frozen digest");
    const out = renderForStack(r, "bun");
    assert.equal(out.realization, "curated");
    assert.equal(out.text, readFileSync(join(ROOT, "tests/golden/bun", r.rule_id + ".txt"), "utf8"), r.rule_id + ": golden");
  }
});

test("a tampered Bun realization is refused, not rendered", () => {
  const r = records[0];
  const tmp = mkdtempSync(join(tmpdir(), "plt84-"));
  const rel = r.realizations.bun.sidecar;
  cpSync(join(ROOT, "conventions-sidecar"), join(tmp, "conventions-sidecar"), { recursive: true });
  writeFileSync(join(tmp, rel), readFileSync(join(ROOT, rel), "utf8").replace(/"then": "/, '"then": "X'));
  assert.throws(() => renderForStack(r, "bun", tmp), /differs from its pinned/);
  assert.ok(existsSync(join(ROOT, rel)));
});

test("SN-002: every core is neutral and uses only vocabulary (or valid proposed) profile keys", () => {
  for (const r of records) {
    assert.deepEqual(neutralityLeaks(r.core), [], r.rule_id + ": neutrality");
    const proposed = new Set((r.proposedKeys as any[]).map((p) => p.key));
    for (const p of r.profileRequirements) assert.ok(isVocabularyKey(p.key) || proposed.has(p.key), r.rule_id + ": " + p.key);
    // A proposal is valid while pending, and stays valid once the owner adds it to the vocabulary.
    for (const k of proposed) if (!isVocabularyKey(k)) assert.deepEqual(proposalProblems(k), [], r.rule_id + ": proposal " + k);
    assert.equal(r.audit.verdict, "PASS", r.rule_id + ": auditor");
  }
});

test("stage 1 renders only stack=bun", () => {
  assert.throws(() => renderForStack(records[0], "python"), /stage-2/);
});
