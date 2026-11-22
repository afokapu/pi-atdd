/**
 * ATD-41 Stream B: internal, in-memory Pi observation handoff for ATD-39.
 *
 * This describes independently witnessed facts and their lifecycle. It is not
 * an admitted OoC catalog, a T9 matcher, an authorization token, or a published
 * Change Realization Contract. In particular, a path is only a resource HINT.
 *
 * The caller may inspect the frames in process; NEVER serialize these proofs
 * into the sanitized telemetry log (source paths/provenance may be sensitive).
 */
import { createHash } from "node:crypto";
import type { ContextObservation, Reconciliation, MissingFact } from "./reasoning-context.ts";
import type { Fact, Proof } from "./inference.ts";

type Operation = ContextObservation["operation"];
type Origin = ContextObservation["origin"];
type Point = "task_start"|"pre_edit"|"post_tool"|"review"|"scope_reset"|"scope_retraction";
export type ObservedReceipt = {
  factId:string;
  factType:string;
  factArgs:readonly string[];
  origin:string;
  provenance:string|null;
  sourceRevision:string|null;
  sourceDigest:string|null;
  evidenceState:"OBSERVED"|"RETRACTED";
};
export type RuleReceipt = {
  conventionId:string;
  sourcePath:string;
  sourceDigest:string|null;
  proof:Proof;
  mandatoryRequires:readonly {
    fromRuleId:string;toRuleId:string;constraint:"mandatory";sourcePath:string;
  }[];
};
export type PiObservationFrame = {
  schema:"pi-atdd/observation-handoff/internal-v1";
  event:{
    id:string;scope:string;origin:Origin|"pi-session-lifecycle"|"pi-reconciliation";
    operation:Operation;point:Point;provenance:string;
    repositoryRevision:string|null;
    targetPathHint:string|null;
    /** The digest of source bytes supplied with THIS event, not necessarily HEAD. */
    sourceDigest:string|null;
    sourceState:"PROPOSED"|"OBSERVED"|"UNVERIFIED"|"MISSING"|"RETRACTED";
  };
  /** These are NOT Resource classes or OoC identities. */
  resourceHints:{fileKind:string|null;layer:string|null};
  observed:readonly ObservedReceipt[];
  retracted:readonly ObservedReceipt[];
  missing:readonly MissingFact[];
  unknownFacts:readonly string[];
  receipts:readonly RuleReceipt[];
  removedRuleIds:readonly string[];
  changedRuleIds:readonly string[];
  graphGaps:readonly string[];
  status:Reconciliation["status"];
  disposition:"observation_only_no_authority";
};
type ScopeSnapshot = {
  input:Pick<ContextObservation,"operation"|"path"|"revision">;
  sourceDigest:string|null;
  facts:Map<string,Fact>;
  ruleIds:readonly string[];
};

/** Exclude raw task text from the observer stream, even inside typed facts. */
function allowedFacts(result:Reconciliation):Map<string,Fact>{
  return new Map(result.observedFacts
    .filter(f=>f.predicate!=="task")
    .map(f=>[f.id,f]));
}
/** Only source-backed facts may inherit the exact observed source-byte digest.
 * A phase, task operation or claimed authority is not proved by source bytes.
 */
const SOURCE_FACTS=new Set(["code_construct","change","file_kind","layer_dependency"]);
function receipt(f:Fact,state:ObservedReceipt["evidenceState"],
  sourceDigest:string|null,revision:string|null):ObservedReceipt {
  return {factId:f.id,factType:f.predicate,factArgs:[...f.args],
    origin:f.source,provenance:f.provenance??null,
    sourceRevision:revision,
    sourceDigest:SOURCE_FACTS.has(f.predicate)?sourceDigest:null,evidenceState:state};
}
/** A proposed edit's digest is NOT a repository revision/committed-source proof. */
function sourceIdentity(input:ContextObservation){
  if(input.sourceText===undefined)return {digest:null,state:"MISSING" as const};
  const digest=createHash("sha256").update(input.sourceText).digest("hex");
  const state=input.origin==="repository-observation"?"OBSERVED" as const:
    input.origin==="pi-event"&&["edit","create"].includes(input.operation)
      ?"PROPOSED" as const:"UNVERIFIED" as const;
  return {digest,state};
}
/** Stable fact identity is not enough if source or provenance was replaced. */
function sameSupport(a:Fact,b:Fact):boolean {
  return a.predicate===b.predicate&&a.source===b.source&&
    a.provenance===b.provenance&&JSON.stringify(a.args)===JSON.stringify(b.args);
}
function pointOf(input:ContextObservation):Point{
  if(input.origin==="detector-result")return "review";
  if(input.origin==="repository-observation")return "post_tool";
  if(input.operation==="task")return "task_start";
  if(input.origin==="pi-event")return "pre_edit";
  return "review";
}
/** The source pin comes from the catalog, not from a guessed OoC identity. */
function ruleReceipts(result:Reconciliation):RuleReceipt[]{
  return result.activations.map(a=>({
    conventionId:a.id,sourcePath:a.convention.source,
    sourceDigest:result.provenance.find(p=>p.id===a.convention.source)?.digest??null,
    proof:a.proof,
    mandatoryRequires:a.requiredPath
      .filter(e=>e.type==="requires"&&e.constraint==="mandatory")
      .map(e=>({fromRuleId:e.source,toRuleId:e.target,
        constraint:"mandatory" as const,sourcePath:e.sourceFile})),
  }));
}
function hint(facts:Map<string,Fact>,predicate:string):string|null {
  return [...facts.values()].find(f=>f.predicate===predicate)?.args[1]??null;
}
function eventIdValid(id:string):boolean{
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
}
/** A new observation replaces prior support in its own scope, not other scopes.
 * The old fact receipts are explicitly retracted; absent facts are never
 * transformed into NO_RULE_REQUIRED.
 */
