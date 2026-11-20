import test from "node:test";
import assert from "node:assert/strict";
import { discoverSourceEvidence } from "../src/structural-evidence.ts";

const AUTH = "bun_mutating_route";
const URN = "test_urn_header";

test("Bun mutating route in generic file activates structural fact without task vocabulary", () => {
  const source = 'Bun.serve({ routes: {"/orders/:id": { DELETE: () => new Response("ok") }} });';
  assert.deepEqual(discoverSourceEvidence("src/server.ts", source), [AUTH]);
  assert.deepEqual(discoverSourceEvidence("src/server.ts", source), [AUTH], "cached result stable");
});
test("fetch mutation is recognized including a one-hop method alias", () => {
  assert.deepEqual(discoverSourceEvidence("src/http.ts",
    'Bun.serve({ fetch(req) { const method = req.method; if(method === "PATCH") return new Response("ok"); } });'), [AUTH]);
});
test("Bun routes bound to a local constant are recognized", () => {
  assert.deepEqual(discoverSourceEvidence("src/server.ts",
    'const routes = {"/orders": { POST: () => new Response("ok") }}; Bun.serve({routes});'), [AUTH]);
});
test("GET and unrelated DELETE object do not count as a mutating route", () => {
  assert.deepEqual(discoverSourceEvidence("src/server.ts",
    'Bun.serve({routes:{"/catalog":{GET:()=>new Response("ok")}}});'), []);
  assert.deepEqual(discoverSourceEvidence("src/server.ts",
    'const options = { DELETE: () => new Response("ok") };'), []);
});
test("test header URN recognized irrespective of directory; not below imports or in non-test file", () => {
  const source = '// URN: test:orders:checkout:E001-SMOKE-001\nimport { strict as assert } from "node:assert";';
  assert.deepEqual(discoverSourceEvidence("src/order-check.test.ts", source), [URN]);
  assert.deepEqual(discoverSourceEvidence("src/order-check.ts", source), []);
  assert.deepEqual(discoverSourceEvidence("src/order-check.test.ts",
    'import { strict as assert } from "node:assert";\n// URN: test:orders:checkout:E001-SMOKE-001'), []);
});
test("tests, vendors and malformed code are not classified as Bun route source", () => {
  const source = 'Bun.serve({routes:{"/x":{DELETE:()=>new Response("ok")}}});';
  assert.deepEqual(discoverSourceEvidence("src/route.test.ts", source), []);
  assert.deepEqual(discoverSourceEvidence("vendor/dependency/server.ts", source), []);
  assert.deepEqual(discoverSourceEvidence("src/server.ts", 'Bun.serve({ routes: {') , []);
});
test("changing code changes facts; no stale source-hash result", () => {
  assert.deepEqual(discoverSourceEvidence("src/http.ts",
    'Bun.serve({routes:{"/x":{PATCH:()=>new Response("ok")}}});'), [AUTH]);
  assert.deepEqual(discoverSourceEvidence("src/http.ts",
    'Bun.serve({routes:{"/x":{GET:()=>new Response("ok")}}});'), []);
});
