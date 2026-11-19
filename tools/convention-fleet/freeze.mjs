// Freeze audited-PASS rewrites into the pi-atdd repository as a sidecar pinned to source SHA-256.
// Usage: node freeze.mjs <repoRoot> <sharedDir>
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FLEET, VENDOR, sha256 } from "./lib.mjs";

const [repo, sharedDir] = process.argv.slice(2);
const OUT = join(repo, "conventions-sidecar");
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]);
const index = Object.fromEntries(files(VENDOR).filter(f => f.endsWith(".convention.yaml")).map(f => [f.split("/").pop().replace(".convention.yaml", ""), f]));
const all = readFileSync(join(FLEET, "all.txt"), "utf8").split("\n").filter(Boolean);
const promptSha = Object.fromEntries(["AUTHOR.md", "AUDITOR.md", "REVIEWER.md", "SPLITTER.md", "SPLIT_AUDITOR.md"].map(f => [f, sha256(readFileSync(join(FLEET, f)))]));
const entries = {}, excluded = {};
for (const id of all) {
  const d = join(FLEET, "runs", id), r = J(join(d, "result.json"));
  const srcPath = index[id], srcSha = sha256(readFileSync(srcPath));
  if (J(join(d, "segments.json")).sourceSha256 !== srcSha) throw new Error("source drift for " + id);
  if (r.status !== "PASS") { excluded[id] = { status: r.status, reason: "did not pass the single-convention lossless audit; handled by the approved split (PLT-81)" }; continue; }
  const fam = srcPath.includes("/planner-nodes/") ? "planner-nodes" : relative(join(VENDOR), srcPath).split("/")[0];
  const rel = join(fam, id + ".json");
  const author = J(join(d, "author.json")), audit = J(join(d, "audit.json"));
  const review = existsSync(join(d, "review.json")) ? J(join(d, "review.json")) : null;
  mkdirSync(join(OUT, "conventions", fam), { recursive: true }); mkdirSync(join(OUT, "evidence", fam), { recursive: true });
  writeFileSync(join(OUT, "conventions", rel), JSON.stringify({ schema: "pi-atdd/convention-sidecar/v1", source: { path: relative(repo, srcPath).replaceAll("\\", "/"), sha256: srcSha }, ...author }, null, 2) + "\n");
  writeFileSync(join(OUT, "evidence", rel), JSON.stringify({ rule_id: id, audit, review, rounds: r.rounds.map(x => ({ round: x.round, verdict: x.verdict, auditRetry: x.auditRetry?.verdict })) }, null, 2) + "\n");
  entries[id] = { file: "conventions/" + rel, evidence: "evidence/" + rel, sourcePath: relative(repo, srcPath), sourceSha256: srcSha,
    sidecarSha256: sha256(readFileSync(join(OUT, "conventions", rel))), auditVerdict: audit.verdict, rounds: r.rounds.length,
    thirdPartyReview: review ? { verdict: review.reviewerVerdict, agreesWithAuditor: review.agreeWithAuditor, usability: review.usability?.score } : null,
    needsNewObserver: [...new Set(r.stats.needsNewObserver ?? [])] };
}
mkdirSync(join(OUT, "shared"), { recursive: true });
const shared = {};
for (const n of readdirSync(sharedDir)) {
  const c = J(join(sharedDir, n, "canonical.json")), a = existsSync(join(sharedDir, n, "shared-audit.json")) ? J(join(sharedDir, n, "shared-audit.json")) : null;
  const v = J(join(sharedDir, n, "variants.json"));
  writeFileSync(join(OUT, "shared", c.id + ".json"), JSON.stringify({ schema: "pi-atdd/convention-sidecar-shared/v1", ...c, variants: v.variants.length, audit: a }, null, 2) + "\n");
  shared[c.id] = { file: "shared/" + c.id + ".json", variants: v.variants.length, audit: a?.verdict, notGenericOpen: (c.notGeneric ?? []).length };
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  schema: "pi-atdd/convention-sidecar-manifest/v1", issue: "PLT-81", frozenAt: new Date().toISOString(),
  canonicalCatalogLockSha256: sha256(readFileSync(join(VENDOR, "catalog.lock.json"))),
  pipeline: { author: "anthropic/claude-opus-5-5 (thinking medium)", auditor: "openai-codex/gpt-6.1-sol (thinking medium)", reviewer: "kimi-coding/k3.1-pro (thinking medium)",
    note: "AI pipeline set up by the operator on the owner's delegation; no human review yet", promptSha256: promptSha },
  counts: { frozen: Object.keys(entries).length, excluded: Object.keys(excluded).length, shared: Object.keys(shared).length },
  entries, excluded, shared,
}, null, 2) + "\n");
console.log(JSON.stringify({ frozen: Object.keys(entries).length, excluded: Object.keys(excluded).length, shared: Object.keys(shared).length }));
