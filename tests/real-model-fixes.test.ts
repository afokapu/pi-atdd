// URN: test:pi-atdd:real-model-fixes:PLT-125
// Acceptance: acc:pi-atdd:PLT-125-A01
// Acceptance: acc:pi-atdd:PLT-125-A02
// Acceptance: acc:pi-atdd:PLT-125-A03
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { bootstrapSeat, executionConfigFromEnv, readSeatCheckpoint, readSeatLease } from "../src/execution-seat.ts";
import { appendSpool, ensureKey, newItem, readLaunchConfig, signEvent } from "../src/attention.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";
import { isKickoff, kickoffText } from "../src/context-handoff.ts";

const here = dirname(fileURLToPath(import.meta.url));

// ---- attention harness (same shape as routed-attention.test.ts) ----
function attention(root: string, role: "worker" | "coach", identity: string, run = "run-a") {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const entries: unknown[] = [];
  const pi = { on: (n: string, f: Function) => handlers.set(n, [...handlers.get(n) ?? [], f]),
    registerTool: (d: any) => tools.set(d.name, d), registerCommand: () => {},
    appendEntry: (t: string, d: unknown) => entries.push({ type: "custom", customType: t, data: d }),
    sendMessage: () => {} };
  const ctx = { isProjectTrusted: () => true, sessionManager: { getBranch: () => entries },
    ui: { setWidget: () => {}, notify: () => {} } };
  registerAttentionStrip(pi as any, { env: {
    PI_CODING_AGENT_DIR: root, PI_ATDD_ATTENTION_ROLE: role, PI_ATDD_ATTENTION_PROFILE: "forge",
    PI_ATDD_ATTENTION_IDENTITY: identity, PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd",
    PI_ATDD_ATTENTION_COACH_ADDRESS: "main@pi-atdd",
    ...(role === "worker" ? { PI_ATDD_ATTENTION_TASK_ID: "PLT-125", PI_ATDD_ATTENTION_EXECUTION_ID: run } : {}),
  }, now: () => new Date("2026-11-22T10:00:00Z"), pollMs: 5000, authorize: () => true,
    setInterval: (f: () => void) => f, clearInterval: () => {} });
  return { tool: (n: string, p: Record<string, unknown> = {}) => tools.get(n).execute("c", p, undefined, undefined, ctx),
    emit: async (n: string) => { for (const f of handlers.get(n) ?? []) await f({}, ctx); } };
}

test("PLT-125 A01: attention_list puts bounded item details in the model-visible content", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-125-a-"));
  try {
    const worker = attention(root, "worker", "worker-1");
    const coach = attention(root, "coach", "Coach A");
    const raised = await worker.tool("attention_raise", { type: "decision", summary: "choose the contract", issue: "PLT-125" });
    await coach.emit("session_start");
    const listed = await coach.tool("attention_list");
    const text: string = listed.content.map((c: { text: string }) => c.text).join("\n");
    assert.match(text, new RegExp(raised.details.id));
    assert.match(text, /decision/);
    assert.match(text, /choose the contract/);
    assert.match(text, /worker-1/);
    assert.match(text, /attention_resolve/, "tells the coach how to act");
    for (let i = 0; i < 40; i++) await worker.tool("attention_raise", { type: "review", summary: "item " + i + " " + "x".repeat(200) });
    const many: string = (await coach.tool("attention_list")).content[0].text;
    assert.ok(many.length < 12_000, "bounded: " + many.length);
    assert.match(many, /more/i, "says when the list is truncated");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- seat: real child killed mid-turn ----
function seatWorld() {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-125-s-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "proof.txt"), "one\n");
  execFileSync("git", ["-C", repo, "add", "proof.txt"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "i"]);
  const env: NodeJS.ProcessEnv = {
    PI_CODING_AGENT_DIR: root, PI_ATDD_EXECUTION_MODE: "standalone",
    PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd", PI_ATDD_EXECUTION_TASK_ID: "PLT-125",
    PI_ATDD_EXECUTION_COACH_ADDRESS: "main@pi-atdd", PI_ATDD_EXECUTION_SEAT_ADDRESS: "driver.one@pi-atdd",
    PI_ATDD_EXECUTION_EXECUTION_ID: "run-a", PI_ATDD_EXECUTION_SESSION_ID: "session-a",
    PI_ATDD_EXECUTION_MODEL_ID: "provider/model-a", PI_ATDD_EXECUTION_GENERATION: "1",
    PI_ATDD_EXECUTION_OWNER_TOKEN: "owner-token-a",
  };
  return { root, repo, env, config: executionConfigFromEnv(env)!, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const ctxFor = (repo: string, id: string) => ({ cwd: repo, model: { provider: "provider", id: "model-a" },
  isProjectTrusted: () => true, sessionManager: { getSessionId: () => id }, ui: { notify: () => {} } });
function hooks(env: NodeJS.ProcessEnv) {
  const handlers = new Map<string, Array<(e: any, c: any) => unknown>>();
  registerSeatExecution({ on: (k: string, f: any) => handlers.set(k, [...handlers.get(k) ?? [], f]), registerCommand: () => {} } as any, env);
  return (hook: string, ctx: unknown): any[] => (handlers.get(hook) ?? []).map(f => f({}, ctx));
}
function crashMidTurn(w: ReturnType<typeof seatWorld>, ...extra: string[]) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types",
    join(here, "fixtures", "seat-turn-crash-child.ts"), w.repo, ...extra], { env: w.env, encoding: "utf8" });
  assert.equal(r.signal, "SIGKILL", r.stderr);
}

