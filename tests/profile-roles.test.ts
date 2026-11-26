// Acceptance: acc:pi-atdd:PLT-84-SN-003
// A structure profile maps roles to paths; role selectors expand through it; the frozen vocabulary is pinned.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile, roleOfPath, expandRoleSelectors, profileProblems } from "../src/profile.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const bun = loadProfile(join(ROOT, "profiles/stacks/default.json"));
const hex = loadProfile(join(ROOT, "tests/fixtures/swap/ts-hexagon.profile.json"));

test("vocabulary v3 is frozen: the file matches its pinned digest", () => {
  const lock = JSON.parse(readFileSync(join(ROOT, "profiles/vocabulary.lock.json"), "utf8"));
  assert.equal(lock.version, 3);
  assert.equal(createHash("sha256").update(readFileSync(join(ROOT, "profiles/vocabulary.yaml"))).digest("hex"), lock.sha256);
});

test("profiles use only vocabulary keys and well-typed values", () => {
  assert.deepEqual(profileProblems(bun), []);
  assert.deepEqual(profileProblems(hex), []);
  assert.ok(profileProblems({ ...bun, values: { ...bun.values, "roles.repository.path": ["x/**"] } }).length > 0);
  assert.ok(profileProblems({ ...bun, values: { ...bun.values, "suffix.source": ".ts" } }).length > 0, "a list key needs an array");
  assert.ok(profileProblems({ ...bun, vocabularyVersion: 2 }).length > 0, "profile must target the frozen vocabulary version");
});

test("roleOfPath gives the role, not the stack's local name", () => {
  assert.equal(roleOfPath(bun, "src/pricing/domain/price.ts"), "domain");
  assert.equal(roleOfPath(bun, "src/pricing/assembly/wire.ts"), "composition_root");
  assert.equal(roleOfPath(hex, "app/core/price.ts"), "domain");
  assert.equal(roleOfPath(hex, "app/domain/price.ts"), undefined, "a Bun layer name means nothing in the hexagon profile");
  assert.equal(roleOfPath(bun, "src/util/strings.ts"), undefined);
});

test("role selectors expand to source-suffixed path globs per profile; path selectors are untouched", () => {
  const sel = [{ id: "a", rules: ["r"], roles: ["domain"], terms: ["x"] }, { id: "b", rules: ["r"], paths: ["docs/**"] }];
  const [a, b] = expandRoleSelectors(sel as any, hex);
  assert.deepEqual(a.paths, ["**/core/**.ts"]);
  assert.equal((a as any).roles, undefined);
  assert.deepEqual(b, sel[1]);
  assert.deepEqual(expandRoleSelectors(sel as any, bun)[0].paths, ["**/domain/**.ts", "**/domain/**.tsx"]);
  assert.throws(() => expandRoleSelectors([{ id: "c", rules: ["r"], roles: ["nope"] }] as any, bun), /unknown role/);
  assert.throws(() => expandRoleSelectors([{ id: "d", rules: ["r"], roles: ["presentation"] }] as any, { ...hex, values: { ...hex.values, "roles.presentation.path": undefined as any } }), /no path/);
});
