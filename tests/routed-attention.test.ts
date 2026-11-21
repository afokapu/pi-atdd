// URN: test:pi-atdd:routed-attention:PLT-118
// Acceptance: acc:pi-atdd:PLT-118-A01
// Acceptance: acc:pi-atdd:PLT-118-A02
// Acceptance: acc:pi-atdd:PLT-118-A03
// Acceptance: acc:pi-atdd:PLT-118-A04
// Acceptance: acc:pi-atdd:PLT-118-A05
// Acceptance: acc:pi-atdd:PLT-118-A06
// Acceptance: acc:pi-atdd:PLT-118-A07
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";

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
  task = "PLT-118", run = "run-a", options: { authorized?: boolean; entries?: Entry[] } = {}) {
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
    now: () => new Date(w.at), pollMs: 5000, authorize: () => options.authorized !== false,
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
    assert.equal(replacement.intervals.length, 0);
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
