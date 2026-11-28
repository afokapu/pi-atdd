// URN: test:pi-atdd:evaluate-delivery:atd-45-a01
// Acceptance: acc:pi-atdd:atd-45-a01
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readYaml } from "../src/catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "tests/fixtures/schema/acceptance.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const appendix = JSON.parse(readFileSync(join(root, "tests/fixtures/schema/appendix.schema.json"), "utf8"));
ajv.addSchema(appendix, "appendix.schema.json");
const validate = ajv.compile(schema);
const nested = (): Array<{ file: string; doc: Record<string, unknown> }> =>
  readdirSync(join(root, "plan/pi-atdd")).filter(f => /^[DLPCEMYRK]\d{3}\.yaml$/.test(f)).sort().flatMap(f =>
    ((readYaml(join(root, "plan/pi-atdd", f)).acceptances ?? []) as Array<Record<string, unknown>>).map(doc => ({ file: f, doc })));

test("all formal implementation criteria follow the existing ATDD-Bun V2 template", () => {
  const all = nested();
  assert.equal(all.length, 117);
  const urns = new Set<string>();
  const ids = new Set<string>();
  for (const { file, doc } of all) {
    assert.equal(validate(doc), true, file + " " + JSON.stringify(validate.errors));
    const identity = doc.identity as { urn: string; phase: string; id: string };
    assert.ok(!urns.has(identity.urn), "duplicate acceptance " + identity.urn);
    urns.add(identity.urn);
    assert.ok(!ids.has(identity.id), "duplicate acceptance ID " + identity.id);
    ids.add(identity.id);
    assert.equal((doc.harness as { language_hint: string }).language_hint, "typescript");
    assert.equal(identity.phase, "GREEN");
  }
});

test("the acceptance schema rejects absent proof fields, not just malformed YAML", () => {
  const valid = nested().find(x => (x.doc.identity as { urn: string }).urn === "acc:pi-atdd:E001-UNIT-001")!.doc;
  const incomplete = { ...valid, then: { abstract: ["passed"] } };
  assert.equal(validate(incomplete), false);
  assert.ok(validate.errors?.some(e => e.instancePath.startsWith("/then")));
});

test("all declared acceptances have a test binding", () => {
  const expected = nested().map(x => (x.doc.identity as { urn: string }).urn);
  const tests = readdirSync(join(root, "tests")).filter(f => f.endsWith(".test.ts") || f.endsWith("-smoke.ts"));
  const text = tests.map(path => readFileSync(join(root, "tests", path), "utf8")).join("\n");
  const bound = [...text.matchAll(/^\/\/ Acceptance: (acc:pi-atdd:[\w-]+)/gm)].map(m => m[1]!);
  const unbound = expected.filter(urn => !bound.includes(urn));
  assert.deepEqual(unbound, [], "every declared acceptance must have a test binding");
  for (const urn of expected) assert.ok(bound.includes(urn), "acceptance lacks a test binding: " + urn);
  for (const urn of new Set(bound)) assert.equal(expected.filter(e => e === urn).length, 1, "bound acceptance is not declared exactly once: " + urn);
});
