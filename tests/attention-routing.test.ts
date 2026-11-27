// URN: test:pi-atdd:attention-routing:PLT-118
// Acceptance: acc:pi-atdd:plt-118-a01
// Acceptance: acc:pi-atdd:plt-118-a02
// Pure routing tests; live spool, lease-fencing, and Pi wake integration remain pending.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readAttentionRouteBinding,
  routeFromWorkerBinding,
  coachOwnsAttention,
  taskOwnsAttention,
  type RoutedAttention,
} from "../src/attention-routing.ts";

const coachA = { role: "coach" as const, profile: "forge", projectId: "pi-atdd", coachAddress: "main@pi-atdd" };
const coachB = { ...coachA, coachAddress: "coordinator.reviews@pi-atdd" };
const worker = { role: "worker" as const, profile: "forge", projectId: "pi-atdd", coachAddress: coachA.coachAddress,
  taskId: "PLT-118", executionId: "run-42" };
const item: RoutedAttention = { route: routeFromWorkerBinding(worker) };

test("PLT-118 A01: only one accountable coach receives an item in a shared profile", () => {
  assert.equal(coachOwnsAttention(item, coachA), true);
  assert.equal(coachOwnsAttention(item, coachB), false);
  assert.equal(coachOwnsAttention(item, { ...coachA, projectId: "other" }), false);
  assert.equal(coachOwnsAttention(item, { ...coachA, profile: "personal" }), false);
});

test("PLT-118 A01: no-recipient legacy or partial records are not disclosed in routed mode", () => {
  assert.equal(coachOwnsAttention({}, coachA), false);
  assert.equal(coachOwnsAttention({ route: null as unknown as NonNullable<RoutedAttention["route"]> }, coachA), false);
  assert.equal(coachOwnsAttention({ route: { ...item.route!, coachAddress: "" } }, coachA), false);
  assert.equal(coachOwnsAttention({ route: { ...item.route!, taskId: "" } }, coachA), false);
});

test("PLT-118 A02: recipient and task are stamped from worker binding", () => {
  const route = routeFromWorkerBinding(worker);
  assert.deepEqual(route, { profile: "forge", projectId: "pi-atdd", taskId: "PLT-118",
    coachAddress: "main@pi-atdd", sourceExecutionId: "run-42" });
  assert.equal(taskOwnsAttention(item, { profile: "forge", projectId: "pi-atdd", taskId: "PLT-118",
    coachAddress: "main@pi-atdd" }), true);
  assert.equal(taskOwnsAttention(item, { profile: "forge", projectId: "pi-atdd", taskId: "PLT-999",
    coachAddress: "main@pi-atdd" }), false);
});

test("PLT-118 A02: all routing fields are mandatory if routing is enabled", () => {
  const env = { PI_ATDD_ATTENTION_PROFILE: "forge", PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd",
    PI_ATDD_ATTENTION_COACH_ADDRESS: "main@pi-atdd", PI_ATDD_ATTENTION_TASK_ID: "PLT-118",
    PI_ATDD_ATTENTION_EXECUTION_ID: "run-42" };
  assert.deepEqual(readAttentionRouteBinding(env, "worker"), worker);
  assert.deepEqual(readAttentionRouteBinding(env, "coach"), coachA);
  assert.equal(readAttentionRouteBinding({}, "worker"), undefined);
  assert.throws(() => readAttentionRouteBinding({ PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd" }, "worker"), /incomplete/);
  assert.throws(() => readAttentionRouteBinding({ ...env, PI_ATDD_ATTENTION_TASK_ID: "" }, "worker"), /incomplete/);
});

// PLT-118 review P1 A01/A02: a seat authorizes only the route it was assigned.
import { seatOwnsRoute } from "../src/attention-routing.ts";
test("PLT-118 review P1 A01/A02: seat-to-route matching is exact on project, coach, task and execution", () => {
  const coachRoute = { role: "coach" as const, profile: "forge", projectId: "pi-atdd", coachAddress: "main@pi-atdd" };
  const workerRoute = { role: "worker" as const, profile: "forge", projectId: "pi-atdd", coachAddress: "main@pi-atdd",
    taskId: "PLT-118", executionId: "run-42" };
  const projectSeat = { projectId: "pi-atdd", taskId: "*", coachAddress: "main@pi-atdd", executionId: "run-c" };
  const taskSeat = { projectId: "pi-atdd", taskId: "PLT-118", coachAddress: "main@pi-atdd", executionId: "run-42" };
  assert.equal(seatOwnsRoute(projectSeat, coachRoute), true);
  assert.equal(seatOwnsRoute(taskSeat, coachRoute), false);
  assert.equal(seatOwnsRoute(taskSeat, workerRoute), true);
  assert.equal(seatOwnsRoute(projectSeat, workerRoute), false);
  assert.equal(seatOwnsRoute({ ...taskSeat, taskId: "PLT-119" }, workerRoute), false);
  assert.equal(seatOwnsRoute({ ...taskSeat, executionId: "run-43" }, workerRoute), false);
  assert.equal(seatOwnsRoute({ ...taskSeat, coachAddress: "other@pi-atdd" }, workerRoute), false);
  assert.equal(seatOwnsRoute({ ...taskSeat, projectId: "other" }, workerRoute), false);
  assert.equal(seatOwnsRoute({ ...taskSeat, taskId: "*" }, workerRoute), false);
});
