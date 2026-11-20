// PLT-101 Attention Strip. Seeded tests written before the implementation.
// Acceptance: PLT-101 points 1-5 (see docs/PLT-101-ATTENTION-STRIP.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";

type Entry = { type: string; customType?: string; data?: any };
const WIDGET = "pi-atdd-attention";
const TYPES = ["decision", "grant", "review", "intervention"] as const;
const WORKER = "forge-plt-101-worker";
const COACH = "Coach - pi-atdd";

function world() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-atdd-attention-"));
  const clock = { t: Date.parse("2026-11-20T09:00:00Z") };
  return { agentDir, clock, spool: join(agentDir, "attention", "spool.jsonl"),
    cleanup: () => rmSync(agentDir, { recursive: true, force: true }) };
}

/** One Pi session. `sessionEntries` is the session log, kept across simulated restarts. */
function start(w: ReturnType<typeof world>, role: "worker" | "coach" | undefined,
    identity: string, sessionEntries: Entry[] = []) {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const widgets = new Map<string, unknown>();
  const intervals: Array<{ fn: () => void; ms: number }> = [];
  const cleared: unknown[] = [];
  const pi = {
    on: (name: string, fn: Function) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    registerTool: (def: any) => tools.set(def.name, def),
    registerCommand: (name: string, def: any) => commands.set(name, def),
    appendEntry: (customType: string, data: unknown) => sessionEntries.push({ type: "custom", customType, data }),
    sendMessage: () => {},
  };
  const env: NodeJS.ProcessEnv = { PI_CODING_AGENT_DIR: w.agentDir };
  if (role) Object.assign(env, { PI_ATDD_ATTENTION_ROLE: role, PI_ATDD_ATTENTION_IDENTITY: identity,
    PI_ATDD_ATTENTION_PROFILE: "forge" });
  registerAttentionStrip(pi as any, {
    env, now: () => new Date(w.clock.t), pollMs: 5000,
    setInterval: (fn: () => void, ms: number) => { const h = { fn, ms }; intervals.push(h); return h as any; },
    clearInterval: (h: unknown) => { cleared.push(h); },
  });
  const ctx = {
    cwd: w.agentDir, isProjectTrusted: () => true, hasUI: true,
    sessionManager: { getBranch: () => sessionEntries, getEntries: () => sessionEntries },
    ui: { notify() {}, setWidget(key: string, lines: unknown) { widgets.set(key, lines); } },
  };
  return {
    ctx, tools, commands, widgets, intervals, cleared, sessionEntries,
    emit: async (name: string, event: unknown = {}) => {
      const results: any[] = [];
      for (const fn of handlers.get(name) ?? []) {
        const r = await fn(event, ctx);
        if (r !== undefined) results.push(r);
      }
      return results;
    },
    tool: (name: string, params: Record<string, unknown>) =>
      tools.get(name).execute("call-" + name, params, undefined, undefined, ctx),
    command: (name: string) => commands.get(name),
  };
}

const widgetLines = (s: ReturnType<typeof start>) => (s.widgets.get(WIDGET) ?? []) as string[];
const lineOf = (s: ReturnType<typeof start>, id: string) => widgetLines(s).find(l => l.includes(id));
const openIds = (s: ReturnType<typeof start>) =>
  widgetLines(s).map(l => l.match(/ati_[0-9a-f]{12}/)?.[0]).filter(Boolean).sort();

test("acc1: a worker raises each of the 4 types and the Coach strip lists each one", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    for (const type of TYPES) await worker.tool("attention_raise", { type, summary: `needs ${type}`, issue: "PLT-101" });
    await coach.emit("session_start", { reason: "startup" });
    for (const type of TYPES) {
      assert.ok(widgetLines(coach).some(l => l.includes(`[${type}]`) && l.includes(`needs ${type}`)), type);
    }
  } finally { w.cleanup(); }
});

test("acc2: ack, snooze, resolve and TTL change state; resolved and expired items leave memory and the widget", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    const a = (await worker.tool("attention_raise", { type: "decision", summary: "A" })).details.id;
    const b = (await worker.tool("attention_raise", { type: "review", summary: "B" })).details.id;
    const c = (await worker.tool("attention_raise", { type: "grant", summary: "C" })).details.id;
    const d = (await worker.tool("attention_raise", { type: "intervention", summary: "D", ttlHours: 1 })).details.id;
    await coach.emit("session_start", { reason: "startup" });

    await coach.tool("attention_ack", { id: a });
    assert.match(lineOf(coach, a)!, /acked/);

    await coach.tool("attention_snooze", { id: b, hours: 2 });
    assert.match(lineOf(coach, b)!, /snoozed/);

    await coach.tool("attention_resolve", { id: c, scope: "within_grant", note: "done" });
    assert.equal(lineOf(coach, c), undefined, "resolved item must leave the strip");
    assert.equal((await worker.tool("attention_status", { id: c })).details.item.state, "resolved");

    w.clock.t += 61 * 60_000;
    await coach.emit("before_agent_start", { messageType: "user", prompt: "tick" });
    assert.equal(lineOf(coach, d), undefined, "TTL-expired item must leave the strip");

    w.clock.t += 2 * 3600_000;
    await coach.emit("before_agent_start", { messageType: "user", prompt: "tick" });
    assert.match(lineOf(coach, b)!, /open/, "snooze ends and the item is open again");
    assert.ok(lineOf(coach, a), "acked item stays while open");
  } finally { w.cleanup(); }
});

