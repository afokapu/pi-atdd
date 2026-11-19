import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import { redeemPoints, type RedeemInput } from "../application/redeem-points.ts";
import type { OrderUseCaseDeps } from "../application/owned-order.ts";
import { orderErrorResponse } from "./order-errors.ts";

type RedeemBody = { points: number; idempotencyKey: string };

/**
 * Validates the body: `points` must be a positive integer and `idempotencyKey` a non-blank string.
 * Returns undefined for anything else so the handler can answer 400 before touching the ledger.
 */
function parseRedeemBody(body: unknown): RedeemBody | undefined {
  const { points, idempotencyKey } = (body ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(points) || (points as number) <= 0) return undefined;
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") return undefined;
  return { points: points as number, idempotencyKey };
}

/** POST /orders/:id/redeem: pay part of a pending order with loyalty points. */
export function redeemRoute(router: Router, deps: OrderUseCaseDeps & { sessions: SessionStore }): void {
  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) => {
    const body = parseRedeemBody(req.body);
    if (!body) return { status: 400, body: { error: "points and idempotencyKey required", error_code: "INVALID_REDEMPTION" } };
    const input: RedeemInput = { orderId: params.id!, customerId: customer.id, ...body };
    try {
      return { status: 200, body: await redeemPoints(deps, input) };
    } catch (e) {
      return orderErrorResponse(e);
    }
  }));
}
