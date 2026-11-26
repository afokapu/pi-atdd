// Acceptance: acc:pi-atdd:plt-84-sn-004
// Rendering for a stack without a curated realization: core + profile idioms + Bun reference example, labelled agent-derived.
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { loadNeutralRecords, renderForStack } from "../src/neutral-render.ts";
import { loadProfile } from "../src/profile.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const hex = loadProfile(join(ROOT, "tests/fixtures/swap/ts-hexagon.profile.json"));
const bun = loadProfile(join(ROOT, "profiles/stacks/default.json"));
const rec = (id: string) => loadNeutralRecords().find(r => r.rule_id === id)!;

test("SN-004: another stack gets core + profile + labelled Bun reference, flagged agent-derived and unverified", () => {
  const out = renderForStack(rec("coder.runtime.single-lockfile"), "ts-hexagon", { profile: hex });
  assert.equal(out.realization, "agent-derived (unverified)");
  assert.match(out.text, /^Realization: agent-derived \(unverified\)/);
  assert.match(out.text, /Core obligation \(authoritative\)/);
  assert.match(out.text, /Reference implementation in ATDD-Bun — translate to this stack; the core obligation is authoritative, not the Bun specifics/);
  assert.match(out.text, /tooling\.package_manager: pnpm/, "the active stack's own profile value is delivered");
  assert.match(out.text, /Keys without a value in the ts-hexagon profile/);
  assert.ok(out.text.indexOf("Core obligation") < out.text.indexOf("Reference implementation"), "core precedes the example");
});

test("arm (b) of the second-stack experiment: core + profile only, no Bun reference", () => {
  const out = renderForStack(rec("coder.runtime.single-lockfile"), "ts-hexagon", { profile: hex, bunReference: false });
  assert.doesNotMatch(out.text, /Reference implementation in ATDD-Bun/);
  assert.equal(out.realization, "agent-derived (unverified)");
});

test("Bun-only items are context on other stacks, never obligations", () => {
  const r = rec("coder.runtime.single-lockfile");
  assert.ok((r.bunOnly as any[]).length > 0);
  assert.match(renderForStack(r, "ts-hexagon", { profile: hex }).text, /Bun-only context \(not an obligation on this stack\)/);
});

test("stack=bun is unchanged by the new renderer: still the frozen realization, curated", () => {
  const out = renderForStack(rec("coder.dto.mapper"), "bun", { profile: bun });
  assert.equal(out.realization, "curated");
  assert.doesNotMatch(out.text, /agent-derived/);
});

test("every one of the 390 conventions renders for another stack with its core obligation", () => {
  const all = loadNeutralRecords();
  assert.equal(all.length, 390);
  for (const r of all) {
    const out = renderForStack(r, "ts-hexagon", { profile: hex });
    assert.match(out.text, /Core obligation \(authoritative\)/, r.rule_id);
    assert.ok(out.text.includes(String((r.core as any).then).slice(0, 40)), r.rule_id + ": the core obligation is present");
  }
});
