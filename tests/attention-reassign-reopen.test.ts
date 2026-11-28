// URN: test:pi-atdd:attention-reassign-reopen:ATD-35-A02
// Acceptance: acc:pi-atdd:atd-35-a02
// Acceptance: acc:pi-atdd:atd-35-a03
// Acceptance: acc:pi-atdd:atd-53-a01
// Acceptance: acc:pi-atdd:atd-53-a02
// Acceptance: acc:pi-atdd:atd-53-a03
// Phase: SMOKE
// Layer: integration
// Scope: ATD-35 Acceptance-02 (coach reassigns an item it holds; reassignment recorded) and
// Acceptance-03 (a coach reopens a resolved item; it returns to its accountable coach's open list).
// Routing (ATD-33 / PLT-118) is not changed here: non-owners still cannot see or act on an item.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { seatOwnsRoute, type AttentionRouteBinding } from "../src/attention-routing.ts";

type Entry = { type: string; customType?: string; data?: unknown };
type Kind = "worker" | "reviewer" | "coach";
type World = { root: string; at: number; cleanup: () => void };
const world = (): World => {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-reassign-"));
  return { root, at: Date.parse("2026-11-22T10:00:00Z"),
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
  task = "PLT-118", run = "run-a") {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const widgets = new Map<string, string[] | undefined>();
  const messages: Array<{ message: { customType: string; content: string }; options: unknown }> = [];
  const intervals: Array<{ fn: () => void; ms: number }> = [];
  const entries: Entry[] = [];
  const pi = {
    on: (name: string, fn: Function) => handlers.set(name, [...handlers.get(name) ?? [], fn]),
    registerTool: (def: any) => tools.set(def.name, def),
    registerCommand: () => {},
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    sendMessage: (message: any, opts: any) => messages.push({ message, options: opts }),
  };
  const status = { idle: true };
  const ctx = { isProjectTrusted: () => true, isIdle: () => status.idle,
    sessionManager: { getBranch: () => entries },
    ui: { setWidget: (k: string, v: string[] | undefined) => widgets.set(k, v), notify: () => {} } };
  registerAttentionStrip(pi as any, { env: roleEnv(w, role, identity, coach, task, run),
    now: () => new Date(w.at), pollMs: 5000,
    authorize: (_ctx: unknown, route?: AttentionRouteBinding) => !route || seatOwnsRoute(
      { projectId: "pi-atdd", taskId: route.role === "coach" ? "*" : route.taskId,
        coachAddress: route.coachAddress, executionId: route.role === "coach" ? "coach" : route.executionId },
      route),
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return fn; },
    clearInterval: () => {} });
  return {
    ctx, widgets, messages, intervals, entries, status,
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
test("ATD-53: busy polls do not queue stale wakes; resolved stays silent across refresh and restart; reopen wakes once", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    await coach.emit("session_start");
    coach.status.idle = false;
    const id = (await worker.tool("attention_raise", { type: "decision", summary: "pending" })).details.id;
    for (let i = 0; i < 4; i++) { w.at += 61_000; coach.intervals[0]!.fn(); }
    assert.equal(coach.messages.length, 0, "busy polls must not enqueue stale follow-ups");
    await coach.tool("attention_resolve", { id, scope: "within_grant", note: "done" });
    coach.status.idle = true;
    await coach.emit("agent_settled");
    for (let i = 0; i < 4; i++) { w.at += 61_000; coach.intervals[0]!.fn(); }
    await coach.emit("session_tree");
    assert.equal(coach.messages.length, 0);
    assert.equal((await coach.tool("attention_list")).details.items.length, 0);
    await coach.emit("session_shutdown");
    const restarted = launch(w, "coach", "Coach A", "main@pi-atdd");
    await restarted.emit("session_start");
    restarted.intervals[0]!.fn();
    assert.equal(restarted.messages.length, 0);
    await restarted.tool("attention_reopen", { id, note: "new evidence" });
    restarted.intervals[0]!.fn();
    assert.equal(restarted.messages.length, 1);
    await restarted.emit("before_agent_start");
    w.at += 120_000;
    restarted.intervals[0]!.fn();
    assert.equal(restarted.messages.length, 1);
    await restarted.tool("attention_resolve", { id, scope: "within_grant", note: "done again" });
    await restarted.tool("attention_reopen", { id, note: "more evidence" });
    restarted.intervals[0]!.fn();
    assert.equal(restarted.messages.length, 2, "new reopen generation is announced");
  } finally { w.cleanup(); }
});

