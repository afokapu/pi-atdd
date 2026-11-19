# orders-service

Small TypeScript service (Node >= 22, type stripping, no dependencies).

Layering inside each bounded context (`src/<context>/`):

- `domain/` — pure business rules. Depends on nothing outside its own `domain/`.
- `application/` — use cases; composes domain with integrations.
- `integration/` — adapters to storage and remote configuration.
- `routes/` — HTTP handlers, registered on `src/http/router.ts`.

Bounded contexts: `orders`, `pricing`, `loyalty`.

Composition root: `src/app.ts` — `createApp(deps)` wires every route onto one `Router`.
Tests build the service through `createApp`; keep its signature (new optional deps are fine).
`src/seed.ts` holds demo data (customers, orders, points lots).

Money is integer cents. Loyalty points are held in lots (`src/loyalty/domain/points.ts`)
stored by an asynchronous store (`src/loyalty/integration/loyalty-store.ts`).

Run tests: `npm test` (or `node --test "tests/**/*.test.ts"`)
