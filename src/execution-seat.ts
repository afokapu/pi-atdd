/**
 * PLT-117 — durable, file-backed seat runtime for standalone Pi.
 *
 * This is an execution-ownership receipt, NOT a new task registry. Task and coach
 * assignment arrive from the trusted launcher. Flow-governed seats must use their
 * own authoritative adapter; a local receipt must never override Flow ownership.
 *
 * Every mutation takes a per-seat filesystem lock and compares the exact prior
 * binding. Crash recovery and a new session require a verified checkpoint.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { holderIsDead, withDurableLock } from "./durable-lock.ts";
import { decideExecutionTransition, matchesSeatLease,
  type ExecutionBinding, type ExecutionCheckpoint, type SeatLeaseObservation } from "./execution-lifecycle.ts";

export type SeatRuntimeConfig = {
  mode: "standalone" | "external";
  binding: ExecutionBinding;
  leasePath: string;
  checkpointDir: string;
  /** Read-only Flow authority; the Flow controller owns changes to these records. */
  flowRoot?: string;
  grantRef?: string;
};
/** The holder is the process that last wrote the lease. Recovery needs it provably dead. */
type Holder = { pid: number; host: string };
type LeaseFile = { schema: "pi-atdd/seat-lease/v1"; binding: ExecutionBinding; holder: Holder; at: string };
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 240;
const number = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const noFile = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "ENOENT";
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const source = (b: ExecutionBinding): SeatLeaseObservation => ({
  seatAddress: b.seatAddress, sessionId: b.sessionId, generation: b.generation, ownerToken: b.ownerToken,
});
const same = (a: ExecutionBinding, b: ExecutionBinding) =>
  a.projectId === b.projectId && a.taskId === b.taskId &&
  a.coachAddress === b.coachAddress && a.seatAddress === b.seatAddress;
const serialize = (x: unknown) => JSON.stringify(x, null, 2) + "\n";

/** A scoped launch is all-or-nothing. No fields means that existing Pi is unaffected. */
export function executionConfigFromEnv(env: NodeJS.ProcessEnv): SeatRuntimeConfig | undefined {
  const prefix = "PI_ATDD_EXECUTION_";
  const values = ["PROJECT_ID", "TASK_ID", "COACH_ADDRESS", "SEAT_ADDRESS", "EXECUTION_ID",
    "SESSION_ID", "MODEL_ID", "GENERATION", "OWNER_TOKEN"] as const;
  const present = values.some(v => env[prefix + v] !== undefined);
  if (!present) return undefined;
  const get = (key: typeof values[number]) => env[prefix + key]?.trim() ?? "";
  const generation = Number(get("GENERATION"));
  if (!values.filter(v => v !== "GENERATION").every(v => text(get(v))) || !number(generation))
    throw new Error("incomplete ATDD execution binding");
  const binding: ExecutionBinding = {
    projectId: get("PROJECT_ID"), taskId: get("TASK_ID"), coachAddress: get("COACH_ADDRESS"),
    seatAddress: get("SEAT_ADDRESS"), executionId: get("EXECUTION_ID"), sessionId: get("SESSION_ID"),
    modelId: get("MODEL_ID"), generation, ownerToken: get("OWNER_TOKEN"),
  };
  const mode = env.PI_ATDD_EXECUTION_MODE;
  if (mode !== "standalone" && mode !== "external")
    throw new Error("PI_ATDD_EXECUTION_MODE must be standalone or external");
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const key = hash(binding.projectId + "\0" + binding.seatAddress);
  const flowRoot = mode === "external" ? (env.ATDD_WORKFLOW_ROOT || env.PI_ATDD_EXECUTION_FLOW_ROOT)?.trim() : undefined;
  const leasePath = mode === "external"
    ? (env.PI_ATDD_EXECUTION_LEASE_FILE?.trim() || (flowRoot && join(flowRoot,
        ".atdd-flow", "pi-runtime", encodeURIComponent(binding.seatAddress) + ".yaml")))
    : join(agentDir, "execution", "seats", key + ".json");
  if (!leasePath || !leasePath.startsWith("/")) throw new Error("execution lease file must be absolute");
  if (mode === "external" && (!flowRoot || !flowRoot.startsWith("/")))
    throw new Error("Flow-owned seat requires absolute ATDD_WORKFLOW_ROOT");
  const grantRef = env.PI_ATDD_EXECUTION_GRANT_REF?.trim();
  if (grantRef && !text(grantRef)) throw new Error("invalid execution grant reference");
  return { mode, binding, leasePath, checkpointDir: join(agentDir, "execution", "checkpoints", key),
    ...(flowRoot ? { flowRoot } : {}), ...(grantRef ? { grantRef } : {}) };
}

