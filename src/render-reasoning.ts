/** Bounded, provenance-preserving reasoning packages for Pi agents. */
import { join } from "node:path";
import type { Proof } from "./inference.ts";
import type { Reconciliation, Activation } from "./reasoning-context.ts";

function proofLines(root:Proof,max=8):string[] {
  const out:string[]=[];
  const seen=new Set<string>();
  const walk=(node:Proof,depth:number)=>{
    if(out.length>=max)return;
    const indent=" ".repeat(Math.min(depth,5)*2);
    for(const assertion of node.assertions.slice(0,2)) {
      if(out.length>=max)return;
      out.push(indent+"Fact "+node.fact.predicate+"("+node.fact.args.join(", ")+")"+
        " <- "+assertion.source+(assertion.provenance?" ["+assertion.provenance.slice(0,250)+"]":""));
    }
    if(seen.has(node.key)){out.push(indent+"(recursive derivation; refer to complete proof)");return;}
    seen.add(node.key);
    for(const derivation of node.derivations.slice(0,2)) {
      if(out.length>=max)break;
      out.push(indent+"Derived "+node.fact.predicate+" by "+derivation.rule+
        " ("+derivation.source+")");
      derivation.premises.forEach(p=>walk(p,depth+1));
    }
    seen.delete(node.key); // shared DAG evidence is not a cycle
  };
  walk(root,0);
  return out.slice(0,max);
}
const clip=(text:string,n:number)=>text.length<=n?text:text.slice(0,n)+"… [read full canonical file]";
function section(item:Activation, r:Reconciliation):string {
  const rule=item.convention;
  const source=r.provenance.find(p=>p.id===rule.source);
  const suffix=rule.file.slice(rule.source.length+1);
  const path=source?join(source.path,suffix):rule.file;
  const other = item.requiredPath.slice(0,7).map(edge =>
    "- "+edge.source+" -"+edge.type+"-> "+edge.target+
    " ["+edge.constraint+"]: "+clip(edge.reason,250)).join("\n");
  return [
    "Convention "+item.id+" — "+clip(rule.statement,800),
    "Canonical source: "+path,
    "Pinned provenance SHA-256: "+(source?.digest??"UNKNOWN")+"; treatment: "+(rule.disposition??"unspecified"),
    rule.summary?"Rationale: "+clip(rule.summary,520):"",
    rule.guidance?"Original guidance: "+clip(rule.guidance,1400):"No implementation recipe in this rule; consult source.",
    ...rule.exceptions.slice(0,5).map(s=>"Authored exception: "+clip(s,250)),
    other?"Authoritative dependency path:\n"+other:"",
    "Trigger proof:\n"+proofLines(item.proof,10).map(s=>"  "+clip(s,350)).join("\n"),
    rule.implementationRef?"Declared detector: "+rule.implementationRef+" (not executed)":"",
    "Required evidence: relevant acceptance assertions, independently executed tests and "+
      "observed behavior; context delivery does not establish compliance.",
  ].filter(Boolean).join("\n");
}
/** Explicit page receipt; no activation is "delivered" merely because it was
 * requested for rendering. This is a presentation receipt, not proof of reading.
 */
export type RenderedPage = {
  text:string;
  emittedIds:string[];
  omittedIds:string[];
};
export function renderReasonedPage(r:Reconciliation,ids?:readonly string[],maxChars=14_000):RenderedPage {
  if(!Number.isInteger(maxChars)||maxChars<1200)
    throw new Error("reasoning budget too small for safety warnings");
  const warnings=[
    "ATDD graph reasoning — positive provenance-backed derivations, not a merge verdict.",
    "Task scope: "+r.scope+"; state: "+r.status.toUpperCase(),
    r.unknownFacts.length?"Unknown context facts (NOT assumed false): "+r.unknownFacts.join(", "):"",
    r.unresolvedGraphEdges.length?"Graph has "+r.unresolvedGraphEdges.length+
      " external unresolved edges; completeness is NOT established.":"",
    ...r.gaps.slice(0,8).map(g=>"MISSING mandatory graph dependency: "+g.missingId),
    r.gaps.length>8?"Other missing mandatory dependencies remain in the full reasoning report.":"",
    !r.activations.length?"ATDD applicability unresolved (UNKNOWN). No activation is not proof that no conventions apply; review applicability.":"",
    "Rules are not waived by alternatives; an independent reviewer and CI verify binding obligations.",
  ].filter(Boolean).join("\n");
  const selected=ids?new Set(ids):null;
  const activations=r.activations.filter(x=>!selected||selected.has(x.id));
  const emittedIds:string[]=[],omittedIds:string[]=[];
  const reserve=300;
  if(warnings.length>maxChars-reserve)
    return {text:warnings.slice(0,maxChars-150)+"\nWARNING: context overflow; no convention was delivered.",
      emittedIds,omittedIds:activations.map(a=>a.id)};
  let text=warnings;
  for(const a of activations){
    const item="\n\n"+section(a,r);
    if(text.length+item.length>maxChars-reserve) {
      omittedIds.push(a.id);
    } else {
      text+=item;
      emittedIds.push(a.id);
    }
  }
  if(omittedIds.length) {
    text+="\n\nATTENTION: "+omittedIds.length+" activated convention(s) omitted by budget. "+
      "Their content has NOT been delivered or acknowledged. Retries must receive "+
      "remaining reasoning before the edit can proceed.";
    if(!emittedIds.length)
      text+=" No complete convention fit the budget: use the full canonical source or enlarge context.";
  }
  return {text,emittedIds,omittedIds};
}
/** Backwards-compatible text renderer. State transitions must use
 * renderReasonedPage() instead; the text function cannot confirm delivery.
 */
export function renderReasoned(r:Reconciliation,ids?:readonly string[],maxChars=14_000):string {
  return renderReasonedPage(r,ids,maxChars).text;
}
