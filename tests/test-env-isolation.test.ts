// Acceptance: ATD-43 Acceptance-01 — the suite gives the same result inside and outside a launched session.
// A launched session exports PI_ATDD_* to its children; no test may inherit them.
import assert from "node:assert/strict";
import { test } from "node:test";

test("ATD-43: the test process starts with no PI_ATDD_* variables", () => {
  const leaked = Object.keys(process.env).filter((key) => key.startsWith("PI_ATDD_"));
  assert.deepEqual(leaked, []);
});