function parseLease(raw: string): LeaseFile {
  const v: unknown = JSON.parse(raw);
  if (!v || typeof v !== "object" || (v as LeaseFile).schema !== "pi-atdd/seat-lease/v1" ||
      !(v as LeaseFile).binding) throw new Error("malformed ATDD seat lease");
  const b = (v as LeaseFile).binding;
  if (![b.projectId, b.taskId, b.coachAddress, b.seatAddress, b.executionId,
    b.sessionId, b.modelId, b.ownerToken].every(text) || !number(b.generation))
    throw new Error("malformed ATDD seat binding");
  const h = (v as LeaseFile).holder;
  if (!h || !Number.isInteger(h.pid) || h.pid <= 0 || !text(h.host)) throw new Error("malformed ATDD seat holder");
  return v as LeaseFile;
}
export function readSeatLeaseFile(path: string): LeaseFile | undefined {
  try { return parseLease(readFileSync(path, "utf8")); }
  catch (e) { if (noFile(e)) return undefined; throw e; }
}
export function readSeatLease(path: string): ExecutionBinding | undefined {
  return readSeatLeaseFile(path)?.binding;
}

/** No lock stealing: on a crashed writer the owner/controller must remove an abandoned lock. */
const locked = withDurableLock;
function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + "." + randomUUID() + ".tmp";
  try { writeFileSync(tmp, serialize(value), { flag: "wx", mode: 0o600 }); renameSync(tmp, path); }
  finally { rmSync(tmp, { force: true }); }
}
const thisHolder = (): Holder => ({ pid: process.pid, host: hostname() });
function commitLease(path: string, binding: ExecutionBinding, holder: Holder = thisHolder()): void {
  atomicJson(path, { schema: "pi-atdd/seat-lease/v1", binding, holder, at: new Date().toISOString() } satisfies LeaseFile);
}

/**
 * Launcher-only provisioning, run outside Pi before tools are enabled. Pi never calls it:
 * the launch environment alone cannot create authority.
 */
export function bootstrapSeat(config: SeatRuntimeConfig): ExecutionBinding {
  if (config.mode !== "standalone") throw new Error("external seat authority cannot be bootstrapped here");
  if (config.binding.generation !== 1) throw new Error("initial seat generation must be 1");
  return locked(config.leasePath, () => {
    const existing = readSeatLease(config.leasePath);
    if (existing) {
      if (!matchesSeatLease(config.binding, source(existing)) || !same(existing, config.binding) ||
        existing.executionId !== config.binding.executionId) throw new Error("seat already assigned");
      return existing;
    }
    commitLease(config.leasePath, config.binding);
    return config.binding;
  });
}

/**
 * Runs `work` while no seat transfer can commit: standalone seats hold the seat lock, so a
 * transfer fails closed instead of landing between a caller's ownership check and its write.
 * Flow-owned seats are changed by Flow, which this process cannot lock; the caller's own check
 * inside `work` is the best available fence there.
 */
export function withSeatFence<T>(config: SeatRuntimeConfig, work: () => T): T {
  return config.mode === "standalone" ? locked(config.leasePath, work) : work();
}

/**
 * Pi rebuilds the extension runtime on session replacement, so the successor's new runtime starts from the
 * launch binding while the lease has rotated (PLT-118 return 2). It may adopt the lease's binding only when the
 * lease is a later generation of this exact seat AND names this very session as its owner; a stale or foreign
 * session matches neither, and a lease is never created or changed here.
 */
