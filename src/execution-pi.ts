/**
 * PLT-117 — Pi adapter for the deterministic seat lifecycle.
 * Inert without PI_ATDD_EXECUTION_* launch configuration.
 *
 * The launcher is the origin of task/seat identity. A model cannot select its
 * own task, seat or owner token. External Flow authority is read-only here.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  acknowledgeRecovery, claimSeatHolder, executionConfigFromEnv, missingAttentionRouteVariables, missingExecutionVariables, ownsExecution, recordSeatCheckpoint,
  recordSeatModel, adoptSuccessorLease, replaceSeat, resumeSeatFromCheckpoint, seatAuthorizationRefusal, vcsHead,
  withSeatFence, type SeatRuntimeConfig,
} from "./execution-seat.ts";
import type { ExecutionCheckpoint } from "./execution-lifecycle.ts";
import { ensureKey, foldAll, operational, readLaunchConfig, verifyAuthentic, type AttentionItem, type SignedEvent } from "./attention.ts";
import { existsSync, readFileSync } from "node:fs";

type Ctx = {
  cwd: string;
  isProjectTrusted: () => boolean;
  sessionManager: { getSessionId: () => string };
  model?: { provider: string; id: string };
  ui: { notify: (message: string, level?: "info" | "warning" | "error") => void };
};
type Api = {
  on: (event: string, handler: (event: any, ctx: Ctx) => unknown) => void;
  registerCommand: (name: string, def: unknown) => void;
};
export type SeatController = {
  owns: (ctx: unknown) => boolean;
  /** Called only when Pi has settled and the handoff request is latched. */
  checkpoint: (ctx: unknown, pending: ExecutionCheckpoint["attention"]) => ExecutionCheckpoint;
  /** Fences the old seat before delivering a kickoff to the new Pi session. */
  activateSuccessor: (ctx: unknown, checkpoint: ExecutionCheckpoint) => void;
  current: () => SeatRuntimeConfig;
  /** Runs `work` under the seat lock after re-checking ownership; throws when the seat is not owned. */
  fence: <T>(ctx: unknown, work: () => T) => T;
  snapshotAttention: () => ExecutionCheckpoint["attention"];
};
const isContext = (x: unknown): x is Ctx => Boolean(x) && typeof x === "object" &&
  typeof (x as Ctx).isProjectTrusted === "function" &&
  typeof (x as Ctx).sessionManager?.getSessionId === "function";
const modelName = (model: Ctx["model"]) => model ? model.provider + "/" + model.id : "unknown";

/** ATD-36: the startup refusal for scoped attention without a complete route or seat. Names each missing setting. */
const attentionLaunchRefusal = (env: NodeJS.ProcessEnv, seatError?: string): string | undefined => {
  if (!env.PI_ATDD_ATTENTION_ROLE && !seatError) return undefined;
  const route = missingAttentionRouteVariables(env);
  const seat = seatError ? [seatError] : missingExecutionVariables(env);
  const parts: string[] = [];
  if (route.length) parts.push("attention route missing " + route.join(", "));
  if (seat.length) parts.push("execution seat missing " + seat.join(", "));
  return "ATDD launch refused: " + (parts.join("; ") || "unknown setting") +
    ". Start Pi with `atdd launch`, which sets every setting and bootstraps the seat; never start bare pi.";
};

