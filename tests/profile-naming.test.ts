// URN: test:pi-atdd:profile-naming:plt-87-n-001
// Acceptance: acc:pi-atdd:plt-87-n-001
// Acceptance: acc:pi-atdd:plt-87-n-002
// Acceptance: acc:pi-atdd:plt-87-n-003
// Acceptance: acc:pi-atdd:plt-87-n-004
// Acceptance: acc:pi-atdd:plt-87-n-005
// Profile-first convention ids: lint, lossless alias map, profile selection, same activation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONVENTION_ID, PROFILES, canonicalRuleId, loadCatalog, loadConfig, namingViolations, resolveContext,
  rulesForProfile, type Catalog, type Selector,
} from "../src/catalog.ts";
import { ReasoningSession } from "../src/reasoning-context.ts";
import { probe } from "../tools/profile-naming/probe.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const aliasDoc = JSON.parse(readFileSync(join(ROOT, "conventions/aliases.json"), "utf8"));
const aliases: Record<string, string> = aliasDoc.aliases;
const provenance = JSON.parse(readFileSync(join(ROOT, "conventions/provenance.json"), "utf8")).files;

function bundled(): { catalog: Catalog; selectors: Selector[]; cwd: string; done: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-naming-"));
  const config = loadConfig(cwd);
  return { catalog: loadCatalog(config.sources, cwd), selectors: config.selectors, cwd,
    done: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("N-001 every bundled convention id is <profile>.<area>.<rule> at conventions/<profile>/<area>/<id>.convention.yaml", () => {
  const b = bundled();
  try {
    assert.deepEqual(namingViolations(b.catalog), []);
    for (const id of b.catalog.rules.keys()) assert.match(id, CONVENTION_ID);
    // the lint does catch a wrong id and a misplaced file
    const bad = new Map(b.catalog.rules);
    const any = [...bad.values()][0]!;
    bad.set("atdd-bun.review.x", { ...any, id: "atdd-bun.review.x" });
    bad.set("coder.dto.elsewhere", { ...any, id: "coder.dto.elsewhere", file: any.source + "/conventions/coder/x/coder.dto.elsewhere.convention.yaml" });
    assert.deepEqual(namingViolations({ rules: bad }).map(v => v.split(":")[0]), ["atdd-bun.review.x", "coder.dto.elsewhere"]);
  } finally { b.done(); }
});

test("N-002 the alias map covers all 358 old ids one-to-one and every old id resolves", () => {
  const b = bundled();
  try {
    const olds = Object.keys(aliases), news = Object.values(aliases);
    assert.equal(olds.length, 358);
    assert.equal(new Set(news).size, 358, "one-to-one");
    const inverse = new Map(Object.entries(aliases).map(([o, n]) => [n, o]));
    for (const [o, n] of Object.entries(aliases)) assert.equal(inverse.get(n), o, "both directions: " + o);
    const loaded358 = [...b.catalog.rules.keys()].filter(id => inverse.has(id));
    assert.equal(loaded358.length, 358, "every new id is loaded");
    for (const o of olds) assert.ok(b.catalog.rules.has(canonicalRuleId(b.catalog, o)), "old id resolves: " + o);
    for (const n of Object.values(aliasDoc.splitParts as Record<string, string>)) assert.match(n, CONVENTION_ID);
  } finally { b.done(); }
});

// PLT-103: the vocabulary rename changes rule text on purpose. Each renamed file is proved against its PLT-87 pin by
// reverse-replaying the recorded edits (conventions/provenance-vocabulary.json): every recorded position must match,
// and the replay must restore the PLT-87 bytes, which then restore the PLT-81 bytes when the rule_id is put back.
const vocabulary = JSON.parse(readFileSync(join(ROOT, "conventions/provenance-vocabulary.json"), "utf8"));
const vocabularyByOldPath = new Map<string, any>(vocabulary.files.map((f: any) => [f.oldPath, f]));

test("N-002 rule content is byte-identical to v0.2.0 apart from the rule_id field (PLT-103: through the recorded vocabulary edits)", () => {
  const files = provenance.filter((r: any) => r.old);
  assert.equal(files.length, 358);
  for (const r of files) {
    const v = vocabularyByOldPath.get(r.newPath);
    if (v) {
      assert.equal(v.prevSha256, r.newSha256, "PLT-87 pin of " + r.newPath);
      const nowBytes = readFileSync(join(ROOT, v.newPath));
      assert.equal(sha(nowBytes), v.newSha256, "renamed file drifted: " + v.newPath);
      const lines = nowBytes.toString("utf8").split("\n");
      const byLine = new Map<number, [number, string, string][]>();
      for (const [ln, col, text, before] of v.edits) byLine.set(ln, [...(byLine.get(ln) ?? []), [col, text, before]]);
      for (const [ln, edits] of byLine) {
        let line = lines[ln - 1];
        for (const [col, text, before] of edits.sort((a, b) => b[0] - a[0])) {
          assert.equal(line.slice(col, col + text.length), text, "recorded edit position: " + v.newPath + ":" + ln);
          line = line.slice(0, col) + before + line.slice(col + text.length);
        }
        lines[ln - 1] = line;
      }
      const replayed = Buffer.from(lines.join("\n"), "utf8");
      assert.equal(sha(replayed), r.newSha256, "replay does not restore the PLT-87 bytes: " + r.newPath);
      const i = lines.findIndex(l => l === "rule_id: " + r.new);
      assert.ok(i >= 0, r.newPath);
      lines[i] = "rule_id: " + r.old;
      assert.equal(sha(Buffer.from(lines.join("\n"), "utf8")), r.oldSha256, "content changed beyond the id: " + r.old);
      assert.ok(!existsSync(join(ROOT, r.oldPath)), "old path still present: " + r.oldPath);
      if (v.newPath !== r.newPath) assert.ok(!existsSync(join(ROOT, r.newPath)), "PLT-87 path still present: " + r.newPath);
      continue;
    }
    const now = readFileSync(join(ROOT, r.newPath));
    assert.equal(sha(now), r.newSha256, "moved file drifted: " + r.newPath);
    const lines = now.toString("utf8").split("\n");
    const i = lines.findIndex(l => l === "rule_id: " + r.new);
    assert.ok(i >= 0, r.newPath);
    lines[i] = "rule_id: " + r.old;
    assert.equal(sha(Buffer.from(lines.join("\n"), "utf8")), r.oldSha256, "content changed beyond the id: " + r.old);
    assert.ok(!existsSync(join(ROOT, r.oldPath)), "old path still present: " + r.oldPath);
  }
});

test("N-003 selecting by profile prefix returns exactly the intended family; shared.* reaches every profile", () => {
  const b = bundled();
  try {
    const all = [...b.catalog.rules.keys()];
    const shared = all.filter(id => id.startsWith("shared."));
    assert.ok(shared.length > 0);
    const union = new Set<string>();
    for (const p of PROFILES) {
      const got = rulesForProfile(b.catalog, p);
      const intended = all.filter(id => id.split(".")[0] === p || id.split(".")[0] === "shared").sort();
      assert.deepEqual(got, intended, p);
      for (const s of shared) assert.ok(got.includes(s), p + " misses " + s);
      for (const id of got) assert.ok(id.startsWith(p + ".") || id.startsWith("shared."), p + " got " + id);
      got.forEach(id => union.add(id));
    }
    assert.equal(union.size, all.length, "every convention reaches at least one profile");
    // the alias map's intended profile matches what the prefix delivers
    for (const [o, n] of Object.entries(aliases)) {
      const p = n.split(".")[0] as typeof PROFILES[number];
      assert.ok(rulesForProfile(b.catalog, p).includes(n), o + " -> " + n);
    }
    // owner decision 2026-11-19: the source tested-by rules are shared (coder writes the header, tester owns closure)
    for (const id of ["shared.traceability.source-tested-by-present", "shared.traceability.source-tested-by-resolves"])
      for (const p of PROFILES) assert.ok(rulesForProfile(b.catalog, p).includes(id), p + " misses " + id);
    // a coder no longer receives the planner family
    assert.ok(!rulesForProfile(b.catalog, "coder").some(id => id.startsWith("planner.")));
    assert.throws(() => rulesForProfile(b.catalog, "nobody" as any), /unknown profile/);
  } finally { b.done(); }
});

test("N-004 the activation probe delivers the same rules (by alias) as v0.2.0", () => {
  const before = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/activation-probe-v0.2.0.json"), "utf8"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-probe-"));
  try {
    // PLT-96 adds the tracker rules at task start. Parity is exact except for those additions, which are listed
    // here by scenario (not filtered by prefix), so any other new tracker activation still fails this test.
    // "set up a jujutsu worktree for the integration branch" matches the `branch` term: a branch setup is tracked work.
    // PLT-96 review P1: every edit/create scenario gains the tracker obligation and its notice; scenario 09 also
    // gains the branch rule ("branch" term). Listed by scenario so any other new tracker activation still fails.
    const WRITE_SCENARIOS = ["02 Implement acceptance for checkout, go green", "03 Update order model",
      "04 Make the green test pass", "05 Add authentication to the payment endpoint",
      "06 Fix layer boundary imports in integration", "07 Add acceptance test binding and coverage",
      "08 Write e2e journey", "11 Persist runtime state", "12 Update documentation", "13 Refactor the presentation view"];
    const OBLIGATION = ["shared.tracker.issue-mandatory", "shared.tracker.unconfigured-notice"];
    const PLT96_ADDITIONS: Record<string, string[]> = {
      ...Object.fromEntries(WRITE_SCENARIOS.map(k => [k, OBLIGATION])),
      "09 Coordinator: set up a jujutsu worktree for the integration branch": ["coder.tracker.issue-in-branch-and-pr", ...OBLIGATION],
    };
    // ATD-45: selectors generated from the activation facts add the topology rules (and their mandatory prerequisites) to
    // edit scenarios, and the review tier to the review scenario that names a path. Listed by scenario so any other
    // new activation still fails this test.
    const ATD45_ADDITIONS: Record<string, string[]> = {
          "07 Add acceptance test binding and coverage": [
                "planner.capability.features",
                "shared.topology.plan-location",
                "tester.topology.test-location"
          ],
          "08 Write e2e journey": [
                "planner.journey.definition",
                "tester.topology.e2e-location"
          ]
    };
    const rekey = (ids: string[]) => ids.map(id => aliases[id] ?? id).sort();
    const after = Object.fromEntries(Object.entries(probe(cwd)).map(([k, v]) => {
      const extra = [...(PLT96_ADDITIONS[k] ?? []), ...(ATD45_ADDITIONS[k] ?? [])];
      const minus = (ids: string[]) => ids.filter(id => !extra.includes(id));
      return [k, { context: minus(v.context), reasoning: minus(v.reasoning), added: extra.filter(id => v.context.includes(id) || v.reasoning.includes(id)) }];
    }));
    for (const [k, v] of Object.entries<any>(after)) {
      assert.deepEqual(v.added, [...(PLT96_ADDITIONS[k] ?? []), ...(ATD45_ADDITIONS[k] ?? [])], "PLT-96 and ATD-45 addition set for " + k);
      delete v.added;
    }
    const expected = Object.fromEntries(Object.entries<any>(before).map(([k, v]) =>
      [k, { context: rekey(v.context), reasoning: rekey(v.reasoning) }]));
    assert.deepEqual(after, expected);
    assert.ok(Object.values<any>(before).some(v => v.reasoning.length), "probe is not vacuous");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("old ids in project selectors and challenges still resolve to the renamed rules", () => {
  const b = bundled();
  try {
    const legacy: Selector[] = [{ id: "legacy", operations: ["review"], terms: ["review"],
      rules: ["atdd-bun.review.behavioral-reconciliation"] }];
    const ctx = resolveContext(b.catalog, legacy, "final review", [], "review");
    assert.deepEqual(ctx.matchingIds, ["reviewer.inspectability.owner", "reviewer.reconciliation.behavioral"]);
    const session = new ReasoningSession(b.catalog, legacy);
    const r = session.observe({ scope: "s", task: "final review", operation: "review", origin: "pi-event", provenance: "t" });
    assert.deepEqual(r.activations.map(a => a.id).sort(), ["reviewer.inspectability.owner", "reviewer.reconciliation.behavioral"]);
    assert.equal(b.catalog.unresolvedEdges.length, 44, "external upstream refs are not captured by renamed ids");
  } finally { b.done(); }
});

test("N-005 shared.convention.propose is authored in the PLT-81 format, audited PASS and delivered to every profile", () => {
  const b = bundled();
  try {
    const id = "shared.convention.propose";
    const rule = b.catalog.rules.get(id)!;
    assert.ok(rule, "loaded from the package-authored source");
    assert.equal(rule.source, "pi-atdd");
    for (const p of PROFILES) assert.ok(rulesForProfile(b.catalog, p).includes(id), p);
    // the rules PLT-87 requires it to carry
    const text = readFileSync(join(ROOT, rule.file.replace(/^pi-atdd\//, "catalog/pi-atdd/")), "utf8");
    for (const must of [/never creates, edits, disables or deletes an active convention/, /concrete evidence/,
      /names the profile and area/, /never\s+applied to the task in which it was raised/, /experiments enter through the same path/i,
      /coach collects/, /independent auditor/, /owner approves or declines/, /declined, with the reason/])
      assert.match(text.replace(/\s+/g, " "), new RegExp(must.source.replace(/\\s\+/g, " "), must.flags), must.source);
    // PLT-81 sidecar: pinned to the source, PASS, one obligation, every segment traced
    const manifest = JSON.parse(readFileSync(join(ROOT, "conventions-sidecar/manifest.json"), "utf8"));
    const e = manifest.entries[id];
    assert.equal(e.auditVerdict, "PASS");
    assert.equal(sha(readFileSync(join(ROOT, e.sourcePath))), e.sourceSha256);
    assert.match(e.authoredBy.author, /^pi-claude-cli\/claude-opus-5-5/);
    assert.match(e.authoredBy.auditor, /^openai-codex\/gpt-6\.1-sol/);
    const side = JSON.parse(readFileSync(join(ROOT, "conventions-sidecar", e.file), "utf8"));
    assert.equal(side.rule_id, id);
    assert.ok(side.then && side.trace.length > 0 && side.activation.fires.length && side.activation.doesNotFire.length);
    // the bundled selector activates it from task wording
    const ctx = resolveContext(b.catalog, b.selectors, "file a convention proposal for this misfiring convention", [], "task");
    assert.ok(ctx.matchingIds.includes(id));
  } finally { b.done(); }
});
