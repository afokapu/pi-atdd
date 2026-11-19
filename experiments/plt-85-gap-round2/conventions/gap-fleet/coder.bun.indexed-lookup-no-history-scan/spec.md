Rule id: `coder.bun.indexed-lookup-no-history-scan`

Topic: a request handler or use case that needs a small, filtered subset of an owner's records (e.g. currently valid entries, open items) from a store that also holds their full history.

Obligation to capture: fetch only the needed subset through a keyed/indexed store query (by owner, with the filter and ordering pushed into the store or adapter), and write back only the records that changed — the number of store calls and records touched per request must not grow with the owner's history.

Knowledge to carry:
- Do not load all records (or all of an owner's history) and filter/sort in memory in the application layer.
- If the store lacks the needed query, add a narrow query method to the store/adapter (e.g. by owner, valid at time T, ordered by a key) maintained with an index or per-owner structure.
- Write only modified records (update by id), not rewrite the whole collection or every record of the owner.
- Avoid N+1 patterns: one call per record read in a loop.
- Evidence: a test with a large history (e.g. thousands of inactive records) shows store calls / records touched per request are bounded by the number of records actually used; a reviewer sees no full-collection read in the request path.
