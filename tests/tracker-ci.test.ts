// URN: test:pi-atdd:tracker-ci:ATD-24-ACC-1
// Acceptance: acc:pi-atdd:ATD-24-ACC-1
// Acceptance: acc:pi-atdd:ATD-24-ACC-2
// Acceptance: acc:pi-atdd:ATD-24-ACC-3
// ATD-24 (PLT-106): CI runs the tracker-issue check on each PR.
// 1 a PR changing code with no issue id in branch and body is reported; 2 a PR with the id in both
// passes; 3 with no tracker configured the notice is shown and never reported as tracked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCRIPT = join(ROOT, "scripts/tracker-check-ci.sh");
const CONFIG = "schema: pi-atdd/config/v2\ntracker:\n  kind: example\n  issuePattern: '[A-Z]{2,}-\\d+'\n";

function repo(config: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-trackerci-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  if (config) writeFileSync(join(dir, "atdd-pi.yaml"), config);
  mkdirSync(join(dir, "src")); writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  git("add", "-A"); git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "src/a.ts"), "export const a = 2;\n");
  git("commit", "-qam", "change");
  return dir;
}
function run(dir: string, branch: string, body: string) {
  return spawnSync("bash", [SCRIPT], { cwd: dir, encoding: "utf8",
    env: { ...process.env, TRACKER_BASE_REF: "main", TRACKER_HEAD_REF: "HEAD", TRACKER_BRANCH: branch, TRACKER_PR_BODY: body, TRACKER_CLI: join(ROOT, "src/cli.ts") } });
}

test("A1 a code change with no issue id is reported as a failure", () => {
  const dir = repo(CONFIG);
  try { const r = run(dir, "feature/no-id", "No id here."); assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stdout, /fail/i); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test("A2 an issue id in branch and body passes", () => {
  const dir = repo(CONFIG);
  try { const r = run(dir, "feature/ATD-24-x", "Closes ATD-24."); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /pass/i); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test("A3 no tracker configured is a visible notice, never a pass", () => {
  const dir = repo(null);
  try { const r = run(dir, "feature/x", "body"); assert.equal(r.status, 3, r.stdout + r.stderr); assert.match(r.stdout, /notice/i); assert.doesNotMatch(r.stdout, /"status":\s*"pass"/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test("A4 the workflow runs the script on pull requests, non-blocking, with the body passed through the environment", () => {
  const wf = readFileSync(join(ROOT, ".github/workflows/checks.yml"), "utf8");
  assert.match(wf, /tracker-check-ci\.sh/);
  assert.match(wf, /if: github\.event_name == 'pull_request'/);
  assert.match(wf, /continue-on-error: true/);
  assert.match(wf, /TRACKER_PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/);
  assert.doesNotMatch(wf, /run:[^\n]*\$\{\{ github\.event\.pull_request\.(body|title)/);
});
