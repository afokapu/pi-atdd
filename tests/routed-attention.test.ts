// URN: test:pi-atdd:routed-attention:PLT-118
// Acceptance: acc:pi-atdd:plt-118-a01
// Acceptance: acc:pi-atdd:plt-118-a02
// Acceptance: acc:pi-atdd:plt-118-a03
// Acceptance: acc:pi-atdd:plt-118-a04
// Acceptance: acc:pi-atdd:plt-118-a05
// Acceptance: acc:pi-atdd:plt-118-a06
// Acceptance: acc:pi-atdd:plt-118-a07
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { seatOwnsRoute, type AttentionRouteBinding } from "../src/attention-routing.ts";
import { bootstrapSeat, executionConfigFromEnv } from "../src/execution-seat.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";

type SeatBinding = Parameters<typeof seatOwnsRoute>[0];

type Entry = { type: string; customType?: string; data?: unknown };
type Kind = "worker" | "reviewer" | "coach";
type World = { root: string; at: number; cleanup: () => void };
const world = (): World => {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-routing-"));
  return { root, at: Date.parse("2026-11-21T10:00:00Z"),
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
};
const roleEnv = (w: World, role: Kind, identity: string, coach: string,
  task = "PLT-118", run = "run-a"): NodeJS.ProcessEnv => ({
  PI_CODING_AGENT_DIR: w.root,
  PI_ATDD_ATTENTION_ROLE: role,
  PI_ATDD_ATTENTION_PROFILE: "forge",
  PI_ATDD_ATTENTION_IDENTITY: identity,
  PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd",
  PI_ATDD_ATTENTION_COACH_ADDRESS: coach,
  ...(role !== "coach" ? { PI_ATDD_ATTENTION_TASK_ID: task,
    PI_ATDD_ATTENTION_EXECUTION_ID: run } : {}),
});
function launch(w: World, role: Kind, identity: string, coach: string,
  task = "PLT-118", run = "run-a",
  options: { authorized?: boolean; entries?: Entry[]; seat?: SeatBinding;
    authorize?: (ctx: unknown, route?: AttentionRouteBinding) => boolean } = {}) {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const widgets = new Map<string, string[] | undefined>();
  const messages: Array<{ message: { customType: string; content: string };
    options: { triggerTurn: boolean; deliverAs: string } }> = [];
  const intervals: Array<{ fn: () => void; ms: number }> = [];
  const entries = options.entries ?? [];
  const pi = {
    on: (name: string, fn: Function) => handlers.set(name, [...handlers.get(name) ?? [], fn]),
    registerTool: (def: any) => tools.set(def.name, def),
    registerCommand: () => {},
    appendEntry: (customType: string, data: unknown) =>
      entries.push({ type: "custom", customType, data }),
    sendMessage: (message: any, opts: any) => messages.push({ message, options: opts }),
  };
  const ctx = { isProjectTrusted: () => true,
    sessionManager: { getBranch: () => entries },
    ui: { setWidget: (k: string, v: string[] | undefined) => widgets.set(k, v),
      notify: () => {} } };
  registerAttentionStrip(pi as any, { env: roleEnv(w, role, identity, coach, task, run),
    now: () => new Date(w.at), pollMs: 5000,
    // Mirrors pi-activation: the seat must own the route it is asked to act for.
    authorize: options.authorize ?? ((_ctx: unknown, route?: AttentionRouteBinding) =>
      options.authorized !== false && (!options.seat || !route || seatOwnsRoute(options.seat, route))),
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return fn; },
    clearInterval: () => {} });
  return {
    ctx, widgets, messages, intervals, entries,
    tool: (name: string, params: Record<string, unknown> = {}) =>
      tools.get(name).execute("call", params, undefined, undefined, ctx),
    emit: async (name: string, evt: unknown = {}) => {
      const results: any[] = [];
      for (const fn of handlers.get(name) ?? []) {
        const result = await fn(evt, ctx);
        if (result !== undefined) results.push(result);
      }
      return results;
    },
  };
}
const widget = (s: ReturnType<typeof launch>) => s.widgets.get("pi-atdd-attention") ?? [];

