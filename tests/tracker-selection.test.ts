// PLT-96 review RETURN on PR #19 (P1 selection, P1 no-tracker notice, P2 CLI omission).
// Acceptance: acc:pi-atdd:PLT-96-A1 (rules reach code-changing work), acc:pi-atdd:PLT-96-A3 (no tracker is said, never passed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadConfig, resolveContext, type Catalog, type Selector } from "../src/catalog.ts";
import { readTrackerConfig } from "../src/tracker-issue.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const MANDATORY = "shared.tracker.issue-mandatory";
const NOTICE = "shared.tracker.unconfigured-notice";

function bundled(): { catalog: Catalog; selectors: Selector[] } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-tracker-select-"));
  try {
    const config = loadConfig(cwd);
    return { catalog: loadCatalog(config.sources, cwd), selectors: config.selectors };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

// Code-changing task wording that the earlier term list did not name.
const BROAD_TASKS = [
  "Build me a dashboard",
  "Ship the billing settings page",
  "Create a reporting screen for managers",
  "Make the export endpoint return CSV",
  "Remove the legacy webhook handler",
  "Set up the staging environment",
  "Rename the invoice module",
];

test("P1 code-changing task wording outside the old term list selects the tracker obligation", () => {
  const { catalog, selectors } = bundled();
  for (const task of BROAD_TASKS) {
    const ctx = resolveContext(catalog, selectors, task, [], "task");
    assert.ok(ctx.matchingIds.includes(MANDATORY), task + " -> " + ctx.matchingIds.join(","));
  }
});

test("P1 the no-tracker notice is selected through the same selection as the mandatory rule", () => {
  const { catalog, selectors } = bundled();
  for (const task of ["Build me a dashboard", "Fix the checkout total"]) {
    const ctx = resolveContext(catalog, selectors, task, [], "task");
    assert.ok(ctx.matchingIds.includes(MANDATORY), task);
    assert.ok(ctx.matchingIds.includes(NOTICE), task + " must carry the notice -> " + ctx.matchingIds.join(","));
  }
});

test("P1 edit and create on any repository file select the tracker obligation whatever the task wording", () => {
  const { catalog, selectors } = bundled();
  for (const op of ["edit", "create"] as const) {
    for (const path of ["README.md", "src/orders/checkout.ts", ".github/workflows/ci.yml", "infra/main.tf"]) {
      const ctx = resolveContext(catalog, selectors, "unrecognized-opaque-task", [path], op);
      assert.ok(ctx.matchingIds.includes(MANDATORY), op + " " + path + " -> " + ctx.matchingIds.join(","));
      assert.ok(ctx.matchingIds.includes(NOTICE), op + " " + path + " must carry the notice");
    }
  }
});

test("P1 unrecognised non-code task wording keeps the applicability gap and gets no tracker rule", () => {
  const { catalog, selectors } = bundled();
  const gap = resolveContext(catalog, selectors, "unrecognized-opaque-task", [], "task");
  assert.equal(gap.status, "unresolved");
  for (const task of ["unrecognized-opaque-task", "Summarise the quarterly meeting notes"]) {
    const ctx = resolveContext(catalog, selectors, task, [], "task");
    assert.ok(!ctx.matchingIds.some(id => id.includes(".tracker.")), task + " -> " + ctx.matchingIds.join(","));
  }
});

test("PLT-96 the repository names its tracker by configuration: Linear, with a Linear identifier pattern", () => {
  const cfg = readTrackerConfig(ROOT);
  assert.ok(cfg, "atdd-pi.yaml must configure a tracker");
  assert.equal(cfg.kind, "linear");
  const pattern = new RegExp(cfg.issuePattern, "i");
  assert.ok(pattern.test("PLT-96"));
  assert.ok(pattern.test("AF8-12"));
  assert.ok(!pattern.test("no issue id here"));
});

test("P2 tracker check without --changed fails instead of passing an unchecked change", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-tracker-cli-"));
  try {
    writeFileSync(join(dir, "atdd-pi.yaml"),
      "schema: pi-atdd/config/v2\ntracker:\n  kind: example-tracker\n  issuePattern: '[A-Z]{2,}-\\d+'\n");
    const run = (args: string[]) => {
      try {
        const out = execFileSync(process.execPath, ["--experimental-strip-types", join(ROOT, "src/cli.ts"),
          "tracker", "check", "--repo", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return { code: 0, out };
      } catch (error) {
        const e = error as { status: number; stdout: string };
        return { code: e.status, out: e.stdout };
      }
    };
    const omitted = run(["--branch", "feature/ABC-12-fix", "--pr-body", "Refs ABC-12"]);
    assert.notEqual(omitted.code, 0, "omitting --changed must not pass: " + omitted.out);
    const parsed = JSON.parse(omitted.out) as { status: string; error?: string };
    assert.equal(parsed.status, "error");
    assert.match(parsed.error ?? "", /--changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
