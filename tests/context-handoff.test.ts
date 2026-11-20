// PLT-102: automatic context handoff at 85% usage.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHandoff, decideContextAction, decideSettle, extractIssueId, INITIAL_HANDOFF_STATE, kickoffText, resolveThresholds,
} from "../src/context-handoff.ts";
import atdd from "../extensions/atdd.ts";

const T = { notifyAt: 80, handoffAt: 85 };

test("thresholds default to 80 notify and 85 handoff, and are configurable", () => {
  assert.deepEqual(resolveThresholds({}), T);
  assert.deepEqual(resolveThresholds({ PI_ATDD_HANDOFF_NOTIFY_AT: "70", PI_ATDD_HANDOFF_AT: "90" }), { notifyAt: 70, handoffAt: 90 });
});

test("invalid thresholds are rejected instead of silently defaulting", () => {
  assert.throws(() => resolveThresholds({ PI_ATDD_HANDOFF_AT: "abc" }), /percentage/);
  assert.throws(() => resolveThresholds({ PI_ATDD_HANDOFF_AT: "101" }), /0 < notify <= handoff <= 100/);
  assert.throws(() => resolveThresholds({ PI_ATDD_HANDOFF_NOTIFY_AT: "90", PI_ATDD_HANDOFF_AT: "85" }), /notify <= handoff/);
  assert.throws(() => resolveThresholds({ PI_ATDD_HANDOFF_NOTIFY_AT: "0" }), /0 < notify/);
});

test("below 80% nothing happens; unknown usage never triggers", () => {
  assert.equal(decideContextAction(79.9, T, INITIAL_HANDOFF_STATE).action, "none");
  assert.equal(decideContextAction(null, T, INITIAL_HANDOFF_STATE).action, "none");
  assert.equal(decideContextAction(Number.NaN, T, INITIAL_HANDOFF_STATE).action, "none");
});

test("80% notifies exactly once", () => {
  const first = decideContextAction(80, T, INITIAL_HANDOFF_STATE);
  assert.equal(first.action, "notify");
  assert.equal(decideContextAction(82, T, first.state).action, "none");
});

test("85% requests a handoff exactly once, even after a notify", () => {
  const notified = decideContextAction(81, T, INITIAL_HANDOFF_STATE).state;
  const handoff = decideContextAction(85, T, notified);
  assert.equal(handoff.action, "handoff");
  assert.equal(handoff.state.handoffRequested, true);
  assert.equal(decideContextAction(92, T, handoff.state).action, "none");
});

test("a jump straight past 85% requests the handoff without a prior notify", () => {
  assert.equal(decideContextAction(90, T, INITIAL_HANDOFF_STATE).action, "handoff");
});

test("settle: only an aborted run drops the latched request; a completed run hands off", () => {
  // Usage is not re-read at settle: Pi may compact first and lower it (PLT-102 review P1).
  assert.equal(decideSettle(true), "drop");
  assert.equal(decideSettle(false), "handoff");
});

test("kickoff names the issue when known, so a chained handoff keeps the id", () => {
  assert.match(kickoffText("PLT-102"), /^Continue PLT-102 from the ATDD context handoff above/);
  assert.match(kickoffText(undefined), /^Continue from the ATDD context handoff above/);
  assert.equal(extractIssueId(kickoffText("PLT-102")), "PLT-102");
});

test("issue id is taken from the task text", () => {
  assert.equal(extractIssueId("Implement PLT-102 handoff now"), "PLT-102");
  assert.equal(extractIssueId("no tracker here"), undefined);
});

