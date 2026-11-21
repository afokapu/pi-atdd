// URN: test:pi-atdd:execution-seat:PLT-117
// Acceptance: acc:pi-atdd:PLT-117-A02
// Acceptance: acc:pi-atdd:PLT-117-A03
// Acceptance: acc:pi-atdd:PLT-117-A04
// Acceptance: acc:pi-atdd:PLT-117-A05
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapSeat, claimSeatHolder, executionConfigFromEnv, ownsExecution, readSeatLease,
  recordSeatCheckpoint, recordSeatModel, replaceSeat, resumeSeatFromCheckpoint, vcsHead } from "../src/execution-seat.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";
import { ExtensionRunner, ModelRegistry, ModelRuntime, SessionManager,
  createExtensionRuntime, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

function world() {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-seat-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "proof.txt"), "revision one\n");
  execFileSync("git", ["-C", repo, "add", "proof.txt"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=ATDD Test", "-c", "user.email=test@example.invalid",
    "commit", "-qm", "initial"]);
  const env: NodeJS.ProcessEnv = {
    PI_CODING_AGENT_DIR: root, PI_ATDD_EXECUTION_MODE: "standalone",
    PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd", PI_ATDD_EXECUTION_TASK_ID: "PLT-117",
    PI_ATDD_EXECUTION_COACH_ADDRESS: "main@pi-atdd",
    PI_ATDD_EXECUTION_SEAT_ADDRESS: "driver.one@pi-atdd",
    PI_ATDD_EXECUTION_EXECUTION_ID: "run-a", PI_ATDD_EXECUTION_SESSION_ID: "session-a",
    PI_ATDD_EXECUTION_MODEL_ID: "provider/model-a", PI_ATDD_EXECUTION_GENERATION: "1",
    PI_ATDD_EXECUTION_OWNER_TOKEN: "owner-token-a",
  };
  const config = executionConfigFromEnv(env)!;
  return { root, repo, env, config, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const verified = { state: "verified" as const, pendingIds: ["ati_123456789abc"] };

test("PLT-117 A03: initial lease is create-only, exact and idempotent", () => {
  const w = world();
  try {
    bootstrapSeat(w.config);
    assert.equal(ownsExecution(w.config, "session-a"), true);
    assert.equal(ownsExecution(w.config, "session-b"), false);
    assert.equal(readSeatLease(w.config.leasePath)?.generation, 1);
    bootstrapSeat(w.config); // same launcher can retry
    assert.throws(() => bootstrapSeat({ ...w.config, binding: { ...w.config.binding,
      executionId: "intruder" } }), /already assigned/);
  } finally { w.cleanup(); }
});

test("PLT-117 A03: in-place model switch preserves owner and blocks stale writers", () => {
  const w = world();
  try {
    bootstrapSeat(w.config);
    const changed = recordSeatModel(w.config, "session-a", "provider/model-b");
    assert.equal(changed.binding.modelId, "provider/model-b");
    assert.equal(changed.binding.generation, 1);
    assert.equal(ownsExecution(changed, "session-a"), true);
    assert.throws(() => recordSeatModel(w.config, "session-b", "model-c"), /stale/);
  } finally { w.cleanup(); }
});

test("PLT-117 A04: checkpoint pins real git head, and replacement fences old session", () => {
  const w = world();
  try {
    bootstrapSeat(w.config);
    const cp = recordSeatCheckpoint(w.config, "session-a", w.repo, verified);
    assert.deepEqual(cp.revision, vcsHead(w.repo));
    assert.equal(cp.acceptance, "unknown");
    const next = replaceSeat(w.config, { nextSessionId: "session-b", modelId: "provider/model-b",
      checkpoint: cp, observedHead: cp.revision.head, sourceSettled: true, recoveryAuthorized: false });
    assert.equal(next.binding.generation, 2);
    assert.equal(next.binding.taskId, "PLT-117");
    assert.equal(next.binding.coachAddress, "main@pi-atdd");
    assert.equal(ownsExecution(w.config, "session-a"), false);
    assert.equal(ownsExecution(next, "session-b"), true);
    assert.throws(() => replaceSeat(w.config, { nextSessionId: "session-c", modelId: "model-c",
      checkpoint: cp, observedHead: cp.revision.head, sourceSettled: true, recoveryAuthorized: false }), /changed/);
  } finally { w.cleanup(); }
});

test("PLT-117 A04/A05: unknown attention, wrong git head and active source fail closed", () => {
  const w = world();
  try {
    bootstrapSeat(w.config);
    const cp = recordSeatCheckpoint(w.config, "session-a", w.repo,
      { state: "unknown", pendingIds: [] });
    const input = { nextSessionId: "session-b", modelId: "provider/model-b",
      checkpoint: cp, observedHead: cp.revision.head, sourceSettled: true, recoveryAuthorized: false };
    assert.throws(() => replaceSeat(w.config, input), /attention/);
    assert.throws(() => replaceSeat(w.config, { ...input,
      checkpoint: { ...cp, attention: verified }, observedHead: "different" }), /revision/);
    assert.throws(() => replaceSeat(w.config, { ...input,
      checkpoint: { ...cp, attention: verified }, sourceSettled: false }), /not settled/);
    assert.equal(ownsExecution(w.config, "session-a"), true);
  } finally { w.cleanup(); }
});

test("PLT-117 A03: external authority cannot be minted or replaced by standalone Pi", () => {
  const w = world();
  try {
    const external = { ...w.config, mode: "external" as const };
    assert.throws(() => bootstrapSeat(external), /external/);
    assert.throws(() => replaceSeat(external, { nextSessionId: "s2", modelId: "m2",
      checkpoint: {} as never, observedHead: "rev", sourceSettled: true, recoveryAuthorized: false }), /Flow/);
  } finally { w.cleanup(); }
});

test("PLT-117 A03/A04: Pi hook blocks stale sessions and authorizes verified successor", () => {
  const w = world();
  try {
    const handlers = new Map<string, Array<(e: any, c: any) => unknown>>();
    const pi = { on: (k: string, f: any) => handlers.set(k, [...(handlers.get(k) || []), f]),
      registerCommand: () => {} };
    bootstrapSeat(w.config); // the launcher provisions the receipt before Pi starts
    const controller = registerSeatExecution(pi as any, w.env)!;
    const context = (id: string) => ({ cwd: w.repo, model: { provider: "provider", id: "model-a" },
      isProjectTrusted: () => true, sessionManager: { getSessionId: () => id },
      ui: { notify: () => {} } });
    const call = (hook: string, ctx: ReturnType<typeof context>) =>
      (handlers.get(hook) ?? []).map(f => f({}, ctx));
    call("session_start", context("session-a"));
    assert.equal(controller.owns(context("session-a")), true);
    assert.deepEqual(call("tool_call", context("session-b"))[0], {
      block: true, reason: "ATDD execution seat is unowned, untrusted or superseded. The launcher must restore the current lease.",
    });
    const checkpoint = controller.checkpoint(context("session-a"), verified);
    controller.activateSuccessor(context("session-b"), checkpoint);
    assert.equal(controller.owns(context("session-a")), false);
    assert.equal(controller.owns(context("session-b")), true);
    assert.equal(call("tool_call", context("session-b"))[0], undefined);
  } finally { w.cleanup(); }
});

test("PLT-117 A03: Flow adapter reads the authoritative seat, task and owner token", () => {
  const w = world();
  try {
    const desk = join(w.root, "flow");
    const config = executionConfigFromEnv({ ...w.env, PI_ATDD_EXECUTION_MODE: "external",
      ATDD_WORKFLOW_ROOT: desk })!;
    mkdirSync(join(desk, ".atdd-flow", "pi-runtime"), { recursive: true });
    mkdirSync(join(desk, "work", "pi-atdd", "seats", "driver.one"), { recursive: true });
    mkdirSync(join(desk, "work", "pi-atdd", "tasks"), { recursive: true });
    writeFileSync(config.leasePath, [
      "schema: atdd-flow/pi-runtime-state/v1", "seat: driver.one@pi-atdd",
      "owner_token: owner-token-a", "pi_session: session-a", "",
    ].join("\n"));
    writeFileSync(join(desk, "work", "pi-atdd", "seats", "driver.one", "seat.yaml"), [
      "schema: atdd-workflow/seat/v1", "address: driver.one@pi-atdd",
      "project: pi-atdd", "runtime:", "  pi_session: session-a", "",
    ].join("\n"));
    const taskFile = join(desk, "work", "pi-atdd", "tasks", "PLT-117.yaml");
    writeFileSync(taskFile, [
      "schema: atdd-workflow/task/v1", "coordinator: main@pi-atdd",
      "assignee: driver.one@pi-atdd", "status: in_progress", "",
    ].join("\n"));
    assert.equal(ownsExecution(config, "session-a"), true);
    assert.equal(ownsExecution(config, "session-b"), false);
    assert.equal(ownsExecution({ ...config, binding: { ...config.binding, ownerToken: "stale" } }, "session-a"), false);
    writeFileSync(taskFile, [
      "schema: atdd-workflow/task/v1", "coordinator: main@pi-atdd",
      "assignee: driver.other@pi-atdd", "status: in_progress", "",
    ].join("\n"));
    assert.equal(ownsExecution(config, "session-a"), false);
  } finally { w.cleanup(); }
});

test("PLT-117 A02: project Coach seat is authorized across tasks without one task assignment", () => {
  const w = world();
  try {
    const desk = join(w.root, "flow");
    const config = executionConfigFromEnv({ ...w.env, PI_ATDD_EXECUTION_MODE: "external",
      PI_ATDD_EXECUTION_TASK_ID: "*", PI_ATDD_EXECUTION_SEAT_ADDRESS: "main@pi-atdd",
      ATDD_WORKFLOW_ROOT: desk })!;
    mkdirSync(join(desk, ".atdd-flow", "pi-runtime"), { recursive: true });
    mkdirSync(join(desk, "work", "pi-atdd", "seats", "main"), { recursive: true });
    writeFileSync(config.leasePath, [
      "schema: atdd-flow/pi-runtime-state/v1", "seat: main@pi-atdd",
      "owner_token: owner-token-a", "pi_session: session-a", "",
    ].join("\n"));
    writeFileSync(join(desk, "work", "pi-atdd", "seats", "main", "seat.yaml"), [
      "schema: atdd-workflow/seat/v1", "address: main@pi-atdd", "role: main",
      "project: pi-atdd", "runtime:", "  pi_session: session-a", "",
    ].join("\n"));
    assert.equal(ownsExecution(config, "session-a"), true);
    assert.equal(ownsExecution({ ...config, binding: { ...config.binding,
      ownerToken: "obsolete" } }, "session-a"), false);
    assert.equal(ownsExecution({ ...config, binding: { ...config.binding,
      sessionId: "not-current" } }, "not-current"), false);
  } finally { w.cleanup(); }
});

// PLT-117 review fixes: launcher-provisioned authority, restart recovery, real Pi events.
const here = dirname(fileURLToPath(import.meta.url));
const verifiedWork = { state: "verified" as const, pendingIds: ["ati_123456789abc"] };
const ctxFor = (repo: string, id: string) => ({ cwd: repo, model: { provider: "provider", id: "model-a" },
  isProjectTrusted: () => true, sessionManager: { getSessionId: () => id }, ui: { notify: () => {} } });
function piHooks(env: NodeJS.ProcessEnv) {
  const handlers = new Map<string, Array<(e: any, c: any) => unknown>>();
  const pi = { on: (k: string, f: any) => handlers.set(k, [...(handlers.get(k) || []), f]),
    registerCommand: () => {} };
  const controller = registerSeatExecution(pi as any, env)!;
  const call = (hook: string, ctx: unknown): any[] => (handlers.get(hook) ?? []).map(f => f({}, ctx));
  return { controller, call };
}
/** A real process that dies by SIGKILL between checkpoint and lease CAS (or before any checkpoint). */
function crashAt(w: ReturnType<typeof world>, stage: "before-checkpoint" | "after-checkpoint") {
  const r = spawnSync(process.execPath, ["--experimental-strip-types",
    join(here, "fixtures", "seat-crash-child.ts"), w.repo, stage], { env: w.env, encoding: "utf8" });
  assert.equal(r.signal, "SIGKILL", r.stderr);
}

test("PLT-117 A03: Pi never mints a seat from launch environment; only a launcher-provisioned lease is adopted", () => {
  const w = world();
  try {
    const minting = piHooks({ ...w.env, PI_ATDD_EXECUTION_BOOTSTRAP: "1" });
    minting.call("session_start", ctxFor(w.repo, "session-a"));
    assert.equal(existsSync(w.config.leasePath), false, "env alone must not create a lease");
    assert.equal(minting.controller.owns(ctxFor(w.repo, "session-a")), false);
    assert.equal(minting.call("tool_call", ctxFor(w.repo, "session-a"))[0]?.block, true);
    const resuming = piHooks({ ...w.env, PI_ATDD_EXECUTION_RESUME: "1" });
    resuming.call("session_start", ctxFor(w.repo, "session-a"));
    assert.equal(existsSync(w.config.leasePath), false, "resume without a checkpoint must not mint either");
  } finally { w.cleanup(); }
});

test("PLT-117 A04/A05: a restart between checkpoint and lease CAS resumes from the verified checkpoint", () => {
  const w = world();
  try {
    bootstrapSeat(w.config);
    crashAt(w, "after-checkpoint");
    assert.equal(readSeatLease(w.config.leasePath)?.sessionId, "session-a", "the CAS never happened");
    const next = resumeSeatFromCheckpoint(w.config, { nextSessionId: "session-b",
      modelId: "provider/model-b", cwd: w.repo });
    assert.equal(next.binding.generation, 2);
    assert.equal(next.binding.sessionId, "session-b");
    assert.notEqual(next.binding.executionId, "run-a");
    assert.equal(ownsExecution(next, "session-b"), true);
    assert.equal(ownsExecution(w.config, "session-a"), false);
    assert.throws(() => resumeSeatFromCheckpoint(w.config, { nextSessionId: "session-c",
      modelId: "provider/model-c", cwd: w.repo }), /does not match the current seat lease/);
  } finally { w.cleanup(); }
});

test("PLT-117 A04: relaunched Pi resumes at session start only when the launcher asks, and tools stay blocked otherwise", () => {
  const w = world();
  try {
    bootstrapSeat(w.config);
    crashAt(w, "after-checkpoint");
    const plain = piHooks(w.env);
    plain.call("session_start", ctxFor(w.repo, "session-b"));
    assert.equal(plain.call("tool_call", ctxFor(w.repo, "session-b"))[0]?.block, true);
    assert.equal(readSeatLease(w.config.leasePath)?.sessionId, "session-a");
    const resumed = piHooks({ ...w.env, PI_ATDD_EXECUTION_RESUME: "1" });
    resumed.call("session_start", ctxFor(w.repo, "session-b"));
    assert.equal(resumed.controller.owns(ctxFor(w.repo, "session-b")), true);
    assert.equal(resumed.call("tool_call", ctxFor(w.repo, "session-b"))[0], undefined);
    assert.equal(readSeatLease(w.config.leasePath)?.generation, 2);
  } finally { w.cleanup(); }
});

test("PLT-117 A04/A05: recovery is refused while the recorded holder lives, without a checkpoint, or after the head moved", () => {
  const live = world();
  try {
    bootstrapSeat(live.config); // the recorded holder is this test process, which is alive
    recordSeatCheckpoint(live.config, "session-a", live.repo, verifiedWork);
    assert.throws(() => resumeSeatFromCheckpoint(live.config, { nextSessionId: "session-b",
      modelId: "provider/model-b", cwd: live.repo }), /may still be running/);
  } finally { live.cleanup(); }

  const none = world();
  try {
    bootstrapSeat(none.config);
    crashAt(none, "before-checkpoint");
    assert.throws(() => resumeSeatFromCheckpoint(none.config, { nextSessionId: "session-b",
      modelId: "provider/model-b", cwd: none.repo }), /checkpoint/);
  } finally { none.cleanup(); }

  const moved = world();
  try {
    bootstrapSeat(moved.config);
    crashAt(moved, "after-checkpoint");
    writeFileSync(join(moved.repo, "later.txt"), "a later revision\n");
    execFileSync("git", ["-C", moved.repo, "add", "later.txt"]);
    execFileSync("git", ["-C", moved.repo, "-c", "user.name=ATDD Test", "-c", "user.email=test@example.invalid",
      "commit", "-qm", "later"]);
    assert.throws(() => resumeSeatFromCheckpoint(moved.config, { nextSessionId: "session-b",
      modelId: "provider/model-b", cwd: moved.repo }), /revision/);
    assert.equal(readSeatLease(moved.config.leasePath)?.sessionId, "session-a");
  } finally { moved.cleanup(); }
});

test("PLT-117 A02: the real Pi model_select event persists an in-place model switch", async () => {
  const w = world();
  const saved = { ...process.env };
  try {
    // The session id comes from Pi's own SessionManager, so the binding is the real runtime's.
    const sessionManager = SessionManager.inMemory(w.repo);
    const sessionId = sessionManager.getSessionId();
    const env = { ...w.env, PI_ATDD_EXECUTION_SESSION_ID: sessionId };
    const config = executionConfigFromEnv(env)!;
    bootstrapSeat(config);
    // Load the seat hooks through Pi's real extension loader and dispatch through its real runner.
    Object.assign(process.env, env);
    const loaded = await discoverAndLoadExtensions([join(here, "fixtures", "seat-extension.ts")], w.repo, w.root);
    assert.deepEqual(loaded.errors, []);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime ?? createExtensionRuntime(), w.repo,
      sessionManager, new ModelRegistry(await ModelRuntime.create()));
    // Pi emits this exact event from AgentSession.setModel and model cycling.
    await runner.emit({ type: "model_select", model: { provider: "provider", id: "model-b" } as never,
      previousModel: undefined, source: "set" });
    const lease = readSeatLease(config.leasePath);
    assert.equal(lease?.modelId, "provider/model-b");
    assert.equal(lease?.sessionId, sessionId);
    assert.equal(lease?.generation, 1);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    w.cleanup();
  }
});
