// Shared test setup (ATD-43), loaded by `npm test` through `node --import` before every test file.
// A launched session exports PI_ATDD_* to its children; tests build their own seat, route and handoff
// state and must not inherit it, or the same suite gives different results inside and outside a session.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("PI_ATDD_")) delete process.env[key];
}
