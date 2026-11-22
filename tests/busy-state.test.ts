// PLT-121: the pi-atdd extension writes a per-identity busy/idle state file so the relaunch script can
// read a real idle signal. Tests first: state changes follow the run lifecycle, a dead pid is unknown,
// and the wiring stays inert without a launch identity.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { busyStateFile, readBusyState, registerBusyState, writeBusyState } from "../src/busy-state.ts";

// A pid of a process that has already exited: spawnSync returns it only after the child is gone.
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(r.pid && r.pid > 0);
  return r.pid;
}

function fakePi() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  return { handlers, pi: { on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, fn) } as any };
}

test("PLT-121 ACC-02: a busy record reads as busy and an idle record as idle, from a live pid", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, "forge-game-coach");
    writeBusyState(file, "busy", process.pid, "2026-11-21T20:00:00.000Z", "forge-game-coach");
    assert.equal(readBusyState(file), "busy");
    writeBusyState(file, "idle", process.pid, "2026-11-21T20:00:05.000Z", "forge-game-coach");
    assert.equal(readBusyState(file), "idle");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: the record holds state, pid, timestamp and identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, "forge-game-coach");
    writeBusyState(file, "busy", 4242, "2026-11-21T20:00:00.000Z", "forge-game-coach");
    const rec = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(rec, { state: "busy", pid: 4242, at: "2026-11-21T20:00:00.000Z", identity: "forge-game-coach" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: a busy record whose pid is dead counts as unknown, not busy", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, "forge-game-coach");
    writeBusyState(file, "busy", deadPid(), "2026-11-21T20:00:00.000Z", "forge-game-coach");
    assert.equal(readBusyState(file), "unknown");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: a missing or malformed state file is unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, "forge-game-coach");
    assert.equal(readBusyState(file), "unknown");
    mkdirSync(join(dir, "attention"), { recursive: true });
    writeFileSync(file, "{not json");
    assert.equal(readBusyState(file), "unknown");
    writeFileSync(file, JSON.stringify({ state: "sleeping", pid: process.pid }));
    assert.equal(readBusyState(file), "unknown");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: the state file lives under attention/ and is named by the identity, sanitized", () => {
  assert.equal(busyStateFile("/tmp/agent", "forge-game-coach"), "/tmp/agent/attention/forge-game-coach.busy.json");
  assert.equal(busyStateFile("/tmp/agent", "Coach - pi-atdd"), "/tmp/agent/attention/Coach_-_pi-atdd.busy.json");
  assert.equal(busyStateFile("/tmp/agent", "../../etc"), "/tmp/agent/attention/.._.._etc.busy.json");
});

test("PLT-121: the extension marks busy when a run starts and idle when Pi has settled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const { pi, handlers } = fakePi();
    registerBusyState(pi, { PI_CODING_AGENT_DIR: dir, PI_ATDD_ATTENTION_IDENTITY: "forge-game-coach" });
    const file = busyStateFile(dir, "forge-game-coach");
    await handlers.get("agent_start")!({}, {});
    assert.equal(readBusyState(file), "busy");
    await handlers.get("agent_settled")!({ aborted: false }, {});
    assert.equal(readBusyState(file), "idle");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, process.pid);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: agent_end alone does not mark idle, because Pi may still retry or continue", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const { pi, handlers } = fakePi();
    registerBusyState(pi, { PI_CODING_AGENT_DIR: dir, PI_ATDD_ATTENTION_IDENTITY: "forge-game-coach" });
    await handlers.get("agent_start")!({}, {});
    await handlers.get("agent_end")?.({}, {});
    assert.equal(readBusyState(busyStateFile(dir, "forge-game-coach")), "busy");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: without a launch identity the wiring is inert and writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const { pi, handlers } = fakePi();
    registerBusyState(pi, { PI_CODING_AGENT_DIR: dir });
    assert.equal(handlers.size, 0);
    assert.equal(existsSync(join(dir, "attention")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
