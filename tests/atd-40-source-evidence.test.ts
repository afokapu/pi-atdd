// URN: test:pi-atdd:source-catalog:E001-UNIT-002
// Acceptance: acc:pi-atdd:E001-UNIT-002
// Acceptance: acc:pi-atdd:E001-UNIT-006
// Phase: GREEN
// Layer: integration
// Source material is evidence, not an automatic Object-of-Control admission.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPassASourceEvidence } from "../tools/atd-40-source-evidence.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("all 376 convention bodies are available without fabricated OoC standing", () => {
  const entries = readPassASourceEvidence();
  assert.equal(entries.length, 376);
  assert.equal(new Set(entries.map(x => x.ruleId)).size, 376);
  assert.equal(entries.filter(x => x.disposition === "CANDIDATE").length, 339);
  assert.equal(entries.filter(x => x.disposition === "NO_CANDIDATE").length, 31);
  assert.equal(entries.filter(x => x.disposition === "UNRESOLVED").length, 6);
  assert.equal(entries.reduce((n, x) => n + x.authoredGraphWitnesses.length, 0), 1000);

  // Every source's actual authored statement and line span is available
  // even when its state boundary has not yet been independently assessed.
  for (const entry of entries) {
    assert.ok(entry.source.statement.trim());
    assert.ok(entry.sourceSpans.statement.startLine > 0);
    assert.ok(entry.sourceSpans.statement.endLine >= entry.sourceSpans.statement.startLine);
    assert.equal(entry.admission, "NOT_ASSESSED_BY_THIS_EXPORT");
    if (entry.disposition === "UNRESOLVED") assert.deepEqual(entry.candidateLabels, []);
  }
});

test("Bun/Flow/local examples retain authored terms, exceptions and use", () => {
  const records = readPassASourceEvidence();
  const byId = new Map(records.map(x => [x.ruleId, x]));
  const bun = byId.get("coder.security.missing-auth")!;
  assert.equal(bun.family, "Bun");
  assert.match(bun.source.statement, /POST, PUT, PATCH or DELETE/);
  assert.ok(Array.isArray(bun.source.terms));
  assert.ok(typeof bun.source.content === "object" && bun.source.content !== null);
  const content = bun.source.content as Record<string, unknown>;
  assert.ok(Array.isArray(content.exceptions), "GET/HEAD and test exceptions must remain inspectable");
  // Missing authorship must not be confused with YAML's explicitly written null.
  assert.deepEqual(bun.source.validation, { "$source": "ABSENT" });

  const flow = byId.get("coach.collaboration.accountable-delegation")!;
  assert.equal(flow.family, "Flow");
  assert.match(flow.source.statement, /accountable delegation/);
  assert.equal(flow.disposition, "CANDIDATE");
  assert.deepEqual(flow.candidateLabels, ["PA-F01", "PA-F02"]);

  const local = byId.get("shared.convention.propose")!;
  assert.equal(local.family, "Local");
  assert.match(local.source.statement, /propose|proposal/i);
  assert.equal(local.disposition, "NO_CANDIDATE");
});

test("source evidence may be exported read-only and never asserts admission", () => {
  const temp = mkdtempSync(join(tmpdir(), "atd-40-source-evidence-"));
  try {
    const output = join(temp, "evidence.jsonl");
    const job = spawnSync(process.execPath, [
      "--experimental-strip-types", join(root, "tools/atd-40-source-evidence.ts"),
      "--output", output,
    ], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
    assert.equal(job.error, undefined, String(job.error));
    assert.equal(job.status, 0, job.stderr);
    const lines = readFileSync(output, "utf8").trimEnd().split("\n");
    assert.equal(lines.length, 376);
    assert.ok(lines.every(line => JSON.parse(line).admission === "NOT_ASSESSED_BY_THIS_EXPORT"));
    assert.match(job.stdout, /376 sources/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("export must not overwrite repository files or its evidence ledger", () => {
  const forbidden = join(root, "research/atd-40/unsafe-output.jsonl");
  assert.ok(!existsSync(forbidden));
  const job = spawnSync(process.execPath, [
    "--experimental-strip-types", join(root, "tools/atd-40-source-evidence.ts"),
    "--output", forbidden,
  ], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
  assert.notEqual(job.status, 0);
  assert.match(job.stderr, /outside this repository/);
  assert.ok(!existsSync(forbidden));
});
