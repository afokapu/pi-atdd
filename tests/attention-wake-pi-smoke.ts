// URN: test:pi-atdd:route-attention:ATD-53-real-pi
// Acceptance: acc:pi-atdd:atd-53-a01
// Acceptance: acc:pi-atdd:atd-53-a02
// Assembled Pi extension and deterministic local faux model; no external model calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { appendSpool, ensureKey, newItem, readLaunchConfig, signEvent } from "../src/attention.ts";
import { bootstrapSeatFromEnv } from "../src/seat-bootstrap.ts";

const root = mkdtempSync(join(tmpdir(), "atd53-pi-"));
const sessionId = randomUUID();
const coach = "coach:smoke/pi-atdd";
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("PI_ATDD_")));
const env: NodeJS.ProcessEnv = { ...cleanEnv, PI_CODING_AGENT_DIR: root, PI_OFFLINE: "1", PI_TELEMETRY: "0",
  PI_SKIP_VERSION_CHECK: "1", PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: coach,
  PI_ATDD_ATTENTION_PROFILE: "smoke", PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd", PI_ATDD_ATTENTION_COACH_ADDRESS: coach,
  PI_ATDD_EXECUTION_MODE: "standalone", PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd", PI_ATDD_EXECUTION_TASK_ID: "*",
  PI_ATDD_EXECUTION_COACH_ADDRESS: coach, PI_ATDD_EXECUTION_SEAT_ADDRESS: coach, PI_ATDD_EXECUTION_EXECUTION_ID: "run-1",
  PI_ATDD_EXECUTION_SESSION_ID: sessionId, PI_ATDD_EXECUTION_MODEL_ID: "atd53-faux/local", PI_ATDD_EXECUTION_GENERATION: "1",
  PI_ATDD_EXECUTION_OWNER_TOKEN: "isolated-test-token" };
const worker = readLaunchConfig({ ...env, PI_ATDD_ATTENTION_ROLE: "worker", PI_ATDD_ATTENTION_IDENTITY: "worker",
  PI_ATDD_ATTENTION_TASK_ID: "ATD-53", PI_ATDD_ATTENTION_EXECUTION_ID: "worker-run" })!;
const item = newItem({ type: "review", summary: "smoke wake", issue: "ATD-53" }, worker, new Date());
appendSpool(worker.spool, signEvent({ event: "raised", item }, ensureKey(worker.keyPath)));
bootstrapSeatFromEnv(env);
const faux = join(root, "faux.ts");
writeFileSync(faux, `
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(resolve("node_modules/@earendil-works/pi-ai/dist/index.js"))};
export default function (pi: any) {
  const f = fauxProvider({provider: "atd53-faux", models: [{id: "local", contextWindow: 20000}]});
  let n = 0;
  f.setResponses(Array.from({length: 20}, () => () => {
    n++;
    if (n === 1) return fauxAssistantMessage(fauxToolCall("attention_resolve", {id: ${JSON.stringify(item.id)}, scope: "within_grant", note: "done"}), {stopReason: "toolUse"});
    if (n === 3) return fauxAssistantMessage(fauxToolCall("attention_reopen", {id: ${JSON.stringify(item.id)}, note: "new evidence"}), {stopReason: "toolUse"});
    return fauxAssistantMessage("ok");
  }));
  pi.registerProvider(f.provider);
}`);
const child = spawn(resolve("node_modules/.bin/pi"), ["--offline", "--approve", "--session-id", sessionId,
  "-e", resolve("extensions/atdd.ts"), "-e", faux, "--mode", "rpc", "--model", "atd53-faux/local"],
  { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
const events: any[] = []; let buffer = "", stderr = "";
child.stdout.on("data", (chunk: Buffer) => { buffer += chunk.toString(); let i: number;
  while ((i = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    try { events.push(JSON.parse(line)); } catch { /* surfaced by timeout */ } } });
child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean, label: string, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (child.exitCode !== null) throw new Error(`Pi exited ${child.exitCode}: ${stderr}`);
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label}: ${stderr}; events=${JSON.stringify(events).slice(-6000)}`);
    await sleep(100);
  }
}
const wakes = () => events.filter(e => e.type === "message_start" && e.message?.customType === "pi-atdd-attention-alert");
const succeeded = (name: string) => events.some(e => e.type === "tool_execution_end" && e.toolName === name && !e.isError);
try {
  await waitFor(() => succeeded("attention_resolve"), "initial wake and resolution");
  await sleep(11_000); // more than two real polling intervals
  assert.equal(wakes().length, 1, "resolved item must not cause another wake");
  assert.match(JSON.stringify(wakes()[0]), new RegExp(item.id), "initial wake names the item");
  child.stdin.write(JSON.stringify({ id: "reopen", type: "prompt", message: "Reopen the resolved item." }) + "\n");
  await waitFor(() => succeeded("attention_reopen"), "reopen tool");
  await waitFor(() => wakes().length === 2, "reopened wake");
  await sleep(11_000);
  assert.equal(wakes().length, 2, "reopen produces exactly one wake across polls");
  assert.match(JSON.stringify(wakes()[1]), new RegExp(item.id), "reopen wake names the same item");
  console.log("ATD-53 real Pi: resolved stays silent and reopen wakes once");
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>(resolve => child.once("exit", () => resolve())), sleep(2000)]);
  rmSync(root, { recursive: true, force: true });
}
