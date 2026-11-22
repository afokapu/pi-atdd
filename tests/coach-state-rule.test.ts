// PLT-123: the optional coach-state section in shared.handoff.record-contents.
// Acceptance: the old obligations stay; the new text names the section and its fields; the PLT-122 coach record satisfies it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { buildHandoff, extractIssueIds, extractPullRequests } from "../src/context-handoff.ts";

const FILE = new URL("../catalog/pi-atdd/conventions/shared/handoff/shared.handoff.record-contents.convention.yaml", import.meta.url);
const rule = parse(readFileSync(FILE, "utf8")) as {
  rule_id: string; statement: string; content: { normative_text: string; fix_hint: string; exceptions: string[] };
};
const flat = (s: string) => s.replace(/\s+/g, " ");
const all = flat([rule.statement, rule.content.normative_text, rule.content.fix_hint, ...rule.content.exceptions].join(" "));

test("PLT-123: every existing obligation of the rule is still present", () => {
  assert.equal(rule.rule_id, "shared.handoff.record-contents");
  const statement = flat(rule.statement);
  for (const kept of [
    "MUST carry only bounded facts",
    "explicit `UNKNOWN` markers",
    "best-effort basis",
    "is not general secret safety",
    "MUST NOT copy the predecessor's own output",
    "MUST NOT present any claimed completion as evidence",
    "stated by reference to the original brief",
  ]) assert.ok(statement.includes(kept), "statement lost: " + kept);
  const normative = flat(rule.content.normative_text);
  for (const kept of [
    "redacted on a best-effort basis",
    "Labels or shapes not on the list pass unchanged",
    "recorded as `not recorded`",
    "open items as `UNKNOWN`",
    "a handoff approves nothing",
    "re-verify the repository before relying on any claimed completion",
  ]) assert.ok(normative.includes(kept), "normative_text lost: " + kept);
  assert.match(rule.content.fix_hint, /leave out the predecessor's assistant output/);
  assert.match(rule.content.fix_hint, /bound the record's length/);
});

test("PLT-123: the rule makes a coach-state section optional and names its fields", () => {
  assert.match(all, /Coach state/);
  assert.match(all, /optional/i);
  for (const field of ["role", "issues", "pull requests", "attention items"]) {
    assert.ok(all.toLowerCase().includes(field), "field missing from the rule: " + field);
  }
  assert.match(all, /authoritative source/);
  assert.match(all, /UNKNOWN/);
  // the section is held to the same limits, and adds no way to copy output
  assert.match(flat(rule.content.normative_text), /The section is redacted and bounded like the task text/);
  assert.match(flat(rule.content.normative_text), /never contains the predecessor's assistant output/);
});

test("PLT-123: the PLT-122 coach record satisfies the new text", () => {
  const task = "Coordinate PLT-122 and PLT-117; review https://github.com/o/r/pull/27 and PR #28.";
  const text = buildHandoff({
    task, cwd: "/w", percent: 90, contextWindow: 1000,
    coach: { role: "coach", identity: "main@pi-atdd", profile: "forge", issues: extractIssueIds(task),
      prs: extractPullRequests(task), attention: ["att-1 decision PLT-122 open"] },
  });
  assert.match(text, /^Coach state:$/m);
  assert.match(text, /^Role: coach/m);
  assert.match(text, /^Issues: PLT-122, PLT-117$/m);
  assert.match(text, /^PRs: .*pull\/27/m);
  assert.match(text, /^Attention items: att-1/m);
  assert.match(text, /^Workers: UNKNOWN$/m, "no authoritative source: UNKNOWN");
  // the old obligations hold in the same record
  assert.match(text, /Done \/ last state: not recorded/);
  assert.match(text, /Open items: UNKNOWN/);
});

// --- PLT-123 audit P2: ids and PR links mentioned in chat are not authoritative -------------------
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";

test("PLT-123 P2: a task mentioning an unknown id and PR fills no Issues/PRs field; refs are shown as unverified", async () => {
  const task = "Please look at ZZTEST-999999 and PR #999999.";
  const env = { PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "t@x", PI_ATDD_ATTENTION_PROFILE: "forge" };
  const old = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-p2-"));
  const handlers = new Map<string, Function>();
  atdd({ on: (n: string, fn: Function) => { const p = handlers.get(n); handlers.set(n, p ? async (...a: unknown[]) => (await p(...a)) ?? (await fn(...a)) : fn); },
    registerCommand: () => {}, registerTool: () => {}, sendMessage: () => {}, appendEntry: () => {}, getActiveTools: () => [], setActiveTools: () => {},
    sendUserMessage: () => {} } as any);
  const ctx = { cwd, isProjectTrusted: () => true, ui: { notify: () => {}, setWidget: () => {} },
    getContextUsage: () => ({ tokens: 900, contextWindow: 1000, percent: 90 }), model: { provider: "p", id: "m" },
    sessionManager: { getSessionFile: () => "/p.jsonl", getSessionId: () => "s",
      getBranch: () => [{ type: "message", message: { role: "user", content: [{ type: "text", text: task }] } }] } };
  try {
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("turn_end")!({ message: { content: [] } }, ctx);
    await handlers.get("agent_settled")!({ aborted: false }, ctx); // ATD-37: the coach's state request
    await handlers.get("agent_settled")!({ aborted: false }, ctx); // the record, after the coach's reply
    const d = join(cwd, ".atdd-pi", "handoffs");
    const rec = readFileSync(join(d, readdirSync(d)[0]!), "utf8");
    assert.match(rec, /^Issue: unknown/m, "header issue is not taken from chat text");
    assert.doesNotMatch(rec.split("Task (")[0]!, /ZZTEST-999999/, "no header line carries the chat id");
    assert.match(rec, /^Issues: UNKNOWN$/m);
    assert.match(rec, /^PRs: UNKNOWN$/m);
    assert.match(rec, /^Task references \(unverified, mentioned in the task text\): .*ZZTEST-999999.*#999999/m);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("PLT-123 P2: the rule no longer calls ids or PR links in chat text authoritative", () => {
  const n = flat(rule.content.normative_text);
  assert.doesNotMatch(n, /tracker ids and pull request links in the task text/);
  assert.match(n, /unverified task references/);
});

test("PLT-123 P2: a verified issue passed by the caller is the only source of the header issue", () => {
  const base = { cwd: "/w", percent: 90, contextWindow: 1000 };
  assert.match(buildHandoff({ ...base, task: "do ZZTEST-999999" }), /^Issue: unknown/m);
  assert.match(buildHandoff({ ...base, task: "do ZZTEST-999999", issue: "PLT-5" }), /^Issue: PLT-5$/m);
});

test("PLT-123 P2: the successor's kickoff carries no chat-derived issue id (fresh handoff and latest relaunch)", async () => {
  const task = "Please look at ZZTEST-999999.";
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-kick-"));
  const handlers = new Map<string, Function>(); const commands = new Map<string, { handler: Function }>(); const sent: string[] = [];
  atdd({ on: (n: string, fn: Function) => { const p = handlers.get(n); handlers.set(n, p ? async (...a: unknown[]) => (await p(...a)) ?? (await fn(...a)) : fn); },
    registerCommand: (n: string, s: { handler: Function }) => { commands.set(n, s); }, registerTool: () => {}, sendMessage: () => {},
    appendEntry: () => {}, getActiveTools: () => [], setActiveTools: () => {}, sendUserMessage: (t: string) => { sent.push(t); } } as any);
  const sessionManager = { getSessionFile: () => "/p.jsonl", getSessionId: () => "s",
    getBranch: () => [{ type: "message", message: { role: "user", content: [{ type: "text", text: task }] } }] };
  const ctx = { cwd, isProjectTrusted: () => true, ui: { notify: () => {}, setWidget: () => {} },
    getContextUsage: () => ({ tokens: 900, contextWindow: 1000, percent: 90 }), model: { provider: "p", id: "m" }, sessionManager };
  const kicks: string[] = [];
  const ok = async (o: any) => { await o.setup({ appendMessage: () => {} }); await o.withSession({ sendUserMessage: async (t: string) => kicks.push(t) }); return { cancelled: false }; };
  try {
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("turn_end")!({ message: { content: [] } }, ctx);
    await handlers.get("agent_settled")!({ aborted: false }, ctx);
    await commands.get("atdd-handoff")!.handler("", { cwd, ui: ctx.ui, sessionManager, newSession: ok });
    await commands.get("atdd-handoff")!.handler("latest", { cwd, ui: ctx.ui, sessionManager, newSession: ok });
    assert.equal(kicks.length, 2);
    for (const k of kicks) { assert.doesNotMatch(k, /ZZTEST-999999/); assert.match(k, /^Continue from the ATDD context handoff above\./); }
  } finally { await handlers.get("session_shutdown")?.({}, ctx); rmSync(cwd, { recursive: true, force: true }); }
});
