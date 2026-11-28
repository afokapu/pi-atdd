// URN: test:pi-atdd:bind-tracker-issue:plt-96-a02
// Acceptance: acc:pi-atdd:plt-96-a02
// PLT-96: every code-changing task is bound to an issue in the configured tracker.
// Acceptance (PLT-96 Telemetry): 1 rules exist, carry ids/statements/terms and are selected for
// coder, planner and coach sessions; 2 a seeded "code change without a tracker issue" is flagged;
// 3 with no tracker configured the result says so (notice, never a silent pass); 4 the feature is
// tracker-neutral (no tracker name in code, kind and issue pattern come from configuration).
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONVENTION_ID, GraphError, loadCatalog, loadConfig, namingViolations, resolveContext, rulesForProfile } from "../src/catalog.ts";
import { changeKind, checkTrackerIssue, readTrackerConfig, type TrackerConfig } from "../src/tracker-issue.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const RULE = {
  core: "shared.tracker.issue-mandatory",
  notice: "shared.tracker.unconfigured-notice",
  coder: "coder.tracker.issue-in-branch-and-pr",
  planner: "planner.tracker.issue-before-ratify",
};
const TRACKER: TrackerConfig = { kind: "example-tracker", issuePattern: "[A-Z]{2,}-\\d+" };
// Seeded case: a code change with no tracker issue anywhere in the branch or PR body.
const SEEDED_UNTRACKED = { changedFiles: ["src/orders/checkout.ts"], branch: "feature/checkout-fix", prBody: "Fixes the checkout total." };

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-tracker-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function bundled() {
  return withTmp(cwd => { const config = loadConfig(cwd); return { catalog: loadCatalog(config.sources, cwd), selectors: config.selectors }; });
}

test("A1 the four tracker rules load with profile-first ids and statements", () => {
  const { catalog } = bundled();
  for (const id of Object.values(RULE)) {
    assert.ok(catalog.rules.has(id), "missing rule " + id);
    assert.match(id, CONVENTION_ID);
    assert.ok(catalog.rules.get(id)!.statement.length > 60, "statement too short: " + id);
    assert.equal(catalog.rules.get(id)!.source, "pi-atdd");
  }
  assert.deepEqual(namingViolations(catalog), []);
});

test("ATD-55 delivered planner binding is tracker-neutral and remains required before ratification", () => {
  const { catalog } = bundled();
  const binding = catalog.rules.get("planner.plan.confirm-binds-an-issue")!;
  assert.equal(binding.source, "pi-atdd");
  const delivered = `${binding.statement}\n${binding.summary}\n${binding.guidance}`;
  assert.match(delivered, /configured tracker/i);
  assert.match(delivered, /record.{0,40}id.{0,40}plan/i);
  assert.match(delivered, /issue.{0,20}branch.{0,20}worktree/i);
  assert.match(delivered, /session removes the .*ceremony, not the issue/i);
  assert.doesNotMatch(delivered, /atdd plan session bind-issue|local manifest|State Store/i);

  const tracker = catalog.rules.get(RULE.planner)!;
  assert.doesNotMatch(`${tracker.statement}\n${tracker.summary}\n${tracker.guidance}`, /local ATDD issue/i);
  const bindingEdge = catalog.edges.find(edge => edge.source === RULE.planner && edge.target === binding.id
    && edge.type === "requires" && edge.constraint === "mandatory");
  assert.ok(bindingEdge, "tracker ratification rule must still require the binding");
  assert.doesNotMatch(bindingEdge.reason, /local binding/i, "the delivered relationship rationale must be tool-neutral");
});

test("A1 rules are selected for coder, planner and coach sessions; shared rules reach every profile", () => {
  const { catalog } = bundled();
  assert.ok(rulesForProfile(catalog, "coder").includes(RULE.coder));
  assert.ok(rulesForProfile(catalog, "coder").includes(RULE.core));
  assert.ok(rulesForProfile(catalog, "planner").includes(RULE.planner));
  assert.ok(rulesForProfile(catalog, "coach").includes(RULE.notice));
  assert.ok(!rulesForProfile(catalog, "coach").includes(RULE.coder), "coder rule must not reach coach");
});

