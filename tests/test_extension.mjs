import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";

import atdd from "../extensions/atdd.ts";

test("Pi extension registers task-start and pre-edit handlers", async () => {
  const handlers = new Map();
  atdd({
    on(name, callback) {
      assert.equal(typeof callback, "function");
      handlers.set(name, callback);
    },
  });
  assert.equal(typeof handlers.get("before_agent_start"), "function");
  assert.equal(typeof handlers.get("tool_call"), "function");

  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-smoke-"));
  try {
    const ctx = { cwd, isProjectTrusted: () => true };
    // Unconfigured repositories must remain untouched.
    assert.equal(await handlers.get("before_agent_start")(
      { messageType: "user", prompt: "ordinary task" }, ctx,
    ), undefined);
    assert.equal(await handlers.get("tool_call")(
      { toolName: "edit", input: { path: "src/example.py" } }, ctx,
    ), undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});



test("real Python resolver activates once per rule and exposes unresolved edits", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-configured-"));
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = resolve(here, "../python/runner.py");
  try {
    cpSync(join(here, "fixtures/catalog"), join(cwd, "catalog"), { recursive: true });
    cpSync(join(here, "fixtures/selectors.yaml"), join(cwd, "selectors.yaml"));
    const digest = JSON.parse(execFileSync(
      process.env.ATDD_PYTHON || "python3", [cli, "--repo", cwd, "digest", "catalog"],
      { encoding: "utf8" },
    )).sha256;
    writeFileSync(join(cwd, "atdd-pi.yaml"),
      "schema: pi-atdd/config/v1\nsources:\n  - path: catalog\n    sha256: " +
      digest + "\nselectors: selectors.yaml\n");

    const handlers = new Map();
    atdd({ on(name, callback) { handlers.set(name, callback); } });
    const ctx = { cwd, isProjectTrusted: () => true };
    const first = await handlers.get("before_agent_start")(
      { messageType: "user", prompt: "Implement FastAPI authentication" }, ctx,
    );
    assert.match(first.message.content, /coder\.security\.missing-auth/);

    // Same convention was already announced at task-start, so no veto.
    const authEdit = await handlers.get("tool_call")(
      { toolName: "edit", input: { path: "src/routes/users.py" } }, ctx,
    );
    assert.equal(authEdit, undefined);

    const dbEdit = { toolName: "edit", input: { path: "src/database/orders.py" } };
    const preflight = await handlers.get("tool_call")(dbEdit, ctx);
    assert.equal(preflight.block, true);
    assert.match(preflight.reason, /coder\.refactor\.nplus1/);
    assert.equal(await handlers.get("tool_call")(dbEdit, ctx), undefined);

    const noRule = { toolName: "edit", input: { path: "docs/index.md" } };
    const gap = await handlers.get("tool_call")(noRule, ctx);
    assert.equal(gap.block, true);
    assert.match(gap.reason, /applicability is unknown/);
    assert.equal(await handlers.get("tool_call")(noRule, ctx), undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
