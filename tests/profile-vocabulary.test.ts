// Acceptance: acc:pi-atdd:PLT-84-SN-002
// The structure-profile key vocabulary that SN-002 cores depend on is closed and documented, and the schema is generated from it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_GROUPS, expandKeys, isVocabularyKey, loadVocabulary, profileSchema, proposalProblems } from "../src/profile-vocabulary.ts";

const ROOT = new URL("..", import.meta.url).pathname;

test("the vocabulary has exactly the eight groups, and every key is documented and typed", () => {
  const v = loadVocabulary();
  assert.deepEqual(Object.keys(v.groups), [...PROFILE_GROUPS]);
  for (const k of expandKeys(v)) {
    assert.ok(k.key.startsWith(k.group + "."), k.key);
    assert.ok(k.doc.trim().length > 10, k.key + " doc");
    assert.ok(["list", "text", "path", "glob", "pattern"].includes(k.type), k.key + " type");
  }
});

test("parametric keys accept only declared parameter values", () => {
  assert.ok(isVocabularyKey("roles.domain.path"));
  assert.ok(isVocabularyKey("suffix.unit_test"));
  assert.ok(isVocabularyKey("urn.binding.acceptance"));
  assert.ok(!isVocabularyKey("roles.repository.path"), "repository is not a declared role");
  assert.ok(!isVocabularyKey("enforcement.severity"), "per-rule severity is not a profile key");
  assert.ok(!isVocabularyKey("lockfile.native"), "keys outside the eight groups are rejected");
});

test("a key proposal must sit in a group, follow the grammar and be new", () => {
  assert.deepEqual(proposalProblems("idiom.retry_policy"), []);
  assert.ok(proposalProblems("idiom.markup_kinds").some((p) => p.includes("already exists")), "approved in vocabulary v2");
  assert.ok(proposalProblems("detector.foo").length > 0);
  assert.ok(proposalProblems("idiom.Auth-Guard").length > 0);
  assert.ok(proposalProblems("idiom.auth_guard").some((p) => p.includes("already exists")));
});

test("profiles/profile.schema.json is the schema generated from the vocabulary", () => {
  const committed = JSON.parse(readFileSync(join(ROOT, "profiles/profile.schema.json"), "utf8"));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(profileSchema())), "regenerate with tools/profile-vocabulary-schema.ts");
  assert.deepEqual(Object.keys(committed.properties.values.properties).sort(), expandKeys().map((k) => k.key).sort());
  assert.equal(committed.properties.values.additionalProperties, false, "the vocabulary is closed");
});

test("the neutrality lint ignores test-kind prose but still catches paths", async () => {
  const { neutralityLeaks } = await import("../src/neutral-lint.ts");
  assert.deepEqual(neutralityLeaks({ then: "an e2e/journey test binds a train", verification: ["unit/acceptance tests"] }), []);
  assert.equal(neutralityLeaks({ then: "put it under e2e/checkout" }).length, 1);
  assert.equal(neutralityLeaks({ then: "x", verification: ["scan src/ only"] }).length, 1, "verification is linted");
});