export function adoptSuccessorLease(config: SeatRuntimeConfig, sessionId: string): SeatRuntimeConfig {
  if (config.mode !== "standalone" || !text(sessionId)) return config;
  let lease: ExecutionBinding | undefined;
  try { lease = readSeatLease(config.leasePath); } catch { return config; }
  if (!lease || !same(config.binding, lease) || lease.generation <= config.binding.generation ||
    lease.sessionId !== sessionId) return config;
  return { ...config, binding: lease };
}

export function ownsExecution(config: SeatRuntimeConfig, sessionId: string): boolean {
  if (!text(sessionId)) return false;
  if (config.mode === "external") return ownsFlowExecution(config, sessionId);
  const current = readSeatLease(config.leasePath);
  return current !== undefined && same(config.binding, current) &&
    config.binding.executionId === current.executionId &&
    matchesSeatLease(config.binding, source(current)) && sessionId === current.sessionId;
}

/**
 * A read-only adapter to the Flow Desk. Flow seat.yaml plus the current token-
 * fenced pi-runtime record are authoritative. We never mutate either file.
 * The task record must assign/co-ordinate this seat, or authority is unknown.
 */
export function ownsFlowExecution(config: SeatRuntimeConfig, sessionId: string): boolean {
  if (config.mode !== "external" || !config.flowRoot || !text(sessionId)) return false;
  const b = config.binding;
  const m = /^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)$/.exec(b.seatAddress);
  const projectCoach = b.taskId === "*"; // project-scoped main/coordinator may supervise multiple tasks
  if (!m || m[2] !== b.projectId || (!projectCoach && !/^[a-zA-Z0-9_.-]+$/.test(b.taskId))) return false;
  try {
    const runtime = parseYaml(readFileSync(config.leasePath, "utf8")) as {
      schema?: string; seat?: string; owner_token?: string; pi_session?: string;
    };
    const seat = parseYaml(readFileSync(join(config.flowRoot, "work", b.projectId,
      "seats", m[1]!, "seat.yaml"), "utf8")) as {
        address?: string; project?: string; role?: string; runtime?: { pi_session?: string };
      };
    const task = projectCoach ? undefined : parseYaml(readFileSync(join(config.flowRoot, "work", b.projectId,
      "tasks", b.taskId + ".yaml"), "utf8")) as {
        schema?: string; coordinator?: string; assignee?: string; status?: string;
      };
    return runtime?.schema === "atdd-flow/pi-runtime-state/v1" &&
      runtime.seat === b.seatAddress && runtime.owner_token === b.ownerToken &&
      runtime.pi_session === sessionId && b.sessionId === sessionId &&
      seat?.address === b.seatAddress && seat.project === b.projectId &&
      seat.runtime?.pi_session === sessionId &&
      (projectCoach
        ? (seat.role === "main" || seat.role === "coordinator")
        : task?.schema === "atdd-workflow/task/v1" &&
          (task.coordinator === b.seatAddress || task.assignee === b.seatAddress) &&
          !["done", "superseded", "rejected"].includes(task.status ?? ""));
  } catch { return false; }
}

/** Record an in-place model change only after the host confirms the model change succeeded. */
export function recordSeatModel(config: SeatRuntimeConfig, sessionId: string, modelId: string): SeatRuntimeConfig {
  if (!text(modelId)) throw new Error("model identifier required");
  if (config.mode === "external") return config; // Flow's owner controls external runtime observations.
  return locked(config.leasePath, () => {
    if (!ownsExecution(config, sessionId)) throw new Error("stale seat model update");
    const next = { ...config.binding, modelId };
    commitLease(config.leasePath, next);
    return { ...config, binding: next };
  });
}

