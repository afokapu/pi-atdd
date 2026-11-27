// URN: test:pi-atdd:activation-selectors:E004-UNIT-402
// Acceptance: acc:pi-atdd:E004-UNIT-402
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalKey, expandKeys, isVocabularyKey, loadVocabulary, profileSchema } from "../src/profile-vocabulary.ts";
import { loadProfile, profileProblems } from "../src/profile.ts";

const ROOT = new URL("..", import.meta.url).pathname;
// A legacy railway term as its own word or as a part of a snake_case identifier (wagon_dir, wmbt_id).
const LEGACY = /(?<![A-Za-z])(wagons?|trains?|interlockings?|cargo|wmbts?)(?![A-Za-z])/i;
const raw = readFileSync(join(ROOT, "profiles/vocabulary.yaml"), "utf8");
const aliasAt = raw.search(/^aliases:/m);

test("version 4: the lock matches, and no legacy term remains outside the alias block", () => {
  const lock = JSON.parse(readFileSync(join(ROOT, "profiles/vocabulary.lock.json"), "utf8"));
  assert.equal(loadVocabulary().version, 4);
  assert.equal(lock.version, 4);
  assert.equal(createHash("sha256").update(readFileSync(join(ROOT, "profiles/vocabulary.yaml"))).digest("hex"), lock.sha256);
  assert.ok(aliasAt > 0, "the legacy key names live in one aliases block");
  const body = raw.slice(0, aliasAt);
  const hits = body.split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => LEGACY.test(l));
  assert.deepEqual(hits.map(([n, l]) => n + ": " + l.trim().slice(0, 80)), []);
  assert.doesNotMatch(JSON.stringify(profileSchema()), LEGACY, "the generated schema carries no legacy term");
});

test("every legacy key is an alias of a current key and resolves to it", () => {
  const v = loadVocabulary();
  const aliases = v.aliases ?? {};
  assert.ok(Object.keys(aliases).length >= 3);
  const current = new Set(expandKeys(v).map(k => k.key));
  for (const [legacy, now] of Object.entries(aliases)) {
    assert.ok(!current.has(legacy), legacy + " is an alias, not a current key");
    assert.ok(current.has(now), legacy + " must point at a current key, got " + now);
    assert.ok(LEGACY.test(legacy), legacy + " is listed because it holds a legacy term");
    assert.equal(canonicalKey(legacy, v), now);
    assert.ok(isVocabularyKey(legacy, v), "the legacy key still resolves");
  }
  assert.equal(canonicalKey("layout.wagon_dir", v), "layout.capability_dir");
  assert.equal(canonicalKey("urn.binding.wmbt", v), "urn.binding.desired_outcome");
  assert.equal(canonicalKey("roots.source", v), "roots.source");
});

test("a version 3 profile with legacy keys still loads; a version 4 profile may not use them", () => {
  const hex = loadProfile(join(ROOT, "tests/fixtures/swap/ts-hexagon.profile.json"));
  assert.equal(hex.vocabularyVersion, 3);
  assert.deepEqual(profileProblems({ ...hex, values: { ...hex.values, "layout.wagon_dir": "<source_root>/<capability>" } }), []);
  const bun = loadProfile(join(ROOT, "profiles/stacks/default.json"));
  assert.equal(bun.vocabularyVersion, 4);
  assert.ok(profileProblems({ ...bun, values: { ...bun.values, "layout.wagon_dir": "x" } }).length > 0,
    "legacy keys are accepted only by profiles that declare an older vocabulary version");
  assert.deepEqual(profileProblems({ ...bun, values: { ...bun.values, "layout.capability_dir": "<source_root>/<capability>" } }), []);
});
