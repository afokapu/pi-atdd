// PLT-101 Attention Strip. Seeded tests, written before the review-RETURN fixes.
// Acceptance: PLT-101 points 1-5 (docs/PLT-101-ATTENTION-STRIP.md).
// Review RETURN (2026-11-20) added: trust gate on every entry point, authenticated records,
// profile filtering, malformed-record tolerance, removal of closed items, explicit expiry.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { ensureKey, signEvent, type AttentionItem, type StateRecord } from "../src/attention.ts";

type Entry = { type: string; customType?: string; data?: any };
const WIDGET = "pi-atdd-attention";
const TYPES = ["decision", "grant", "review", "intervention"] as const;
const WORKER = "forge-plt-101-worker";
const COACH = "Coach - pi-atdd";
const HOUR = 3_600_000;
const ISO = (ms: number) => new Date(ms).toISOString();

function world() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-atdd-attention-"));
  const clock = { t: Date.parse("2026-11-20T09:00:00Z") };
  return {
    agentDir, clock,
    spool: join(agentDir, "attention", "spool.jsonl"),
    key: join(agentDir, "attention", "attention.key"),
    cleanup: () => rmSync(agentDir, { recursive: true, force: true }),
  };
}
type World = ReturnType<typeof world>;

/** One Pi session. `sessionEntries` is the session log, kept across simulated restarts. */
function start(w: World, role: "worker" | "coach" | undefined, identity: string,
    sessionEntries: Entry[] = [], isTrusted = true) {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const widgets = new Map<string, unknown>();
  const notes: Array<{ message: string; level?: string }> = [];
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
    setInterval: (fn: () => void, ms: number) => { const h = { fn, ms }; intervals.push(h); return h; },
    clearInterval: (h: unknown) => { cleared.push(h); },
  });
  const ctx = {
    cwd: w.agentDir, isProjectTrusted: () => isTrusted, hasUI: true,
    sessionManager: { getBranch: () => sessionEntries, getEntries: () => sessionEntries },
    ui: {
      notify: (message: string, level?: string) => { notes.push({ message, level }); },
      setWidget: (key: string, lines: unknown) => { widgets.set(key, lines); },
    },
  };
  return {
    ctx, tools, commands, widgets, notes, intervals, cleared, sessionEntries,
    emit: async (name: string, event: unknown = {}) => {
      const results: any[] = [];
      for (const fn of handlers.get(name) ?? []) {
        const r = await fn(event, ctx);
        if (r !== undefined) results.push(r);
      }
      return results;
    },
    /** Pass `null` to simulate a call with no extension context at all. */
    tool: (name: string, params: Record<string, unknown>, c: unknown = ctx) =>
      tools.get(name).execute("call-" + name, params, undefined, undefined, c),
    command: (name: string) => commands.get(name),
  };
}
type S = ReturnType<typeof start>;

