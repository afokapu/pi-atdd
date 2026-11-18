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
/** Provenance strings of every assertion inside one proof subtree. */
function evidenceOf(p:Proof,out:string[]=[],seen=new Set<string>()):string[]{
  if(seen.has(p.key))return out;
  seen.add(p.key);
  for(const a of p.assertions)out.push(a.provenance??a.source);
  for(const d of p.derivations){out.push(d.rule);d.premises.forEach(x=>evidenceOf(x,out,seen));}
  return out;
}
/**
 * Relevance of an activation to the observed subject. Only DIRECT derivations
 * (selector or typed applicability rules) count file-specific evidence: a
 * mandatory prerequisite does not inherit the path evidence of the rule that
 * requires it, so it can never outrank its directly targeted rule.
 *   path selector evidence +4, typed layer/path fact +2 (direct only);
 *   prerequisite-only activation 1; task-wording-only activation 0.
 */
export function relevance(a:Activation):number {
  let best=-1;
  for(const d of a.proof.derivations){
    if(d.rule==="pi-atdd.mandatory-prerequisites"){best=Math.max(best,1);continue;}
    const ev=d.premises.flatMap(x=>evidenceOf(x));
    let score=0;
    if(ev.some(r=>r.startsWith("path:")))score+=4;
    if(d.rule.startsWith("pi-atdd.typed-")||ev.some(r=>r.startsWith("layer:")))score+=2;
    best=Math.max(best,score===0?0:score+2);
  }
  return Math.max(best,0);
}
const MIN_COMPACT=400;
export function rankActivations(list:readonly Activation[]):Activation[] {
  return [...list].sort((x,y)=>relevance(y)-relevance(x)||(x.id<y.id?-1:x.id>y.id?1:0));
}
/** Minimal rendering that still carries the obligation, its source and guidance. */
function compactSection(item:Activation,r:Reconciliation,budget:number):string {
  const rule=item.convention;
  const source=r.provenance.find(p=>p.id===rule.source);
  const suffix=rule.file.slice(rule.source.length+1);
  const path=source?join(source.path,suffix):rule.file;
  const head=[
    "Convention "+item.id+" — "+clip(rule.statement,500),
    "Canonical source: "+path,
    "Pinned provenance SHA-256: "+(source?.digest??"UNKNOWN"),
    "Activation evidence: "+item.reasons.slice(0,4).map(s=>clip(s,120)).join("; "),
  ].join("\n");
  const tail="\n[compact rendering under page budget: read the full canonical file]";
  const room=budget-head.length-tail.length-60;
  const guidance=rule.guidance&&room>120?"\nOriginal guidance: "+clip(rule.guidance,room):"";
  const text=head+guidance+tail;
  return text.length<=budget?text:text.slice(0,Math.max(0,budget-tail.length))+tail;
}
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
  // Highest relevance first, so a bounded page drops lower-relevance rules first.
  const activations=rankActivations(r.activations.filter(x=>!selected||selected.has(x.id)));
  const emittedIds:string[]=[],omittedIds:string[]=[];
  const reserve=320;
  if(warnings.length>maxChars-reserve)
    return {text:warnings.slice(0,maxChars-150)+"\nWARNING: context overflow; no convention was delivered.",
      emittedIds,omittedIds:activations.map(a=>a.id)};
  let text=warnings;
  for(const [i,a] of activations.entries()){
    const item="\n\n"+section(a,r);
    if(omittedIds.length) {
      omittedIds.push(a.id); // strict relevance order: never skip a rule to fit a less relevant one
    } else if(text.length+item.length<=maxChars-reserve) {
      text+=item;
      emittedIds.push(a.id);
    } else if(i===0&&maxChars-reserve-text.length-2>=MIN_COMPACT) {
      // The most relevant rule is not dropped while a compact rendering fits.
      text+="\n\n"+compactSection(a,r,maxChars-reserve-text.length-2);
      emittedIds.push(a.id);
    } else {
      omittedIds.push(a.id);
    }
  }
  if(omittedIds.length) {
    const attention="\n\nATTENTION: "+omittedIds.length+" activated convention(s) omitted by budget (lower relevance first). "+
      "Their content has NOT been delivered or acknowledged. Retries must receive "+
      "remaining reasoning before the edit can proceed."+
      (!emittedIds.length?" No complete convention fit the budget: use the full canonical source or enlarge context.":"");
    const listed=" Omitted: "+omittedIds.join(", ")+".";
    text+=attention.length+listed.length+text.length<=maxChars?attention+listed:attention;
  }
  return {text,emittedIds,omittedIds};
}
/** Backwards-compatible text renderer. State transitions must use
 * renderReasonedPage() instead; the text function cannot confirm delivery.
 */
export function renderReasoned(r:Reconciliation,ids?:readonly string[],maxChars=14_000):string {
  return renderReasonedPage(r,ids,maxChars).text;
}
