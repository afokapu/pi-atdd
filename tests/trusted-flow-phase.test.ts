// Acceptance: PLT-128 — only the authenticated Flow task supplies phase facts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTrustedFlowPhase } from "../src/trusted-flow-phase.ts";
import type { SeatRuntimeConfig } from "../src/execution-seat.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-flow-phase-"));
  const dir = join(root, "work", "demo", "tasks");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "delivery.yaml");
  const task = (status: string, phase?: string, assignee="driver.delivery@demo") => {
    writeFileSync(file, [
      "schema: atdd-workflow/task/v1",
      "title: Deliver feature",
      "status: " + status,
      "coordinator: coordinator@demo",
      "assignee: " + assignee,
      ...(phase ? ["phase: " + phase] : []),
      "done_when:",
      "  - text: Feature works",
      "",
    ].join("\n"));
  };
  task("in_progress");
  const seat: SeatRuntimeConfig = {
    mode: "external",
    flowRoot: root,
    leasePath: join(root, "lease"),
    checkpointDir: join(root, "checkpoints"),
    binding: {
      projectId: "demo",
      taskId: "delivery",
      coachAddress: "coordinator@demo",
      seatAddress: "driver.delivery@demo",
      executionId: "execution-1",
      sessionId: "session-1",
      generation: 1,
      ownerToken: "token",
      modelId: "fixture-low",
    },
  };
  return { root, task, seat, finish: () => rmSync(root, { recursive: true, force: true }) };
}

test("PLT-128: trusted Flow task starts at PLAN then activates the current phase without guessing", () => {
  const x=fixture();
  try {
    assert.equal(readTrustedFlowPhase(x.seat)?.phase, "PLAN");
    x.task("in_progress","red");
    assert.equal(readTrustedFlowPhase(x.seat)?.phase,"RED");
    x.task("in_progress","green");
    assert.equal(readTrustedFlowPhase(x.seat)?.phase,"GREEN");
    x.task("in_progress","refactor");
    assert.equal(readTrustedFlowPhase(x.seat)?.phase,"REFACTOR");
    x.task("review","refactor");
    assert.equal(readTrustedFlowPhase(x.seat),undefined);
  } finally { x.finish(); }
});

test("PLT-128: Flow phase refuses mismatched task identity and unknown phases", () => {
  const x=fixture();
  try {
    x.task("in_progress","plan","driver.someone-else@demo");
    assert.throws(() => readTrustedFlowPhase(x.seat),/does not match/);
    x.task("in_progress","invented");
    assert.throws(() => readTrustedFlowPhase(x.seat),/Unknown authoritative/);
    assert.equal(readTrustedFlowPhase({...x.seat, mode:"standalone"}),undefined);
    assert.equal(readTrustedFlowPhase({...x.seat, binding:{...x.seat.binding, taskId:"*"}}),undefined);
  } finally { x.finish(); }
});
