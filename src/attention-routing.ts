/**
 * PLT-118 — task/coach routing for attention records. Pure domain contract.
 * Routing fields must come from an authenticated launcher/task assignment; an
 * attention_raise tool must never accept them from a model. This module does
 * not authorize a seat or own a task registry. Runtime adapters supply that.
 */
export type AttentionRoute = Readonly<{
  profile: string;
  projectId: string;
  taskId: string;
  coachAddress: string;
  sourceExecutionId: string;
}>;

export type CoachRouteBinding = Readonly<{
  role: "coach";
  profile: string;
  projectId: string;
  coachAddress: string;
}>;

export type WorkerRouteBinding = Readonly<{
  role: "worker";
  profile: string;
  projectId: string;
  coachAddress: string;
  taskId: string;
  executionId: string;
}>;

export type AttentionRouteBinding = CoachRouteBinding | WorkerRouteBinding;
export type RoutedAttention = Readonly<{ route?: AttentionRoute }>;
export type TaskRecipient = Readonly<Pick<AttentionRoute, "profile" | "projectId" | "taskId" | "coachAddress">>;

const present = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 200;
export const isValidAttentionRoute = (route: AttentionRoute | undefined): route is AttentionRoute =>
  route !== undefined && route !== null && typeof route === "object" && [route.profile, route.projectId, route.taskId, route.coachAddress,
    route.sourceExecutionId].every(present);

/**
 * Reads an opt-in scoped routing contract from launcher environment. Existing
 * unscoped installations return undefined; an incomplete scoped launch fails.
 * The compatibility rollout must quarantine unsigned/legacy no-route records
 * before exposing a shared-profile spool to multiple coaches.
 */
export function readAttentionRouteBinding(
  env: Record<string, string | undefined>, role: "worker" | "coach",
): AttentionRouteBinding | undefined {
  const projectId = env.PI_ATDD_ATTENTION_PROJECT_ID?.trim();
  const coachAddress = env.PI_ATDD_ATTENTION_COACH_ADDRESS?.trim();
  const taskId = env.PI_ATDD_ATTENTION_TASK_ID?.trim();
  const executionId = env.PI_ATDD_ATTENTION_EXECUTION_ID?.trim();
  if ([projectId, coachAddress, taskId, executionId].every(x => x === undefined)) return undefined;
  const profile = env.PI_ATDD_ATTENTION_PROFILE?.trim();
  if (![profile, projectId, coachAddress].every(present) ||
      (role === "worker" && ![taskId, executionId].every(present)))
    throw new Error("incomplete ATDD attention route binding");
  if (role === "coach") return { role, profile: profile!, projectId: projectId!, coachAddress: coachAddress! };
  return { role, profile: profile!, projectId: projectId!, coachAddress: coachAddress!,
    taskId: taskId!, executionId: executionId! };
}

/** Caller must supply the launcher-verified binding, never untrusted tool parameters. */
export function routeFromWorkerBinding(binding: WorkerRouteBinding): AttentionRoute {
  const route = { profile: binding.profile, projectId: binding.projectId, taskId: binding.taskId,
    coachAddress: binding.coachAddress, sourceExecutionId: binding.executionId };
  if (!isValidAttentionRoute(route)) throw new Error("incomplete ATDD attention worker binding");
  return route;
}

/** Fail closed: legacy items lacking a recipient are not visible to scoped coaches. */
export function coachOwnsAttention(item: RoutedAttention, coach: CoachRouteBinding): boolean {
  const route = item?.route;
  return isValidAttentionRoute(route) && route.profile === coach.profile &&
    route.projectId === coach.projectId && route.coachAddress === coach.coachAddress &&
    [coach.profile, coach.projectId, coach.coachAddress].every(present);
}

/** Eligibility only; an adapter must separately verify the current task/seat lease. */
export function taskOwnsAttention(item: RoutedAttention, task: TaskRecipient): boolean {
  const route = item?.route;
  return isValidAttentionRoute(route) && [task.profile, task.projectId, task.taskId, task.coachAddress].every(present) &&
    route.profile === task.profile && route.projectId === task.projectId &&
    route.taskId === task.taskId && route.coachAddress === task.coachAddress;
}

/**
 * PLT-118 review P1 A01/A02: a seat may act for a route only when the seat's current assignment
 * is that route: same project and coach, and the same task and execution for a worker. A project
 * coach seat is the one with task "*". The caller supplies the seat from its trusted assignment.
 */
export function seatOwnsRoute(
  seat: Readonly<{ projectId: string; taskId: string; coachAddress: string; executionId: string }>,
  route: AttentionRouteBinding,
): boolean {
  if (seat.projectId !== route.projectId || seat.coachAddress !== route.coachAddress) return false;
  if (route.role === "coach") return seat.taskId === "*";
  return seat.taskId !== "*" && seat.taskId === route.taskId && seat.executionId === route.executionId;
}
