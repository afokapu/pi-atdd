// PLT-122 real-session smoke: a Coach session renews itself in a real Pi RPC process (isolated agent dir,
// faux 20k-token model) with role/identity/profile and model tier unchanged, the attention tool callable in the
// successor, the original task kept, and a fresh process relaunching from the kept record with /atdd-handoff latest.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const agentDir = mkdtempSync(join(tmpdir(), "pi-renew-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-renew-cwd-"));
const extDir = mkdtempSync(join(tmpdir(), "pi-renew-ext-"));
process.on("exit", () => { for (const d of [agentDir, cwd, extDir]) rmSync(d, { recursive: true, force: true }); });
execSync("git init -q && git commit -q --allow-empty -m init", { cwd });
// reserveTokens 2000: Pi's compaction line (window minus reserve) must sit above the handoff thresholds used here.
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false, reserveTokens: 2000 } }));
const aiPath = resolve(root, "node_modules/@earendil-works/pi-ai/dist/index.js");
// ATD-37: the state the faux coach writes into .atdd-pi/coach-state.json when asked before the switch.
const COACH_STATE = { workers: ["worker-atd-37 (ATD-37 coder)"], prs: ["#45"], decisions: ["Draft PR only; no merge, tag or install move"], nextSteps: ["Review PR #45 when ready"] };
writeFileSync(join(extDir, "faux.ts"), `
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(aiPath)};
import { mkdirSync, writeFileSync } from "node:fs";
export default function (pi: any) {
  const f = fauxProvider({ provider: "renew-faux", models: [{ id: "tier-low", contextWindow: 20000 }, { id: "tier-med", contextWindow: 20000 }] });
  const g = globalThis as any; // the extension is re-instantiated for every session; the process is not
  // ATD-37: a coach asked for its state writes .atdd-pi/coach-state.json. The write is a side effect of the faux turn,
  // not a tool call: a scoped coach without a bound seat has every tool refused (ATD-36), and this smoke binds no seat.
  const STATE_TEXT = ${JSON.stringify(JSON.stringify(COACH_STATE))};
  const textOf = (m: any): string => typeof m.content === "string" ? m.content : (m.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
  const writeState = () => { mkdirSync(".atdd-pi", { recursive: true }); writeFileSync(".atdd-pi/coach-state.json", STATE_TEXT); return fauxAssistantMessage("coach state written"); };
  const reply = (context: any) => {
    // Pi adds its own context messages around the user's message, so look at everything since the last assistant turn.
    const since = context.messages.slice(context.messages.map((m: any) => m.role).lastIndexOf("assistant") + 1);
    const last = [...since].reverse().find((m: any) => m.role === "toolResult");
    const asked = since.some((m: any) => m.role === "user" && textOf(m).includes("coach-state.json"));
    if (last && last.role === "toolResult") {
      return fauxAssistantMessage("ok");
    }
    if (asked) return writeState();
    const n = g.__renewCalls = (g.__renewCalls ?? 0) + 1;
    return n === 2 ? fauxAssistantMessage(fauxToolCall("attention_ack", { id: "no-such-item" }), { stopReason: "toolUse" }) : fauxAssistantMessage("ok " + "x".repeat(300));
  };
  f.setResponses(Array.from({ length: 60 }, () => (context: any) => reply(context)));
  pi.registerProvider(f.provider);
}`);

const TASK = "Coordinate PLT-122 and PLT-117 for the Coach; review PR #28. " + "detail ".repeat(400);
const ENV = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1",
  PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "main@pi-atdd", PI_ATDD_ATTENTION_PROFILE: "forge",
  PI_ATDD_HANDOFF_AT: "12", PI_ATDD_HANDOFF_NOTIFY_AT: "8", PI_ATDD_HANDOFF_MAX_HOPS: "2" };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failures.push(what); };

