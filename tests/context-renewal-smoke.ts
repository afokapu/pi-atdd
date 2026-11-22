// PLT-122 real-session smoke: a Coach session renews itself in a real Pi RPC process (isolated agent dir,
// faux 20k-token model) with role/identity/profile and model tier unchanged, the attention tool callable in the
// successor, the original task kept, and a fresh process relaunching from the kept record with /atdd-handoff latest.
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const agentDir = mkdtempSync(join(tmpdir(), "pi-renew-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-renew-cwd-"));
const extDir = mkdtempSync(join(tmpdir(), "pi-renew-ext-"));
process.on("exit", () => { for (const d of [agentDir, cwd, extDir]) rmSync(d, { recursive: true, force: true }); });
execSync("git init -q && git commit -q --allow-empty -m init", { cwd });
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false } }));
const aiPath = resolve(root, "node_modules/@earendil-works/pi-ai/dist/index.js");
writeFileSync(join(extDir, "faux.ts"), `
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(aiPath)};
export default function (pi: any) {
  const f = fauxProvider({ provider: "renew-faux", models: [{ id: "tier-low", contextWindow: 20000 }, { id: "tier-med", contextWindow: 20000 }] });
  const g = globalThis as any; // the extension is re-instantiated for every session; the process is not
  const reply = () => { const n = g.__renewCalls = (g.__renewCalls ?? 0) + 1; return n === 2 ? fauxAssistantMessage(fauxToolCall("attention_ack", { id: "no-such-item" }), { stopReason: "toolUse" }) : fauxAssistantMessage("ok " + "x".repeat(300)); };
  f.setResponses(Array.from({ length: 60 }, () => reply));
  pi.registerProvider(f.provider);
}`);

const TASK = "Coordinate PLT-122 and PLT-117 for the Coach; review PR #28. " + "detail ".repeat(400);
const ENV = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1",
  PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "main@pi-atdd", PI_ATDD_ATTENTION_PROFILE: "forge",
  PI_ATDD_HANDOFF_AT: "12", PI_ATDD_HANDOFF_NOTIFY_AT: "8", PI_ATDD_HANDOFF_MAX_HOPS: "1" };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failures.push(what); };

async function session(run: (send: (o: object) => void, events: any[]) => Promise<void>) {
  const child = spawn(resolve(root, "node_modules/.bin/pi"), ["--offline", "--approve", "-e", resolve(root, "extensions/atdd.ts"),
    "-e", join(extDir, "faux.ts"), "--mode", "rpc", "--model", "renew-faux/tier-med"], { cwd, env: ENV, stdio: ["pipe", "pipe", "pipe"] });
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
  await sleep(12000);
  const after = await state(send, events, "b");
  check(!!before?.sessionId && before.sessionId !== after?.sessionId, "A01 successor session started automatically");
  check(before?.model?.id === "tier-med" && after?.model?.id === "tier-med", "A01 model tier unchanged (tier-med)");
  const records = (() => { try { return readdirSync(join(cwd, ".atdd-pi", "handoffs")).map(f => readFileSync(join(cwd, ".atdd-pi", "handoffs", f), "utf8")); } catch { return []; } })();
  check(records.length === 1, "one record written (hop limit 1 stops further hops)");
  check(/Coach state:/.test(records[0] ?? "") && /Role: coach \(main@pi-atdd, profile forge\)/.test(records[0] ?? ""), "A04 coach-state section with role/identity/profile");
  check(/Workers: UNKNOWN/.test(records[0] ?? "") && /PLT-122, PLT-117/.test(records[0] ?? ""), "A04 unknowns say UNKNOWN; issues listed");
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

if (failures.length) { console.error("context renewal smoke FAILED:", failures.join("; ")); process.exitCode = 1; }
else console.log("context renewal smoke passed");
