/**
 * Transient Coach prompts derived from live task seats and each worker's busy-state heartbeat.
 * Eligibility uses a live seat scoped to this Coach/project plus the worker's busy-state signal. It does not
 * query Linear and cannot verify issue status (including In Progress): a live seat is the proxy for active work;
 * a closed/removed seat is inactive and is not reminded.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pidAlive, readBusyState, stateName, type BusyRecord } from "./busy-state.ts";
import { holderIsDead } from "./durable-lock.ts";

type WorkerLease = {
  schema: "pi-atdd/seat-lease/v1";
  binding: { projectId: string; taskId: string; coachAddress: string; seatAddress: string };
  holder: { pid: number; host: string };
  at: string;
};
type WorkerStatus = { taskId: string; name: string; kind: "idle" | "unknown" };
type ReminderContext = { isIdle?: () => boolean; ui: { notify: (message: string, level?: string) => void } };
type ReminderOptions = {
  agentDir?: string;
  coachAddress: string;
  projectId: string;
  now?: () => number;
  pollMs?: number;
  idleMs?: number;
  unknownMs?: number;
  throttleMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

const IDLE_MS = 10 * 60_000;
const UNKNOWN_MS = 30 * 60_000;
const THROTTLE_MS = 30 * 60_000;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

function readLease(file: string): WorkerLease | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!object(value) || value.schema !== "pi-atdd/seat-lease/v1" || !object(value.binding) || !object(value.holder)) return;
    const { binding, holder } = value;
    if (![binding.projectId, binding.taskId, binding.coachAddress, binding.seatAddress].every(v => typeof v === "string" && v) ||
        !Number.isInteger(holder.pid) || holder.pid <= 0 || typeof holder.host !== "string" || typeof value.at !== "string") return;
    return value as WorkerLease;
  } catch { return; }
}

function busyRecordFor(agentDir: string, seatAddress: string, projectId: string): { record?: BusyRecord; state: "busy" | "idle" | "unknown" } {
  const dir = join(agentDir, "attention");
  let files: string[];
  try { files = readdirSync(dir).filter(name => /^[a-f0-9]{32}\.busy\.json$/.test(name)); }
  catch { return { state: "unknown" }; }
  const expected = seatAddress.split("@")[0]?.split(".").slice(1).join(".");
  for (const file of files) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (!object(raw) || typeof raw.identity !== "string" || stateName(raw.identity) + ".busy.json" !== file) continue;
      if (!(slug(raw.identity) === expected || slug(raw.identity).endsWith("-" + expected)) ||
          !seatAddress.endsWith("@" + projectId)) continue;
      const record = raw as BusyRecord;
      const state = readBusyState(join(dir, file), pidAlive);
      return { record, state };
    } catch { /* an unreadable worker state is unknown, never proof of busy */ }
  }
  return { state: "unknown" };
}

export function collectWorkerReminderStatuses(input: Pick<ReminderOptions, "agentDir" | "coachAddress" | "projectId" | "now" | "idleMs" | "unknownMs">): WorkerStatus[] {
  const agentDir = input.agentDir ?? join(homedir(), ".pi", "agent");
  const now = (input.now ?? Date.now)();
  let files: string[];
  try { files = readdirSync(join(agentDir, "execution", "seats")).filter(name => name.endsWith(".json")); }
  catch { return []; }
  const statuses: WorkerStatus[] = [];
  for (const file of files) {
    const lease = readLease(join(agentDir, "execution", "seats", file));
    if (!lease) continue;
    const { binding, holder } = lease;
    if (binding.projectId !== input.projectId || binding.coachAddress !== input.coachAddress ||
        !binding.seatAddress.startsWith("worker.") || binding.taskId === "*" || holderIsDead(holder.pid, holder.host)) continue;
    const { record, state } = busyRecordFor(agentDir, binding.seatAddress, binding.projectId);
    const stateAt = Date.parse(record?.at ?? "");
    const leaseAt = Date.parse(lease.at);
    if (state === "idle" && Number.isFinite(stateAt) && now - stateAt >= (input.idleMs ?? IDLE_MS)) {
      statuses.push({ taskId: binding.taskId, name: binding.seatAddress.split("@")[0]!, kind: "idle" });
    } else if (state === "unknown" && now - (Number.isFinite(stateAt) ? stateAt : leaseAt) >= (input.unknownMs ?? UNKNOWN_MS)) {
      statuses.push({ taskId: binding.taskId, name: binding.seatAddress.split("@")[0]!, kind: "unknown" });
    }
  }
  return statuses.sort((a, b) => a.taskId.localeCompare(b.taskId));
}

export function registerWorkerReminder(options: ReminderOptions) {
  let timer: unknown;
  let lastNotice = -Infinity;
  const now = options.now ?? Date.now;
  const setTimer = options.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTimer = options.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  let context: ReminderContext | undefined;
  const tick = () => {
    if (!context || context.isIdle?.() === false) return;
    const at = now();
    if (at - lastNotice < (options.throttleMs ?? THROTTLE_MS)) return;
    const workers = collectWorkerReminderStatuses({ ...options, now });
    if (!workers.length) return;
    const names = workers.map(worker => worker.kind === "idle"
      ? `${worker.name} (${worker.taskId})`
      : `${worker.name} (${worker.taskId}, status unknown — check pane)`);
    context.ui.notify("Coach reminder: check active workers " + names.join(", ") +
      ". Check each pane, unblock, escalate to the owner, or confirm idle is legitimate (for example, awaiting review).", "info");
    lastNotice = at;
  };
  return {
    start(ctx: ReminderContext, schedule = true) {
      context = ctx;
      if (schedule && timer === undefined) timer = setTimer(tick, options.pollMs ?? 5000);
    },
    stop() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      context = undefined;
    },
    tick,
  };
}