test("A1 selectors deliver the rules at task start, with their mandatory dependencies, and never throw", () => {
  const { catalog, selectors } = bundled();
  const coder = resolveContext(catalog, selectors, "Open a pull request for the fix on branch feature/checkout", ["src/orders/checkout.ts"], "task");
  assert.ok(coder.matchingIds.includes(RULE.core) && coder.matchingIds.includes(RULE.coder), coder.matchingIds.join(","));
  // PLT-96 review P1: a write to a repository file is code-changing work, so the obligation reaches edit/create too.
  const write = resolveContext(catalog, selectors, "Open a pull request for the fix on branch feature/checkout", ["src/orders/checkout.ts"], "edit");
  assert.ok(write.matchingIds.includes(RULE.core), "core rule must reach edit/create: " + write.matchingIds.join(","));
  const planner = resolveContext(catalog, selectors, "Ratify the plan decomposition", [], "task");
  assert.ok(planner.matchingIds.includes(RULE.planner), planner.matchingIds.join(","));
  assert.ok(planner.matchingIds.includes("planner.plan.confirm-binds-an-issue"), "planner rule must require the plan-binding rule");
  const coach = resolveContext(catalog, selectors, "Coordinator: update the tracker status for the integration branch", [], "task");
  assert.ok(coach.matchingIds.includes(RULE.core) && coach.matchingIds.includes(RULE.notice), coach.matchingIds.join(","));
});

test("A1 the tracker rules do not mask an applicability gap: an unrecognised task stays unresolved", () => {
  const { catalog, selectors } = bundled();
  const gap = resolveContext(catalog, selectors, "unrecognized-opaque-task", [], "task");
  assert.equal(gap.status, "unresolved");
  assert.ok(!gap.matchingIds.some(id => id.includes(".tracker.")), gap.matchingIds.join(","));
});

test("A2 seeded: a code change without a tracker issue is flagged", () => {
  const r = checkTrackerIssue({ ...SEEDED_UNTRACKED, tracker: TRACKER });
  assert.equal(r.verdict, "fail");
  assert.equal(r.issueRef, null);
  assert.ok(r.findings.some(f => /no tracker issue/.test(f)), r.findings.join(" | "));
});

test("A2 the issue id must be in the branch name AND the PR body", () => {
  const branchOnly = checkTrackerIssue({ changedFiles: ["src/a.ts"], branch: "feature/ABC-12-fix", prBody: "no reference", tracker: TRACKER });
  assert.equal(branchOnly.verdict, "fail");
  assert.ok(branchOnly.findings.some(f => /PR body/.test(f)), branchOnly.findings.join(" | "));
  const bodyOnly = checkTrackerIssue({ changedFiles: ["src/a.ts"], branch: "feature/fix", prBody: "Refs ABC-12", tracker: TRACKER });
  assert.equal(bodyOnly.verdict, "fail");
  assert.ok(bodyOnly.findings.some(f => /branch/.test(f)), bodyOnly.findings.join(" | "));
});

test("A2 bound change passes; the PR body not yet written is a notice, not a pass", () => {
  const ok = checkTrackerIssue({ changedFiles: ["src/a.ts"], branch: "feature/ABC-12-fix", prBody: "Refs ABC-12", tracker: TRACKER });
  assert.equal(ok.verdict, "pass");
  assert.equal(ok.issueRef, "ABC-12");
  const pending = checkTrackerIssue({ changedFiles: ["src/a.ts"], branch: "feature/ABC-12-fix", tracker: TRACKER });
  assert.equal(pending.verdict, "notice");
});

