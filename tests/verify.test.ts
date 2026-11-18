import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifyTargets } from "../src/verify.ts";

const here = dirname(fileURLToPath(import.meta.url));
test("selected TypeScript/JS test does not execute unrelated failing tests", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-verify-"));
  try {
    mkdirSync(join(cwd, "tests"));
    writeFileSync(join(cwd, "tests/pass.test.mjs"),
      'import { test } from "node:test"; import assert from "node:assert/strict"; test("pass",()=>assert.equal(2+2,4));');
    writeFileSync(join(cwd, "tests/fail.test.mjs"),
      'import { test } from "node:test"; test("fail",()=>{ throw new Error("must not run"); });');
    const good = verifyTargets(cwd, ["tests/pass.test.mjs"]);
    assert.equal(good.status, "passed", good.stderr);
    assert.deepEqual(good.targets, ["tests/pass.test.mjs"]);
    const bad = verifyTargets(cwd, ["tests/fail.test.mjs"]);
    assert.equal(bad.status, "failed");
    assert.notEqual(bad.exitCode, 0);
    const cli = spawnSync(process.execPath, ["--experimental-strip-types", resolve(here, "../src/cli.ts"),
      "--repo", cwd, "verify", "--target", "tests/pass.test.mjs"], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    assert.equal(JSON.parse(cli.stdout).status, "passed");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("invalid paths, missing tests, and option injection are rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-negative-"));
  try {
    assert.throws(() => verifyTargets(cwd, []), /explicit test targets/);
    for (const path of ["../escape.test.ts", "/tmp/escape.test.ts", "--test", "tests/missing.test.ts", "package.json"]) {
      assert.throws(() => verifyTargets(cwd, [path]));
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("bounded execution times out instead of waiting on a hung test", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-timeout-"));
  try {
    writeFileSync(join(cwd, "wait.test.mjs"),
      'import { test } from "node:test"; test("hang",async()=>{ await new Promise(resolve => setTimeout(resolve, 10000)); });');
    const evidence = verifyTargets(cwd, ["wait.test.mjs"], { timeoutMs: 1000 });
    assert.equal(evidence.status, "timed_out");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