export function vcsHead(cwd: string): { vcs: "git" | "jj"; head: string } {
  for (const [vcs, cmd, args] of [
    ["jj", "jj", ["log", "--no-graph", "-r", "@", "-T", "commit_id"]],
    ["git", "git", ["rev-parse", "HEAD"]],
  ] as const) {
    try {
      const head = execFileSync(cmd, [...args], { cwd, encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (/^[0-9a-f]{40,64}$/.test(head)) return { vcs, head };
    } catch { /* try the other VCS; do not infer a revision from a branch name */ }
  }
  throw new Error("cannot verify exact git/jj revision");
}

/** Checkpoint records a measured revision and verified attention IDs, never an agent completion claim. */
export function recordSeatCheckpoint(config: SeatRuntimeConfig, sessionId: string, cwd: string,
  attention: ExecutionCheckpoint["attention"],
  grant: ExecutionCheckpoint["grant"] = { state: "unknown", reference: config.grantRef ?? null }): ExecutionCheckpoint {
  if (!ownsExecution(config, sessionId)) throw new Error("cannot checkpoint a stale seat");
  const b = config.binding;
  const checkpoint: ExecutionCheckpoint = {
    schema: "pi-atdd/execution-checkpoint/v1",
    projectId: b.projectId, taskId: b.taskId, coachAddress: b.coachAddress, seatAddress: b.seatAddress,
    sourceExecutionId: b.executionId, sourceSessionId: b.sessionId,
    revision: vcsHead(cwd), acceptance: "unknown", grant, attention,
  };
  atomicJson(join(config.checkpointDir, b.executionId + ".json"), checkpoint);
  return checkpoint;
}

/**
 * Pi records itself as the live holder once it has verified ownership. Recovery later
 * checks this process, so a live session can never be mistaken for a crashed one.
 */
export function claimSeatHolder(config: SeatRuntimeConfig, sessionId: string): void {
  if (config.mode !== "standalone") return;
  locked(config.leasePath, () => {
    if (!ownsExecution(config, sessionId)) throw new Error("cannot claim a stale seat");
    const lease = readSeatLeaseFile(config.leasePath);
    if (!lease) throw new Error("seat lease changed during claim");
    commitLease(config.leasePath, lease.binding, thisHolder());
  });
}

/** The verified checkpoint for an execution, read from disk; the transition decision re-validates it. */
export function readSeatCheckpoint(checkpointDir: string, executionId: string): ExecutionCheckpoint {
  let raw: string;
  try { raw = readFileSync(join(checkpointDir, executionId + ".json"), "utf8"); }
  catch (e) { if (noFile(e)) throw new Error("no verified checkpoint for the recorded execution"); throw e; }
  const v = JSON.parse(raw) as ExecutionCheckpoint;
  if (!v || typeof v !== "object" || v.schema !== "pi-atdd/execution-checkpoint/v1")
    throw new Error("malformed execution checkpoint");
  return v;
}

/** Lock-held transition; the caller holds the seat lock and has validated the source binding. */
function transitionSeatLocked(config: SeatRuntimeConfig, input: {
  nextSessionId: string; modelId: string; checkpoint: ExecutionCheckpoint;
  observedHead: string; sourceSettled: boolean; recoveryAuthorized: boolean;
}, beforeCommit: (next: ExecutionBinding) => void = () => {}): SeatRuntimeConfig {
  const current = readSeatLease(config.leasePath);
  if (!current || !ownsExecution(config, config.binding.sessionId))
    throw new Error("seat lease changed during handoff");
  const next: ExecutionBinding = {
    ...config.binding, generation: config.binding.generation + 1,
    executionId: randomUUID(), ownerToken: randomUUID(),
    sessionId: input.nextSessionId, modelId: input.modelId,
  };
  const decision = decideExecutionTransition({
    kind: "replace_session", source: config.binding, observedOwner: source(current), next,
    checkpoint: input.checkpoint, observedHead: input.observedHead,
    sourceSettled: input.sourceSettled, recoveryAuthorized: input.recoveryAuthorized,
  });
  if (decision.status === "hold") throw new Error("seat handoff refused: " + decision.reason);
  beforeCommit(next); // durable successor records are written before the lease can point at them
  commitLease(config.leasePath, next);
  return { ...config, binding: next };
}

/** Safe CAS and generation fencing. External Flow ownership must be changed by Flow. */
export function replaceSeat(config: SeatRuntimeConfig, input: {
  nextSessionId: string; modelId: string; checkpoint: ExecutionCheckpoint;
  observedHead: string; sourceSettled: boolean; recoveryAuthorized: boolean;
}): SeatRuntimeConfig {
  if (config.mode !== "standalone") throw new Error("Flow-owned seat replacement requires Flow adapter");
  if (!text(input.nextSessionId) || !text(input.modelId)) throw new Error("replacement runtime incomplete");
  return locked(config.leasePath, () => transitionSeatLocked(config, input));
}

/**
 * Delivery acknowledgement: a successor that has put these closures in front of the model clears
 * them from its checkpoint. Until then a further crash replays them (at-least-once).
 */
export function acknowledgeRecovery(config: SeatRuntimeConfig, sessionId: string, delivered: string[]): void {
  if (config.mode !== "standalone" || delivered.length === 0) return;
  locked(config.leasePath, () => {
    if (!ownsExecution(config, sessionId)) throw new Error("cannot acknowledge recovery for a stale seat");
    const cp = readSeatCheckpoint(config.checkpointDir, config.binding.executionId);
    const owed = cp.undeliveredClosed ?? [];
    const remaining = owed.filter(id => !delivered.includes(id));
    if (remaining.length === owed.length) return;
    atomicJson(join(config.checkpointDir, config.binding.executionId + ".json"),
      { ...cp, undeliveredClosed: remaining } satisfies ExecutionCheckpoint);
  });
}

/** What a relaunched successor inherits: the carried-forward checkpoint and what changed since. */
export type RecoveredSeat = {
  config: SeatRuntimeConfig;
  /** Carried to the successor execution: pending IDs re-checked now; grant and acceptance unchanged. */
  checkpoint: ExecutionCheckpoint;
  /** Checkpoint attention IDs no longer open at relaunch (answered or closed since the checkpoint). */
  closedSinceCheckpoint: string[];
};

/**
 * Crash recovery after a restart between checkpoint and lease CAS. Authority comes from
 * the lease's recorded holder being provably dead on this host, plus the verified
 * checkpoint on disk and the exact current repository head. The relaunch binding must
 * match the current lease exactly; a model's own claim is never recovery authority.
 * `recheckAttention` re-reads the attention store under the seat lock; unknown refuses recovery.
 */
export function resumeSeatFromCheckpoint(config: SeatRuntimeConfig, input: {
  nextSessionId: string; modelId: string; cwd: string;
  recheckAttention: () => ExecutionCheckpoint["attention"];
}): RecoveredSeat {
  if (config.mode !== "standalone") throw new Error("Flow-owned seat recovery requires Flow adapter");
  if (!text(input.nextSessionId) || !text(input.modelId)) throw new Error("resume runtime incomplete");
  return locked(config.leasePath, () => {
    const lease = readSeatLeaseFile(config.leasePath);
    if (!lease) throw new Error("no seat lease to resume");
    if (!same(config.binding, lease.binding) || config.binding.executionId !== lease.binding.executionId ||
      !matchesSeatLease(config.binding, source(lease.binding)))
      throw new Error("relaunch binding does not match the current seat lease");
    if (!holderIsDead(lease.holder.pid, lease.holder.host))
      throw new Error("recorded seat holder may still be running; recovery refused");
    const checkpoint = readSeatCheckpoint(config.checkpointDir, lease.binding.executionId);
    const recheck = input.recheckAttention();
    if (recheck.state !== "verified")
      throw new Error("pending attention cannot be re-checked; recovery refused");
    const pendingIds = [...recheck.pendingIds];
    // Closures not yet delivered by an earlier generation stay owed until a successor acknowledges them.
    const closedSinceCheckpoint = [...new Set([...(checkpoint.undeliveredClosed ?? []),
      ...checkpoint.attention.pendingIds])].filter(id => !pendingIds.includes(id));
    const carried: ExecutionCheckpoint = { ...checkpoint, attention: { state: "verified", pendingIds },
      undeliveredClosed: closedSinceCheckpoint };
    const next = transitionSeatLocked({ ...config, binding: lease.binding }, {
      nextSessionId: input.nextSessionId, modelId: input.modelId, checkpoint,
      observedHead: vcsHead(input.cwd).head, sourceSettled: false, recoveryAuthorized: true,
    }, nextBinding => atomicJson(join(config.checkpointDir, nextBinding.executionId + ".json"), {
      ...carried, sourceExecutionId: nextBinding.executionId, sourceSessionId: nextBinding.sessionId,
    } satisfies ExecutionCheckpoint));
    return { config: next, closedSinceCheckpoint, checkpoint: {
      ...carried, sourceExecutionId: next.binding.executionId, sourceSessionId: next.binding.sessionId,
    } };
  });
}
