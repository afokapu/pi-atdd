import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import { OrderStateError } from "../../orders/domain/order.ts";
import { InsufficientPointsError } from "../domain/points.ts";
import { IdempotencyConflictError, OrderNotFoundError, redeemPoints, type RedeemDeps } from "../application/redeem-points.ts";

export type RedeemRouteDeps = RedeemDeps & { sessions: SessionStore };

/** POST /orders/:id/redeem — body { points, idempotencyKey }; responds with the new quote. */
export function redeemRoutes(router: Router, deps: RedeemRouteDeps): Router {
  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) => {
    const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
    if (!Number.isSafeInteger(body?.points) || (body!.points as number) <= 0)
      return { status: 400, body: { error: "points must be a positive integer" } };
    if (typeof body?.idempotencyKey !== "string" || body.idempotencyKey.length === 0)
      return { status: 400, body: { error: "idempotencyKey required" } };
    try {
      const quote = await redeemPoints(deps, customer.id, params.id!, body.points as number, body.idempotencyKey);
      return { status: 200, body: quote };
    } catch (e) {
      if (e instanceof OrderNotFoundError) return { status: 404, body: { error: e.message } };
      if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
      if (e instanceof IdempotencyConflictError || e instanceof InsufficientPointsError)
        return { status: 422, body: { error: e.message } };
      throw e;
    }
  }));
  return router;
}
