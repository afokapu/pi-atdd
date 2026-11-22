/**
 * ATD-40 Pass A source lock / inventory check. Read-only: no OoC admission or T9 logic.
 *
 * Usage: node --experimental-strip-types tools/atd-40-verify-ledger.ts
 *
 * This checks corpus membership, YAML source IDs, immutable Git blob IDs, and
 * bundled digestSource locks. It does NOT judge semantic candidates or O1–O8.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { digestSource, type SourceKind } from "../src/catalog.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fileAt = (name: string): string => join(root, name);
const ledgerPath = "docs/ATD-40-PASS-A-LEDGER.tsv";
const ledger = readFileSync(fileAt(ledgerPath), "utf8");
const lines = ledger.trimEnd().split("\n").filter(line => line && !line.startsWith("#"));
const columns = [
  "rule_id_filename_derived", "source_family", "path", "git_blob_sha",
  "pass_a_disposition", "proposed_candidate_refs", "inspected_rule_spans",
  "graph_witnesses_out_and_in", "reason_or_open_question", "source_id_verification",
];
assert.deepEqual(lines.shift()?.split("\t"), columns, "unexpected ledger schema");
assert.equal(lines.length, 376, "exact source inventory denominator changed");

const roots = [
  { path: "vendor/atdd-bun/conventions", family: "Bun" },
  { path: "vendor/atdd-flow/conventions", family: "Flow" },
  { path: "catalog/pi-atdd/conventions", family: "Local" },
] as const;

function walk(dir: string): string[] {
  return readdirSync(fileAt(dir), { withFileTypes: true })
    .flatMap(entry => {
      const name = (dir + "/" + entry.name).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) throw new Error("symlink in convention corpus: " + name);
      return entry.isDirectory()
        ? walk(name)
        : entry.isFile() && name.endsWith(".convention.yaml") ? [name] : [];
    });
}
const actual = new Set(roots.flatMap(item => walk(item.path)));
assert.equal(actual.size, 376, "actual non-fixture file count changed");
const included = new Set<string>();
const ids = new Set<string>();
const dispositions = new Map<string, number>();
const families = new Map<string, number>();

for (const [index, rowText] of lines.entries()) {
  const values = rowText.split("\t");
  assert.equal(values.length, columns.length, "malformed ledger TSV row " + (index + 1));
  const [id, family, path, blobSha, status, candidates, spans, witnesses, reason] = values;
  assert.ok(id && family && path && blobSha && status, "missing required row data");
  assert.ok(reason, "missing resolution rationale at row " + (index + 1));
  assert.ok(actual.has(path!), "ledger path absent from canonical sources: " + path);
  assert.ok(!included.has(path!), "duplicate file: " + path);
  included.add(path!);
  const expectedFamily = roots.find(item => path!.startsWith(item.path + "/"))?.family;
  assert.equal(family, expectedFamily, "incorrect source family for " + path);
  assert.ok(!ids.has(id!), "duplicate convention ID: " + id);
  ids.add(id!);

  const bytes = readFileSync(fileAt(path!));
  const header = Buffer.from("blob " + bytes.length + "\0", "utf8");
  const actualSha = createHash("sha1").update(header).update(bytes).digest("hex");
  assert.equal(actualSha, blobSha, "Git blob SHA mismatch at " + path);

  const doc = parseDocument(bytes.toString("utf8"), { strict: true, uniqueKeys: true });
  assert.equal(doc.errors.length, 0, "invalid YAML " + path + " " + doc.errors.join("; "));
  const parsed: unknown = doc.toJS({ maxAliasCount: 100 });
  assert.ok(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    "expected YAML object " + path);
  const ruleId = (parsed as Record<string, unknown>).rule_id;
  assert.equal(ruleId, id, "filename-derived rule ID is not the authored YAML rule_id: " + path);
  assert.ok(typeof (parsed as Record<string, unknown>).statement === "string",
    "missing authored statement: " + path);

  assert.ok(["CANDIDATE", "NO_CANDIDATE", "UNRESOLVED"].includes(status!),
    "unknown Pass A disposition " + status);
  if (status === "CANDIDATE") assert.ok(candidates, "missing provisional candidate ref " + id);
  if (status === "UNRESOLVED") assert.equal(candidates, "", "unverified candidate " + id);
  if (status !== "UNRESOLVED") assert.ok(spans, "missing inspected source span " + id);
  if (witnesses) {
    for (const witness of witnesses.split(";")) {
      const loc = witness.match(/@(vendor\/atdd-bun\/relationships\.yaml|catalog\/pi-atdd\/relationships\.yaml)#L(\d+)$/);
      assert.ok(loc, "malformed graph witness " + witness);
      const graph = readFileSync(fileAt(loc![1]!), "utf8").split("\n");
      const sourceLine = graph[Number(loc![2]!) - 1];
      assert.ok(sourceLine?.includes("source_ref:"), "bad graph edge anchor " + witness);
    }
  }
  dispositions.set(status!, (dispositions.get(status!) ?? 0) + 1);
  families.set(family!, (families.get(family!) ?? 0) + 1);
}
assert.deepEqual([...included].sort(), [...actual].sort(), "missing source paths");
for (const [key, count] of [["Bun", 356], ["Flow", 2], ["Local", 18]] as const)
  assert.equal(families.get(key), count, "source family denominator changed: " + key);
for (const [key, count] of [["CANDIDATE", 13], ["NO_CANDIDATE", 1], ["UNRESOLVED", 362]] as const)
  assert.equal(dispositions.get(key), count, "disposition count changed: " + key);

const lock = JSON.parse(readFileSync(fileAt("vendor/catalog.lock.json"), "utf8")) as {
  sources: Array<{ id: string; kind: SourceKind; path: string; sha256: string }>;
};
assert.equal(lock.sources.length, 3, "source-lock sources changed");
for (const item of lock.sources) {
  assert.ok(existsSync(fileAt(item.path)), "missing source lock root: " + item.path);
  const digest = digestSource(fileAt(item.path), item.kind);
  assert.equal(digest, item.sha256, "source-lock digest mismatch: " + item.id);
}

console.log(
  "ATD-40 source check verified: 376 YAML rule IDs + Git blobs; Bun 356 / Flow 2 / Local 18; " +
  "CANDIDATE source files 13 / NO_CANDIDATE 1 / UNRESOLVED 362; 3 source SHA256 locks."
);
console.log("Semantic Pass A, independent O1–O8, T9 parity and authorization: NOT VERIFIED.");
