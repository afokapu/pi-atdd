// URN: test:handoff:coach-state:ATD-37-Acceptance-01
// Acceptance: acc:handoff:ATD-37-Acceptance-01
// Acceptance: acc:handoff:ATD-37-Acceptance-02
// Acceptance: acc:handoff:ATD-37-Acceptance-03
// ATD-37: a coach handoff keeps the original brief as the task across hops (relay messages are not tasks),
// and lists workers, PRs, decisions and next steps from state the coach wrote before the switch.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHandoff, isRelay, parseCoachStateFile, resolveTask, taskFromPrompt,
} from "../src/context-handoff.ts";
import atdd from "../extensions/atdd.ts";

const TASK = "ATD-37: keep the coach brief as the task across hops.";
const RELAY = "[from pi-atdd · forge | reply-to 01a2034e-8d90-7259]\nSend again.";
const KICKOFF = "Continue from the ATDD context handoff above.";
const base = { cwd: "/w", percent: 90, contextWindow: 1000 };
const STATE = {
  workers: ["worker-atd-37 (ATD-37 coder)"],
  prs: ["#40"],
  decisions: ["Draft PR only; no merge, tag or install move"],
  nextSteps: ["Review PR #40 when ready"],
};

/** Clears every PI_ATDD_* variable (a seat's own env must not leak into the test) and restores it after. */
async function withAtddEnv(overrides: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map<string, string>();
  for (const k of Object.keys(process.env)) if (k.startsWith("PI_ATDD_")) saved.set(k, process.env[k]!);
  for (const k of saved.keys()) delete process.env[k];
  Object.assign(process.env, overrides);
  try { await fn(); } finally {
    for (const k of Object.keys(process.env)) if (k.startsWith("PI_ATDD_")) delete process.env[k];
    for (const [k, v] of saved) process.env[k] = v;
  }
}

const userMsg = (text: string) => ({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });

function harness(cwd: string, branch: unknown[], percent: number) {
  const handlers = new Map<string, Function>();
  const sent: string[] = [];
  atdd({
    on: (n: string, fn: Function) => {
      const prev = handlers.get(n);
      handlers.set(n, prev ? async (...a: unknown[]) => { const r1 = await prev(...a); const r2 = await fn(...a); return r1 ?? r2; } : fn);
    },
    registerCommand: () => {}, registerTool: () => {}, sendMessage: () => {}, appendEntry: () => {},
    getActiveTools: () => [], setActiveTools: () => {},
    sendUserMessage: (t: string) => { sent.push(t); },
  } as any);
  const ctx = { cwd, isProjectTrusted: () => true, ui: { notify: () => {}, setWidget: () => {} },
    getContextUsage: () => ({ tokens: percent * 10, contextWindow: 1000, percent }), model: { provider: "provider", id: "model-a" },
    sessionManager: { getSessionFile: () => "/p.jsonl", getBranch: () => branch, getSessionId: () => "session-a" } };
  return {
    sent, ctx,
    start: () => handlers.get("session_start")!({}, ctx),
    stop: () => handlers.get("session_shutdown")?.({}, ctx),
    turnEnd: () => handlers.get("turn_end")!({ message: { content: [] } }, ctx),
    settle: () => handlers.get("agent_settled")!({ aborted: false }, ctx),
  };
}
const recordsIn = (cwd: string) => {
  const d = join(cwd, ".atdd-pi", "handoffs");
  try { return readdirSync(d).sort().map(f => readFileSync(join(d, f), "utf8")); } catch { return []; }
};
const taskBlock = (rec: string) => /<<<TASK\n([\s\S]*?)\n<<<END TASK>>>/.exec(rec)?.[1];

// --- Acceptance-01: the relay is never the task -----------------------------------------------
test("Acceptance-01: a relay message is recognised by its [from ...] tag and is not a task", () => {
  assert.equal(isRelay(RELAY), true);
  assert.equal(isRelay("  [from x · y | reply-to z]\nhi"), true, "leading space is tolerated");
  assert.equal(isRelay("Send again."), false, "a plain owner message is not a relay");
  assert.equal(isRelay("[fro"), false);
});

test("Acceptance-01: resolveTask keeps the brief when a relay comes after it, with and without a record", () => {
  assert.equal(resolveTask([TASK, RELAY]), TASK, "the brief survives a later relay");
  assert.equal(resolveTask([RELAY]), "unknown task (session resume requires authoritative task lookup)", "a relay alone is no task");
  const rec = buildHandoff({ ...base, task: TASK, hop: 1 });
  assert.equal(resolveTask([rec, KICKOFF, RELAY]), TASK, "after a hop, the record's brief wins over a relay");
  assert.equal(resolveTask([rec, KICKOFF, "Now also fix ATD-40.", RELAY]), "Now also fix ATD-40.",
    "a real later owner message still replaces the brief");
});

