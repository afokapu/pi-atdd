# orders-service

Small TypeScript service (Node >= 22, type stripping, no dependencies).

Layering inside each bounded context (`src/<context>/`):

- `domain/` — pure business rules. Depends on nothing outside its own `domain/`.
- `application/` — use cases; composes domain with integrations.
- `integration/` — adapters to storage and remote configuration.
- `routes/` — HTTP handlers, registered on `src/http/router.ts`.

Run tests: `npm test` (or `node --test "tests/**/*.test.ts"`)