export class PiObservationFeed {
  private scopes=new Map<string,ScopeSnapshot>();
  capture(id:string,input:ContextObservation,result:Reconciliation):PiObservationFrame {
    if(!eventIdValid(id)||input.scope!==result.scope)
      throw new Error("observation event identity/scope mismatch");
    const facts=allowedFacts(result),previous=this.scopes.get(input.scope);
    const source=sourceIdentity(input),priorDigest=previous?.sourceDigest??null;
    const retracted=[...(previous?.facts.values()??[])]
      .filter(f=>!facts.has(f.id)||!sameSupport(f,facts.get(f.id)!)||
        SOURCE_FACTS.has(f.predicate)&&priorDigest!==source.digest)
      .map(f=>receipt(f,"RETRACTED",priorDigest,previous?.input.revision??null));
    this.scopes.set(input.scope,{input:{
      operation:input.operation,path:input.path,revision:input.revision,
    },sourceDigest:source.digest,facts,ruleIds:result.activations.map(a=>a.id)});
    return {
      schema:"pi-atdd/observation-handoff/internal-v1",
      event:{id,scope:input.scope,origin:input.origin,operation:input.operation,
        point:pointOf(input),provenance:input.provenance,
        repositoryRevision:input.revision??null,targetPathHint:input.path??null,
        sourceDigest:source.digest,sourceState:source.state},
      resourceHints:{fileKind:hint(facts,"file_kind"),layer:hint(facts,"file_layer")},
      observed:[...facts.values()].map(f=>receipt(f,"OBSERVED",source.digest,input.revision??null)),
      retracted,missing:[...result.missingReasons],
      unknownFacts:[...result.unknownFacts],receipts:ruleReceipts(result),
      removedRuleIds:[...result.removed],changedRuleIds:[...result.changed],
      graphGaps:result.gaps.map(g=>g.missingId),status:result.status,
      disposition:"observation_only_no_authority",
    };
  }
  /** An explicit source/reviewer retraction is never an observed negative.
   * It removes one scope's supports without affecting independent scopes.
   */
  retractScope(id:string,scope:string,reason:string):PiObservationFrame|null{
    if(!eventIdValid(id))throw new Error("invalid observation retraction event");
    const snapshot=this.scopes.get(scope);
    if(!snapshot)return null;
    this.scopes.delete(scope);
    return {
      schema:"pi-atdd/observation-handoff/internal-v1",
      event:{id,scope,origin:"pi-reconciliation",operation:snapshot.input.operation,
        point:"scope_retraction",provenance:reason,
        repositoryRevision:snapshot.input.revision??null,
        targetPathHint:snapshot.input.path??null,
        sourceDigest:snapshot.sourceDigest,sourceState:"RETRACTED"},
      resourceHints:{fileKind:null,layer:null},
      observed:[],retracted:[...snapshot.facts.values()].map(f=>
        receipt(f,"RETRACTED",snapshot.sourceDigest,snapshot.input.revision??null)),
      missing:[{fact:"observation",reason}],unknownFacts:["observation"],
      receipts:[],removedRuleIds:[...snapshot.ruleIds],changedRuleIds:[],
      graphGaps:[],status:"unknown",disposition:"observation_only_no_authority",
    };
  }
  /** Session/repository switches invalidate facts without asserting a new
   * code mutation or an invented provider/validator identity.
   */
  invalidate(idPrefix:string):PiObservationFrame[]{
    const frames=[...this.scopes.keys()].map((scope,index)=>
      this.retractScope(idPrefix+"."+index,scope,"scope_invalidated")!);
    return frames.map(frame=>({
      ...frame,event:{...frame.event,origin:"pi-session-lifecycle",point:"scope_reset"},
    }));
  }
}
