import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";
import { Ledger } from "./loyalty/application/ledger.ts";
import { KeyedLock } from "./shared/keyed-lock.ts";
import type { IdempotencyStore } from "./orders/application/order-payments.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
  /** Recorded redemption results by idempotency key. Defaults to an in-memory map. */
  idempotency?: IdempotencyStore;
};

/** Composition root: every route of the service on one router. */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  const payments = {
    orders: deps.orders,
    ledger: new Ledger(deps.loyalty),
    customerLock: new KeyedLock(),
    idempotency: deps.idempotency ?? new Map(),
    now: deps.now ?? (() => new Date()),
  };
  orderRoutes(router, { orders: deps.orders, sessions: deps.sessions, payments });
  return router;
}
