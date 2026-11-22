/**
 * PLT-121: a real idle signal for the coach relaunch script. The extension writes one small state file per
 * launch identity: busy when a run starts, idle when Pi has settled (agent_settled, not agent_end: Pi may still
 * retry or continue after agent_end). A record whose pid is dead reads as "unknown", never as busy or idle.
 * Inert unless PI_ATDD_ATTENTION_IDENTITY is set, so ordinary sessions write nothing.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type BusyState = "busy" | "idle";
export type BusyRead = BusyState | "unknown";
export type BusyRecord = { state: BusyState; pid: number; at: string; identity: string };

/** The relaunch script derives the same name with `tr -c 'A-Za-z0-9._-' '_'`. Keep the two in step. */
export const sanitizeIdentity = (identity: string) => identity.replace(/[^A-Za-z0-9._-]/g, "_");

export function busyStateFile(agentDir: string, identity: string): string {
  return join(agentDir, "attention", sanitizeIdentity(identity) + ".busy.json");
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Writes via a temp file and rename, so a reader never sees a half-written record. */
export function writeBusyState(file: string, state: BusyState, pid: number, at: string, identity: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const rec: BusyRecord = { state, pid, at, identity };
  const tmp = file + "." + pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(rec) + "\n");
  renameSync(tmp, file);
}

export function readBusyState(file: string, alive: (pid: number) => boolean = pidAlive): BusyRead {
  let rec: Partial<BusyRecord>;
  try {
    rec = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "unknown";
  }
  if (typeof rec !== "object" || rec === null) return "unknown";
  if (typeof rec.pid !== "number" || !alive(rec.pid)) return "unknown";
  if (rec.state === "busy" || rec.state === "idle") return rec.state;
  return "unknown";
}

type Api = { on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => void };

export function registerBusyState(pi: unknown, env: NodeJS.ProcessEnv = process.env, now: () => Date = () => new Date()): void {
  const api = pi as Api; // same structural cast as attention-strip.ts
  const identity = env.PI_ATDD_ATTENTION_IDENTITY?.trim();
  if (!identity) return;
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const file = busyStateFile(agentDir, identity);
  const write = (state: BusyState) => writeBusyState(file, state, process.pid, now().toISOString(), identity);
  // before_agent_start closes the gap between a dispatched prompt and agent_start.
  api.on("before_agent_start", () => { write("busy"); return undefined; });
  api.on("agent_start", () => { write("busy"); });
  api.on("agent_settled", () => { write("idle"); });
}
