// PLT-123: the optional coach-state section in shared.handoff.record-contents.
// Acceptance: the old obligations stay; the new text names the section and its fields; the PLT-122 coach record satisfies it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { buildHandoff, extractIssueIds, extractPullRequests } from "../src/context-handoff.ts";

const FILE = new URL("../catalog/pi-atdd/conventions/shared/handoff/shared.handoff.record-contents.convention.yaml", import.meta.url);
const rule = parse(readFileSync(FILE, "utf8")) as {
  rule_id: string; statement: string; content: { normative_text: string; fix_hint: string; exceptions: string[] };
};
const flat = (s: string) => s.replace(/\s+/g, " ");
const all = flat([rule.statement, rule.content.normative_text, rule.content.fix_hint, ...rule.content.exceptions].join(" "));

test("PLT-123: every existing obligation of the rule is still present", () => {
  assert.equal(rule.rule_id, "shared.handoff.record-contents");
  const statement = flat(rule.statement);
  for (const kept of [
    "MUST carry only bounded facts",
    "explicit `UNKNOWN` markers",
    "best-effort basis",
    "is not general secret safety",
    "MUST NOT copy the predecessor's own output",
    "MUST NOT present any claimed completion as evidence",
    "stated by reference to the original brief",
  ]) assert.ok(statement.includes(kept), "statement lost: " + kept);
  const normative = flat(rule.content.normative_text);
  for (const kept of [
    "redacted on a best-effort basis",
    "Labels or shapes not on the list pass unchanged",
    "recorded as `not recorded`",
    "open items as `UNKNOWN`",
    "a handoff approves nothing",
    "re-verify the repository before relying on any claimed completion",
  ]) assert.ok(normative.includes(kept), "normative_text lost: " + kept);
  assert.match(rule.content.fix_hint, /leave out the predecessor's assistant output/);
  assert.match(rule.content.fix_hint, /bound the record's length/);
});

test("PLT-123: the rule makes a coach-state section optional and names its fields", () => {
  assert.match(all, /Coach state/);
  assert.match(all, /optional/i);
  for (const field of ["role", "issues", "pull requests", "attention items"]) {
    assert.ok(all.toLowerCase().includes(field), "field missing from the rule: " + field);
  }
  assert.match(all, /authoritative source/);
  assert.match(all, /UNKNOWN/);
  // the section is held to the same limits, and adds no way to copy output
  assert.match(flat(rule.content.normative_text), /The section is redacted and bounded like the task text/);
  assert.match(flat(rule.content.normative_text), /never contains the predecessor's assistant output/);
});

test("PLT-123: the PLT-122 coach record satisfies the new text", () => {
  const task = "Coordinate PLT-122 and PLT-117; review https://github.com/o/r/pull/27 and PR #28.";
  const text = buildHandoff({
    task, cwd: "/w", percent: 90, contextWindow: 1000,
    coach: { role: "coach", identity: "main@pi-atdd", profile: "forge", issues: extractIssueIds(task),
      prs: extractPullRequests(task), attention: ["att-1 decision PLT-122 open"] },
  });
  assert.match(text, /^Coach state:$/m);
  assert.match(text, /^Role: coach/m);
  assert.match(text, /^Issues: PLT-122, PLT-117$/m);
  assert.match(text, /^PRs: .*pull\/27/m);
  assert.match(text, /^Attention items: att-1/m);
  assert.match(text, /^Workers: UNKNOWN$/m, "no authoritative source: UNKNOWN");
  // the old obligations hold in the same record
  assert.match(text, /Done \/ last state: not recorded/);
  assert.match(text, /Open items: UNKNOWN/);
});
