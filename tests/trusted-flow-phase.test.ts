// URN: test:pi-atdd:incremental-inference:E002-UNIT-005-trusted-flow-phase
// Acceptance: acc:pi-atdd:E002-UNIT-001
// Acceptance: acc:pi-atdd:E002-UNIT-005
// Phase: UNIT
// Layer: application
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readTrustedFlowPhase, readEnvFlowPhase } from "../src/trusted-flow-phase.ts";
import type { SeatRuntimeConfig } from "../src/execution-seat.ts";

const session = "pi-session-atd-42";
const seatAddress = "driver.delivery@demo";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-flow-phase-"));
  const cwd = join(root, "delivery-worktree");
  mkdirSync(cwd, { recursive: true });
  const taskDir = join(root, "work", "demo", "tasks");
  mkdirSync(taskDir, { recursive: true });
  const file = join(taskDir, "delivery.yaml");
  const task = (status: string, phase?: string, assignee=seatAddress, blocker?:string) => {
    writeFileSync(file, stringify({
      schema: "atdd-workflow/task/v1", title: "Deliver feature", status,
      coordinator: "coordinator@demo", assignee,
      ...(phase ? { phase } : {}),
      ...(blocker ? { blocker } : {}),
      done_when: [{ text: "Feature works" }],
    }));
  };
  task("in_progress");

  // Match Flow's real launch receipt location, not a fictional root file.
  const receiptDir = join(root, ".atdd-flow", "runtime-launch");
  mkdirSync(receiptDir,{recursive:true});
  const receiptFile = join(receiptDir, session + "-receipt.yaml");
  const receipt = {
    schema: "atdd-flow/pi-runtime-launch-receipt/v1", seat: seatAddress,
    tasks: ["delivery"],
    pi_session: session, pi_session_path: join(root, "session.jsonl"),
    herdr_session: "forge", pane: "w1:p2",
  };
  writeFileSync(receiptFile, stringify(receipt));
  const seatFile = join(root, "work", "demo", "seats", "driver.delivery", "seat.yaml");
  mkdirSync(join(root, "work", "demo", "seats", "driver.delivery"), { recursive: true });
  const record = {
    schema: "atdd-workflow/seat/v2", address: seatAddress, role: "driver",
    project: "demo", worktree: cwd, branch: "delivery/test",
    runtime: {
      application: "herdr", wake: "native",
      addresses: { herdr: { session: "forge", pane: "w1:p2" } },
      pi_session: session, pi_session_path: receipt.pi_session_path,
      launch_receipt: receiptFile,
    },
  };
  const writeSeat = (next=record) => writeFileSync(seatFile, stringify(next));
  writeSeat();
  const bound: SeatRuntimeConfig = {
    mode: "external", flowRoot: root,
    leasePath: join(root, "lease"), checkpointDir: join(root, "checkpoints"),
    binding: {
      projectId: "demo", taskId: "delivery", coachAddress: "coordinator@demo",
      seatAddress, executionId: "execution-1", sessionId: session,
      generation: 1, ownerToken: "token", modelId: "fixture-low",
    },
  };
  const env = {
    ATDD_WORKFLOW_ROOT: root, ATDD_WORKFLOW_SEAT: seatAddress,
    ATDD_FLOW_PI_SESSION: session, ATDD_FLOW_HERDR_SESSION: "forge",
    ATDD_FLOW_HERDR_PANE: "w1:p2",
  };
  const ctx = { cwd, sessionManager: { getSessionId: () => session } };
  return {
    root, cwd, file, task, receiptFile, receipt, seatFile, record, writeSeat, bound, env, ctx,
    finish: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("ATD-42: authenticated task supplies the current PLAN, RED, GREEN and REFACTOR facts", () => {
  const x=fixture();
  try {
    assert.equal(readTrustedFlowPhase(x.bound)?.phase, "PLAN");
    x.task("in_progress", "red");
    assert.equal(readTrustedFlowPhase(x.bound)?.phase, "RED");
    x.task("in_progress", "green");
    assert.equal(readTrustedFlowPhase(x.bound)?.phase, "GREEN");
    x.task("in_progress", "refactor");
    assert.equal(readTrustedFlowPhase(x.bound)?.phase, "REFACTOR");
    x.task("review", "refactor");
    assert.equal(readTrustedFlowPhase(x.bound), undefined);
    x.task("in_progress", "green", seatAddress, "waiting for a dependency");
    assert.equal(readTrustedFlowPhase(x.bound), undefined, "blocked work has no executable phase");
    assert.equal(readEnvFlowPhase(x.env, x.ctx), undefined, "native and leased paths agree");
  } finally { x.finish(); }
});

test("ATD-42: authenticated task refuses a foreign assignee or unknown phase", () => {
  const x=fixture();
  try {
    x.task("in_progress", "plan", "driver.other@demo");
    assert.throws(() => readTrustedFlowPhase(x.bound), /does not match/);
    x.task("in_progress", "invented");
    assert.throws(() => readTrustedFlowPhase(x.bound), /Unknown authoritative/);
    assert.equal(readTrustedFlowPhase({...x.bound, mode: "standalone"}), undefined);
    assert.equal(readTrustedFlowPhase({...x.bound, binding: {...x.bound.binding, taskId: "*"}}), undefined);
    x.writeSeat({...x.record, role:"coordinator"});
    assert.throws(() => readTrustedFlowPhase(x.bound, x.cwd), /active driver identity/);
    x.writeSeat();
    assert.throws(() => readTrustedFlowPhase(x.bound, x.root), /worktree does not match/);
  } finally { x.finish(); }
});

test("ATD-42: native Flow phase requires matching live session, worktree and launch receipt", () => {
  const x=fixture();
  try {
    assert.equal(readEnvFlowPhase(x.env, x.ctx)?.phase, "PLAN");
    x.task("in_progress", "green");
    assert.equal(readEnvFlowPhase(x.env, x.ctx)?.phase, "GREEN");
    x.task("review", "green");
    assert.equal(readEnvFlowPhase(x.env, x.ctx), undefined);
    assert.equal(readEnvFlowPhase({...x.env, ATDD_FLOW_PI_SESSION: undefined}, x.ctx), undefined);
    assert.equal(readEnvFlowPhase(x.env, {cwd:x.cwd}), undefined);
  } finally { x.finish(); }
});

test("ATD-42: stale or misbound Flow runtime never becomes an authoritative phase", () => {
  const x=fixture();
  try {
    assert.throws(() => readEnvFlowPhase(x.env, {
      ...x.ctx, sessionManager: {getSessionId: () => "superseded-pi-session"},
    }), /session does not match/);
    assert.throws(() => readEnvFlowPhase(x.env, {...x.ctx, cwd:x.root}), /worktree does not match/);
    x.writeSeat({...x.record, runtime: {...x.record.runtime, pi_session: "stale-session"}});
    assert.throws(() => readEnvFlowPhase(x.env, x.ctx), /runtime binding does not match/);
    x.writeSeat();
    writeFileSync(x.receiptFile, stringify({...x.receipt, pi_session: "stale-session"}));
    assert.throws(() => readEnvFlowPhase(x.env, x.ctx), /receipt does not match/);
    // Rebinding an assigned task without a new launch must not borrow phase authority.
    writeFileSync(x.receiptFile, stringify({...x.receipt, tasks:["unrelated"]}));
    assert.throws(() => readEnvFlowPhase(x.env, x.ctx), /did not authorize the active task/);
    x.writeSeat({...x.record, runtime: {...x.record.runtime, launch_receipt: ""}});
    assert.equal(readEnvFlowPhase(x.env, x.ctx), undefined, "missing receipt means unknown");
    const outside = join(x.root, "untrusted-receipt.yaml");
    writeFileSync(outside, stringify(x.receipt));
    x.writeSeat({...x.record, runtime: {...x.record.runtime, launch_receipt: outside}});
    assert.throws(() => readEnvFlowPhase(x.env, x.ctx), /outside the runtime-launch directory/);
  } finally { x.finish(); }
});

test("ATD-42: multiple assignments and foreign seats cannot select a trusted phase", () => {
  const x=fixture();
  try {
    writeFileSync(join(x.root, "work", "demo", "tasks", "second.yaml"), readFileSync(x.file));
    assert.throws(() => readEnvFlowPhase(x.env, x.ctx), /Several active Flow tasks/);
    assert.throws(() => readEnvFlowPhase({...x.env, ATDD_WORKFLOW_SEAT: "driver.other@demo"}, x.ctx), /ENOENT|Flow seat/);
  } finally { x.finish(); }
});
