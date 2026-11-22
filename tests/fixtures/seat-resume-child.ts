// PLT-117 test fixture: a relaunched Pi process. It loads the seat hooks exactly as the shipped
// extension does, runs the launcher-requested resume at session start, then dies by SIGKILL
// before any prompt. Driven by execution-seat.test.ts.
import { registerSeatExecution } from "../../src/execution-pi.ts";

const [repo, sessionId, kill = "before-prompt"] = process.argv.slice(2);
if (!repo || !sessionId || (kill !== "before-prompt" && kill !== "after-injection"))
  throw new Error("usage: <repo> <sessionId> [before-prompt|after-injection]");
const handlers = new Map<string, Array<(e: any, c: any) => unknown>>();
const pi = { on: (k: string, f: any) => handlers.set(k, [...(handlers.get(k) ?? []), f]), registerCommand: () => {} };
const controller = registerSeatExecution(pi as any, process.env)!;
const ctx = { cwd: repo, model: { provider: "provider", id: "model-b" }, isProjectTrusted: () => true,
  sessionManager: { getSessionId: () => sessionId }, ui: { notify: () => {} } };
for (const f of handlers.get("session_start") ?? []) f({}, ctx);
if (!controller.owns(ctx)) process.exit(3); // the resume must have succeeded before the crash
// Fault-injection kill points. "after-injection": the recovery notice has been handed to the prompt
// (before_agent_start returned) but the turn has not ended.
if (kill === "after-injection") for (const f of handlers.get("before_agent_start") ?? []) f({}, ctx);
process.kill(process.pid, "SIGKILL");
