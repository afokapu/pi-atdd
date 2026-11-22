/**
 * ATD-29 source-evidence export: preserve what the 376 authored YAML rules
 * actually say. No heuristics turn a rule, file or policy into an admitted OoC.
 * All candidate/negative/unresolved verdicts come from the Pass A ledger.
 *
 * Usage:
 * node --experimental-strip-types tools/atd-40-source-evidence.ts --output /tmp/atd-40-evidence.jsonl
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readYaml } from "../src/catalog.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = join(root, "research/atd-40/ATD-40-PASS-A-LEDGER.tsv");
const SOURCE_PREFIXES = [
  "vendor/atdd-bun/conventions/",
  "vendor/atdd-flow/conventions/",
  "catalog/pi-atdd/conventions/",
];

type SourceSpan = { startLine: number; endLine: number };
type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
export type PassASourceEvidence = {
  ruleId: string;
  family: string;
  sourcePath: string;
  gitBlobSha: string;
  disposition: "CANDIDATE" | "NO_CANDIDATE" | "UNRESOLVED";
  candidateLabels: string[];
  authoredGraphWitnesses: string[];
  sourceSpans: Record<string, SourceSpan>;
  source: {
    schemaVersion: Json;
    kind: Json;
    status: Json;
    statement: string;
    rationale: Json;
    terms: Json;
    exceptions: Json;
    content: Json;
    validation: Json;
    implementation: Json;
    sourceProvenance: Json;
    metadata: Json;
    parity: Json;
  };
  admission: "NOT_ASSESSED_BY_THIS_EXPORT";
};

function authoredSpans(text: string): Record<string, SourceSpan> {
  const lines = text.split("\n");
  const starts: Array<{ key: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^([a-z_][a-z0-9_-]*):(?:\s|$)/.exec(lines[i]!);
    if (match) starts.push({ key: match[1]!, line: i + 1 });
  }
  const spans: Record<string, SourceSpan> = {};
  starts.forEach((field, i) => {
    spans[field.key] = {
      startLine: field.line,
      endLine: (starts[i + 1]?.line ?? lines.length + 1) - 1,
    };
  });
  return spans;
}

function json(x: unknown): Json {
  return x === undefined ? null : x as Json;
}

/** Reproduces authored material, not independent semantic interpretation. */
export function readPassASourceEvidence(): PassASourceEvidence[] {
  const lines = readFileSync(ledgerPath, "utf8")
    .trimEnd().split("\n").filter(line => line && !line.startsWith("#"));
  const heading = lines.shift()!.split("\t");
  const required = [
    "rule_id_filename_derived", "source_family", "path", "git_blob_sha",
    "pass_a_disposition", "proposed_candidate_refs",
    "graph_witnesses_out_and_in", "source_id_verification",
  ];
  for (const key of required) assert.ok(heading.includes(key), "missing ledger column: " + key);
  const column = (row: string[], key: string) => row[heading.indexOf(key)]!;
  assert.equal(lines.length, 376, "unexpected source population");

  const seen = new Set<string>();
  return lines.map(line => {
    const row = line.split("\t");
    const id = column(row, "rule_id_filename_derived");
    const path = column(row, "path");
    const status = column(row, "pass_a_disposition");
    assert.ok(SOURCE_PREFIXES.some(prefix => path.startsWith(prefix)),
      "unexpected source path: " + path);
    assert.ok(!seen.has(id), "duplicate source convention identity: " + id);
    seen.add(id);
    assert.equal(column(row, "source_id_verification"), "YAML_HEADER_CHECKED_BY_VERIFIER");
    assert.ok(["CANDIDATE", "NO_CANDIDATE", "UNRESOLVED"].includes(status),
      "unknown Pass A disposition: " + status);
    const text = readFileSync(join(root, path), "utf8");
    const authored = readYaml(join(root, path));
    assert.equal(authored.rule_id, id, "source rule identity drift: " + path);
    assert.ok(typeof authored.statement === "string" && authored.statement.trim(),
      "source has no normative statement: " + path);
    const spans = authoredSpans(text);
    assert.ok(spans.statement, "normative statement lacks a source span: " + path);
    return {
      ruleId: id,
      family: column(row, "source_family"),
      sourcePath: path,
      gitBlobSha: column(row, "git_blob_sha"),
      disposition: status as PassASourceEvidence["disposition"],
      candidateLabels: column(row, "proposed_candidate_refs").split("+").filter(Boolean),
      authoredGraphWitnesses: column(row, "graph_witnesses_out_and_in").split(";").filter(Boolean),
      sourceSpans: spans,
      source: {
        schemaVersion: json(authored.schema_version),
        kind: json(authored.kind),
        status: json(authored.status),
        statement: authored.statement,
        rationale: json(authored.rationale),
        terms: json(authored.terms),
        exceptions: json(authored.exceptions),
        content: json(authored.content),
        validation: json(authored.validation),
        implementation: json(authored.implementation),
        sourceProvenance: json(authored.source),
        metadata: json(authored.metadata),
        parity: json(authored.parity),
      },
      admission: "NOT_ASSESSED_BY_THIS_EXPORT" as const,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 2 && args[0] === "--output" && !!args[1],
    "usage: atd-40-source-evidence.ts --output <jsonl-file>");
  const evidence = readPassASourceEvidence();
  writeFileSync(resolve(args[1]!), evidence.map(entry => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  const counts = { candidate: evidence.filter(e => e.disposition === "CANDIDATE").length,
    negative: evidence.filter(e => e.disposition === "NO_CANDIDATE").length,
    unresolved: evidence.filter(e => e.disposition === "UNRESOLVED").length };
  console.log("Authored ATD-29 evidence exported: " + evidence.length +
    " sources, " + JSON.stringify(counts) + "; source fields only, no OoC admission.");
}