test("Acceptance-01: the live task update ignores relays and kickoffs, and takes a real prompt", () => {
  assert.equal(taskFromPrompt(TASK, RELAY), TASK);
  assert.equal(taskFromPrompt(TASK, KICKOFF), TASK);
  assert.equal(taskFromPrompt("", RELAY), "unknown task (session resume requires authoritative task lookup)");
  assert.equal(taskFromPrompt(TASK, "Second task."), "Second task.");
  assert.equal(taskFromPrompt("", undefined), "unknown task");
});

// --- Acceptance-02: workers, PRs, decisions and next steps come from agent-written state --------
test("Acceptance-02: the agent-written state file is parsed, bounded and redacted", () => {
  const parsed = parseCoachStateFile(JSON.stringify({ ...STATE, decisions: ["use password=hunter2 for x"] }));
  assert.deepEqual(parsed?.workers, STATE.workers);
  assert.deepEqual(parsed?.prs, STATE.prs);
  assert.doesNotMatch(parsed?.decisions?.[0] ?? "", /hunter2/, "a credential-shaped value is redacted");
  assert.equal(parseCoachStateFile("not json"), undefined, "unreadable state is not guessed");
  assert.equal(parseCoachStateFile("[1,2]"), undefined, "a non-object is not state");
  assert.equal(parseCoachStateFile(JSON.stringify({ workers: "one string" }))?.workers, undefined, "a non-array field is UNKNOWN");
  const many = parseCoachStateFile(JSON.stringify({ prs: Array.from({ length: 30 }, (_, i) => "#" + i) }));
  assert.equal(many?.prs?.length, 10, "each list is bounded");
});

