import type { Handler, Response } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { withCustomerLock } from "../../loyalty/application/customer-lock.ts";
import { InsufficientPointsError } from "../../loyalty/domain/points.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import { OrderStateError } from "../domain/order.ts";
import { redeemPoints, IdempotencyKeyReusedError, OrderAlreadyRedeemedError } from "../application/redeem-order.ts";

export type RedeemRouteDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  now: () => Date;
};

const isPositiveInteger = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const badRequest = (error: string): Response => ({ status: 400, body: { error } });

/** Maps a redemption failure to its response. Unrecognised failures are rethrown. */
function redemptionFailure(e: unknown): Response {
  if (e instanceof IdempotencyKeyReusedError) return { status: 422, body: { error: e.message } };
  if (e instanceof OrderStateError || e instanceof OrderAlreadyRedeemedError || e instanceof InsufficientPointsError)
    return { status: 409, body: { error: e.message } };
  if (e instanceof UnknownRegionError) return badRequest(e.message);
  throw e;
}

/** POST /orders/:id/redeem: the signed-in owner pays part of a pending order with points. */
export function redeemHandler(deps: RedeemRouteDeps): Handler {
  return withCustomer(deps.sessions, (req, params, customer) => {
    const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
    const points = body?.points;
    const idempotencyKey = body?.idempotencyKey;
    if (!isPositiveInteger(points)) return badRequest("points must be a positive integer");
    if (typeof idempotencyKey !== "string" || idempotencyKey === "") return badRequest("idempotencyKey required");

    return withCustomerLock(customer.id, async (): Promise<Response> => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      try {
        const result = await redeemPoints({ loyalty: deps.loyalty, now: deps.now }, order, { points, idempotencyKey });
        return { status: 200, body: result };
      } catch (e) {
        return redemptionFailure(e);
      }
    });
  });
}
