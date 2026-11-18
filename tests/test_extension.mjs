import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