test("PLT-118 A01/A03: coach A alone sees task item in strip, tool and LLM context", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-1", "main@pi-atdd");
    const a = launch(w, "coach", "Coach A", "main@pi-atdd");
    const b = launch(w, "coach", "Coach B", "coordinator.review@pi-atdd");
    const raised = await worker.tool("attention_raise", { type: "decision", summary: "choose contract",
      issue: "PLT-118", to: "coordinator.review@pi-atdd" });
    const id = raised.details.id as string;
    assert.equal(raised.details.item.route.coachAddress, "main@pi-atdd");
    await a.emit("session_start"); await b.emit("session_start");
    assert.equal(widget(a).some(line => line.includes(id)), true);
    assert.equal(widget(b).some(line => line.includes(id)), false);
    const contextA = await a.emit("before_agent_start");
    assert.match(contextA[0].message.content, /choose contract/);
    assert.deepEqual(await b.emit("before_agent_start"), []);
    assert.equal((await a.tool("attention_list")).details.items.length, 1);
    assert.equal((await b.tool("attention_list")).details.items.length, 0);
    await assert.rejects(b.tool("attention_resolve", { id, scope: "within_grant", note: "stolen" }),
      /unknown attention item/);
  } finally { w.cleanup(); }
});

test("PLT-118 A04: one Pi-native wake for an idle Coach, with follow-up delivery for busy runs", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-1", "main@pi-atdd");
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    await coach.emit("session_start");
    assert.equal(coach.messages.length, 0);
    await worker.tool("attention_raise", { type: "grant", summary: "need grant" });
    coach.intervals[0]!.fn();
    assert.equal(coach.messages.length, 1);
    assert.equal(coach.messages[0]!.options.triggerTurn, true);
    assert.equal(coach.messages[0]!.options.deliverAs, "followUp");
    coach.intervals[0]!.fn();
    assert.equal(coach.messages.length, 1);
    await worker.tool("attention_raise", { type: "review", summary: "review ready" });
    await worker.tool("attention_raise", { type: "intervention", summary: "blocked" });
    coach.intervals[0]!.fn();
    assert.equal(coach.messages.length, 2);
    assert.equal(coach.messages[1]!.message.content.includes("2 new attention"), true);
  } finally { w.cleanup(); }
});

test("PLT-118 A05: a replacement worker sees a prior worker resolution and later attempts do not", async () => {
  const w = world();
  try {
    const first = launch(w, "worker", "worker-a", "main@pi-atdd", "PLT-118", "execution-a");
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    const raised = await first.tool("attention_raise", { type: "decision", summary: "which option?" });
    const id = raised.details.id as string;
    await coach.emit("session_start");
    await coach.tool("attention_resolve", { id, scope: "within_grant", note: "option B" });
    const second = launch(w, "worker", "worker-b", "main@pi-atdd", "PLT-118", "execution-b");
    const received = await second.emit("before_agent_start");
    assert.match(received[0].message.content, /option B/);
    assert.deepEqual(await second.emit("before_agent_start"), []);
    await second.emit("agent_settled", { aborted: false });
    const third = launch(w, "worker", "worker-c", "main@pi-atdd", "PLT-118", "execution-c");
    assert.deepEqual(await third.emit("before_agent_start"), []);
  } finally { w.cleanup(); }
});

test("PLT-118 A05/A06: a new coach session rebuilds from durable spool, not old session entries", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const first = launch(w, "coach", "Coach A", "main@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "grant", summary: "grant pending" })).details.id;
    await first.emit("session_start");
    const replacement = launch(w, "coach", "Coach A new session", "main@pi-atdd");
    await replacement.emit("session_start");
    assert.equal(widget(replacement).some(line => line.includes(id)), true);
    await replacement.tool("attention_ack", { id });
    assert.equal(widget(replacement).some(line => line.includes("acked")), true);
  } finally { w.cleanup(); }
});

