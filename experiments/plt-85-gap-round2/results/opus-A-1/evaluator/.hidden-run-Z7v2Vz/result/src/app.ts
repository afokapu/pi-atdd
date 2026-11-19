import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import { redeemRoutes } from "./loyalty/routes/redeem-routes.ts";
import { CustomerLock } from "./loyalty/application/customer-lock.ts";
import { IdempotencyStore } from "./loyalty/application/redeem-points.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
  /** Remembered redemption results by idempotency key. Defaults to a fresh in-memory store. */
  idempotency?: IdempotencyStore;
};

/** Composition root: every route of the service on one router. */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  const now = deps.now ?? (() => new Date());
  const lock = new CustomerLock();
  const idempotency = deps.idempotency ?? new IdempotencyStore();
  const { orders, loyalty, sessions } = deps;
  orderRoutes(router, { orders, loyalty, sessions, lock, now });
  redeemRoutes(router, { orders, loyalty, sessions, lock, idempotency, now });
  return router;
}