test("ATD-53: settled delivery rechecks ownership and sends a still-open item", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coach = launch(w, "coach", "Coach A", "main@pi-atdd");
    await coach.emit("session_start");
    coach.status.idle = false;
    const moved = (await worker.tool("attention_raise", { type: "review", summary: "move" })).details.id;
    const kept = (await worker.tool("attention_raise", { type: "grant", summary: "keep" })).details.id;
    coach.intervals[0]!.fn();
    await coach.tool("attention_reassign", { id: moved, toCoach: "release@pi-atdd", note: "handoff" });
    coach.status.idle = true;
    await coach.emit("agent_settled");
    assert.equal(coach.messages.length, 1);
    assert.match(coach.messages[0]!.message.content, new RegExp(kept));
    assert.doesNotMatch(coach.messages[0]!.message.content, new RegExp(moved));
  } finally { w.cleanup(); }
});

const widget = (s: ReturnType<typeof launch>) => s.widgets.get("pi-atdd-attention") ?? [];
const spoolLines = (w: World) => readFileSync(join(w.root, "attention", "spool.jsonl"), "utf8")
  .split("\n").filter(Boolean).map(line => JSON.parse(line));

test("ATD-35 A02: a coach reassigns an item it holds; it leaves that list, appears in the target's list, and the reassignment is recorded", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coachA = launch(w, "coach", "Coach A", "main@pi-atdd");
    const coachB = launch(w, "coach", "Coach B", "release@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "decision", summary: "release scope", issue: "PLT-118" }))
      .details.id as string;
    await coachA.emit("session_start");
    await coachB.emit("session_start");
    assert.ok(widget(coachA).some(line => line.includes(id)));
    assert.ok(!widget(coachB).some(line => line.includes(id)), "routing unchanged: B does not see A's item");

    const moved = await coachA.tool("attention_reassign", { id, toCoach: "release@pi-atdd",
      note: "belongs to the release review" });
    assert.equal(moved.details.item.route.coachAddress, "release@pi-atdd");
    assert.equal(moved.details.item.state, "open");

    assert.equal((await coachA.tool("attention_list")).details.items.length, 0);
    assert.ok(!widget(coachA).some(line => line.includes(id)), "A's strip drops the item at once");
    await assert.rejects(coachA.tool("attention_ack", { id }), /unknown attention item/);

    await coachB.emit("session_start");
    const bItems = (await coachB.tool("attention_list")).details.items;
    assert.deepEqual(bItems.map((it: any) => it.id), [id]);
    assert.equal(bItems[0].route.coachAddress, "release@pi-atdd");
    assert.ok(widget(coachB).some(line => line.includes(id)));

    const record = spoolLines(w).find(e => e.event === "state" && e.rec.id === id && e.rec.state === "reassigned");
    assert.ok(record, "reassignment is a signed record in the durable spool");
    assert.equal(record.rec.reassignTo, "release@pi-atdd");
    assert.equal(record.rec.by, "Coach A");
    assert.equal(record.rec.note, "belongs to the release review");
    assert.match(record.mac, /^[0-9a-f]{64}$/);

    assert.equal((await coachB.tool("attention_ack", { id })).details.item.state, "acked");
  } finally { w.cleanup(); }
});

test("ATD-35 A02: a forged reassignment (edited target, original MAC) is dropped and changes no list", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coachA = launch(w, "coach", "Coach A", "main@pi-atdd");
    const coachB = launch(w, "coach", "Coach B", "release@pi-atdd");
    const coachC = launch(w, "coach", "Coach C", "third@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "grant", summary: "forgery probe" })).details.id as string;
    await coachA.emit("session_start");
    await coachA.tool("attention_reassign", { id, toCoach: "release@pi-atdd", note: "to B" });
    const genuine = spoolLines(w).find(e => e.event === "state" && e.rec.state === "reassigned");
    appendFileSync(join(w.root, "attention", "spool.jsonl"),
      JSON.stringify({ ...genuine, rec: { ...genuine.rec, reassignTo: "third@pi-atdd" } }) + "\n");

    await coachC.emit("session_start");
    assert.equal((await coachC.tool("attention_list")).details.items.length, 0, "forged target gains nothing");
    await coachB.emit("session_start");
    assert.equal((await coachB.tool("attention_list")).details.items[0].route.coachAddress, "release@pi-atdd");
  } finally { w.cleanup(); }
});

