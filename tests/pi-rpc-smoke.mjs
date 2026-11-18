import { spawn } from "node:child_process";
import { resolve } from "node:path";

const cli = resolve("node_modules/.bin/pi");
const child = spawn(cli, ["--offline", "--approve", "-e", resolve("extensions/atdd.ts"),
  "--mode", "rpc", "--no-session"], {
  cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], shell: false,
  env: { ...process.env, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" },
});
let stdout = "", stderr = "", resolved = false;
const timeout = setTimeout(() => stop(new Error("Pi RPC did not answer get_commands")), 25_000);
function stop(error) {
  if (resolved) return;
  resolved = true;
  clearTimeout(timeout);
  child.stdin.end();
  if (error) {
    console.error("Pi extension discovery FAILED:", error.message, stderr.slice(-3000));
    child.kill("SIGTERM");
    process.exitCode = 1;
  } else {
    console.log("Pi RPC extension discovery: atdd registered");
  }
}
child.stderr.on("data", chunk => { stderr += chunk.toString(); });
child.stdout.on("data", chunk => {
  stdout += chunk.toString();
  for (;;) {
    const pos = stdout.indexOf("\n");
    if (pos === -1) break;
    const line = stdout.slice(0, pos); stdout = stdout.slice(pos + 1);
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { stop(new Error("Pi emitted non-JSON protocol data")); return; }
    if (record.id !== "commands") continue;
    if (record.success !== true) { stop(new Error(JSON.stringify(record))); return; }
    const names = record.data?.commands?.map(c => c.name) ?? [];
    if (!names.includes("atdd")) stop(new Error("ATDD command missing from real Pi runtime: " + names.join(",")));
    else stop();
    return;
  }
});
child.on("error", err => stop(err));
child.on("exit", code => { if (!resolved) stop(new Error("Pi exited before reply: " + code)); });
child.stdin.write(JSON.stringify({ id: "commands", type: "get_commands" }) + "\n");
