// URN: test:pi-atdd:execution-lifecycle:PLT-117
// Acceptance: acc:pi-atdd:PLT-117-A01
// Acceptance: acc:pi-atdd:PLT-117-A02
// Acceptance: acc:pi-atdd:PLT-117-A03
// Acceptance: acc:pi-atdd:PLT-117-A04
// Pure contract tests; real Pi/Flow adapters and concurrency evidence remain pending.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideExecutionTransition,
  matchesSeatLease,
  type ExecutionBinding,
  type TransitionInput,
} from "../src/execution-lifecycle.ts";

const source: ExecutionBinding = {
  projectId: "pi-atdd", taskId: "PLT-117", coachAddress: "coach@pi-atdd",
  seatAddress: "driver.impl@pi-atdd", executionId: "run-a",
  sessionId: "pi-session-a", modelId: "model-a", generation: 4, ownerToken: "token-a",
};
const owner = {
  seatAddress: source.seatAddress, sessionId: source.sessionId,
  generation: source.generation, ownerToken: source.ownerToken,
};
const next: ExecutionBinding = {
  ...source, executionId: "run-b", sessionId: "pi-session-b",
  modelId: "model-b", generation: 5, ownerToken: "token-b",
};
const checkpoint = {
  schema: "pi-atdd/execution-checkpoint/v1" as const,
  projectId: source.projectId, taskId: source.taskId,
  coachAddress: source.coachAddress, seatAddress: source.seatAddress,
  sourceExecutionId: source.executionId, sourceSessionId: source.sessionId,
  revision: { vcs: "git" as const, head: "0123456789abcdef" },
  acceptance: "unknown" as const,
  attention: { state: "verified" as const, pendingIds: ["ati_000000000001"] },
};
const common = { source, next, observedOwner: owner,
  checkpoint, observedHead: "0123456789abcdef" };
const decide = (overrides: Partial<TransitionInput> = {}) =>
  decideExecutionTransition({ kind: "replace_session", sourceSettled: true, recoveryAuthorized: false, ...common, ...overrides });

test("PLT-117 A03: only the exact current lease owns a seat", () => {
  assert.equal(matchesSeatLease(source, owner), true);
  assert.equal(matchesSeatLease(source, { ...owner, ownerToken: "stale" }), false);
  assert.equal(matchesSeatLease(source, { ...owner, generation: 3 }), false);
  assert.equal(matchesSeatLease(source, { ...owner, sessionId: "different" }), false);
  assert.equal(matchesSeatLease(source, { ...owner, seatAddress: "another@pi-atdd" }), false);
  assert.equal(matchesSeatLease(source, null as unknown as typeof owner), false);
});

test("PLT-117 A02/A04: replacement retains the task and coach, but changes execution ownership", () => {
  const decision = decide();
  assert.deepEqual(decision, {
    status: "allow", fencePrevious: true, checkpointAcceptance: "unknown",
    pendingAttentionIds: ["ati_000000000001"],
  });
  assert.equal(checkpoint.taskId, next.taskId);
  assert.equal(checkpoint.coachAddress, next.coachAddress);
});

test("PLT-117 A03: stale ownership or mismatched task/coaching destination is held", () => {
  assert.equal(decide({ observedOwner: { ...owner, ownerToken: "stale" } }).status, "hold");
  assert.equal(decide({ next: { ...next, taskId: "PLT-999" } }).status, "hold");
  assert.equal(decide({ next: { ...next, coachAddress: "coach@other" } }).status, "hold");
  assert.equal(decide({ next: { ...next, seatAddress: "driver.other@pi-atdd" } }).status, "hold");
  assert.equal(decide({ next: { ...next, generation: 4 } }).status, "hold");
  assert.equal(decide({ next: { ...next, ownerToken: source.ownerToken } }).status, "hold");
});

test("PLT-117 A04: a fresh session must prove the exact source revision and pending attention", () => {
  assert.equal(decide({ observedHead: "different-revision" }).status, "hold");
  assert.equal(decide({ checkpoint: { ...checkpoint, attention: { state: "unknown", pendingIds: [] } } }).status, "hold");
  assert.equal(decide({ checkpoint: { ...checkpoint, sourceSessionId: "unrelated" } }).status, "hold");
  assert.equal(decide({ checkpoint: { ...checkpoint, taskId: "wrong" } }).status, "hold");
  assert.equal(decide({ checkpoint: null as unknown as typeof checkpoint }).status, "hold");
});

test("PLT-117 A05: an interrupted source requires explicit recovery authorization", () => {
  assert.equal(decide({ sourceSettled: false, recoveryAuthorized: false }).status, "hold");
  assert.equal(decide({ sourceSettled: false, recoveryAuthorized: true }).status, "allow");
});

test("PLT-117 A03: switching model in place retains the exact execution lease", () => {
  const switched: ExecutionBinding = { ...source, modelId: "model-b" };
  const result = decideExecutionTransition({ kind: "switch_model", source, next: switched, observedOwner: owner });
  assert.deepEqual(result, { status: "allow", fencePrevious: false });
  assert.equal(decideExecutionTransition({ kind: "switch_model", source, next, observedOwner: owner }).status, "hold");
  assert.equal(decideExecutionTransition({ kind: "switch_model", source, next: switched,
    observedOwner: { ...owner, generation: 6 } }).status, "hold");
});
