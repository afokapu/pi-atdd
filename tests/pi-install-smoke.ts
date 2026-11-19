// Acceptance: acc:pi-atdd:E001-UNIT-001
/** Prove Pi package installation, not merely explicit -e loading.

 A fresh isolated HOME prevents changes to real user package settings. The install
 is from this checkout: no global install or credential needed. Discovery runs
 without -e, so only Pi's installed-package mechanism can register /atdd.
*/
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(process.cwd());
const cli = resolve(repo, "node_modules/.bin/pi");
const root = mkdtempSync(join(tmpdir(), "pi-atdd-installed-package-"));
const home = join(root, "home"), project = join(root, "project");
mkdirSync(home);
mkdirSync(project);
// PLT-98: also isolate the Pi agent dir, so a caller's profile (PI_CODING_AGENT_DIR) cannot leak in.
const env = { ...process.env, HOME: home, PI_CODING_AGENT_DIR: join(root, "agent"), PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" };
const installed = spawnSync(cli, ["install", repo], {
  cwd: project, env, encoding: "utf8", timeout: 40_000, maxBuffer: 1_000_000, shell: false,
});
if (installed.status !== 0) {
  console.error("Pi local package installation failed", installed.stdout, installed.stderr);
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}
const child = spawn(cli, ["--offline", "--approve", "--mode", "rpc", "--no-session"], {
  cwd: project, env, stdio: ["pipe", "pipe", "pipe"], shell: false,
});
let complete = false, output = "", stderr = "";
function finish(error?: Error) {
  if (complete) return;
  complete = true;
  clearTimeout(timer);
  child.stdin.end();
  child.kill("SIGTERM");
  if (error) {
    console.error("Pi installed-package discovery failed:", error.message, stderr.slice(-3000));
    process.exitCode = 1;
  } else {
    console.log("Pi installed local package and registered atdd command in isolated HOME");
  }
  rmSync(root, { recursive: true, force: true });
}
const timer = setTimeout(() => finish(new Error("Timed out waiting for installed Pi package discovery")), 30_000);
child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
child.stdout.on("data", (chunk: Buffer) => {
  output += chunk.toString();
  for (;;) {
    const index = output.indexOf("\n");
    if (index < 0) return;
    const line = output.slice(0, index); output = output.slice(index + 1);
    let response: { id?: string; success?: boolean; data?: { commands?: Array<{ name: string }> } };
    try { response = JSON.parse(line); } catch { finish(new Error("Non-JSON Pi RPC response")); return; }
    if (response.id !== "commands") continue;
    if (response.success !== true || !response.data?.commands?.some(c => c.name === "atdd"))
      finish(new Error("Installed package did not register /atdd: " + line));
    else finish();
    return;
  }
});
child.on("error", (error) => finish(error));
child.on("exit", (code) => { if (!complete) finish(new Error("Pi exited before discovery: " + code)); });
child.stdin.write(JSON.stringify({ id: "commands", type: "get_commands" }) + "\n");
