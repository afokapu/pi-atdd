// Add audited lossless splits to the sidecar: one file per source with all parts, plus a graph overlay.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { FLEET, VENDOR, sha256 } from "./lib.mjs";
const [repo] = process.argv.slice(2);
const OUT = join(repo, "conventions-sidecar"), D = join(FLEET, "runs-split");
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]);
const index = Object.fromEntries(files(VENDOR).filter(f => f.endsWith(".convention.yaml")).map(f => [f.split("/").pop().replace(".convention.yaml", ""), f]));
const manifest = J(join(OUT, "manifest.json"));
const overlay = { schema: "pi-atdd/convention-sidecar-graph-overlay/v1", note: "Proposed graph changes from lossless splits. Canonical relationships.yaml is unchanged; consumers resolve aliasOf and apply edges/edgeRemap on top of it.", aliases: {}, edges: [], edgeRemap: [] };
manifest.splits = {};
mkdirSync(join(OUT, "splits"), { recursive: true }); mkdirSync(join(OUT, "evidence", "splits"), { recursive: true });
for (const id of readdirSync(D).sort()) {
  const r = J(join(D, id, "result.json")); if (r.status !== "PASS") continue;
  const s = J(join(D, id, "split.json")), srcSha = sha256(readFileSync(index[id]));
  if (J(join(D, id, "segments.json")).sourceSha256 !== srcSha) throw new Error("drift " + id);
  const file = join("splits", id + ".json");
  writeFileSync(join(OUT, file), JSON.stringify({ schema: "pi-atdd/convention-sidecar-split/v1", source: { path: relative(repo, index[id]), sha256: srcSha }, ...s }, null, 2) + "\n");
  writeFileSync(join(OUT, "evidence", file), JSON.stringify({ source_rule_id: id, audit: J(join(D, id, "split-audit.json")), review: existsSync(join(D, id, "split-review.json")) ? J(join(D, id, "split-review.json")) : null, rounds: r.rounds.map(x => ({ round: x.round, verdict: x.verdict, parts: x.parts })) }, null, 2) + "\n");
  Object.assign(overlay.aliases, s.aliasOf ?? {}); overlay.edges.push(...(s.edges ?? []).map(e => ({ ...e, from: id }))); overlay.edgeRemap.push(...(s.edgeRemap ?? []).map(e => ({ ...e, from: id })));
  const rv = existsSync(join(D, id, "split-review.json")) ? J(join(D, id, "split-review.json")) : null;
  manifest.splits[id] = { file, evidence: "evidence/" + file, sourcePath: relative(repo, index[id]), sourceSha256: srcSha, sidecarSha256: sha256(readFileSync(join(OUT, file))),
    parts: s.parts.map(p => p.rule_id), auditVerdict: "PASS", rounds: r.rounds.length, thirdPartyReview: rv && { verdict: rv.reviewerVerdict, agreesWithAuditor: rv.agreeWithAuditor, usability: (rv.parts ?? []).map(p => p.usability) } };
  if (manifest.excluded[id]) manifest.excluded[id].resolvedBySplit = file;
}
writeFileSync(join(OUT, "graph-overlay.json"), JSON.stringify(overlay, null, 2) + "\n");
manifest.counts.splitSources = Object.keys(manifest.splits).length; manifest.counts.splitParts = Object.values(manifest.splits).reduce((n, x) => n + x.parts.length, 0);
manifest.counts.coveredSources = manifest.counts.frozen + manifest.counts.splitSources;
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest.counts), "overlay edges", overlay.edges.length, "remaps", overlay.edgeRemap.length);
