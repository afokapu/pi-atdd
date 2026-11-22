// URN: test:pi-atdd:attention-seat-live:PLT-118
// Acceptance: acc:pi-atdd:PLT-118-A02
// Acceptance: acc:pi-atdd:PLT-118-A05
// Acceptance: acc:pi-atdd:PLT-118-A06
// PLT-118 PR #31 return: the worker route follows the CURRENT authorized seat binding, and
// attention writes are fenced against a seat transfer. Real seat lease, real child process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { attentionSeatOptions } from "../src/attention-seat.ts";
import { bootstrapSeat, executionConfigFromEnv, readSeatLease } from "../src/execution-seat.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";

const CHILD = join(import.meta.dirname, "fixtures", "seat-transfer-child.ts");
type Entry = { type: string; customType?: string; data?: unknown };

function world() {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-seat-live-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "proof.txt"), "one\n");
  execFileSync("git", ["-C", repo, "add", "proof.txt"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "i"]);
  const seatEnv: NodeJS.ProcessEnv = {
    PI_CODING_AGENT_DIR: root, PI_ATDD_EXECUTION_MODE: "standalone",
    PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd", PI_ATDD_EXECUTION_TASK_ID: "PLT-118",
    PI_ATDD_EXECUTION_COACH_ADDRESS: "main@pi-atdd", PI_ATDD_EXECUTION_SEAT_ADDRESS: "driver@pi-atdd",
    PI_ATDD_EXECUTION_EXECUTION_ID: "run-a", PI_ATDD_EXECUTION_SESSION_ID: "session-a",
    PI_ATDD_EXECUTION_MODEL_ID: "provider/model", PI_ATDD_EXECUTION_GENERATION: "1",
    PI_ATDD_EXECUTION_OWNER_TOKEN: "token-a",
  };
  const attention = (role: "worker" | "coach"): NodeJS.ProcessEnv => ({
    PI_CODING_AGENT_DIR: root, PI_ATDD_ATTENTION_ROLE: role, PI_ATDD_ATTENTION_PROFILE: "forge",
    PI_ATDD_ATTENTION_IDENTITY: role + "-1", PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd",
    PI_ATDD_ATTENTION_COACH_ADDRESS: "main@pi-atdd",
    ...(role === "worker" ? { PI_ATDD_ATTENTION_TASK_ID: "PLT-118", PI_ATDD_ATTENTION_EXECUTION_ID: "run-a" } : {}),
  });
  bootstrapSeat(executionConfigFromEnv(seatEnv)!);
  return { root, repo, seatEnv, attention, spool: join(root, "attention", "spool.jsonl"),
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const session = (repo: string, id: string, entries: Entry[]) => ({
  cwd: repo, model: { provider: "provider", id: "model" }, isProjectTrusted: () => true,
  sessionManager: { getSessionId: () => id, getBranch: () => entries },
  ui: { setWidget: () => {}, notify: () => {} } });
function strip(env: NodeJS.ProcessEnv, entries: Entry[], extra: Record<string, unknown> = {}, seatEnv?: NodeJS.ProcessEnv) {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const pi = { on: (n: string, f: Function) => handlers.set(n, [...handlers.get(n) ?? [], f]),
    registerTool: (d: any) => tools.set(d.name, d), registerCommand: () => {},
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    sendMessage: () => {} };
  const seat = seatEnv ? registerSeatExecution(pi as any, seatEnv) : undefined;
  registerAttentionStrip(pi as any, { env, ...attentionSeatOptions(seat), ...extra });
  return { seat, tool: (n: string, ctx: unknown, p: Record<string, unknown> = {}) =>
      tools.get(n).execute("c", p, undefined, undefined, ctx),
    emit: async (n: string, ctx: unknown, e: unknown = {}) => {
      const out: any[] = [];
      for (const f of handlers.get(n) ?? []) { const r = await f(e, ctx); if (r !== undefined) out.push(r); }
      return out;
    } };
}

test("PLT-118 fix P1 A05: an authorized in-process successor keeps attention tools and resolution delivery; the stale session does not", async () => {
  const w = world();
  try {
    const entries: Entry[] = [];
    const worker = strip(w.attention("worker"), entries, {}, w.seatEnv);
    const a = session(w.repo, "session-a", entries);
    await worker.emit("session_start", a);
    const first = (await worker.tool("attention_raise", a, { type: "decision", summary: "before rotation" })).details.item;
    assert.equal(first.route.sourceExecutionId, "run-a");

    // PLT-117 handoff: the real seat controller rotates executionId and fences session-a.
    const cp = worker.seat!.checkpoint(a, { state: "verified", pendingIds: [first.id] });
    const b = session(w.repo, "session-b", entries);
    worker.seat!.activateSuccessor(b, cp);
    const rotated = worker.seat!.current().binding.executionId;
    assert.notEqual(rotated, "run-a");

    // The Coach resolves the earlier item; the successor must still receive it and keep its tools.
    const coach = strip(w.attention("coach"), [], { authorize: () => true });
    const c = session(w.repo, "coach-session", []);
    await coach.tool("attention_resolve", c, { id: first.id, scope: "within_grant", note: "approved" });
    const second = (await worker.tool("attention_raise", b, { type: "review", summary: "after rotation" })).details.item;
    assert.equal(second.route.sourceExecutionId, rotated);
    assert.equal(second.route.taskId, "PLT-118");
    const turn = await worker.emit("before_agent_start", b);
    assert.ok(turn.some(r => new RegExp(first.id).test(r.message.content) && /Coach/.test(r.message.content)));
    assert.equal((await worker.tool("attention_status", b)).details.items.map((i: any) => i.id).join(), second.id); // resolved item left operational memory

    // The stale predecessor session is still refused everywhere.
    await assert.rejects(worker.tool("attention_raise", a, { type: "decision", summary: "stale" }), /not authorized/);
    await assert.rejects(worker.tool("attention_status", a), /not authorized/);
    assert.equal((await worker.emit("before_agent_start", a)).some(r => /attention update/.test(r.message.content)), false);
  } finally { w.cleanup(); }
});

test("PLT-118 fix P1 A02/A05/A06: a seat transfer cannot land between the ownership check and the spool write", async () => {
  const w = world();
  try {
    const entries: Entry[] = [];
    let outcome = "";
    let fired = false;
    // `now` runs inside attention_raise's critical section; a real child process tries the transfer there.
    const worker = strip(w.attention("worker"), entries, { now: () => {
      if (!fired) {
        fired = true;
        outcome = spawnSync(process.execPath, ["--experimental-strip-types", CHILD, w.repo],
          { env: { ...process.env, ...w.seatEnv }, encoding: "utf8" }).stdout.trim();
      }
      return new Date("2026-11-21T10:00:00Z");
    } }, w.seatEnv);
    const a = session(w.repo, "session-a", entries);
    await worker.emit("session_start", a);
    let raised = true;
    try { await worker.tool("attention_raise", a, { type: "decision", summary: "racing write" }); }
    catch { raised = false; }
    const written = existsSync(w.spool) && readFileSync(w.spool, "utf8").includes("racing write");
    assert.ok(fired, "the race hook ran inside the write");
    assert.match(outcome, /^REFUSED/, "a transfer must fail closed while a write holds the seat");
    assert.equal(readSeatLease(worker.seat!.current().leasePath)?.generation, 1);
    assert.equal(raised, written);

    // After a real transfer the old seat can no longer write.
    const cp = worker.seat!.checkpoint(a, { state: "verified", pendingIds: [] });
    worker.seat!.activateSuccessor(session(w.repo, "session-b", entries), cp);
    await assert.rejects(worker.tool("attention_raise", a, { type: "decision", summary: "after transfer" }), /not authorized/);
    assert.equal(readFileSync(w.spool, "utf8").includes("after transfer"), false);
  } finally { w.cleanup(); }
});

test("PLT-118 fix2: a new runtime adopts the rotated lease only for the session the lease names", async () => {
  const w = world();
  try {
    const entries: Entry[] = [];
    const old = strip(w.attention("worker"), entries, {}, w.seatEnv);
    const a = session(w.repo, "session-a", entries);
    const cp = old.seat!.checkpoint(a, { state: "verified", pendingIds: [] });
    old.seat!.activateSuccessor(session(w.repo, "session-b", entries), cp);
    // Pi rebuilds the runtime from the ORIGINAL launch env.
    const rebuilt = strip(w.attention("worker"), entries, {}, w.seatEnv);
    assert.equal(rebuilt.seat!.owns(session(w.repo, "session-a", entries)), false, "the predecessor session is not adopted");
    assert.equal(rebuilt.seat!.owns(session(w.repo, "session-other", entries)), false, "a foreign session is not adopted");
    assert.equal(rebuilt.seat!.current().binding.generation, 1);
    assert.equal(rebuilt.seat!.owns(session(w.repo, "session-b", entries)), true);
    assert.equal(rebuilt.seat!.current().binding.generation, 2);
  } finally { w.cleanup(); }
});
