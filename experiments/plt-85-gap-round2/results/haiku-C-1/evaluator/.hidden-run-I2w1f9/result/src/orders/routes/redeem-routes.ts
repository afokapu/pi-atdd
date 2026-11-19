import type { Request, Response, Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { OrderBook } from "../domain/order.ts";
import type { LoyaltyLedger } from "../../loyalty/application/ledger-port.ts";
import { redeemOrder, type RedeemOutcome, type RedeemRequest } from "../application/redeem-order.ts";

/**
 * HTTP entry point for LOY-002: `POST /orders/:id/redeem` with body `{ points, idempotencyKey }`.
 * This module only parses the body and maps outcomes to statuses; the rules live in the use case.
 */
export type RedeemRouteDeps = { orders: OrderBook; sessions: SessionStore; loyalty: LoyaltyLedger; now: () => Date };

export function redeemRoutes(router: Router, deps: RedeemRouteDeps): Router {
  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) => {
    const parsed = parseRedeemBody(req);
    if (!parsed.ok) return { status: 400, body: { error_code: "INVALID_REQUEST", error: parsed.error } };
    const outcome = await redeemOrder(deps, customer.id, params.id!, parsed.value);
    return toResponse(outcome);
  }));
  return router;
}

type Parsed = { ok: true; value: RedeemRequest } | { ok: false; error: string };

function parseRedeemBody(req: Request): Parsed {
  const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
  const points = body?.points;
  const key = body?.idempotencyKey;
  if (typeof points !== "number" || !Number.isInteger(points) || points <= 0)
    return { ok: false, error: "points must be a positive integer" };
  if (typeof key !== "string" || key.trim() === "") return { ok: false, error: "idempotencyKey required" };
  return { ok: true, value: { points, idempotencyKey: key } };
}

function toResponse(outcome: RedeemOutcome): Response {
  switch (outcome.kind) {
    case "redeemed": return { status: 200, body: outcome.quote };
    case "not-found": return { status: 404, body: { error_code: "ORDER_NOT_FOUND", error: "order not found" } };
    case "not-pending": return { status: 409, body: { error_code: "ORDER_NOT_PENDING", error: "only pending orders can be paid with points" } };
    case "already-redeemed": return { status: 409, body: { error_code: "ORDER_ALREADY_REDEEMED", error: "order already paid with points" } };
    case "key-reused": return { status: 409, body: { error_code: "IDEMPOTENCY_KEY_REUSED", error: "idempotency key was used with a different request" } };
  }
}
