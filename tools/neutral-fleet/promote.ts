// PLT-84: promote audited fleet outputs into conventions-neutral/<profile>/<area>/<rule_id>.json.
// Usage: node --experimental-strip-types tools/neutral-fleet/promote.ts <runs-dir> <rule_id>...
// Only status PASS is promoted. The Bun realization is a reference to the frozen sidecar, pinned by SHA-256.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../src/neutral-render.ts";

const [runs, ...ids] = process.argv.slice(2);
const VOCAB_VERSION = (await import("../../src/profile-vocabulary.ts")).loadVocabulary().version;
const manifest = JSON.parse(readFileSync(join(ROOT, "conventions-sidecar/manifest.json"), "utf8"));
const partOf: Record<string, any> = {};
for (const se of Object.values<any>(manifest.splits ?? {})) for (const p of se.parts) partOf[p] = se;
const J = (p: string) => JSON.parse(readFileSync(p, "utf8"));
for (const id of ids) {
  const dir = join(runs, id), res = J(join(dir, "result.json"));
  if (res.status !== "PASS") { console.log("NOT PROMOTED " + id + ": " + res.status); continue; }
  const e = manifest.entries[id] ?? partOf[id], n = J(join(dir, "neutral.json")), a = J(join(dir, "neutral-audit.json")), rule = J(join(dir, "rule.json"));
  const isPart = !manifest.entries[id];
  const sha = createHash("sha256").update(readFileSync(join(ROOT, "conventions-sidecar", e.file))).digest("hex");
  if (sha !== e.sidecarSha256) throw new Error(id + ": frozen sidecar changed");
  if (!isPart && createHash("sha256").update(readFileSync(join(dir, "bun.json"))).digest("hex") !== sha) throw new Error(id + ": fleet input is not the frozen sidecar");
  const rv = existsSync(join(dir, "review-neutral.json")) ? J(join(dir, "review-neutral.json")) : null;
  const [profile, area] = id.split(".");
  const rec = {
    schema: "pi-atdd/neutral-convention/v0", rule_id: id, legacyId: rule.legacyId, ...(isPart ? { splitOf: e.legacyId } : {}),
    core: n.core, profileRequirements: n.profileRequirements, proposedKeys: n.proposedKeys ?? [],
    bunOnly: n.bunOnly ?? [], classification: n.classification, neutralityNotes: n.neutralityNotes ?? "",
    realizations: { bun: { sidecar: "conventions-sidecar/" + e.file, sha256: sha, ...(isPart ? { part: rule.legacyId } : {}) } },
    audit: {
      issue: "PLT-84", stage: res.deriver ? 2 : 1, vocabularyVersion: VOCAB_VERSION, verdict: a.verdict, rounds: res.rounds.length, usefulness: a.usefulness?.score,
      deriver: [...new Set(res.rounds.map((x: any) => x.deriverModel ?? "pi-claude-cli/claude-opus-5-5"))].join(" -> "), auditor: "openai-codex/gpt-6.1-sol", reviewer: "kimi-coding/k3.1-pro",
      review: rv && { faithful: rv.faithful, leaks: rv.leaks, pythonTransferScore: rv.pythonTransferScore, agreeWithAuditor: rv.agreeWithAuditor },
    },
  };
  const out = join(ROOT, "conventions-neutral", profile, area);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, id + ".json"), JSON.stringify(rec, null, 2) + "\n");
  console.log("promoted " + id);
}