test("acc3: restart rebuild from hidden session entries gives the same open set", async () => {
  const w = world();
  try {
    const log: Entry[] = [];
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH, log);
    const ids: string[] = [];
    for (const type of TYPES) ids.push((await worker.tool("attention_raise", { type, summary: type })).details.id);
    await coach.emit("session_start", { reason: "startup" });
    await coach.tool("attention_ack", { id: ids[0] });
    await coach.tool("attention_resolve", { id: ids[1], scope: "within_grant", note: "ok" });
    await coach.tool("attention_snooze", { id: ids[2], hours: 3 });
    const before = openIds(coach);
    assert.deepEqual(before, [ids[0], ids[2], ids[3]].sort());

    const restarted = start(w, "coach", COACH, log);
    await restarted.emit("session_start", { reason: "resume" });
    assert.deepEqual(openIds(restarted), before);

    // Entries are the source of truth: without the spool the open set is the same.
    rmSync(w.spool);
    const again = start(w, "coach", COACH, log);
    await again.emit("session_start", { reason: "resume" });
    assert.deepEqual(openIds(again), before);

    assert.ok(log.length > 0);
    assert.ok(log.every(e => e.type === "custom" && e.customType?.startsWith("pi-atdd-attention")),
      "attention state is hidden custom entries, never LLM messages");
  } finally { w.cleanup(); }
});

test("acc4: the worker sees a Coach resolution on its next turn without agent-say, and only once", async () => {
  const w = world();
  try {
    const workerLog: Entry[] = [];
    const worker = start(w, "worker", WORKER, workerLog);
    const coach = start(w, "coach", COACH);
    const id = (await worker.tool("attention_raise", { type: "grant", summary: "may I push?" })).details.id;
    await worker.emit("session_start", { reason: "startup" });
    assert.deepEqual(await worker.emit("before_agent_start", { messageType: "user", prompt: "next" }), []);

    await coach.emit("session_start", { reason: "startup" });
    await coach.tool("attention_resolve", { id, scope: "within_grant", note: "yes, push" });

    const [delivery] = await worker.emit("before_agent_start", { messageType: "user", prompt: "next turn" });
    assert.equal(delivery.message.customType, "pi-atdd-attention-resolution");
    assert.equal(delivery.message.display, false);
    assert.match(delivery.message.content, new RegExp(id));
    assert.match(delivery.message.content, /yes, push/);

    assert.deepEqual(await worker.emit("before_agent_start", { messageType: "user", prompt: "again" }), []);

    const restarted = start(w, "worker", WORKER, workerLog);
    await restarted.emit("session_start", { reason: "resume" });
    assert.deepEqual(await restarted.emit("before_agent_start", { messageType: "user", prompt: "x" }), []);
  } finally { w.cleanup(); }
});

test("Q4: above-grant resolution requires the owner's answer, which is recorded and delivered", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    const id = (await worker.tool("attention_raise", { type: "grant", summary: "above grant" })).details.id;
    const id2 = (await worker.tool("attention_raise", { type: "review", summary: "other" })).details.id;
    await coach.emit("session_start", { reason: "startup" });

    await assert.rejects(coach.tool("attention_resolve", { id, scope: "owner_answer", note: "asked owner" }), /ownerAnswer/);
    await assert.rejects(coach.tool("attention_resolve", { id, scope: "owner_answer", note: "x", ownerAnswer: "  " }), /ownerAnswer/);
    await assert.rejects(coach.tool("attention_resolve", { id: id2, scope: "anything", note: "x" }));
    assert.equal((await worker.tool("attention_status", { id })).details.item.state, "open");

    await coach.tool("attention_resolve", { id, scope: "owner_answer", note: "above grant", ownerAnswer: "yes, once" });
    const st = (await worker.tool("attention_status", { id })).details.item;
    assert.equal(st.state, "resolved");
    assert.equal(st.resolution.scope, "owner_answer");
    assert.equal(st.resolution.ownerAnswer, "yes, once");

    const [delivery] = await worker.emit("before_agent_start", { messageType: "user", prompt: "next" });
    assert.match(delivery.message.content, /yes, once/);
  } finally { w.cleanup(); }
});

