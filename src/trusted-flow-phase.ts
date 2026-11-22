/** ATD-42 — observe Flow-owned task phases without creating authority.
 * A model cannot choose its own task, phase, runtime or Coach by wording.
 * Every native phase fact must be supported by one launch-bound driver task.
 */
import { readFileSync, realpathSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { parse } from "yaml";
import type { SeatRuntimeConfig } from "./execution-seat.ts";
import type { Phase } from "./reasoning-context.ts";

export type TrustedFlowPhase = {
  phase: Phase; task: string; provenance: string; actorRole: "driver";
};
export type FlowPhaseContext = {
  cwd: string;
  sessionManager?: { getSessionId: () => string };
};
const identifier = /^[a-zA-Z0-9_.-]+$/;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Resolve even existing symlinks before reading: lexical task IDs are not a
 * substitute for containing the physical file inside the Flow-owned Desk. */
function flowRecord(root: string, file: string): unknown {
  const path = realpathSync(file), rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Flow record resolves outside its authoritative root");
  return parse(readFileSync(path, "utf8"));
}

/** A terminal or paused task does not grant execution-phase guidance.
 * The enum is closed: unknown phases must never be silently normalized. */
function phaseFor(task: Record<string, unknown>, taskId: string, provenance: string): TrustedFlowPhase | undefined {
  if (task.status !== "todo" && task.status !== "in_progress") return undefined;
  if (task.blocker || task.deferred) return undefined; // paused work is not executable
  const phase = task.phase ?? "plan";
  if (!["plan", "red", "green", "refactor"].includes(String(phase)))
    throw new Error("Unknown authoritative Flow task phase");
  return { task: taskId, phase: String(phase).toUpperCase() as Phase, actorRole: "driver", provenance };
}

/** The Pi-ATDD execution lease was already fenced by executionSeat.owns(ctx).
 * Recheck its task/Coach tuple against Flow; never use a Coach lease as a driver. */
export function readTrustedFlowPhase(seat: SeatRuntimeConfig | undefined, cwd?: string): TrustedFlowPhase | undefined {
  if (!seat || seat.mode !== "external" || !seat.flowRoot) return undefined;
  const b = seat.binding;
  if (b.taskId === "*") return undefined;
  if (![b.projectId, b.taskId].every(s => identifier.test(s)) || !isAbsolute(seat.flowRoot))
    throw new Error("Invalid Flow task identity or coordination root");
  const root = realpathSync(seat.flowRoot);
  // The authenticated lease must still point to an active Flow DRIVER seat.
  const name = /^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)$/.exec(b.seatAddress);
  if (!name || name[2] !== b.projectId) throw new Error("Flow seat does not belong to the leased project");
  nativeDriver(root, b.projectId, name[1]!, b.seatAddress, cwd);
  const file = join(root, "work", b.projectId, "tasks", b.taskId + ".yaml");
  const task = flowRecord(root, file);
  if (!object(task) || task.schema !== "atdd-workflow/task/v1" ||
      task.assignee !== b.seatAddress || task.coordinator !== b.coachAddress)
    throw new Error("Flow task does not match authenticated task, driver and coach binding");
  return phaseFor(task, b.taskId, "Flow task " + b.projectId + "/" + b.taskId + " @ " + file);
}

/** A native Flow seat must be the same driver, worktree and project as Pi.
 * The launcher receipt is separate proof, validated before selecting a task. */
function nativeDriver(root: string, project: string, name: string, address: string, cwd?: string) {
  const file = join(root, "work", project, "seats", name, "seat.yaml");
  const seat = flowRecord(root, file);
  if (!object(seat) || seat.address !== address || seat.project !== project ||
      seat.role !== "driver" || seat.retired)
    throw new Error("Flow seat does not match active driver identity");
  if (typeof seat.worktree !== "string")
    throw new Error("Flow driver seat does not declare its worktree");
  if (cwd && realpathSync(seat.worktree) !== realpathSync(cwd))
    throw new Error("Flow driver worktree does not match the running Pi repository");
  return seat;
}

/** Confirm the recorded Herdr/Pi tuple is still the exact one this process
 * claims. An absent receipt means UNKNOWN, not an inferred authorization. */
