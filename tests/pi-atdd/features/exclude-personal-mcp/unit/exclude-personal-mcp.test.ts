// URN: test:pi-atdd:exclude-personal-mcp:atd-58-a01
// Acceptance: acc:pi-atdd:atd-58-a01
// Acceptance: acc:pi-atdd:atd-58-a02
// Acceptance: acc:pi-atdd:atd-58-a03
// Acceptance: acc:pi-atdd:atd-58-a04
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planLaunch, type LaunchInput } from "../../../../../src/launcher.ts";

const REPO = new URL("../../../../../", import.meta.url).pathname;
const hostEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("PI_ATDD_ATTENTION_") && !key.startsWith("PI_ATDD_EXECUTION_") && key !== "PI_ATDD_MODE"));

function input(root: string, role: string, label: string, task?: string): LaunchInput {
  return {
    role, label, profile: "af8", project: "pi-atdd", coach: "coach:af8/pi-atdd", agentDir: root,
    model: "pi-claude-cli/claude-haiku-5-5", ...(task ? { task } : {}),
  };
}

function dryRun(root: string, role: string, label: string, task?: string) {
  const args = ["--experimental-strip-types", "src/cli.ts", "launch", "--dry-run", "--role", role,
    "--label", label, ...(task ? ["--task", task] : []), "--profile", "af8", "--project", "pi-atdd",
    "--coach", "coach:af8/pi-atdd", "--agent-dir", root, "--model", "pi-claude-cli/claude-haiku-5-5"];
  const run = spawnSync(process.execPath, args, { cwd: REPO, encoding: "utf8", env: hostEnv() });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const plan = JSON.parse(run.stdout);
  assert.equal(plan.status, "planned");
  return plan.pi as string[];
}

test("ATD-58 A04: MCP connection and 429 investigation results are recorded", () => {
  const report = readFileSync(new URL("../../../../../docs/ATD-58-MCP-investigation.md", import.meta.url), "utf8");
  assert.match(report, /Tool exclusion does not prevent MCP server connections/);
  assert.match(report, /did not reproduce a Wispr-generated warning/);
});

test("ATD-58 A01-A03: personal MCP exclusion is role-specific in launch plans and dry runs", () => {
  const root = mkdtempSync(join(tmpdir(), "atd-58-launch-"));
  try {
    const exclusion = ["--exclude-tools", "mcp__wispr*,mcp__granola*,mcp__google*"];
    for (const [role, label, task] of [["worker", "Worker", "ATD-58"], ["reviewer", "Reviewer", "ATD-58"]]) {
      const plan = planLaunch(input(root, role, label, task));
      const index = plan.piArgs.indexOf("--exclude-tools");
      assert.deepEqual(plan.piArgs.slice(index, index + 2), exclusion, `${role} launch plan`);
      const printed = dryRun(root, role, label, task);
      const printedIndex = printed.indexOf("--exclude-tools");
      assert.deepEqual(printed.slice(printedIndex, printedIndex + 2), exclusion, `${role} dry run`);
    }

    const coach = planLaunch(input(root, "coach", "Coach"));
    assert.equal(coach.piArgs.includes("--exclude-tools"), false, "coach launch plan preserves tools");
    assert.equal(dryRun(root, "coach", "Coach").includes("--exclude-tools"), false, "coach dry run preserves tools");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
