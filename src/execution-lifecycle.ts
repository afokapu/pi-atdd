/**
 * PLT-117 — deterministic transition preflight for a task-scoped execution seat.
 * This is a pure contract, not a seat registry or an authorization provider.
 * The caller MUST obtain observedOwner, observedHead and recoveryAuthorized from
 * authoritative runtime/repository adapters, never from model-supplied text.
 * A successful decision is not permission to modify a runtime: the adapter must
 * atomically fence the previous owner and verify the successor at commit time.
 */
export type ExecutionBinding = Readonly<{
  projectId: string;
  taskId: string;
  coachAddress: string;
  seatAddress: string;
  executionId: string;
  sessionId: string;
  modelId: string;
  generation: number;
  ownerToken: string;
}>;

export type SeatLeaseObservation = Readonly<Pick<ExecutionBinding,
  "seatAddress" | "sessionId" | "generation" | "ownerToken">>;

export type ExecutionCheckpoint = Readonly<{
  schema: "pi-atdd/execution-checkpoint/v1";
  projectId: string;
  taskId: string;
  coachAddress: string;
  seatAddress: string;
  sourceExecutionId: string;
  sourceSessionId: string;
  revision: { vcs: "git" | "jj"; head: string };
  /** Unknown acceptance must remain unknown in the successor, never become done. */
  acceptance: "verified" | "unknown";
  attention: { state: "verified" | "unknown"; pendingIds: string[] };
}>;

export type TransitionInput =
  | Readonly<{ kind: "switch_model"; source: ExecutionBinding; next: ExecutionBinding;
    observedOwner: SeatLeaseObservation }>
  | Readonly<{ kind: "replace_session"; source: ExecutionBinding; next: ExecutionBinding;
    observedOwner: SeatLeaseObservation; checkpoint: ExecutionCheckpoint;
    observedHead: string; sourceSettled: boolean; recoveryAuthorized: boolean }>;

export type TransitionDecision =
  | { status: "hold"; reason: string }
  | { status: "allow"; fencePrevious: false }
  | { status: "allow"; fencePrevious: true; checkpointAcceptance: "verified" | "unknown";
      pendingAttentionIds: string[] };

const valid = (value: string) => typeof value === "string" && value.trim().length > 0;
const validBinding = (b: ExecutionBinding) =>
  [b.projectId, b.taskId, b.coachAddress, b.seatAddress,
    b.executionId, b.sessionId, b.modelId, b.ownerToken].every(valid) &&
  Number.isSafeInteger(b.generation) && b.generation >= 1;

/** An advisory local comparison; the runtime adapter must recheck under its ownership lock. */
export function matchesSeatLease(binding: ExecutionBinding, observed: SeatLeaseObservation): boolean {
  return validBinding(binding) && binding.seatAddress === observed.seatAddress &&
    binding.sessionId === observed.sessionId && binding.generation === observed.generation &&
    binding.ownerToken === observed.ownerToken;
}

const sameWorkAndSeat = (a: ExecutionBinding, b: ExecutionBinding) =>
  a.projectId === b.projectId && a.taskId === b.taskId &&
  a.coachAddress === b.coachAddress && a.seatAddress === b.seatAddress;
const hold = (reason: string): TransitionDecision => ({ status: "hold", reason });

/**
 * Preflight only. The caller must perform any lease mutation atomically and
 * revalidate its expected generation/token immediately before changing state.
 */
export function decideExecutionTransition(input: TransitionInput): TransitionDecision {
  const { source, next, observedOwner } = input;
  if (!validBinding(source) || !validBinding(next)) return hold("incomplete execution binding");
  if (!matchesSeatLease(source, observedOwner)) return hold("current runtime does not own the observed seat lease");
  if (!sameWorkAndSeat(source, next)) return hold("project, task, coach and seat must remain stable");

  if (input.kind === "switch_model") {
    if (next.executionId !== source.executionId || next.sessionId !== source.sessionId ||
      next.generation !== source.generation || next.ownerToken !== source.ownerToken)
      return hold("in-place model switch must retain the exact runtime owner");
    if (next.modelId === source.modelId) return hold("no model change requested");
    return { status: "allow", fencePrevious: false };
  }

  if (next.executionId === source.executionId || next.sessionId === source.sessionId ||
    next.ownerToken === source.ownerToken || next.generation !== source.generation + 1)
    return hold("replacement requires a fresh execution, session, token and next generation");
  if (!input.sourceSettled && !input.recoveryAuthorized)
    return hold("source is not settled and recovery is not authorized");

  const cp = input.checkpoint;
  if (cp.schema !== "pi-atdd/execution-checkpoint/v1" ||
      cp.projectId !== source.projectId || cp.taskId !== source.taskId ||
      cp.coachAddress !== source.coachAddress || cp.seatAddress !== source.seatAddress ||
      cp.sourceExecutionId !== source.executionId || cp.sourceSessionId !== source.sessionId)
    return hold("checkpoint does not describe the source work and execution");
  if (!valid(cp.revision.head) || !valid(input.observedHead) || cp.revision.head !== input.observedHead ||
      (cp.revision.vcs !== "git" && cp.revision.vcs !== "jj"))
    return hold("exact source revision is unverified");
  if (cp.acceptance !== "verified" && cp.acceptance !== "unknown")
    return hold("checkpoint acceptance is invalid");
  if (cp.attention.state !== "verified" || !Array.isArray(cp.attention.pendingIds) ||
      !cp.attention.pendingIds.every(valid))
    return hold("pending attention cannot be reconstructed");

  return { status: "allow", fencePrevious: true, checkpointAcceptance: cp.acceptance,
    pendingAttentionIds: [...cp.attention.pendingIds] };
}