function nativeRuntime(seat: Record<string, unknown>, pi: string, herdr: string, pane: string) {
  const runtime = seat.runtime;
  if (!object(runtime) || !runtime.launch_receipt) return undefined;
  const addresses = object(runtime.addresses) ? runtime.addresses : undefined;
  const locator = addresses && object(addresses.herdr) ? addresses.herdr : undefined;
  if (runtime.application !== "herdr" || runtime.wake !== "native" ||
      runtime.pi_session !== pi || locator?.session !== herdr ||
      locator?.pane !== pane || typeof runtime.pi_session_path !== "string" ||
      !isAbsolute(runtime.pi_session_path))
    throw new Error("Flow runtime binding does not match the live Pi and Herdr placement");
  if (typeof runtime.launch_receipt !== "string" || !isAbsolute(runtime.launch_receipt))
    throw new Error("Flow runtime launch receipt must be an absolute Flow-owned path");
  return { path: runtime.launch_receipt, sessionPath: runtime.pi_session_path };
}

/** Flow's receipt stores *which tasks* the launcher actually authorized.
 * A task assigned after launch must not inherit another task's trusted phase. */
function nativeReceipt(root: string, path: string, expected: Record<string, string>): Set<string> {
  // Flow's launcher writes receipts under one protected Desk subdirectory.
  const directory = realpathSync(join(root, ".atdd-flow", "runtime-launch"));
  const physical = realpathSync(path), rel = relative(directory, physical);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Flow launch receipt is outside the runtime-launch directory");
  const receipt = flowRecord(root, physical);
  if (!object(receipt) || !Object.entries(expected).every(([k, value]) => receipt[k] === value))
    throw new Error("Flow launch receipt does not match the live seat binding");
  const tasks = receipt.tasks;
  if (!Array.isArray(tasks) || !tasks.length || !tasks.every(x => typeof x === "string" && identifier.test(x)))
    throw new Error("Flow launch receipt has no valid authorized task identities");
  return new Set(tasks as string[]);
}

/** Select exactly one runnable task; never fall back to the first match.
 * Excluded tasks cannot steal the phase, and an unlaunched task cannot inherit it. */
function activeDriverTask(root: string, project: string, address: string, permitted: Set<string>) {
  const dir = join(root, "work", project, "tasks");
  const active: { id: string; task: Record<string, unknown> }[] = [];
  for (const name of readdirSync(dir).filter(n => identifier.test(n) && n.endsWith(".yaml") && !n.endsWith(".reviews.yaml")).sort()) {
    const id = name.slice(0, -5), task = flowRecord(root, join(dir, name));
    if (!object(task) || task.schema !== "atdd-workflow/task/v1") continue;
    if (task.assignee === address && (task.status === "todo" || task.status === "in_progress") &&
        !task.blocker && !task.deferred) active.push({ id, task });
  }
  if (!active.length) return undefined;
  if (active.length !== 1) throw new Error("Several active Flow tasks: cannot infer the current driver's phase");
  if (!permitted.has(active[0]!.id)) throw new Error("Flow launch receipt did not authorize the active task");
  return active[0]!;
}

/** Native Flow cannot grant phase authority through environment alone.
 * The live Pi identity, Desk seat and immutable launch receipt must agree. */
export function readEnvFlowPhase(env: NodeJS.ProcessEnv, ctx: FlowPhaseContext): TrustedFlowPhase | undefined {
  const rootEnv = env.ATDD_WORKFLOW_ROOT, address = env.ATDD_WORKFLOW_SEAT;
  if (!rootEnv || !address) return undefined;
  const match = /^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)$/.exec(address);
  if (!match || !isAbsolute(rootEnv)) throw new Error("Invalid Flow seat identity or coordination root");
  const pi = ctx.sessionManager?.getSessionId(), claimed = env.ATDD_FLOW_PI_SESSION;
  const herdr = env.ATDD_FLOW_HERDR_SESSION, pane = env.ATDD_FLOW_HERDR_PANE;
  if (!pi || !claimed || !herdr || !pane) return undefined;
  if (pi !== claimed) throw new Error("Flow Pi session does not match the running session");

  const [, name, project] = match, root = realpathSync(rootEnv);
  const seat = nativeDriver(root, project, name, address, ctx.cwd);
  const runtime = nativeRuntime(seat, pi, herdr, pane);
  if (!runtime) return undefined;
  const permitted = nativeReceipt(root, runtime.path, {
    schema: "atdd-flow/pi-runtime-launch-receipt/v1", seat: address,
    pi_session: pi, pi_session_path: runtime.sessionPath,
    herdr_session: herdr, pane,
  });
  const active = activeDriverTask(root, project, address, permitted);
  if (!active) return undefined;
  if (typeof active.task.coordinator !== "string" || !active.task.coordinator)
    throw new Error("Active Flow task has no accountable coordinator");
  return phaseFor(active.task, active.id,
    "Flow-owned task " + project + "/" + active.id + " from verified seat and launch receipt");
}
