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
const validate = ajv.compile(schema);

test("all seven implementation acceptance criteria follow the existing ATDD-Bun V2 template", () => {
  const dir = join(root, "plan/acceptances");
  const files = readdirSync(dir).filter(file => file.endsWith(".acceptance.yaml")).sort();
  assert.equal(files.length, 7);
  const urns = new Set<string>();
  for (const file of files) {
    const doc = readYaml(join(dir, file));
    assert.equal(validate(doc), true, file + " " + JSON.stringify(validate.errors));
    const identity = doc.identity as { urn: string; phase: string };
    assert.ok(!urns.has(identity.urn), "duplicate acceptance " + identity.urn);
    urns.add(identity.urn);
    assert.equal((doc.harness as { language_hint: string }).language_hint, "typescript");
    assert.equal(identity.phase, "GREEN");
  }
});

test("the acceptance schema rejects absent proof fields, not just malformed YAML", () => {
  const valid = readYaml(join(root, "plan/acceptances/E001-UNIT-001.acceptance.yaml"));
  const incomplete = { ...valid, then: { abstract: ["passed"] } };
  assert.equal(validate(incomplete), false);
  assert.ok(validate.errors?.some(e => e.instancePath.startsWith("/then")));
});