test("A2 'code-changing' covers repo files, CI, deploy/infra and cloud build settings; no change needs no issue", () => {
  assert.equal(changeKind("src/a.ts"), "repo-file");
  assert.equal(changeKind("README.md"), "repo-file", "docs are repo files too");
  assert.equal(changeKind(".github/workflows/ci.yml"), "ci");
  assert.equal(changeKind("infra/main.tf"), "deploy-infra");
  assert.equal(changeKind("deploy/k8s/app.yaml"), "deploy-infra");
  assert.equal(changeKind("cloudbuild.yaml"), "cloud-build");
  for (const file of [".github/workflows/ci.yml", "infra/main.tf", "cloudbuild.yaml", "README.md"]) {
    assert.equal(checkTrackerIssue({ changedFiles: [file], branch: "main", prBody: "", tracker: TRACKER }).verdict, "fail", file);
  }
  const none = checkTrackerIssue({ changedFiles: [], branch: "main", tracker: TRACKER });
  assert.equal(none.verdict, "pass");
});

test("A3 no tracker configured: an explicit notice, never a silent pass", () => {
  const r = checkTrackerIssue({ ...SEEDED_UNTRACKED, tracker: null });
  assert.equal(r.verdict, "notice");
  assert.match(r.message, /No issue tracker is configured/);
  assert.notEqual(r.verdict, "pass");
});

test("A3 tracker is read from atdd-pi.yaml; absent or unset means null; invalid pattern is rejected", () => {
  withTmp(dir => {
    assert.equal(readTrackerConfig(dir), null, "no atdd-pi.yaml");
    writeFileSync(join(dir, "atdd-pi.yaml"), "schema: pi-atdd/config/v2\n");
    assert.equal(readTrackerConfig(dir), null, "schema without tracker key");
    writeFileSync(join(dir, "atdd-pi.yaml"), "schema: pi-atdd/config/v2\ntracker:\n  kind: example-tracker\n  issuePattern: '[A-Z]{2,}-\\d+'\n");
    assert.deepEqual(readTrackerConfig(dir), TRACKER);
    writeFileSync(join(dir, "atdd-pi.yaml"), "schema: pi-atdd/config/v2\ntracker:\n  kind: example-tracker\n  issuePattern: '('\n");
    assert.throws(() => readTrackerConfig(dir), GraphError);
    writeFileSync(join(dir, "atdd-pi.yaml"), "schema: pi-atdd/config/v2\ntracker:\n  kind: ''\n  issuePattern: 'X-1'\n");
    assert.throws(() => readTrackerConfig(dir), GraphError);
  });
});

test("A4 tracker-neutral: the module names no tracker product", () => {
  const source = readFileSync(join(ROOT, "src/tracker-issue.ts"), "utf8");
  assert.doesNotMatch(source, /linear|jira|github issue/i);
});

test("A2/A3 CLI: `atdd tracker check` exits 1 on the seeded case and 3 with no tracker configured", () => {
  withTmp(dir => {
    const run = (extra: string[]) => {
      try {
        const out = execFileSync(process.execPath, ["--experimental-strip-types", join(ROOT, "src/cli.ts"), "tracker", "check",
          "--repo", dir, "--branch", SEEDED_UNTRACKED.branch, "--pr-body", SEEDED_UNTRACKED.prBody, ...extra,
          ...SEEDED_UNTRACKED.changedFiles.flatMap(f => ["--changed", f])], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return { code: 0, out };
      } catch (error) {
        const e = error as { status: number; stdout: string };
        return { code: e.status, out: e.stdout };
      }
    };
    const unconfigured = run([]);
    assert.equal(unconfigured.code, 3, unconfigured.out);
    assert.equal(JSON.parse(unconfigured.out).status, "notice");
    writeFileSync(join(dir, "atdd-pi.yaml"), "schema: pi-atdd/config/v2\ntracker:\n  kind: example-tracker\n  issuePattern: '[A-Z]{2,}-\\d+'\n");
    const seeded = run([]);
    assert.equal(seeded.code, 1, seeded.out);
    assert.equal(JSON.parse(seeded.out).status, "fail");
  });
});
