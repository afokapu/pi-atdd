// URN: test:pi-atdd:source-catalog:E001-UNIT-006
// Acceptance: acc:pi-atdd:E001-UNIT-006
// Phase: GREEN
// Layer: integration
// Triple-check original Linear criteria evidence; never fabricate B/C/owner PASS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "research/atd-26/ATD-26-ALL-20-ORIGINAL-ACCEPTANCES-TRIPLE-CHECK.md");
const text = readFileSync(path, "utf8");
const rows = text.split("\n").filter(line => line.startsWith("| ATD-"))
  .map(line => {
    assert.ok(line.endsWith(" |"));
    return line.slice(2, -2).split(" | ");
  });
const originals = {
  "ATD-26": 8, "ATD-27": 4, "ATD-28": 4, "ATD-29": 4,
} as const;

test("twenty original acceptances are each explicitly triple-checked", () => {
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map(row => row[0])).size, 20);
  for (const [issue, count] of Object.entries(originals)) {
    const actual = rows.filter(row => row[0]?.startsWith(issue + "/Acceptance-"));
    assert.equal(actual.length, count);
    for (let i = 1; i <= count; i++) {
      assert.equal(actual.some(r => r[0] === issue + "/Acceptance-" + String(i).padStart(2, "0")), true);
    }
  }
  for (const row of rows) {
    assert.equal(row.length, 7, "missing source/systemic/systematic/adversarial/standing column");
    // Presence of each independent review lens is required; text length is not
    // a correctness criterion, because some original requirements are concise.
    assert.ok(row.slice(1, 5).every(column => column && column.trim().length > 0));
    assert.ok(row[6] && row[6].length > 24, "each acceptance needs a specific unblocker");
  }
});

test("unverified independence and owner gates cannot be self-marked PASS", () => {
  for (const row of rows) assert.ok(["PARTIAL", "UNVERIFIED"].includes(row[5]!));
  assert.equal(rows.filter(row => row[5] === "UNVERIFIED").length, 3);
  assert.match(text, /same assistant conducted all three lenses/i);
  assert.match(text, /no actual D1\(c\) accepted record/);
  assert.match(text, /owner/);
});

test("each original issue retains a systemic/systematic/adversarial source routing", () => {
  for (const link of [
    "ATD-26-SOURCE-GRAPH-SYSTEMIC.tsv",
    "ATD-28-O1-O8-01.jsonl",
    "ATD-26-ADVERSARIAL-CANDIDATES-01.jsonl",
    "ATD-27-ALL-376-SOURCE-DISPOSITIONS.tsv",
  ]) assert.ok(text.includes(link), "missing evidence entry point " + link);
});
