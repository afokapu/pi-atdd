Rule id: `coder.bun.idempotent-replay-stored-result`

Topic: a mutating operation that accepts an idempotency key from the client.

Obligation to capture: on a repeated request with the same idempotency key, return the stored original result without re-executing side effects or recomputing it from current state, after re-authorising the caller; reject the same key sent with a different request payload.

Knowledge to carry:
- Persist, per key (scoped to the caller/resource), a fingerprint of the normalised request payload and the full original response, in the same atomic step as the side effect.
- On replay: authenticate and authorise the caller again exactly as for a first request (the key is not a credential); then compare the fingerprint; same → return the stored response verbatim (do not recompute from current prices/configuration/state); different → reject with a 4xx conflict/unprocessable error and perform nothing.
- Concurrent requests with the same key must not both execute: check-and-record the key inside the same critical section as the side effect.
- Do not key replay only by key string globally (cross-tenant collisions) — scope by caller/resource.
- Evidence: tests for replay (no extra side effect, identical body), mismatch (4xx, nothing changed), replay by a different caller (rejected like a first request), and replay after configuration change (stored result returned).
