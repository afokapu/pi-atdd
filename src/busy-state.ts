/**
 * PLT-121: a real idle signal for the coach relaunch script. The extension keeps one small state file per
 * launch identity: busy on before_agent_start / agent_start and on each turn, idle on agent_settled (not agent_end:
 * Pi may still retry or continue after agent_end). A busy record stops counting as busy when:
 *  - its pid is dead, or
 *  - it is older than STALE_MS with no turn event. This bounds a run that dies after our before_agent_start but
 *    before any settle (a later Pi preflight throws): no event of ours can observe that, so the record expires
 *    and the relaunch script falls back to the pane, which is the authority for a long live turn.
 * Both outcomes read as "unknown", never as busy or idle from a dead or stale record.
 * Inert unless PI_ATDD_ATTENTION_IDENTITY is set.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type BusyState = "busy" | "idle";
export type BusyRead = BusyState | "unknown";
export type BusyRecord = { state: BusyState; pid: number; at: string; identity: string };

/** Keep in step with the 600 s bound in relaunch-coach-v2.sh. */
export const STALE_MS = 10 * 60_000;

/**
 * File name derivation, shared with relaunch-coach-v2.sh: first 32 hex digits of sha256 over the identity's
 * UTF-8 bytes, exactly as given (no trimming, no character mapping), so padded and non-ASCII identities agree.
 */
export const stateName = (identity: string): string =>
  createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 32);

export function busyStateFile(agentDir: string, identity: string): string {
  return join(agentDir, "attention", stateName(identity) + ".busy.json");
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

export function readBusyState(file: string, alive: (pid: number) => boolean = pidAlive, nowMs: number = Date.now()): BusyRead {
  let rec: Partial<BusyRecord> | null;
  try {
    rec = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "unknown";
  }
  if (typeof rec !== "object" || rec === null) return "unknown";
  if (typeof rec.pid !== "number" || !alive(rec.pid)) return "unknown";
  if (rec.state === "idle") return "idle";
  if (rec.state !== "busy") return "unknown";
  const at = Date.parse(rec.at ?? "");
  if (!Number.isFinite(at) || nowMs - at > STALE_MS) return "unknown";
  return "busy";
}

type Api = { on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => void };

export function registerBusyState(pi: unknown, env: NodeJS.ProcessEnv = process.env, now: () => Date = () => new Date()): void {
  const identity = env.PI_ATDD_ATTENTION_IDENTITY;
  if (!identity) return;
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const file = busyStateFile(agentDir, identity);
  const write = (state: BusyState) => writeBusyState(file, state, process.pid, now().toISOString(), identity);
  const api = pi as Api;
  // before_agent_start closes the gap between a dispatched prompt and agent_start.
  api.on("before_agent_start", () => { write("busy"); return undefined; });
  api.on("agent_start", () => { write("busy"); });
  // Heartbeat: a live turn keeps its record fresh, so only a run that stops without settling goes stale.
  api.on("turn_start", () => { write("busy"); });
  api.on("turn_end", () => { write("busy"); });
  api.on("agent_settled", () => { write("idle"); });
}