test("PLT-118 A01/A06: stale runtime authorization and legacy events fail closed in routed coach", async () => {
  const w = world();
  try {
    const legacyEnv = { PI_CODING_AGENT_DIR: w.root, PI_ATDD_ATTENTION_ROLE: "worker",
      PI_ATDD_ATTENTION_PROFILE: "forge", PI_ATDD_ATTENTION_IDENTITY: "legacy" };
    const legacyHandlers = new Map<string, any>();
    const legacyTools = new Map<string, any>();
    registerAttentionStrip({ on: (e: string, cb: any) => legacyHandlers.set(e, cb),
      registerTool: (def: any) => legacyTools.set(def.name, def),
      registerCommand: () => {}, appendEntry: () => {} } as any, { env: legacyEnv, now: () => new Date(w.at) });
    const legacyCtx = { isProjectTrusted: () => true,
      sessionManager: { getBranch: () => [] }, ui: { notify: () => {}, setWidget: () => {} } };
    await legacyTools.get("attention_raise").execute("call", { type: "decision", summary: "legacy item" },
      undefined, undefined, legacyCtx);
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    await coach.emit("session_start");
    assert.equal((await coach.tool("attention_list")).details.items.length, 0);
    assert.equal((await coach.tool("attention_quarantine_status")).details.count, 1);
    const denied = launch(w, "coach", "Coach A denied", "main@pi-atdd", "PLT-118", "x",
      { authorized: false });
    await assert.rejects(denied.tool("attention_list"), /not authorized/);
    assert.deepEqual(await denied.emit("before_agent_start"), []);
  } finally { w.cleanup(); }
});

test("PLT-118 A02/A07: reviewers can raise but an untrusted/no-seat worker cannot", async () => {
  const w = world();
  try {
    const reviewer = launch(w, "reviewer", "review-run-a", "main@pi-atdd");
    const id = (await reviewer.tool("attention_raise", { type: "review", summary: "PR ready" })).details.id;
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    await coach.emit("session_start");
    assert.ok(widget(coach).some(line => line.includes(id)));
    const denied = launch(w, "worker", "worker denied", "main@pi-atdd", "PLT-118", "x",
      { authorized: false });
    await assert.rejects(denied.tool("attention_raise", { type: "decision", summary: "spoof" }), /not authorized/);
  } finally { w.cleanup(); }
});

test("PLT-118 A05: a Coach handoff starts polling after successor lease becomes current", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    await worker.tool("attention_raise", { type: "decision", summary: "pending through handoff" });
    const lease = { authorized: false };
    const replacement = launch(w, "coach", "Coach successor", "main@pi-atdd",
      "PLT-118", "run-next", lease);
    await replacement.emit("session_start");
    // P2 A04: polling is armed at session start and does nothing until the lease is current.
    assert.equal(replacement.intervals.length, 1);
    replacement.intervals[0]!.fn();
    assert.equal(replacement.messages.length, 0);
    lease.authorized = true;
    const [delivered] = await replacement.emit("before_agent_start");
    assert.match(delivered.message.content, /pending through handoff/);
    assert.equal(replacement.intervals.length, 1);
  } finally { w.cleanup(); }
});

test("PLT-118 A01/A02: one project Coach owns attention from several independent tasks", async () => {
  const w = world();
  try {
    const first = launch(w, "worker", "worker-task-one", "main@pi-atdd", "PLT-118", "run-one");
    const second = launch(w, "worker", "worker-task-two", "main@pi-atdd", "PLT-119", "run-two");
    const coach = launch(w, "coach", "Coach for project", "main@pi-atdd");
    const one = (await first.tool("attention_raise", { type: "decision", summary: "task one" })).details.id;
    const two = (await second.tool("attention_raise", { type: "review", summary: "task two" })).details.id;
    await coach.emit("session_start");
    const items = (await coach.tool("attention_list")).details.items;
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item: any) => item.id).sort(), [one, two].sort());
    assert.deepEqual(items.map((item: any) => item.route.taskId).sort(), ["PLT-118", "PLT-119"]);
  } finally { w.cleanup(); }
});