test("Acceptance-02: a coach record lists the agent-written fields, not UNKNOWN, and says where they came from", () => {
  const text = buildHandoff({ ...base, task: TASK, coach: { role: "coach", ...STATE,
    stateFile: { writtenAt: "2026-11-22T14:10:00.000Z" } } });
  assert.match(text, /^Workers: worker-atd-37 \(ATD-37 coder\)$/m);
  assert.match(text, /^PRs: #40$/m);
  assert.match(text, /^Owner decisions: Draft PR only; no merge, tag or install move$/m);
  assert.match(text, /^Next steps: Review PR #40 when ready$/m);
  assert.match(text, /^Agent-written state: written 2026-11-22T14:10:00\.000Z; unverified, written by the coach before the switch$/m);
});

test("Acceptance-02: without a state file the coach fields stay UNKNOWN and the source says so", () => {
  const text = buildHandoff({ ...base, task: TASK, coach: { role: "coach" } });
  assert.match(text, /^Workers: UNKNOWN$/m);
  assert.match(text, /^Next steps: UNKNOWN$/m);
  assert.match(text, /^Agent-written state: UNKNOWN \(no readable state written before the switch\)$/m);
});

// --- Acceptance-03: the successor needs no rebuild from the predecessor's session -----------------
test("Acceptance-03: the successor's record carries the brief and the coach state, and its kickoff is not a task", () => {
  const rec = buildHandoff({ ...base, task: TASK, hop: 1, coach: { role: "coach", ...STATE, stateFile: { writtenAt: "t" } } });
  assert.equal(resolveTask([rec, KICKOFF, RELAY]), TASK);
  assert.match(rec, /^Workers: worker-atd-37/m);
  assert.match(rec, /^PRs: #40$/m);
  assert.match(rec, /^Owner decisions: Draft PR only/m);
  assert.match(rec, /^Next steps: Review PR #40/m);
});

// --- adapter: the whole path through the Pi extension ----------------------------------------------
test("Acceptance-01/02/03 adapter: relay after the brief; the coach writes its state before the switch", async () => {
  await withAtddEnv({ PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "main@pi-atdd", PI_ATDD_ATTENTION_PROFILE: "forge" }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-atd37-"));
    const h = harness(cwd, [userMsg(TASK), userMsg(RELAY)], 90);
    try {
      await h.start();
      await h.turnEnd();
      await h.settle();
      assert.equal(recordsIn(cwd).length, 0, "no record before the coach has written its state");
      assert.equal(h.sent.length, 1);
      assert.match(h.sent[0]!, /^\[from atdd-pi/, "the ask is tagged as non-task");
      assert.match(h.sent[0]!, /\.atdd-pi\/coach-state\.json/);

      mkdirSync(join(cwd, ".atdd-pi"), { recursive: true });
      writeFileSync(join(cwd, ".atdd-pi", "coach-state.json"), JSON.stringify(STATE));
      await h.turnEnd(); // the coach's reply turn
      await h.settle();

      const [rec] = recordsIn(cwd);
      assert.ok(rec, "the record is written after the state step");
      assert.equal(taskBlock(rec!), TASK, "Acceptance-01: the record's task is the original brief, not the relay");
      assert.match(rec!, /^Workers: worker-atd-37/m, "Acceptance-02: workers from agent-written state");
      assert.match(rec!, /^PRs: #40$/m);
      assert.match(rec!, /^Owner decisions: Draft PR only/m);
      assert.match(rec!, /^Next steps: Review PR #40/m);
      assert.equal(h.sent.at(-1), "/atdd-handoff", "the switch follows the record");
      assert.equal(h.sent.filter(s => s.startsWith("[from atdd-pi")).length, 1, "the ask is sent once");
    } finally { await h.stop?.(); rmSync(cwd, { recursive: true, force: true }); }
  });
});

test("Acceptance-02 adapter: a coach that writes no state still hands off once, with UNKNOWN fields (no loop)", async () => {
  await withAtddEnv({ PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "main@pi-atdd", PI_ATDD_ATTENTION_PROFILE: "forge" }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-atd37-"));
    const h = harness(cwd, [userMsg(TASK)], 90);
    try {
      await h.start();
      await h.turnEnd();
      await h.settle();
      // the coach's reply turn ends above the threshold again; it must not re-ask, and the run settles again
      await h.turnEnd();
      await h.settle();
      await h.turnEnd();
      await h.settle();
      const recs = recordsIn(cwd);
      assert.equal(recs.length, 1, "exactly one record");
      assert.match(recs[0]!, /^Workers: UNKNOWN$/m);
      assert.equal(h.sent.filter(s => s.startsWith("[from atdd-pi")).length, 1, "asked once across reply turns");
      assert.equal(h.sent.filter(s => s === "/atdd-handoff").length, 1);
    } finally { await h.stop?.(); rmSync(cwd, { recursive: true, force: true }); }
  });
});

test("Acceptance-02 adapter: a state file that is a symlink out of the workspace is not read", async () => {
  await withAtddEnv({ PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "main@pi-atdd", PI_ATDD_ATTENTION_PROFILE: "forge" }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-atd37-"));
    const outside = mkdtempSync(join(tmpdir(), "pi-atdd-atd37-outside-"));
    const h = harness(cwd, [userMsg(TASK)], 90);
    try {
      writeFileSync(join(outside, "state.json"), JSON.stringify(STATE));
      await h.start();
      await h.turnEnd();
      await h.settle();
      // the coach writes a link to a file outside the workspace as its state
      mkdirSync(join(cwd, ".atdd-pi"), { recursive: true });
      symlinkSync(join(outside, "state.json"), join(cwd, ".atdd-pi", "coach-state.json"));
      await h.settle();
      const [rec] = recordsIn(cwd);
      assert.ok(rec);
      assert.match(rec!, /^Workers: UNKNOWN$/m, "a linked state file is never read");
    } finally { await h.stop?.(); rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });
});

test("Acceptance-02 adapter: a redirected .atdd-pi is neither read nor cleaned up (no delete outside the workspace)", async () => {
  await withAtddEnv({ PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "main@pi-atdd", PI_ATDD_ATTENTION_PROFILE: "forge" }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-atd37-"));
    const outside = mkdtempSync(join(tmpdir(), "pi-atdd-atd37-outside-"));
    const h = harness(cwd, [userMsg(TASK)], 90);
    try {
      writeFileSync(join(outside, "coach-state.json"), JSON.stringify(STATE));
      symlinkSync(outside, join(cwd, ".atdd-pi"));
      await h.start();
      await h.turnEnd();
      await h.settle();
      await h.turnEnd();
      await h.settle();
      assert.equal(readFileSync(join(outside, "coach-state.json"), "utf8"), JSON.stringify(STATE), "the file outside is untouched");
      const [rec] = recordsIn(cwd);
      assert.match(rec ?? "", /^Workers: UNKNOWN$/m, "a redirected state directory is never read");
    } finally { await h.stop?.(); rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });
});
