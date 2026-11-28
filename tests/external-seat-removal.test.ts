// URN: test:pi-atdd:manage-seats:atd-50-b01
// Acceptance: acc:pi-atdd:atd-50-b01
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { executionConfigFromEnv } from "../src/execution-seat.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";

const removedMessage = "external seat mode was removed in 0.6.0; start with atdd launch";

test("external execution mode refuses startup rather than falling back", () => {
  const env: NodeJS.ProcessEnv = {
    PI_ATDD_EXECUTION_MODE: "external", PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd",
    PI_ATDD_EXECUTION_TASK_ID: "ATD-50", PI_ATDD_EXECUTION_COACH_ADDRESS: "main@pi-atdd",
    PI_ATDD_EXECUTION_SEAT_ADDRESS: "driver@pi-atdd", PI_ATDD_EXECUTION_EXECUTION_ID: "run-a",
    PI_ATDD_EXECUTION_SESSION_ID: "session-a", PI_ATDD_EXECUTION_MODEL_ID: "provider/model",
    PI_ATDD_EXECUTION_GENERATION: "1", PI_ATDD_EXECUTION_OWNER_TOKEN: "token-a",
    ATDD_WORKFLOW_ROOT: "/tmp/flow-root",
  };
  for (const input of [env, { PI_ATDD_EXECUTION_MODE: "external" }]) {
    assert.throws(() => executionConfigFromEnv(input), (error: unknown) =>
      error instanceof Error && error.message === removedMessage);
  }
});

test("external-mode startup registers a refusal and blocks tools", () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const pi = { on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler) };
  assert.equal(registerSeatExecution(pi as never, { PI_ATDD_EXECUTION_MODE: "external" }), undefined);
  let message = "";
  handlers.get("session_start")!({}, { ui: { notify: (text: string) => { message = text; } } });
  assert.ok(message.includes(removedMessage));
  const result = handlers.get("tool_call")!();
  assert.equal(result.block, true);
  assert.ok(result.reason.includes(removedMessage));
});

test("production source has no legacy Flow runtime path or schema", () => {
  function check(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) check(path);
      else if (entry.isFile()) assert.doesNotMatch(readFileSync(path, "utf8"), /\.atdd-flow|atdd-flow\//, path);
    }
  }
  check(fileURLToPath(new URL("../src/", import.meta.url)));
});