// PLT-118 independent review (569501c1): P1 A01/A02, P1 A01, P1 A05/A06, P2 A04, P2 A05, PLT-117 integration.
test("PLT-118 review P1 A01/A02: a seat authorizes only the route it was assigned", async () => {
  const w = world();
  try {
    const seatOnOtherTask = { projectId: "pi-atdd", taskId: "PLT-119", coachAddress: "main@pi-atdd", executionId: "run-b" };
    const rebound = launch(w, "worker", "worker-x", "main@pi-atdd", "PLT-118", "run-a", { seat: seatOnOtherTask });
    await assert.rejects(rebound.tool("attention_raise", { type: "decision", summary: "spoof" }), /not authorized/);
    const coachSeatOnTask = { projectId: "pi-atdd", taskId: "PLT-118", coachAddress: "main@pi-atdd", executionId: "run-c" };
    const taskSeatAsCoach = launch(w, "coach", "Coach X", "main@pi-atdd", "", "", { seat: coachSeatOnTask });
    await assert.rejects(taskSeatAsCoach.tool("attention_list"), /not authorized/);
    const sameRunWorker = { projectId: "pi-atdd", taskId: "PLT-118", coachAddress: "main@pi-atdd", executionId: "run-a" };
    const owner = launch(w, "worker", "worker-a", "main@pi-atdd", "PLT-118", "run-a", { seat: sameRunWorker });
    assert.equal((await owner.tool("attention_raise", { type: "decision", summary: "own seat" })).details.item.route.taskId, "PLT-118");
  } finally { w.cleanup(); }
});

test("PLT-118 review P1 A01: a coach does not copy another coach's state records into its Pi history", async () => {
  const w = world();
  try {
    const otherWorker = launch(w, "worker", "worker-2", "other@pi-atdd", "PLT-119", "run-2");
    const id = (await otherWorker.tool("attention_raise", { type: "decision", summary: "other task" })).details.id;
    const otherCoach = launch(w, "coach", "Coach B", "other@pi-atdd");
    await otherCoach.tool("attention_resolve", { id, scope: "within_grant", note: "private coach note" });
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    await coach.emit("session_start");
    assert.equal(coach.entries.some(e => (e.data as any)?.rec?.id === id), false);
    assert.equal(JSON.stringify(coach.entries).includes("private coach note"), false);
    assert.equal((await coach.tool("attention_list")).details.items.length, 0);
  } finally { w.cleanup(); }
});

test("PLT-118 review P1 A05/A06: ownership is checked inside the spool commit lock", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "grant", summary: "lock check" })).details.id;
    const spool = join(w.root, "attention", "spool.jsonl");
    const heldDuringCheck: boolean[] = [];
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd", "PLT-118", "run-a", {
      authorize: () => { heldDuringCheck.push(existsSync(spool + ".lock")); return true; },
    });
    heldDuringCheck.length = 0;
    await coach.tool("attention_ack", { id });
    assert.ok(heldDuringCheck.length > 0);
    assert.equal(heldDuringCheck.every(Boolean), true);
  } finally { w.cleanup(); }
});

test("PLT-118 review P1 A05/A06: an errored run does not advance the worker receipt, and the next turn retries", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd", "PLT-118", "run-a");
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "decision", summary: "errored run" })).details.id;
    await coach.emit("session_start");
    await coach.tool("attention_ack", { id });
    assert.match((await worker.emit("before_agent_start"))[0].message.content, /acked/);
    await worker.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] });
    await worker.emit("agent_settled", { aborted: false });
    assert.match((await worker.emit("before_agent_start"))[0].message.content, /acked/);
    const next = launch(w, "worker", "worker-b", "main@pi-atdd", "PLT-118", "run-b");
    assert.match((await next.emit("before_agent_start"))[0].message.content, /acked/);
  } finally { w.cleanup(); }
});

