import type { Response } from "../../http/router.ts";
import { OrderStateError } from "../domain/order.ts";
import { OrderNotFoundError } from "../application/owned-order.ts";
import { IdempotencyKeyReusedError, OrderAlreadyRedeemedError } from "../application/redeem-points.ts";

const coded = (status: number, errorCode: string, message: string): Response =>
  ({ status, body: { error: message, error_code: errorCode } });

/**
 * Maps order use-case failures to HTTP responses with a stable error code.
 * Anything unexpected is rethrown so the server reports it rather than hiding it.
 */
export function orderErrorResponse(e: unknown): Response {
  if (e instanceof OrderNotFoundError) return coded(404, "ORDER_NOT_FOUND", e.message);
  if (e instanceof OrderStateError) return coded(409, "ORDER_NOT_PENDING", e.message);
  if (e instanceof OrderAlreadyRedeemedError) return coded(409, "ORDER_ALREADY_REDEEMED", e.message);
  if (e instanceof IdempotencyKeyReusedError) return coded(409, "IDEMPOTENCY_KEY_REUSED", e.message);
  throw e;
}
