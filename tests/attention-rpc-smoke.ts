// PLT-118: real Pi RPC discovery of the routed coach extension.
// This deliberately uses an isolated agent directory and makes no LLM calls.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pi-atdd-attention-rpc-"));
const cli = resolve("node_modules/.bin/pi");
const child = spawn(cli, [
  "--offline", "--approve", "-e", resolve("extensions/atdd.ts"),
  "--mode", "rpc", "--no-session",
], {
  cwd: process.cwd(), shell: false, stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    PI_CODING_AGENT_DIR: root, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1",
    PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "Coach - pi-atdd",
    PI_ATDD_ATTENTION_PROFILE: "forge",
    PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd",
    PI_ATDD_ATTENTION_COACH_ADDRESS: "main@pi-atdd",
  },
});
let complete = false, data = "", stderr = "";
function done(error?: Error) {
  if (complete) return;
  complete = true;
  clearTimeout(timer);
  child.stdin.end();
  child.kill("SIGTERM");
  rmSync(root, { recursive: true, force: true });
  if (error) {
    console.error("Pi routed attention RPC smoke FAILED:", error.message, stderr.slice(-3000));
    process.exitCode = 1;
  } else console.log("Pi routed Coach loaded; /atdd and /attention registered");
}
const timer = setTimeout(() => done(new Error("Pi did not return commands")), 25_000);
child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
child.stdout.on("data", (chunk: Buffer) => {
  data += chunk.toString();
  for (;;) {
    const index = data.indexOf("\n");
    if (index < 0) break;
    const line = data.slice(0, index);
    data = data.slice(index + 1);
    if (!line.trim()) continue;
    let response: { id?: string; success?: boolean; data?: { commands?: Array<{ name: string }> } };
    try { response = JSON.parse(line); }
    catch { done(new Error("Pi emitted non-JSON RPC data")); return; }
    if (response.id !== "commands") continue;
    const names = response.data?.commands?.map(x => x.name) ?? [];
    if (!response.success || !names.includes("atdd") || !names.includes("attention"))
      done(new Error("Expected both commands, got " + names.join(", ")));
    else done();
    return;
  }
});
child.on("error", error => done(error));
child.on("exit", code => { if (!complete) done(new Error("Pi exited before RPC response: " + code)); });
child.stdin.write(JSON.stringify({ id: "commands", type: "get_commands" }) + "\n");