export function registerSeatExecution(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): SeatController | undefined {
  const api = pi as unknown as Api;
  let configured: SeatRuntimeConfig | undefined;
  let seatError: string | undefined;
  try { configured = executionConfigFromEnv(env); }
  catch (e) { seatError = e instanceof Error ? e.message : String(e); }
  if (!configured) {
    // ATD-36: scoped attention without a complete route or seat is refused at session start, naming each setting.
    const refusal = attentionLaunchRefusal(env, seatError);
    if (refusal) {
      api.on("session_start", (_event, ctx) => { (ctx as Partial<Ctx>)?.ui?.notify(refusal, "error"); });
      api.on("tool_call", () => ({ block: true, reason: refusal }));
    }
    return undefined;
  }
  let current = configured;
  // Set only by a launcher-requested recovery. Tools stay blocked until the next prompt delivers it.
  let awaitingTurnEnd: string[] | undefined;
  let recovery: { pendingIds: string[]; closedSinceCheckpoint: string[]; acceptance: string;
    grant: string; delivered: boolean } | undefined;
  const recoveryNotice = (): string => {
    if (!recovery || recovery.delivered) return "";
    recovery.delivered = true;
    const ids = (xs: string[]) => xs.length ? xs.join(", ") : "none";
    return " Recovered after a crash from a verified checkpoint. Pending attention IDs (re-checked now): " +
      ids(recovery.pendingIds) + "; closed since checkpoint: " + ids(recovery.closedSinceCheckpoint) +
      ". Acceptance " + recovery.acceptance.toUpperCase() + "; grant " + recovery.grant.toUpperCase() +
      " (a reference is not a grant; ask the owner before privileged actions). Continue from the record: " +
      "do not repeat completed actions, and check pending attention items first before raising anything new.";
  };
  const snapshotAttention = (): ExecutionCheckpoint["attention"] => {
    const attention = readLaunchConfig(env);
    if (!attention) {
      // A separate agent may have raised items without attention hooks here.
      const dir = env.PI_CODING_AGENT_DIR;
      const spool = dir ? dir + "/attention/spool.jsonl" : undefined;
      return spool && existsSync(spool) ? { state: "unknown", pendingIds: [] }
        : { state: "verified", pendingIds: [] };
    }
    try {
      const raw = existsSync(attention.spool) ? readFileSync(attention.spool, "utf8") : "";
      const key = ensureKey(attention.keyPath);
      // A row that fails shape or MAC, or a partial last line, means we cannot prove absence of an outstanding request.
      const authentic = raw.split("\n").filter(line => line.trim()).map(line => {
        try { return verifyAuthentic(JSON.parse(line), attention, key); } catch { return undefined; }
      });
      if (authentic.some(ev => ev === undefined) || (raw.length > 0 && !raw.endsWith("\n")))
        return { state: "unknown", pendingIds: [] };
      const events = authentic as SignedEvent[];
      const live = [...operational(foldAll(events), new Date()).values()];
      const pendingIds: string[] = [];
      for (const item of live) {
        const route = (item as AttentionItem & { route?: {
          projectId: string; taskId: string; coachAddress: string } }).route;
        if (!route) return { state: "unknown", pendingIds: [] };
        if (route.projectId === current.binding.projectId &&
            (current.binding.taskId === "*" || route.taskId === current.binding.taskId) &&
            route.coachAddress === current.binding.coachAddress) pendingIds.push(item.id);
      }
      return { state: "verified", pendingIds };
    } catch { return { state: "unknown", pendingIds: [] }; }
  };
  const owns = (x: unknown): boolean => {
    if (!isContext(x) || !x.isProjectTrusted()) return false;
    const id = x.sessionManager.getSessionId();
    // A rebuilt runtime in the successor session learns its rotated binding from the lease that names it.
    if (!ownsExecution(current, id)) current = adoptSuccessorLease(current, id);
    return ownsExecution(current, id);
  };
  const checkpoint = (x: unknown, attention: ExecutionCheckpoint["attention"]): ExecutionCheckpoint => {
    if (!isContext(x) || !owns(x)) throw new Error("cannot checkpoint unowned ATDD task seat");
    if (attention.state !== "verified") throw new Error("pending attention cannot be verified for handoff");
    return recordSeatCheckpoint(current, x.sessionManager.getSessionId(), x.cwd, attention);
  };
  const activateSuccessor = (x: unknown, cp: ExecutionCheckpoint): void => {
    if (!isContext(x) || !x.isProjectTrusted()) throw new Error("untrusted successor seat");
    const head = vcsHead(x.cwd);
    if (head.vcs !== cp.revision.vcs) throw new Error("VCS type changed during handoff");
    current = replaceSeat(current, {
      nextSessionId: x.sessionManager.getSessionId(), modelId: modelName(x.model),
      checkpoint: cp, observedHead: head.head, sourceSettled: true, recoveryAuthorized: false,
    });
    if (!owns(x)) throw new Error("successor seat lease verification failed");
  };

  api.on("session_start", (_event, ctx) => {
    if (!isContext(ctx) || !ctx.isProjectTrusted()) return;
    try {
      // Pi never mints authority from its environment: the launcher provisions the lease before Pi starts.
      // A relaunch after a crash resumes only when the launcher asks, from the verified checkpoint.
      if (current.mode === "standalone" && env.PI_ATDD_EXECUTION_RESUME === "1" && !owns(ctx)) {
        if (!ctx.model) throw new Error("a model is required to resume a seat");
        const recovered = resumeSeatFromCheckpoint(current, {
          nextSessionId: ctx.sessionManager.getSessionId(), modelId: modelName(ctx.model), cwd: ctx.cwd,
          recheckAttention: snapshotAttention,
        });
        current = recovered.config;
        recovery = { pendingIds: recovered.checkpoint.attention.pendingIds,
          closedSinceCheckpoint: recovered.closedSinceCheckpoint,
          acceptance: recovered.checkpoint.acceptance, grant: recovered.checkpoint.grant.state, delivered: false };
      }
      if (owns(ctx)) claimSeatHolder(current, ctx.sessionManager.getSessionId());
      else ctx.ui.notify("ATDD execution seat is unowned or superseded; tool calls are blocked", "error");
    } catch (e) { ctx.ui.notify("ATDD execution seat unavailable: " + String(e), "error"); }
  });
  api.on("before_agent_start", (_event, ctx) => {
    if (!owns(ctx)) return { message: {
      customType: "pi-atdd-execution-refused", display: false,
      content: "ATDD execution seat authorization failed. Do not claim task completion or call tools until ownership is restored.",
    } };
    const b = current.binding;
    const owed = recovery && !recovery.delivered ? recovery.closedSinceCheckpoint : undefined;
    const notice = recoveryNotice();
    // Handed to the prompt now; acknowledged only at turn_end, once Pi has persisted the turn.
    if (owed?.length) awaitingTurnEnd = owed;
    return { message: {
      customType: "pi-atdd-execution-context", display: false,
      content: "ATDD verified execution scope: project " + b.projectId + "; task " + b.taskId +
        "; accountable coach " + b.coachAddress + "; seat " + b.seatAddress +
        "; execution " + b.executionId + "; lease generation " + b.generation +
        ". Revalidate acceptance and repository evidence before completion. Model or session identity is not a waiver." +
        notice,
    } };
  });
  // Acknowledge at the turn boundary. A crash before it replays the closure (at-least-once), never loses it.
  api.on("turn_end", (_event, ctx) => {
    const owed = awaitingTurnEnd;
    awaitingTurnEnd = undefined;
    if (!owed?.length || !isContext(ctx)) return;
    try { acknowledgeRecovery(current, ctx.sessionManager.getSessionId(), owed); }
    catch (e) { ctx.ui.notify("ATDD recovery acknowledgement failed; closures will be replayed: " + String(e), "error"); }
  });
  // PLT-125: the PLT-117 checkpoint is refreshed at each settled turn, so a SIGKILL mid-run leaves
  // a verifiable one. Same record and same ownership checks as handoff; unowned, unknown or
  // unmeasurable state writes nothing and the earlier checkpoint (or none) stays authoritative.
  api.on("turn_end", (_event, ctx) => {
    if (!isContext(ctx) || !owns(ctx)) return;
    try {
      const attention = snapshotAttention();
      if (attention.state !== "verified") return;
      recordSeatCheckpoint(current, ctx.sessionManager.getSessionId(), ctx.cwd, attention);
    } catch (e) { ctx.ui.notify("ATDD seat checkpoint not written: " + String(e), "warning"); }
  });
  api.on("tool_call", (_event, ctx) => {
    if (!owns(ctx)) return { block: true,
      reason: "ATDD execution seat is unowned, untrusted or superseded. The launcher must restore the current lease." };
    if (recovery && !recovery.delivered) return { block: true,
      reason: "ATDD recovered seat: start the next prompt so the recovery context (pending attention, unknown acceptance and grant) is delivered before tool use." };
    return undefined;
  });
  // Pi emits model_select from setModel and model cycling (source: set | cycle).
  api.on("model_select", (event, ctx) => {
    if (!owns(ctx) || !event?.model) return;
    try { current = recordSeatModel(current, ctx.sessionManager.getSessionId(), modelName(event.model)); }
    catch (e) { ctx.ui.notify("ATDD model binding update refused: " + String(e), "error"); }
  });
  api.registerCommand("atdd-seat", {
    description: "Inspect authenticated ATDD task, model and session seat binding",
    handler: async (_args: string, ctx: Ctx) => {
      if (!isContext(ctx) || !ctx.isProjectTrusted()) return;
      const b = current.binding;
      ctx.ui.notify("ATDD seat " + b.seatAddress + ", task " + b.taskId +
        ", generation " + b.generation + (owns(ctx) ? " (owned)" : " (NOT owned)"), owns(ctx) ? "info" : "warning");
    },
  });
  const fence = <T>(x: unknown, work: () => T): T => withSeatFence(current, () => {
    if (!owns(x)) throw new Error(seatAuthorizationRefusal(env));
    return work();
  });
  return { owns, checkpoint, activateSuccessor, snapshotAttention, current: () => current, fence };
}