test("from and profile are stamped from launch config, never from tool arguments", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const item = (await worker.tool("attention_raise", {
      type: "review", summary: "x", from: "someone-else", profile: "pluggy",
    })).details.item;
    assert.equal(item.from, WORKER);
    assert.equal(item.profile, "forge");
  } finally { w.cleanup(); }
});

test("invalid input is rejected at raise: type, summary length, TTL bounds", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    await assert.rejects(worker.tool("attention_raise", { type: "gossip", summary: "x" }));
    await assert.rejects(worker.tool("attention_raise", { type: "review", summary: "x".repeat(281) }));
    await assert.rejects(worker.tool("attention_raise", { type: "review", summary: "x", ttlHours: 169 }));
    await assert.rejects(worker.tool("attention_raise", { type: "review", summary: "x", ttlHours: 0 }));
    await assert.rejects(worker.tool("attention_raise", { type: "review", summary: "  " }));
  } finally { w.cleanup(); }
});

test("default TTL is 72 hours; 7 days is accepted", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const def = (await worker.tool("attention_raise", { type: "review", summary: "x" })).details.item;
    assert.equal(Date.parse(def.ttl) - Date.parse(def.createdAt), 72 * 3600_000);
    const max = (await worker.tool("attention_raise", { type: "review", summary: "y", ttlHours: 168 })).details.item;
    assert.equal(Date.parse(max.ttl) - Date.parse(max.createdAt), 168 * 3600_000);
  } finally { w.cleanup(); }
});

test("a worker cannot act as the Coach and sees only its own items", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const other = start(w, "worker", "forge-other-worker");
    const mine = (await worker.tool("attention_raise", { type: "review", summary: "mine" })).details.id;
    const theirs = (await other.tool("attention_raise", { type: "review", summary: "theirs" })).details.id;
    for (const name of ["attention_ack", "attention_resolve", "attention_snooze", "attention_cancel"]) {
      assert.equal(worker.tools.has(name), false, name);
    }
    assert.equal(worker.commands.has("attention"), false);
    const status = (await worker.tool("attention_status", {})).details.items.map((i: any) => i.id);
    assert.deepEqual(status, [mine]);
    assert.ok(!status.includes(theirs));
  } finally { w.cleanup(); }
});

test("without launch config the strip is inert: no tools, no command, no hooks", () => {
  const w = world();
  try {
    const bare = start(w, undefined, "none");
    assert.equal(bare.tools.size, 0);
    assert.equal(bare.commands.size, 0);
    assert.equal(bare.intervals.length, 0);
  } finally { w.cleanup(); }
});

test("the owner command mirrors the Coach tools and exists only for the Coach", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    const id = (await worker.tool("attention_raise", { type: "decision", summary: "cmd" })).details.id;
    await coach.emit("session_start", { reason: "startup" });
    assert.ok(coach.command("attention"));
    await coach.command("attention").handler(`ack ${id}`, coach.ctx);
    assert.match(lineOf(coach, id)!, /acked/);
  } finally { w.cleanup(); }
});

test("a spool event from another profile is ignored at ingest", async () => {
  const w = world();
  try {
    mkdirSync(join(w.agentDir, "attention"), { recursive: true });
    const foreign = { id: "ati_aaaaaaaaaaaa", type: "decision", from: "x", profile: "pluggy", summary: "foreign",
      state: "open", createdAt: "2026-11-20T09:00:00Z", ttl: "2026-11-23T09:00:00Z", revision: 1 };
    appendFileSync(w.spool, JSON.stringify({ kind: "raised", item: foreign }) + "\n");
    const coach = start(w, "coach", COACH);
    await coach.emit("session_start", { reason: "startup" });
    assert.equal(lineOf(coach, "ati_aaaaaaaaaaaa"), undefined);
  } finally { w.cleanup(); }
});

test("the Coach polls the spool every 5 seconds and the timer is cleared on shutdown", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    await coach.emit("session_start", { reason: "startup" });
    assert.equal(coach.intervals.length, 1);
    assert.equal(coach.intervals[0].ms, 5000);
    const id = (await worker.tool("attention_raise", { type: "intervention", summary: "polled" })).details.id;
    assert.equal(lineOf(coach, id), undefined, "not visible before the poll");
    coach.intervals[0].fn();
    assert.ok(lineOf(coach, id), "visible after the poll");
    await coach.emit("session_shutdown", { reason: "quit" });
    assert.equal(coach.cleared.length, 1);
  } finally { w.cleanup(); }
});