const widgetLines = (s: S) => (s.widgets.get(WIDGET) ?? []) as string[];
const lineOf = (s: S, id: string) => widgetLines(s).find(l => l.includes(id));
const openIds = (s: S) => widgetLines(s).map(l => l.match(/ati_[0-9a-f]{12}/)?.[0]).filter(Boolean).sort();
/** Every complete spool line that parses, as the file actually holds it. */
function records(w: World): any[] {
  if (!existsSync(w.spool)) return [];
  return readFileSync(w.spool, "utf8").split("\n").filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
const lastRec = (w: World, id: string): StateRecord | undefined =>
  records(w).filter(r => r.event === "state" && r.rec?.id === id).map(r => r.rec as StateRecord).at(-1);
const stateOf = (w: World, id: string) => lastRec(w, id)?.state;
const itemOf = async (s: S, id: string) => (await s.tool("attention_status", { id })).details.item;

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

test("acc2: ack, snooze, resolve, cancel and TTL change state; closed items leave memory and the widget", async () => {
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
    assert.equal(stateOf(w, a), "acked", "ack is a state record in the spool");

    await coach.tool("attention_snooze", { id: b, hours: 2 });
    assert.match(lineOf(coach, b)!, /snoozed/);

    await coach.tool("attention_resolve", { id: c, scope: "within_grant", note: "done" });
    assert.equal(stateOf(w, c), "resolved", "resolve is recorded");
    assert.equal(lineOf(coach, c), undefined, "resolved item leaves the strip");
    assert.equal(await itemOf(worker, c), undefined, "resolved item leaves worker status");

    w.clock.t += 61 * 60_000;
    await coach.emit("before_agent_start", { messageType: "user", prompt: "tick" });
    assert.equal(stateOf(w, d), "expired", "TTL expiry is an explicit state change, not only a filter");
    assert.equal(lineOf(coach, d), undefined, "expired item leaves the strip");
    assert.equal(await itemOf(worker, d), undefined, "expired item leaves worker status");

    w.clock.t += 2 * HOUR;
    await coach.emit("before_agent_start", { messageType: "user", prompt: "tick" });
    assert.match(lineOf(coach, b)!, /open/, "snooze ends and the item is open again");
    assert.match(lineOf(coach, a)!, /acked/, "acked item stays while live");

    await coach.command("attention").handler(`cancel ${a} stale`, coach.ctx);
    assert.equal(stateOf(w, a), "cancelled", "cancel is recorded");
    assert.equal(lineOf(coach, a), undefined, "cancelled item leaves the strip");
    assert.equal(await itemOf(worker, a), undefined, "cancelled item leaves worker status");
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

    // Session entries are the source of truth: without the spool the open set is the same.
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
    await assert.rejects(coach.tool("attention_resolve", { id: id2, scope: "anything", note: "x" }), /scope/);
    assert.equal((await itemOf(worker, id)).state, "open", "rejected resolutions change nothing");

    await coach.tool("attention_resolve", { id, scope: "owner_answer", note: "above grant", ownerAnswer: "yes, once" });
    const rec = lastRec(w, id)!;
    assert.equal(rec.state, "resolved");
    assert.equal(rec.scope, "owner_answer");
    assert.equal(rec.ownerAnswer, "yes, once");
    assert.equal(await itemOf(worker, id), undefined, "resolved item leaves worker status");

    const [delivery] = await worker.emit("before_agent_start", { messageType: "user", prompt: "next" });
    assert.match(delivery.message.content, /yes, once/);
    assert.match(delivery.message.content, /above grant/);
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
    assert.equal(Date.parse(def.ttl) - Date.parse(def.createdAt), 72 * HOUR);
    const max = (await worker.tool("attention_raise", { type: "review", summary: "y", ttlHours: 168 })).details.item;
    assert.equal(Date.parse(max.ttl) - Date.parse(max.createdAt), 168 * HOUR);
  } finally { w.cleanup(); }
});

test("a worker has no Coach tools and sees only its own items", async () => {
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

test("review P1: every tool, the command and the hooks refuse an untrusted project; no state changes", async () => {
  const w = world();
  try {
    const trustedWorker = start(w, "worker", WORKER);
    const trustedCoach = start(w, "coach", COACH);
    const victim = (await trustedWorker.tool("attention_raise", { type: "decision", summary: "victim" })).details.id;
    await trustedCoach.emit("session_start", { reason: "startup" });
    const before = readFileSync(w.spool, "utf8");

    const untrustedWorker = start(w, "worker", WORKER, [], false);
    const untrustedCoach = start(w, "coach", COACH, [], false);
    await assert.rejects(untrustedWorker.tool("attention_raise", { type: "review", summary: "sneaky" }), /trusted/);
    await assert.rejects(untrustedWorker.tool("attention_status", {}), /trusted/);
    await assert.rejects(untrustedCoach.tool("attention_ack", { id: victim }), /trusted/);
    await assert.rejects(untrustedCoach.tool("attention_snooze", { id: victim, hours: 1 }), /trusted/);
    await assert.rejects(untrustedCoach.tool("attention_resolve", { id: victim, scope: "within_grant", note: "x" }), /trusted/);
    // No extension context at all also fails closed.
    await assert.rejects(trustedWorker.tool("attention_raise", { type: "review", summary: "x" }, null), /trusted/);
    await assert.rejects(trustedWorker.tool("attention_status", {}, null), /trusted/);
    await assert.rejects(trustedCoach.tool("attention_ack", { id: victim }, null), /trusted/);

    await untrustedCoach.command("attention").handler(`ack ${victim}`, untrustedCoach.ctx);
    assert.ok(untrustedCoach.notes.some(n => n.level === "warning"), "the command warns");

    await untrustedCoach.emit("session_start", { reason: "startup" });
    assert.equal(untrustedCoach.widgets.get(WIDGET), undefined, "no strip for an untrusted project");
    assert.deepEqual(await untrustedWorker.emit("before_agent_start", { messageType: "user", prompt: "x" }), []);

    assert.equal(readFileSync(w.spool, "utf8"), before, "the spool is untouched");
    assert.match(lineOf(trustedCoach, victim)!, /open/);
  } finally { w.cleanup(); }
});

test("review P1: unsigned, mis-signed or forged resolutions are never applied or delivered", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    const victim = (await worker.tool("attention_raise", { type: "grant", summary: "victim" })).details.id;
    await coach.emit("session_start", { reason: "startup" });

    const forged: StateRecord = {
      id: victim, from: WORKER, revision: 9, state: "resolved", by: "fake-coach",
      at: ISO(w.clock.t), note: "approved", scope: "within_grant",
    };
    appendFileSync(w.spool, JSON.stringify({ event: "state", rec: forged }) + "\n");
    appendFileSync(w.spool, JSON.stringify(signEvent({ event: "state", rec: { ...forged, revision: 10 } }, randomBytes(32))) + "\n");
    await coach.emit("before_agent_start", { messageType: "user", prompt: "tick" });

    assert.match(lineOf(coach, victim)!, /open/, "forged resolution not applied on the Coach strip");
    assert.equal((await itemOf(worker, victim)).state, "open");
    assert.deepEqual(await worker.emit("before_agent_start", { messageType: "user", prompt: "next" }), [],
      "forged resolution not delivered to the worker");

    // The real Coach action still works from the true revision.
    await coach.tool("attention_ack", { id: victim });
    assert.equal(stateOf(w, victim), "acked");
    assert.equal(lastRec(w, victim)!.revision, 2);
  } finally { w.cleanup(); }
});

