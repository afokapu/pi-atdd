/**
 * Write-once convention challenge records, outside the immutable canonical YAML.
 * This is a proposal/evidence channel, NOT a waiver or an approval mechanism.
 * A decision requires an independently authenticated adapter capability.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Catalog } from "./catalog.ts";

export type EvidenceRef = {
  kind: "test" | "diff" | "runtime" | "benchmark";
  locator: string; sha256: string;
};
export type ChallengeRequest = {
  ruleId: string; sourceDigest: string; requester: string;
  counterexample: string; proposedRealization: string;
  assumptions: string[]; evidence: EvidenceRef[];
};
export type ChallengeRecord = ChallengeRequest & {
  schema: "pi-atdd/challenge/v1"; id: string;
  affectedRelationships: Array<{ source: string; target: string; type: string; reason: string }>;
  status: "pending_review";
};
export type ReviewDecision = {
  schema: "pi-atdd/external-review/v1"; challengeId: string;
  reviewer: string; verdict: "ACCEPT_ALTERNATIVE" | "RETURN" | "ESCALATE";
  evidence: EvidenceRef[]; reason: string; sourceDigest: string;
};
/** Provided by a trusted external review provider, NEVER inferred from comments. */
export type TrustedReviewAdapter = {
  verifyReview: (challenge: ChallengeRecord, decision: ReviewDecision) => Promise<boolean>;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const clean = (value: unknown, label: string, max = 2000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new Error("invalid " + label);
  return value.trim();
};
function refs(input: EvidenceRef[]): EvidenceRef[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 25) throw new Error("evidence references are required");
  return input.map(ref => {
    if (!["test","diff","runtime","benchmark"].includes(ref.kind)
        || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw new Error("invalid evidence reference");
    return {kind:ref.kind, locator:clean(ref.locator,"evidence locator",300),sha256:ref.sha256};
  });
}
export function proposeChallenge(catalog: Catalog, proposal: ChallengeRequest): ChallengeRecord {
  const rule = catalog.rules.get(proposal.ruleId);
  if (!rule) throw new Error("unknown convention: " + proposal.ruleId);
  const origin = catalog.provenance.find(item => item.id === rule.source);
  if (!origin || origin.digest !== proposal.sourceDigest)
    throw new Error("challenge source digest is stale or not authoritative");
  const data: ChallengeRequest = {
    ruleId:proposal.ruleId,sourceDigest:proposal.sourceDigest,
    requester:clean(proposal.requester,"requester",150),
    counterexample:clean(proposal.counterexample,"counterexample",3000),
    proposedRealization:clean(proposal.proposedRealization,"proposed realization",3000),
    assumptions: (proposal.assumptions ?? []).map(a => clean(a,"assumption",400)),
    evidence:refs(proposal.evidence),
  };
  if (!Array.isArray(proposal.assumptions) || proposal.assumptions.length>20) throw new Error("invalid assumptions");
  const affectedRelationships = catalog.edges
    .filter(edge => edge.source===rule.id || edge.target===rule.id)
    .map(edge=>({source:edge.source,target:edge.target,type:edge.type,reason:edge.reason}))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const id = hash(JSON.stringify({data,affectedRelationships}));
  return {schema:"pi-atdd/challenge/v1",id,...data,affectedRelationships,status:"pending_review"};
}
const challengePath = (root:string,id:string) => join(resolve(root),".atdd","pi-atdd","challenges",id+".json");
export function publishChallenge(root:string,record:ChallengeRecord):string {
  if (!/^[a-f0-9]{64}$/.test(record.id) || record.status!=="pending_review") throw new Error("invalid immutable challenge record");
  const file = challengePath(root,record.id);
  mkdirSync(join(resolve(root),".atdd","pi-atdd","challenges"),{recursive:true});
  writeFileSync(file,JSON.stringify(record,null,2)+"\n",{flag:"wx",encoding:"utf8"});
  return file;
}
export function readChallenge(root:string,id:string):ChallengeRecord {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("invalid challenge id");
  const value = JSON.parse(readFileSync(challengePath(root,id),"utf8")) as ChallengeRecord;
  if (value.id!==id || value.status!=="pending_review" || value.schema!=="pi-atdd/challenge/v1")
    throw new Error("challenge record corrupt");
  return value;
}
export async function publishExternalReview(root:string,record:ChallengeRecord,
    decision:ReviewDecision,adapter:TrustedReviewAdapter):Promise<string> {
  if (decision.schema!=="pi-atdd/external-review/v1" || decision.challengeId!==record.id
      || decision.sourceDigest!==record.sourceDigest || decision.reviewer===record.requester
      || !["ACCEPT_ALTERNATIVE","RETURN","ESCALATE"].includes(decision.verdict))
    throw new Error("review is stale, malformed or a self-approval");
  clean(decision.reviewer,"reviewer",150);
  clean(decision.reason,"review reason",3000);
  refs(decision.evidence);
  // Trust is a capability from a connector. A claim in task text or Linear
  // comment is not authenticated authority.
  if (!await adapter.verifyReview(record,decision))
    throw new Error("external review authority or evidence could not be verified");
  const file = join(resolve(root),".atdd","pi-atdd","challenges",record.id+".review.json");
  writeFileSync(file,JSON.stringify(decision,null,2)+"\n",{flag:"wx",encoding:"utf8"});
  return file;
}