test("handoff record names issue, workspace, state and resume path, and is bounded", () => {
  const text = buildHandoff({
    task: "PLT-102 automatic context handoff " + "x".repeat(20_000), cwd: "/work/plt-102", percent: 85.4, contextWindow: 200000,
    revision: "abc123", handoffPath: "/work/plt-102/.atdd-pi/handoffs/a.md",
  });
  assert.match(text, /^# ATDD context handoff \(shared\.handoff\)/);
  assert.match(text, /Issue: PLT-102/);
  assert.match(text, /Workspace: \/work\/plt-102/);
  assert.match(text, /Revision: abc123/);
  assert.match(text, /85\.4% of 200000 tokens/);
  assert.match(text, /How to resume:/);
  assert.match(text, /Done \/ last state: not recorded/);
  assert.match(text, /\[clipped\]/);
  assert.ok(text.length <= 6_100, "handoff must stay bounded");
});

test("unknown issue and revision say UNKNOWN instead of guessing", () => {
  const text = buildHandoff({ task: "tidy up", cwd: "/w", percent: 86, contextWindow: 1000 });
  assert.match(text, /Issue: unknown/);
  assert.match(text, /Revision: UNKNOWN/);
});

type Usage = { tokens: number; contextWindow: number; percent: number };
function harness(cwd: string, initial: Usage | undefined) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const sent: Array<{ text: string; options: unknown }> = [];
  const notes: string[] = [];
  let usage = initial;
  atdd({
    on: (name: string, fn: Function) => { handlers.set(name, fn); },
    registerCommand: (name: string, spec: { handler: Function }) => { commands.set(name, spec); },
    registerTool: () => {},
    sendMessage: () => {},
    sendUserMessage: (text: string, options: unknown) => { sent.push({ text, options }); },
  } as any);
  const ctx = {
    cwd, isProjectTrusted: () => true,
    ui: { notify: (m: string) => { notes.push(m); } },
    getContextUsage: () => usage,
    sessionManager: { getSessionFile: () => "/parent.jsonl", getBranch: () => [] },
  };
  const turnEnd = (text: string) =>
    handlers.get("turn_end")!({ message: { content: [{ type: "text", text }] } }, ctx);
  const settle = (aborted = false) => handlers.get("agent_settled")!({ aborted }, ctx);
  const command = (newSession: Function) => commands.get("atdd-handoff")!.handler({}, {
    cwd, ui: ctx.ui, sessionManager: ctx.sessionManager, newSession,
  });
  return { ctx, sent, notes, turnEnd, settle, command, setUsage: (u: Usage | undefined) => { usage = u; } };
}
const at86: Usage = { tokens: 172000, contextWindow: 200000, percent: 86 };
const at40: Usage = { tokens: 80000, contextWindow: 200000, percent: 40 };

test("Pi adapter: turn_end at 86% writes a record, then requests the command-based session switch", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-handoff-"));
  try {
    const h = harness(cwd, at86);
    await h.turnEnd("Implemented the handoff.");
    await h.settle();
    assert.deepEqual(h.sent.map(s => s.text), ["/atdd-handoff"]);
    assert.deepEqual(h.sent[0]!.options, { expandPromptTemplates: true });
    const dir = join(cwd, ".atdd-pi", "handoffs");
    const [file] = readdirSync(dir);
    const body = readFileSync(join(dir, file!), "utf8");
    assert.match(body, /86\.0% of 200000 tokens/);
    await h.settle();
    assert.equal(h.sent.length, 1, "a second settle with no new crossing does nothing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("aborted settle drops the request, says so, and a later crossing can re-arm", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-handoff-"));
  try {
    const h = harness(cwd, at86);
    await h.turnEnd("Working.");
    await h.settle(true);
    assert.equal(h.sent.length, 0);
    assert.match(h.notes.at(-1)!, /aborted/);
    await h.turnEnd("Working again.");
    await h.settle();
    assert.equal(h.sent.length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("compaction after the latch does not cancel the handoff; the record keeps the latched usage", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-handoff-"));
  try {
    const h = harness(cwd, at86);
    await h.turnEnd("Long run.");
    h.setUsage(at40); // Pi compacted between turn_end and agent_settled
    await h.settle();
    assert.deepEqual(h.sent.map(s => s.text), ["/atdd-handoff"]);
    const [file] = readdirSync(join(cwd, ".atdd-pi", "handoffs"));
    const body = readFileSync(join(cwd, ".atdd-pi", "handoffs", file!), "utf8");
    assert.match(body, /86\.0% of 200000 tokens/);
    assert.doesNotMatch(body, /40\.0%/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("cancelled newSession keeps the record for a manual retry, and never retries by itself", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-handoff-"));
  try {
    const h = harness(cwd, at86);
    await h.turnEnd("Done with step one.");
    await h.settle();
    await h.command(async () => ({ cancelled: true }));
    assert.match(h.notes.at(-1)!, /cancelled/);
    assert.match(h.notes.at(-1)!, /\.atdd-pi/);
    assert.equal(h.sent.length, 1, "no automatic re-request after a cancel");

    const seeded: string[] = [];
    const kicks: string[] = [];
    const ok = async (options: any) => {
      await options.setup({ appendMessage: (m: { content: Array<{ text: string }> }) => seeded.push(m.content[0]!.text) });
      await options.withSession({ sendUserMessage: async (t: string) => kicks.push(t) });
      return { cancelled: false };
    };
    await h.command(ok);
    assert.match(seeded[0]!, /ATDD context handoff/);
    assert.match(kicks[0]!, /Continue from the ATDD context handoff/);
    await h.command(ok);
    assert.match(h.notes.at(-1)!, /No ATDD context handoff is pending/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a newSession that throws is reported, and the record is kept for retry", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-handoff-"));
  try {
    const h = harness(cwd, at86);
    await h.turnEnd("Stopping here.");
    await h.settle();
    await h.command(async () => { throw new Error("boom"); });
    assert.match(h.notes.at(-1)!, /failed.*boom/);
    const [file] = readdirSync(join(cwd, ".atdd-pi", "handoffs"));
    assert.ok(file, "record survives a failed switch");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