test("PLT-125 A02: a run killed mid-turn after a settled turn resumes with pending items and UNKNOWN evidence", () => {
  const w = seatWorld();
  try {
    bootstrapSeat(w.config);
    const cfg = readLaunchConfig({ ...w.env, PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "main@pi-atdd",
      PI_ATDD_ATTENTION_PROFILE: "forge" });
    assert.ok(cfg);
    crashMidTurn(w);
    const cp = readSeatCheckpoint(w.config.checkpointDir, "run-a");
    assert.equal(cp.acceptance, "unknown");
    const call = hooks({ ...w.env, PI_ATDD_EXECUTION_RESUME: "1" });
    call("session_start", ctxFor(w.repo, "session-b"));
    assert.equal(readSeatLease(w.config.leasePath)?.generation, 2, "resumed as generation 2");
    const [started] = call("before_agent_start", ctxFor(w.repo, "session-b"));
    assert.match(started.message.content, /Acceptance UNKNOWN; grant UNKNOWN/);
    assert.match(started.message.content, /do not repeat completed actions/i);
  } finally { w.cleanup(); }
});

test("PLT-125 A02: attention raised after the settled turn is reported pending on resume", () => {
  const w = seatWorld();
  try {
    Object.assign(w.env, { PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "main@pi-atdd",
      PI_ATDD_ATTENTION_PROFILE: "forge" });
    bootstrapSeat(w.config);
    crashMidTurn(w);
    const lc = readLaunchConfig(w.env)!;
    const id = "ati_aaaaaaaaaaaa";
    appendSpool(lc.spool, signEvent({ event: "raised", item: { ...newItem({ type: "decision", summary: "need owner", issue: "PLT-125" }, lc, new Date()),
      id, route: { profile: "forge", projectId: "pi-atdd", taskId: "PLT-125", coachAddress: "main@pi-atdd", sourceExecutionId: "run-a" } } }, ensureKey(lc.keyPath)));
    const call = hooks({ ...w.env, PI_ATDD_EXECUTION_RESUME: "1" });
    call("session_start", ctxFor(w.repo, "session-b"));
    const [started] = call("before_agent_start", ctxFor(w.repo, "session-b"));
    assert.match(started.message.content, new RegExp("re-checked now\\): " + id));
  } finally { w.cleanup(); }
});

test("PLT-125 A02: work committed after the last settled turn fails closed (stale checkpoint is refused)", () => {
  const w = seatWorld();
  try {
    bootstrapSeat(w.config);
    crashMidTurn(w, "commit");
    const call = hooks({ ...w.env, PI_ATDD_EXECUTION_RESUME: "1" });
    const notes: string[] = [];
    const ctx = { ...ctxFor(w.repo, "session-b"), ui: { notify: (m: string) => notes.push(m) } };
    call("session_start", ctx);
    assert.equal(readSeatLease(w.config.leasePath)?.generation, 1, "no transfer on a stale revision");
    assert.equal(call("tool_call", ctx)[0]?.block, true);
  } finally { w.cleanup(); }
});

test("PLT-125 A02: a stale or foreign session writes no mid-run checkpoint", () => {
  const w = seatWorld();
  try {
    bootstrapSeat(w.config);
    const call = hooks(w.env);
    call("turn_end", ctxFor(w.repo, "intruder"));
    assert.throws(() => readSeatCheckpoint(w.config.checkpointDir, "run-a"), /no verified checkpoint/);
  } finally { w.cleanup(); }
});

// ---- wording and duplicate guard ----
test("PLT-125 A03: kickoff says continue from the record and do not repeat completed actions", () => {
  const text = kickoffText("PLT-125");
  assert.match(text, /do not repeat completed actions/i);
  assert.match(text, /pending attention items first/i);
  assert.equal(isKickoff(text), true, "still recognized as a kickoff, never as a task");
});

test("PLT-125 A03: a successor raising an item that is already open gets the existing one, not a duplicate", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-125-d-"));
  try {
    const first = attention(root, "worker", "worker-1", "run-a");
    const successor = attention(root, "worker", "worker-1", "run-b");
    const coach = attention(root, "coach", "Coach A");
    const a = await first.tool("attention_raise", { type: "decision", summary: "Choose the contract", issue: "PLT-125" });
    const b = await successor.tool("attention_raise", { type: "decision", summary: "choose  the contract", issue: "PLT-125" });
    assert.equal(b.details.id, a.details.id);
    assert.match(b.content[0].text, /already open/i);
    await coach.emit("session_start");
    assert.equal((await coach.tool("attention_list")).details.items.length, 1);
    const other = await successor.tool("attention_raise", { type: "decision", summary: "a different question" });
    assert.notEqual(other.details.id, a.details.id);
    await coach.tool("attention_resolve", { id: a.details.id, scope: "within_grant", note: "done" });
    const again = await successor.tool("attention_raise", { type: "decision", summary: "Choose the contract", issue: "PLT-125" });
    assert.notEqual(again.details.id, a.details.id, "a closed item may be raised again");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
