/** PLT-128: read-only task phase from the Flow-owned Desk, under a verified execution seat.
 * This adapter never changes a Flow task, grants authority, or trusts model-supplied phase text.
 */
import { readFileSync, realpathSync } from "node:fs";
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
