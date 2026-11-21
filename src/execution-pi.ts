/**
 * PLT-117 — Pi adapter for the deterministic seat lifecycle.
 * Inert without PI_ATDD_EXECUTION_* launch configuration.
 *
 * The launcher is the origin of task/seat identity. A model cannot select its
 * own task, seat or owner token. External Flow authority is read-only here.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  bootstrapSeat, executionConfigFromEnv, ownsExecution, readSeatLease, recordSeatCheckpoint,
  recordSeatModel, replaceSeat, vcsHead, type SeatRuntimeConfig,
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
  snapshotAttention: () => ExecutionCheckpoint["attention"];
};
const isContext = (x: unknown): x is Ctx => Boolean(x) && typeof x === "object" &&
  typeof (x as Ctx).isProjectTrusted === "function" &&
  typeof (x as Ctx).sessionManager?.getSessionId === "function";
const modelName = (model: Ctx["model"]) => model ? model.provider + "/" + model.id : "unknown";

export function registerSeatExecution(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): SeatController | undefined {
  const configured = executionConfigFromEnv(env);
  if (!configured) return undefined;
  const api = pi as unknown as Api;
  let current = configured;
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
      // Rows for other coaches are authentic and are filtered below, not counted as unknown (review integration).
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
  const owns = (x: unknown): boolean => isContext(x) && x.isProjectTrusted() &&
    ownsExecution(current, x.sessionManager.getSessionId());
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
      if (current.mode === "standalone" && env.PI_ATDD_EXECUTION_BOOTSTRAP === "1" &&
        !readSeatLease(current.leasePath)) bootstrapSeat(current);
      if (!owns(ctx)) ctx.ui.notify("ATDD execution seat is unowned or superseded; tool calls are blocked", "error");
    } catch (e) { ctx.ui.notify("ATDD execution seat unavailable: " + String(e), "error"); }
  });
  api.on("before_agent_start", (_event, ctx) => {
    if (!owns(ctx)) return { message: {
      customType: "pi-atdd-execution-refused", display: false,
      content: "ATDD execution seat authorization failed. Do not claim task completion or call tools until ownership is restored.",
    } };
    const b = current.binding;
    return { message: {
      customType: "pi-atdd-execution-context", display: false,
      content: "ATDD verified execution scope: project " + b.projectId + "; task " + b.taskId +
        "; accountable coach " + b.coachAddress + "; seat " + b.seatAddress +
        "; execution " + b.executionId + "; lease generation " + b.generation +
        ". Revalidate acceptance and repository evidence before completion. Model or session identity is not a waiver.",
    } };
  });
  api.on("tool_call", (_event, ctx) => {
    if (!owns(ctx)) return { block: true,
      reason: "ATDD execution seat is unowned, untrusted or superseded. The launcher must restore the current lease." };
    return undefined;
  });
  api.on("model_changed", (_event, ctx) => {
    if (!owns(ctx) || !ctx.model) return;
    try { current = recordSeatModel(current, ctx.sessionManager.getSessionId(), modelName(ctx.model)); }
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
  return { owns, checkpoint, activateSuccessor, snapshotAttention, current: () => current };
}
