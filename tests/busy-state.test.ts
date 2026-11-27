// URN: test:pi-atdd:hand-off-context:plt-121-a01
// Acceptance: acc:pi-atdd:plt-121-a01
// PLT-121: the pi-atdd extension writes a per-identity busy/idle state file so the relaunch script can read a
// real idle signal. Tests: state follows the run lifecycle; a dead pid is unknown; a busy record that stops
// getting turn events goes stale (unknown) instead of sticking; the file name is one shared derivation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STALE_MS, busyStateFile, readBusyState, registerBusyState, stateName, writeBusyState } from "../src/busy-state.ts";

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

const T0 = Date.parse("2026-11-21T20:00:00.000Z");
const ISO = (ms: number) => new Date(ms).toISOString();
const IDENT = "forge-game-coach";

test("PLT-121 ACC-02: a fresh busy record reads as busy and an idle record as idle, from a live pid", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, IDENT);
    writeBusyState(file, "busy", process.pid, ISO(T0), IDENT);
    assert.equal(readBusyState(file, undefined, T0 + 1000), "busy");
    writeBusyState(file, "idle", process.pid, ISO(T0 + 5000), IDENT);
    assert.equal(readBusyState(file, undefined, T0 + 1000 + 3_600_000), "idle");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: the record holds state, pid, timestamp and identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, IDENT);
    writeBusyState(file, "busy", 4242, ISO(T0), IDENT);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { state: "busy", pid: 4242, at: ISO(T0), identity: IDENT });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: a busy record whose pid is dead counts as unknown, not busy", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, IDENT);
    writeBusyState(file, "busy", deadPid(), ISO(T0), IDENT);
    assert.equal(readBusyState(file, undefined, T0 + 1000), "unknown");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: a missing or malformed state file is unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, IDENT);
    assert.equal(readBusyState(file), "unknown");
    mkdirSync(join(dir, "attention"), { recursive: true });
    writeFileSync(file, "{not json");
    assert.equal(readBusyState(file), "unknown");
    writeFileSync(file, "null");
    assert.equal(readBusyState(file), "unknown");
    writeFileSync(file, JSON.stringify({ state: "sleeping", pid: process.pid, at: ISO(T0) }));
    assert.equal(readBusyState(file, undefined, T0), "unknown");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: a busy record older than STALE_MS is unknown even with a live pid (a preflight that threw never settled)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, IDENT);
    writeBusyState(file, "busy", process.pid, ISO(T0), IDENT);
    assert.equal(readBusyState(file, undefined, T0 + STALE_MS), "busy");
    assert.equal(readBusyState(file, undefined, T0 + STALE_MS + 1), "unknown");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: an idle record never expires, and a busy record with no timestamp is unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, IDENT);
    writeBusyState(file, "idle", process.pid, ISO(T0), IDENT);
    assert.equal(readBusyState(file, undefined, T0 + 365 * 24 * 3_600_000), "idle");
    writeFileSync(file, JSON.stringify({ state: "busy", pid: process.pid, identity: IDENT }));
    assert.equal(readBusyState(file, undefined, T0), "unknown");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: one shared name derivation: sha256 over the exact identity bytes, first 32 hex digits", () => {
  // Literals computed with: printf '%s' IDENT | shasum -a 256 | cut -c1-32 (the same rule relaunch-coach-v2.sh uses).
  assert.equal(stateName("forge-game-coach"), "18453c8ef4e80636384387d4df6f3251");
  assert.equal(stateName("Café 🚀"), "04a6eb2c6b294e87c215e9b7aee6ecc7");
  assert.equal(stateName(" Café 🚀 "), "37c519173a2f0dd93e06cd3d769da6b7");
  assert.notEqual(stateName(" Café 🚀 "), stateName("Café 🚀"));
  assert.equal(stateName("Café 🚀"), createHash("sha256").update("Café 🚀", "utf8").digest("hex").slice(0, 32));
  assert.equal(busyStateFile("/tmp/agent", IDENT), "/tmp/agent/attention/18453c8ef4e80636384387d4df6f3251.busy.json");
});

test("PLT-121: the extension marks busy when a run starts and idle when Pi has settled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const { pi, handlers } = fakePi();
    registerBusyState(pi, { PI_CODING_AGENT_DIR: dir, PI_ATDD_ATTENTION_IDENTITY: IDENT }, () => new Date(T0));
    const file = busyStateFile(dir, IDENT);
    await handlers.get("agent_start")!({}, {});
    assert.equal(readBusyState(file, undefined, T0), "busy");
    await handlers.get("agent_settled")!({ aborted: false }, {});
    assert.equal(readBusyState(file, undefined, T0), "idle");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, process.pid);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: agent_end alone does not mark idle, because Pi may still retry or continue", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const { pi, handlers } = fakePi();
    registerBusyState(pi, { PI_CODING_AGENT_DIR: dir, PI_ATDD_ATTENTION_IDENTITY: IDENT }, () => new Date(T0));
    await handlers.get("agent_start")!({}, {});
    await handlers.get("agent_end")?.({}, {});
    assert.equal(readBusyState(busyStateFile(dir, IDENT), undefined, T0), "busy");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-121: a before_agent_start followed by a throw and no settle expires; a turn heartbeat keeps a live run busy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-busy-"));
  try {
    const file = busyStateFile(dir, IDENT);
    // Stuck case: only before_agent_start ran; nothing else reaches us.
    const a = fakePi();
    registerBusyState(a.pi, { PI_CODING_AGENT_DIR: dir, PI_ATDD_ATTENTION_IDENTITY: IDENT }, () => new Date(T0));
    await a.handlers.get("before_agent_start")!({}, {});
    assert.equal(readBusyState(file, undefined, T0 + STALE_MS - 1), "busy");
    assert.equal(readBusyState(file, undefined, T0 + STALE_MS + 1), "unknown");
    // Live case: a turn starts at T0+9min, so at T0+15min the record is 6 minutes old and still busy.
    const b = fakePi();
    registerBusyState(b.pi, { PI_CODING_AGENT_DIR: dir, PI_ATDD_ATTENTION_IDENTITY: IDENT }, () => new Date(T0 + 9 * 60_000));
    await b.handlers.get("turn_start")!({}, {});
    assert.equal(readBusyState(file, undefined, T0 + 15 * 60_000), "busy");
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
