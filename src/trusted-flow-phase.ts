/** ATD-42: read-only task phase from the Flow-owned Desk, under a verified execution seat.
 * This adapter never changes a Flow task, grants authority, or trusts model-supplied phase text.
 */
import { readFileSync, realpathSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { parse } from "yaml";
import type { SeatRuntimeConfig } from "./execution-seat.ts";
import type { Phase } from "./reasoning-context.ts";

export type TrustedFlowPhase = {
  phase: Phase;
  task: string;
  provenance: string;
  actorRole: "driver";
};
const identifier = /^[a-zA-Z0-9_.-]+$/;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Only caller-verified Flow seat leases may reach this function. The adapter verifies
 * the task-to-seat binding again, so an unrelated or replaced task cannot seed phase facts. */
export function readTrustedFlowPhase(seat: SeatRuntimeConfig | undefined): TrustedFlowPhase | undefined {
  if (!seat || seat.mode !== "external" || !seat.flowRoot) return undefined;
  const b = seat.binding;
  if (b.taskId === "*") return undefined; // project-wide coaches do not own a driver phase
  if (![b.projectId, b.taskId].every(s => identifier.test(s)) || !isAbsolute(seat.flowRoot))
    throw new Error("Invalid Flow task identity or coordination root");
  const root = realpathSync(seat.flowRoot);
  const path = realpathSync(join(root, "work", b.projectId, "tasks", b.taskId + ".yaml"));
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Flow task resolves outside its authoritative root");
  const task: unknown = parse(readFileSync(path, "utf8"));
  if (!object(task) || task.schema !== "atdd-workflow/task/v1" ||
      task.assignee !== b.seatAddress || task.coordinator !== b.coachAddress)
    throw new Error("Flow task does not match authenticated task, driver and coach binding");
  if (task.status !== "todo" && task.status !== "in_progress") return undefined;
  const phase = task.phase ?? "plan";
  if (!["plan", "red", "green", "refactor"].includes(String(phase)))
    throw new Error("Unknown authoritative Flow task phase");
  return {
    phase: String(phase).toUpperCase() as Phase,
    task: b.taskId,
    actorRole: "driver",
    provenance: "Flow task " + b.projectId + "/" + b.taskId + " @ " + path,
  };
}


/** Native Flow Pi seats are trusted ONLY after verifying the real launcher-bound
 * worktree, Pi session, Herdr placement and receipt against the Flow Desk.
 * Environment variables alone are never proof of seat ownership. Host-attached
 * or legacy seats without an exact receipt remain UNKNOWN (no typed phase).
 * The Flow controller remains the sole authority for task/phase writes.
 */
export type FlowPhaseContext = {
  cwd: string;
  sessionManager?: { getSessionId: () => string };
};
export function readEnvFlowPhase(env: NodeJS.ProcessEnv, ctx: FlowPhaseContext): TrustedFlowPhase | undefined {
  const rootEnv = env.ATDD_WORKFLOW_ROOT, address = env.ATDD_WORKFLOW_SEAT;
  if (!rootEnv || !address) return undefined;
  const match = /^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)$/.exec(address);
  if (!match || !isAbsolute(rootEnv)) throw new Error("Invalid Flow seat identity or coordination root");
  const piSession = ctx.sessionManager?.getSessionId();
  const claimedSession = env.ATDD_FLOW_PI_SESSION;
  const herdrSession = env.ATDD_FLOW_HERDR_SESSION, pane = env.ATDD_FLOW_HERDR_PANE;
  if (!piSession || !claimedSession || !herdrSession || !pane) return undefined;
  if (piSession !== claimedSession) throw new Error("Flow Pi session does not match the running session");

  const [, seatName, project] = match;
  const root = realpathSync(rootEnv);
  const safe = (relativePath: string): string => {
    const path = realpathSync(join(root, relativePath));
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
      throw new Error("Flow record resolves outside the coordination root");
    return path;
  };
  const seat: unknown = parse(readFileSync(safe(join("work", project, "seats", seatName, "seat.yaml")), "utf8"));
  if (!object(seat) || seat.address !== address || seat.project !== project ||
      seat.role !== "driver" || seat.retired)
    throw new Error("Flow seat does not match active driver identity");
  if (typeof seat.worktree !== "string" || realpathSync(seat.worktree) !== realpathSync(ctx.cwd))
    throw new Error("Flow driver worktree does not match the running Pi repository");

  // Match the same binding and launch receipt fields that Flow verifies before
  // activating its own native Pi transport (extensions/pi/index.ts).
  const runtime = seat.runtime;
  if (!object(runtime) || !runtime.launch_receipt) return undefined;
  const addresses = object(runtime.addresses) ? runtime.addresses : undefined;
  const locator = addresses && object(addresses.herdr) ? addresses.herdr : undefined;
  if (runtime.application !== "herdr" || runtime.wake !== "native" ||
      runtime.pi_session !== piSession || locator?.session !== herdrSession ||
      locator.pane !== pane || typeof runtime.pi_session_path !== "string")
    throw new Error("Flow runtime binding does not match the live Pi and Herdr placement");

  if (typeof runtime.launch_receipt !== "string" || !isAbsolute(runtime.launch_receipt))
    throw new Error("Flow runtime launch receipt is not a verified absolute path");
  const receipt: unknown = parse(readFileSync(realpathSync(runtime.launch_receipt), "utf8"));
  if (!object(receipt) || receipt.schema !== "atdd-flow/pi-runtime-launch-receipt/v1" ||
      receipt.seat !== address || receipt.pi_session !== piSession ||
      receipt.pi_session_path !== runtime.pi_session_path ||
      receipt.herdr_session !== herdrSession || receipt.pane !== pane)
    throw new Error("Flow launch receipt does not match the live seat binding");

  const dir = safe(join("work", project, "tasks"));
  const active: { id: string; task: Record<string, unknown> }[] = [];
  for (const filename of readdirSync(dir).filter(n => identifier.test(n) && n.endsWith(".yaml") && !n.endsWith(".reviews.yaml")).sort()) {
    const id = filename.slice(0, -5);
    const task: unknown = parse(readFileSync(safe(join("work", project, "tasks", filename)), "utf8"));
    if (!object(task) || task.schema !== "atdd-workflow/task/v1") continue;
    if (task.assignee === address && (task.status === "todo" || task.status === "in_progress") &&
        !task.blocker && !task.deferred) active.push({ id, task });
  }
  if (!active.length) return undefined;
  if (active.length !== 1) throw new Error("Several active Flow tasks: cannot infer the current driver's phase");
  const { id, task } = active[0];
  if (typeof task.coordinator !== "string" || !task.coordinator)
    throw new Error("Active Flow task has no accountable coordinator");
  const phase = task.phase ?? "plan";
  if (!["plan", "red", "green", "refactor"].includes(String(phase)))
    throw new Error("Unknown authoritative Flow task phase");
  return {
    task: id, phase: String(phase).toUpperCase() as Phase, actorRole: "driver",
    provenance: "Flow-owned task " + project + "/" + id +
      " from verified live seat " + address + " and launch receipt",
  };
}