async function session(run: (send: (o: object) => void, events: any[]) => Promise<void>, workdir = cwd, extraEnv: Record<string, string> = {}) {
  const child = spawn(resolve(root, "node_modules/.bin/pi"), ["--offline", "--approve", "-e", resolve(root, "extensions/atdd.ts"),
    "-e", join(extDir, "faux.ts"), "--mode", "rpc", "--model", "renew-faux/tier-med"], { cwd: workdir, env: { ...ENV, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"] });
  const events: any[] = []; let buf = "";
  child.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { try { events.push(JSON.parse(buf.slice(0, i))); } catch {} buf = buf.slice(i + 1); } });
  child.stderr.on("data", () => {});
  const send = (o: object) => child.stdin.write(JSON.stringify(o) + "\n");
  try { await sleep(3000); await run(send, events); } finally { child.kill(); }
}
const state = async (send: (o: object) => void, events: any[], id: string) => {
  send({ id, type: "get_state" }); await sleep(800);
  return events.find(e => e.id === id)?.data as { model?: { id: string }; sessionId?: string; sessionFile?: string } | undefined;
};

await session(async (send, events) => {
  const before = await state(send, events, "a");
  send({ type: "prompt", message: TASK });
  await sleep(16000);
  const after = await state(send, events, "b");
  check(!!before?.sessionId && before.sessionId !== after?.sessionId, "A01 successor session started automatically");
  check(before?.model?.id === "tier-med" && after?.model?.id === "tier-med", "A01 model tier unchanged (tier-med)");
  const records = (() => { try { return readdirSync(join(cwd, ".atdd-pi", "handoffs")).map(f => readFileSync(join(cwd, ".atdd-pi", "handoffs", f), "utf8")); } catch { return []; } })();
  check(records.length === 2, "two records written (hop limit 2 stops a third)");
  check(/Hop: 2/.test(records[1] ?? "") && (records[1] ?? "").includes("Coordinate PLT-122 and PLT-117 for the Coach"), "review P1: the original task survives hop 2 in a real session");
  check(!/Task[^\n]*\n<<<TASK\nContinue /.test(records[1] ?? ""), "review P1: the kickoff did not replace the task");
  check(/Coach state:/.test(records[0] ?? "") && /Role: coach \(main@pi-atdd, profile forge\)/.test(records[0] ?? ""), "A04 coach-state section with role/identity/profile");
  check(/^Workers: worker-atd-37/m.test(records[0] ?? "") && /PLT-122, PLT-117/.test(records[0] ?? ""), "A04 workers from the coach-written state; issues listed");
  const tool = events.find(e => e.type === "tool_execution_end" && e.toolName === "attention_ack");
  check(!!tool && !/not found|unknown tool/i.test(JSON.stringify(tool.result ?? "")), "A01 attention tool is registered and runs in the successor");
  const sessionFile = after?.sessionFile ? readFileSync(after.sessionFile, "utf8") : "";
  check(sessionFile.includes("Coordinate PLT-122 and PLT-117"), "A04 original task text is in the successor session");
});

await session(async (send, events) => {
  const before = await state(send, events, "c");
  send({ type: "prompt", message: "/atdd-handoff latest" });
  await sleep(6000);
  const after = await state(send, events, "d");
  check(!!before?.sessionId && before.sessionId !== after?.sessionId, "A05 fresh process relaunches from the kept record");
  const file = after?.sessionFile ? readFileSync(after.sessionFile, "utf8") : "";
  check(file.includes("ATDD context handoff") && file.includes("Coordinate PLT-122"), "A05 relaunched session is seeded with the record and original task");
});

// ATD-37: a coach gets an agent relay as its last input before the threshold is crossed. The record keeps the
// brief as the task, and the coach state the coach wrote before the switch reaches the record and the successor.
const BRIEF = "ATD-37: keep the coach brief as the task across hops; review draft PR #45.";
const RELAY = "[from 🧩 PI-ATDD AF8 · Coach | reply-to block:01a20396-2cca-7bbf-a090-c07b41cac010] Send again. " + "detail ".repeat(1200);
const cwd3 = mkdtempSync(join(tmpdir(), "pi-renew-cwd3-"));
process.on("exit", () => rmSync(cwd3, { recursive: true, force: true }));
execSync("git init -q && git commit -q --allow-empty -m init", { cwd: cwd3 });
const taskOf = (rec: string) => /<<<TASK\n([\s\S]*?)\n<<<END TASK>>>/.exec(rec)?.[1];
const recordsIn = (dir: string) => { try { return readdirSync(join(dir, ".atdd-pi", "handoffs")).sort().map(f => readFileSync(join(dir, ".atdd-pi", "handoffs", f), "utf8")); } catch { return []; } };
await session(async (send, events) => {
  const before = await state(send, events, "g");
  send({ type: "prompt", message: BRIEF });
  await sleep(5000);
  check(!existsSync(join(cwd3, ".atdd-pi", "handoffs")), "relay-last: the brief alone does not hand off");
  send({ type: "prompt", message: RELAY });
  await sleep(20000);
  const after = await state(send, events, "h");
  check(!!before?.sessionId && before.sessionId !== after?.sessionId, "relay-last: the threshold crossed after the relay and a successor started");
  const records = recordsIn(cwd3);
  const rec = records[0] ?? "";
  check(records.length >= 1 && taskOf(rec) === BRIEF, "Acceptance-01: the record's task is the original brief, not the relay");
  check(/^Workers: worker-atd-37 \(ATD-37 coder\)$/m.test(rec), "Acceptance-02: workers are listed from the coach-written state");
  check(/^PRs: #45$/m.test(rec), "Acceptance-02: PRs are listed from the coach-written state");
  check(/^Owner decisions: Draft PR only/m.test(rec) && /^Next steps: Review PR #45/m.test(rec), "Acceptance-02: owner decisions and next steps are listed");
  check(!existsSync(join(cwd3, ".atdd-pi", "coach-state.json")), "the coach state file is removed after it is read");
  const succ = after?.sessionFile ? readFileSync(after.sessionFile, "utf8") : "";
  check(succ.includes(BRIEF) && succ.includes("Workers: worker-atd-37"), "Acceptance-03: the successor session carries the brief and the coach state");
}, cwd3, { PI_ATDD_HANDOFF_AT: "35", PI_ATDD_HANDOFF_NOTIFY_AT: "30" }); // relay crosses 35%; the brief alone sits near 29%

// Review P1: a handoff directory redirected outside the workspace is refused, in a real session.
const stray = mkdtempSync(join(tmpdir(), "pi-renew-stray-"));
const work2 = mkdtempSync(join(tmpdir(), "pi-renew-cwd2-"));
process.on("exit", () => { for (const d of [stray, work2]) rmSync(d, { recursive: true, force: true }); });
execSync("git init -q && git commit -q --allow-empty -m init", { cwd: work2 });
mkdirSync(join(stray, "handoffs"), { recursive: true });
const validRecord = readFileSync(join(cwd, ".atdd-pi", "handoffs", readdirSync(join(cwd, ".atdd-pi", "handoffs")).sort()[0]!), "utf8");
writeFileSync(join(stray, "handoffs", "2026-01-01T00-00-00-000Z.md"), validRecord);
symlinkSync(stray, join(work2, ".atdd-pi"));
await session(async (send, events) => {
  const before = await state(send, events, "e");
  send({ type: "prompt", message: "/atdd-handoff latest" });
  await sleep(5000);
  const after = await state(send, events, "f");
  check(!!before?.sessionId && before.sessionId === after?.sessionId, "review P1: a redirected handoff directory starts no successor");
  check(JSON.stringify(events).includes("outside the workspace"), "review P1: the refusal says the directory is outside the workspace");
}, work2);

if (failures.length) { console.error("context renewal smoke FAILED:", failures.join("; ")); process.exitCode = 1; }
else console.log("context renewal smoke passed");
