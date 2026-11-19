import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";
import { KeyedLock } from "./common/keyed-lock.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
};

/**
 * Composition root: every route of the service on one router. One lock is created per app so
 * that every customer-scoped write (redeem, cancel) shares the same critical sections.
 */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  const payments = {
    orders: deps.orders,
    loyalty: deps.loyalty,
    locks: new KeyedLock(),
    now: deps.now ?? (() => new Date()),
  };
  orderRoutes(router, { orders: deps.orders, sessions: deps.sessions, payments });
  return router;
}
