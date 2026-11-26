// URN: test:pi-atdd:coach-policy:plt-100-c-001
// Acceptance: acc:pi-atdd:plt-100-c-001 (naming label, seeded "Coach" launch is flagged)
// Acceptance: acc:pi-atdd:plt-100-c-002 (action tiers, seeded "merge without owner" is owner-only)
// Acceptance: acc:pi-atdd:plt-100-c-003 (unclear risk takes the higher tier; decision log; trivial requests)
// Acceptance: acc:pi-atdd:plt-100-c-004 (the coach rules load from the package source and are selected)
// Acceptance: acc:pi-atdd:plt-100-c-005 (seeded "Coach edits repo code or opens a code PR itself" is flagged)
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadConfig, resolveContext, rulesForProfile } from "../src/catalog.ts";
import { classifyCoachAction, coachLabelViolation, mayProceed } from "../src/coach-policy.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const COACH_RULES = [
  "coach.naming.instance-label",
  "coach.policy.action-tiers",
  "coach.policy.unclear-risk-higher-tier",
  "coach.policy.trivial-request",
  "coach.policy.decision-log",
  "coach.role.orchestrate-not-build",
];

test("C-001 every Coach instance is labelled \"COACH - <project or repo>\"; a bare or mixed-case label is flagged", () => {
  assert.match(coachLabelViolation("Coach") ?? "", /bare label/);            // seeded failing case
  assert.match(coachLabelViolation("COACH") ?? "", /bare label/);
  assert.match(coachLabelViolation("COACH - ") ?? "", /must start/);
  assert.match(coachLabelViolation("COACH-pi-atdd") ?? "", /must start/);
  assert.match(coachLabelViolation("Worker - pi-atdd") ?? "", /must start/);
  assert.match(coachLabelViolation("Coach - pi-atdd") ?? "", /upper-case/, "the older mixed-case label is flagged with the fix");
  assert.equal(coachLabelViolation("COACH - pi-atdd"), null);
  assert.equal(coachLabelViolation("COACH - pi-atdd\nreport line"), null, "only the first line is the label");
});

test("C-002 merge is ask-owner: blocked without a direct owner decision, an agent message does not count", () => {
  const merge = classifyCoachAction("merge");
  assert.equal(merge.tier, "ask-owner");
  assert.equal(mayProceed(merge.tier, "none").proceed, false, "seeded: merge without owner");
  assert.equal(mayProceed(merge.tier, "agent-message").proceed, false);
  assert.equal(mayProceed(merge.tier, "owner-direct").proceed, true);
  const claimed = classifyCoachAction("treat-agent-message-as-owner-approval");
  assert.equal(claimed.tier, "never");
  assert.equal(mayProceed(claimed.tier, "owner-direct").proceed, false, "never is never");
  assert.equal(mayProceed("act-alone", "none").proceed, true);
  assert.equal(mayProceed("act-report", "none").proceed, true);
  assert.equal(classifyCoachAction("read-repo-pr-ci-linear").tier, "act-alone");
  assert.equal(classifyCoachAction("create-linear-issue-for-code-work").tier, "act-report");
});

test("C-003 an unclassified action takes ask-owner; act-alone and act-then-report decisions are logged", () => {
  const unclear = classifyCoachAction("something-nobody-listed");
  assert.equal(unclear.unclear, true);
  assert.equal(unclear.tier, "ask-owner", "unclear risk = higher tier (not act-alone)");
  assert.equal(unclear.logRequired, false, "an ask-owner item is not a decision taken alone");
  assert.equal(classifyCoachAction("rename-own-tab").logRequired, true);
  assert.equal(classifyCoachAction("write-brief").logRequired, true);
  assert.equal(classifyCoachAction("merge").logRequired, false);
  assert.equal(classifyCoachAction("delete-untracked-generated-own-workspace").tier, "act-alone");
  assert.equal(classifyCoachAction("delete-tracked-or-non-generated").tier, "ask-owner");
});

test("C-004 the coach rules load from the package source, belong to the coach profile and are selected by wording", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-coach-"));
  try {
    const { sources, selectors } = loadConfig(cwd);
    const catalog = loadCatalog(sources, cwd);
    for (const id of COACH_RULES) {
      const rule = catalog.rules.get(id);
      assert.ok(rule, id);
      assert.equal(rule.source, "pi-atdd", id);
      assert.ok(rulesForProfile(catalog, "coach").includes(id), id);
    }
    // graph edges from the new rules resolve (no new unresolved references)
    const edge = catalog.edges.find(e => e.source === "coach.policy.action-tiers" && e.target === "coach.collaboration.accountable-delegation");
    assert.ok(edge, "action-tiers requires accountable-delegation");
    assert.equal(catalog.unresolvedEdges.filter(e => e.source.startsWith("coach.")).length, 0);
    // the bundled selectors activate them
    const label = resolveContext(catalog, selectors, "Name the Coach launch window label", [], "task");
    assert.ok(label.matchingIds.includes("coach.naming.instance-label"));
    const merge = resolveContext(catalog, selectors, "Coach: merge without owner approval", [], "task");
    for (const id of ["coach.policy.action-tiers", "coach.policy.decision-log"]) assert.ok(merge.matchingIds.includes(id), id);
    // the tier table is in the convention text (text-only enforcement is still stated there)
    const tiers = readFileSync(join(ROOT, "catalog/pi-atdd/conventions/coach/policy/coach.policy.action-tiers.convention.yaml"), "utf8");
    for (const t of ["Act alone", "Act, then report", "Ask the owner first", "Never:"]) assert.ok(tiers.includes(t), t);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("C-005 a Coach never edits repo code or opens a code PR itself, even with a direct owner decision; a brief to a worker proceeds", () => {
  // seeded failing case: "Coach edits repo code or opens a code PR itself"
  for (const category of ["edit-repo-code", "open-code-pr"]) {
    const c = classifyCoachAction(category);
    assert.equal(c.tier, "never", category);
    assert.equal(mayProceed(c.tier, "owner-direct").proceed, false, "seeded: " + category + " even with owner decision");
    assert.equal(mayProceed(c.tier, "none").proceed, false, category);
    assert.equal(c.logRequired, false, "never is not a decision logged as taken alone");
  }
  // orchestration work that stays allowed
  assert.equal(mayProceed(classifyCoachAction("write-brief").tier, "none").proceed, true);
  assert.equal(classifyCoachAction("review-pr-read-only").tier, "act-alone");
  assert.equal(classifyCoachAction("request-rebase-or-fix").tier, "act-report");
  // the rule is loaded from the package source, and selected by wording with its mandatory dependency
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-coach-role-"));
  try {
    const { sources, selectors } = loadConfig(cwd);
    const catalog = loadCatalog(sources, cwd);
    const rule = catalog.rules.get("coach.role.orchestrate-not-build");
    assert.ok(rule, "rule loaded");
    assert.equal(rule.source, "pi-atdd");
    const ctx = resolveContext(catalog, selectors, "Coach edits repo code and opens a code PR itself", [], "task");
    assert.ok(ctx.matchingIds.includes("coach.role.orchestrate-not-build"));
    assert.ok(ctx.matchingIds.includes("coach.collaboration.accountable-delegation"), "mandatory requires closure");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