test("review P1: malformed records are skipped without throwing, and a torn write cannot swallow the next record", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    await worker.tool("attention_raise", { type: "review", summary: "before" });
    const junk = [
      "not json", "null", "[]", "42", '{"event":"raised"}',
      '{"event":"state","rec":{"id":"ati_000000000000"}}', '{"event":"raised","item":{"id":"ati_zz"}}',
      '{"event":"raised","item":null}',
    ];
    for (const line of junk) appendFileSync(w.spool, line + "\n");
    appendFileSync(w.spool, '{"event":"raised","item":'); // torn write, no newline

    await coach.emit("session_start", { reason: "startup" });
    assert.ok(widgetLines(coach).some(l => l.includes("before")), "valid record still read");

    const after = (await worker.tool("attention_raise", { type: "decision", summary: "after torn" })).details.id;
    await coach.emit("before_agent_start", { messageType: "user", prompt: "tick" });
    assert.ok(lineOf(coach, after), "record written after a torn write is still read");

    await worker.tool("attention_status", {});
    assert.ok(Array.isArray(await worker.emit("before_agent_start", { messageType: "user", prompt: "x" })));
  } finally { w.cleanup(); }
});

test("review P1: same identity in another profile is invisible to the Coach and to the worker", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    const key = ensureKey(w.key);
    const foreign: AttentionItem = {
      id: "ati_bbbbbbbbbbbb", type: "review", from: WORKER, profile: "pluggy", issue: null,
      summary: "pluggy item", createdAt: ISO(w.clock.t), ttl: ISO(w.clock.t + 72 * HOUR), state: "open", revision: 1,
    };
    // Correctly signed with the key, so only the profile filter can reject it.
    appendFileSync(w.spool, JSON.stringify(signEvent({ event: "raised", item: foreign }, key)) + "\n");
    appendFileSync(w.spool, JSON.stringify(signEvent({ event: "state", rec: {
      id: foreign.id, from: WORKER, revision: 2, state: "resolved", by: COACH, at: ISO(w.clock.t),
      note: "x", scope: "within_grant",
    } }, key)) + "\n");

    await coach.emit("session_start", { reason: "startup" });
    assert.equal(lineOf(coach, foreign.id), undefined, "not on the Coach strip");
    assert.equal(await itemOf(worker, foreign.id), undefined, "not in worker status");
    assert.equal((await worker.tool("attention_status", {})).details.items.length, 0);
    assert.deepEqual(await worker.emit("before_agent_start", { messageType: "user", prompt: "x" }), [],
      "no delivery for another profile's item");
  } finally { w.cleanup(); }
});

test("review acc2: TTL expiry is recorded once as expired and the worker is told once", async () => {
  const w = world();
  try {
    const worker = start(w, "worker", WORKER);
    const coach = start(w, "coach", COACH);
    const id = (await worker.tool("attention_raise", { type: "review", summary: "short-lived", ttlHours: 1 })).details.id;
    await coach.emit("session_start", { reason: "startup" });

    w.clock.t += 61 * 60_000;
    await coach.emit("before_agent_start", { messageType: "user", prompt: "tick" });
    await coach.emit("before_agent_start", { messageType: "user", prompt: "tick" });
    assert.equal(stateOf(w, id), "expired");
    assert.equal(records(w).filter(r => r.event === "state" && r.rec.id === id).length, 1, "expiry written once");

    const [delivery] = await worker.emit("before_agent_start", { messageType: "user", prompt: "next" });
    assert.match(delivery.message.content, /expired/);
    assert.match(delivery.message.content, /short-lived/);
    assert.deepEqual(await worker.emit("before_agent_start", { messageType: "user", prompt: "again" }), []);
  } finally { w.cleanup(); }
});