test("PLT-118 review P1 A05/A06: an aborted run releases pending so the same session retries", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd", "PLT-118", "run-a");
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "decision", summary: "aborted run" })).details.id;
    await coach.emit("session_start");
    await coach.tool("attention_ack", { id });
    assert.match((await worker.emit("before_agent_start"))[0].message.content, /acked/);
    await worker.emit("agent_settled", { aborted: true });
    assert.match((await worker.emit("before_agent_start"))[0].message.content, /acked/);
  } finally { w.cleanup(); }
});

test("PLT-118 review P2 A04: a wake whose turn never starts is re-sent after its window", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    await coach.emit("session_start");
    await worker.tool("attention_raise", { type: "grant", summary: "wake lost" });
    coach.intervals[0]!.fn();
    assert.equal(coach.messages.length, 1);
    w.at += 30_000;
    coach.intervals[0]!.fn();
    assert.equal(coach.messages.length, 1);
    w.at += 120_000;
    coach.intervals[0]!.fn();
    assert.equal(coach.messages.length, 2);
  } finally { w.cleanup(); }
});

test("PLT-118 review P2 A05: every undelivered revision reaches the worker, not only the latest", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd", "PLT-118", "run-a");
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "decision", summary: "two revisions" })).details.id;
    await coach.emit("session_start");
    await coach.tool("attention_ack", { id });
    await coach.tool("attention_snooze", { id, hours: 1 });
    const [msg] = await worker.emit("before_agent_start");
    assert.match(msg.message.content, /acked/);
    assert.match(msg.message.content, /snoozed/);
  } finally { w.cleanup(); }
});

test("PLT-117 integration: rows for other coaches do not block a verified handoff; corrupt rows still do", async () => {
  const w = world();
  try {
    const seatEnv: NodeJS.ProcessEnv = {
      PI_CODING_AGENT_DIR: w.root, PI_ATDD_EXECUTION_MODE: "standalone",
      PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd", PI_ATDD_EXECUTION_TASK_ID: "*",
      PI_ATDD_EXECUTION_COACH_ADDRESS: "main@pi-atdd", PI_ATDD_EXECUTION_SEAT_ADDRESS: "main@pi-atdd",
      PI_ATDD_EXECUTION_EXECUTION_ID: "run-coach", PI_ATDD_EXECUTION_SESSION_ID: "sess-coach",
      PI_ATDD_EXECUTION_MODEL_ID: "model", PI_ATDD_EXECUTION_GENERATION: "1",
      PI_ATDD_EXECUTION_OWNER_TOKEN: "token-coach",
      PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "Coach A", PI_ATDD_ATTENTION_PROFILE: "forge",
      PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd", PI_ATDD_ATTENTION_COACH_ADDRESS: "main@pi-atdd",
    };
    bootstrapSeat(executionConfigFromEnv(seatEnv)!);
    const other = launch(w, "worker", "worker-b", "other@pi-atdd", "PLT-119", "run-b");
    await other.tool("attention_raise", { type: "decision", summary: "other coach's task" });
    const pi = { on: () => {}, registerCommand: () => {} };
    const seat = registerSeatExecution(pi as any, seatEnv)!;
    const snapshot = seat.snapshotAttention();
    assert.equal(snapshot.state, "verified");
    assert.deepEqual(snapshot.pendingIds, []);
    const spool = join(w.root, "attention", "spool.jsonl");
    const { appendFileSync } = await import("node:fs");
    appendFileSync(spool, "{not json\n");
    assert.equal(seat.snapshotAttention().state, "unknown");
    assert.ok(readFileSync(spool, "utf8").length > 0);
  } finally { w.cleanup(); }
});