test("ATD-35 A02: reassignment fails closed: note required, not to self, not for an item the coach does not hold", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coachA = launch(w, "coach", "Coach A", "main@pi-atdd");
    const coachB = launch(w, "coach", "Coach B", "release@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "review", summary: "fail closed" })).details.id as string;
    await coachA.emit("session_start");
    await coachB.emit("session_start");
    await assert.rejects(coachA.tool("attention_reassign", { id, toCoach: "release@pi-atdd", note: " " }), /note is required/);
    await assert.rejects(coachA.tool("attention_reassign", { id, toCoach: "main@pi-atdd", note: "self" }),
      /already belongs to that coach/);
    await assert.rejects(coachB.tool("attention_reassign", { id, toCoach: "third@pi-atdd", note: "not mine" }),
      /unknown attention item/);
    assert.equal((await coachA.tool("attention_list")).details.items.length, 1, "nothing moved");
  } finally { w.cleanup(); }
});

test("ATD-35 A03: a coach reopens a resolved item; it returns to its accountable coach's open list and the worker is told", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd", "PLT-118", "run-a");
    const coachA = launch(w, "coach", "Coach A", "main@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "decision", summary: "reopen me" })).details.id as string;
    await coachA.emit("session_start");
    await coachA.tool("attention_resolve", { id, scope: "within_grant", note: "option B" });
    assert.equal((await coachA.tool("attention_list")).details.items.length, 0);

    const reopened = await coachA.tool("attention_reopen", { id, note: "new evidence" });
    assert.equal(reopened.details.item.state, "open");
    assert.equal(reopened.details.item.resolution, undefined);
    const listed = (await coachA.tool("attention_list")).details.items;
    assert.deepEqual(listed.map((it: any) => it.id), [id]);
    assert.ok(widget(coachA).some(line => line.includes(id) && line.includes("open")));

    const [delivered] = await worker.emit("before_agent_start");
    assert.match(delivered.message.content, /resolved/);
    assert.match(delivered.message.content, /reopened/);
  } finally { w.cleanup(); }
});

test("ATD-35 A03: reopen is limited to resolved items, and only the coach that holds them", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coachA = launch(w, "coach", "Coach A", "main@pi-atdd");
    const coachB = launch(w, "coach", "Coach B", "release@pi-atdd");
    const open = (await worker.tool("attention_raise", { type: "grant", summary: "still open" })).details.id as string;
    const resolved = (await worker.tool("attention_raise", { type: "grant", summary: "resolve first" })).details.id as string;
    await coachA.emit("session_start");
    await coachA.tool("attention_resolve", { id: resolved, scope: "within_grant", note: "done" });
    await assert.rejects(coachA.tool("attention_reopen", { id: open, note: "x" }), /cannot reopen a open item/);
    await coachB.emit("session_start");
    await assert.rejects(coachB.tool("attention_reopen", { id: resolved, note: "not mine" }), /unknown attention item/);
    await assert.rejects(coachA.tool("attention_reopen", { id: resolved, note: " " }), /note is required/);
  } finally { w.cleanup(); }
});

test("ATD-35 A03: a reopen after the item's TTL has run out is refused", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coachA = launch(w, "coach", "Coach A", "main@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "review", summary: "short ttl", ttlHours: 1 })).details.id as string;
    await coachA.emit("session_start");
    await coachA.tool("attention_resolve", { id, scope: "within_grant", note: "done" });
    w.at += 2 * 3_600_000;
    await assert.rejects(coachA.tool("attention_reopen", { id, note: "late" }), /has expired/);
  } finally { w.cleanup(); }
});

test("ATD-35 A02/A03: after a reassignment the new coach can resolve and later reopen; the worker still hears about its item", async () => {
  const w = world();
  try {
    const worker = launch(w, "worker", "worker-a", "main@pi-atdd");
    const coachA = launch(w, "coach", "Coach A", "main@pi-atdd");
    const coachB = launch(w, "coach", "Coach B", "release@pi-atdd");
    const id = (await worker.tool("attention_raise", { type: "decision", summary: "moved twice" })).details.id as string;
    await coachA.emit("session_start");
    await coachA.tool("attention_reassign", { id, toCoach: "release@pi-atdd", note: "release item" });
    await coachB.emit("session_start");
    await coachB.tool("attention_resolve", { id, scope: "within_grant", note: "decided" });
    await coachB.tool("attention_reopen", { id, note: "decision revisited" });
    assert.deepEqual((await coachB.tool("attention_list")).details.items.map((it: any) => it.id), [id]);
    assert.deepEqual((await coachA.tool("attention_list")).details.items, []);
    const [delivered] = await worker.emit("before_agent_start");
    assert.match(delivered.message.content, /reassigned/);
    assert.match(delivered.message.content, /reopened/);
  } finally { w.cleanup(); }
});
