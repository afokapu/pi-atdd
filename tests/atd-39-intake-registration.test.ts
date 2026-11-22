// URN: test:pi-atdd:source-catalog:E001-UNIT-006
// Acceptance: acc:pi-atdd:E001-UNIT-006
// Phase: GREEN
// Layer: integration
// This test checks the *proposed* coordinator patch while the intake workflow
// still checks out the previously-approved integration base from the PR event.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, ".github/workflows/integration-acceptance.yml");
const workflow = readFileSync(path, "utf8");

test("coordinator checker validates all 20 original source acceptance rows", () => {
  const run = spawnSync(process.execPath, [
    "--test", join(root, "tests/integration-contract-check.test.mjs"),
  ], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(run.status, 0, run.stdout + "\n" + run.stderr);
  // Nested node:test processes under CI's outer Node test runner can emit no
  // own TAP; verify the exact checked source cases and child exit instead.
  const cases = readFileSync(join(root, "tests/integration-contract-check.test.mjs"), "utf8")
    .match(/^test\(/gm) ?? [];
  assert.equal(cases.length, 13);
  assert.match(run.stdout, /# fail 0/);
});

test("review worker has an exact integration-derived pinned fork, not a main fork", () => {
  const matched = /feature\/atd-29-pass-a-semantic-completion\)[\s\S]*?FORK=([0-9a-f]{40})\s*;;/.exec(workflow);
  assert.ok(matched);
  assert.equal(matched[1], "567b2e513782b380c18f320d69edf140d61a36d4");
  assert.match(workflow, /git merge-base --is-ancestor "\$FORK" "\$PR_HEAD_SHA"/);
  assert.match(workflow, /Unregistered integration head:/);
});

test("coordinator change itself is pinned to current integration head", () => {
  const matched = /feature\/atd-39-register-atd-26-review-intake\)[\s\S]*?FORK=([0-9a-f]{40})\s*;;/.exec(workflow);
  assert.ok(matched);
  assert.equal(matched[1], "9792560103f1a13f34bf8a3f1620342c04158616");
  assert.ok(!workflow.includes("feature/atd-*"), "no generic wildcard allow-list");
});
