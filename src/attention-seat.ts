/**
 * PLT-118: binds the attention strip to the live execution seat. The launch route names the task
 * and coach; the execution rotates when PLT-117 recovery or handoff replaces the session, so the
 * route in force is always derived from the CURRENT authorized binding, never from launch env.
 */
import { seatOwnsRoute, type AttentionRouteBinding } from "./attention-routing.ts";
import type { SeatController } from "./execution-pi.ts";
import type { StripOptions } from "./attention-strip.ts";

export function attentionSeatOptions(seat: SeatController | undefined): StripOptions {
  if (!seat) return {};
  return {
    liveRoute: (ctx: unknown, launched: AttentionRouteBinding) => {
      if (!seat.owns(ctx)) return undefined;
      const binding = seat.current().binding;
      // The task, project and coach are fixed by the launch; only the execution may rotate.
      const route: AttentionRouteBinding = launched.role === "worker"
        ? { ...launched, executionId: binding.executionId } : launched;
      return seatOwnsRoute(binding, route) ? route : undefined;
    },
    fence: (ctx, work) => seat.fence(ctx, work),
  };
}
