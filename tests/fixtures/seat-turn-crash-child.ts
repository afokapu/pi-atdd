// PLT-125 test fixture: a Pi-like process that owns its seat, settles one real turn (turn_end),
// starts a second turn, then dies by SIGKILL mid-turn. Driven by real-model-fixes.test.ts.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerSeatExecution } from "../../src/execution-pi.ts";

const [repo, commitAfterTurn] = process.argv.slice(2);
if (!repo) throw new Error("usage: <repo> [commit-after-turn]");
const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
const pi = { on: (k: string, f: (e: unknown, c: unknown) => unknown) => handlers.set(k, [...(handlers.get(k) ?? []), f]),
  registerCommand: () => {} };
registerSeatExecution(pi as never, process.env);
const ctx = { cwd: repo, model: { provider: "provider", id: "model-a" }, isProjectTrusted: () => true,
  sessionManager: { getSessionId: () => "session-a" }, ui: { notify: (m: string) => console.error(m) } };
const fire = (hook: string) => (handlers.get(hook) ?? []).forEach(f => f({}, ctx));
fire("session_start");
fire("before_agent_start");
fire("turn_end"); // one settled turn
if (commitAfterTurn === "commit") { // work lands after the last settled turn: the checkpoint is now stale
  writeFileSync(join(repo, "later.txt"), "later\n");
  execFileSync("git", ["-C", repo, "add", "later.txt"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "later"]);
}
fire("before_agent_start"); // second turn begins, never settles
process.kill(process.pid, "SIGKILL");
