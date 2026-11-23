/**
 * ATD-22: Pi's pre-action T9 declaration gate, NOT a T9 parser, OoC registry,
 * provider admission authority, or governance rule matcher.
 *
 * Only a trusted host may provide an ontology, selected perimeter and an
 * action-scope attestor. Without that authority a mandatory gate refuses work.
 */
import { createHash } from "node:crypto";
import { createT9, type ExpressionDocument, type OntologySnapshot,
  type Perimeter } from "@forgeonehundred/frg-t9-semantic-compiler";

export type ProposedAction={
  toolName:string; input:unknown; repositoryRevision:string;
  workingTreeDigest:string;
};
export type AuthenticatedT9Authority={
  /** Independently authenticated and owner-pinned, never model-provided. */
  snapshot:OntologySnapshot;
  perimeter:Perimeter;
  /** Independent host authority AND Resource/target/tool/intent binding. */
  attest:(input:{
    document:ExpressionDocument;
    compiledChange:Extract<ExpressionDocument["expression"],{kind:"change"}>;
    action:ProposedAction;
  })=>Promise<{status:"AUTHORIZED";attestationId:string;repositoryRevision:string;
    workingTreeDigest:string}|
    {status:"REFUSED";reason:string}>;
};
export type DeclarationRequest={
  documentJson:string;toolName:string;toolInputJson:string;
};
export type T9Verdict={
  status:"DECLARED"|"REFUSED";
  reason:string;
  attestationId?:string;
};
type Pending={
  toolName:string; inputDigest:string;repositoryRevision:string;
  workingTreeDigest:string;attestationId:string;
};
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const allowedKey=(k:string)=>k!=="__proto__"&&k!=="constructor"&&k!=="prototype";
/** Deterministic JSON equality without relying on property insertion order. */
function ordered(value:unknown,depth=0):string{
  if(depth>32)throw Error("JSON nesting exceeds 32");
  if(value===null||typeof value==="string"||typeof value==="boolean"||
    typeof value==="number"&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(v=>ordered(v,depth+1)).join(",")+"]";
  if(typeof value!=="object")throw Error("not an ordinary JSON value");
  const o=value as Record<string,unknown>,keys=Object.keys(o).sort();
  if(!keys.every(allowedKey))throw Error("unsafe JSON key");
  return "{"+keys.map(k=>JSON.stringify(k)+":"+ordered(o[k],depth+1)).join(",")+"}";
}
export function actionFingerprint(toolName:string,input:unknown):string {
  if(!toolName||toolName.length>96)throw Error("invalid tool name");
  return hash(ordered({toolName,input}));
}
/** Only a single desired Change Path can unlock the pre-action gate. */
function desiredDocument(value:unknown):value is ExpressionDocument{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  if(v.languageVersion!=="t9-expression/2")return false;
  const expr=v.expression;
  return !!expr&&typeof expr==="object"&&!Array.isArray(expr)&&
    (expr as Record<string,unknown>).kind==="change";
}
function documentFrom(json:string):ExpressionDocument{
  if(typeof json!=="string"||Buffer.byteLength(json,"utf8")>16_384)
    throw Error("T9 declaration exceeds 16 KB");
  const parsed:unknown=JSON.parse(json);
  if(!desiredDocument(parsed))
    throw Error("A governed action requires one desired T9 v2 Change Path");
  return parsed;
}
type DesiredChange=Extract<ExpressionDocument["expression"],{kind:"change"}>;
function compiledDesired(host:AuthenticatedT9Authority,
  document:ExpressionDocument):DesiredChange{
  const client=createT9({perimeter:host.perimeter,snapshot:host.snapshot});
  if(client.status!=="READY")throw Error("T9 perimeter/snapshot refused");
  const compiled=client.compileExpression(document);
  if(compiled.status!=="RESOLVED"||compiled.ast?.kind!=="change"||
    !("intention" in compiled.ast))
    throw Error("T9 did not resolve a canonical desired Change Path");
  return compiled.ast as DesiredChange;
}
/** JSON and target integrity are checked BEFORE calling the host attestor. */
function declaredAction(request:DeclarationRequest,revision:string,
  workingTreeDigest:string):{action:ProposedAction;inputDigest:string}{
  if(!request.toolName||["declare_t9_change","set_atdd_mode"].includes(request.toolName))
    throw Error("not a governed mutation target");
  if(request.toolInputJson.length>65_536)throw Error("tool input exceeds 64 KB");
  const input:unknown=JSON.parse(request.toolInputJson);
  if(!input||typeof input!=="object"||Array.isArray(input))
    throw Error("tool input must be a bounded JSON object");
  const inputDigest=actionFingerprint(request.toolName,input);
  return {action:{toolName:request.toolName,input,repositoryRevision:revision,
    workingTreeDigest},inputDigest};
}
async function authenticatedPending(host:AuthenticatedT9Authority,
  document:ExpressionDocument,change:DesiredChange,
  action:ProposedAction,inputDigest:string):Promise<Pending>{
  const attestation=await host.attest({document,compiledChange:change,action});
  if(attestation.status==="REFUSED")throw Error(attestation.reason);
  if(!attestation.attestationId||
    attestation.repositoryRevision!==action.repositoryRevision||
    attestation.workingTreeDigest!==action.workingTreeDigest)
    throw Error("authenticated provider revision/attestation mismatch");
  return {toolName:action.toolName,inputDigest,
    repositoryRevision:action.repositoryRevision,
    workingTreeDigest:action.workingTreeDigest,
    attestationId:attestation.attestationId};
}
/** Read-only primitives do not require a fictional desired Change Path. */
export function readOnlyAction(toolName:string,input:unknown):boolean {
  if(["read","ls","find","grep"].includes(toolName))return true;
  if(toolName!=="bash")return false;
  const cmd=(input as {command?:unknown}|null)?.command;
  if(typeof cmd!=="string"||cmd.length>2048||/[;&|><\n\r\x60$\\]/.test(cmd))
    return false;
  // This is intentionally an exact allow-list, NOT a command-prefix test.
  // e.g. rg --pre, find -exec, git show --output can execute or write.
  return new Set(["pwd","ls","ls -la","git status","git status --short",
    "git diff","git diff --stat","git rev-parse HEAD",
    "git log -1 --oneline"]).has(cmd.trim());
}
export class T9IntentGate {
  private pending:Pending|null=null;
  constructor(private readonly authority?:AuthenticatedT9Authority){}
  reset():void{this.pending=null;}
  /** Every governed action binds to one compiler-resolved, host-attested declaration. */
  async declare(request:DeclarationRequest,revision:string|null,
    workingTreeDigest:string|null):Promise<T9Verdict>{
    this.pending=null;
    if(!revision||!workingTreeDigest)
      return {status:"REFUSED",reason:"No independently observed repository/worktree revision"};
    if(!this.authority)
      return {status:"REFUSED",reason:"No authenticated T9 perimeter and work-provider binding"};
    try{
      const document=documentFrom(request.documentJson);
      const {action,inputDigest}=declaredAction(request,revision,workingTreeDigest);
      const change=compiledDesired(this.authority,document);
      this.pending=await authenticatedPending(this.authority,document,change,action,inputDigest);
      return {status:"DECLARED",reason:"T9 desired change resolved and host-attested for one exact action",
        attestationId:this.pending.attestationId};
    }catch(e){return {status:"REFUSED",reason:String(e)};}
  }
  /** Pure preflight. A different operation, body or revision cannot inherit authority. */
  check(toolName:string,input:unknown,revision:string|null,
    workingTreeDigest:string|null):{block:true;reason:string}|undefined{
    if(readOnlyAction(toolName,input))return undefined;
    if(!this.pending)return {block:true,reason:"T9 declaration required. Call declare_t9_change before this tool action; no authority is inferred from chat."};
    try{
      if(!revision||revision!==this.pending.repositoryRevision||
        !workingTreeDigest||workingTreeDigest!==this.pending.workingTreeDigest||
        toolName!==this.pending.toolName||
        actionFingerprint(toolName,input)!==this.pending.inputDigest)
        return {block:true,reason:"T9 declared intent does not match the exact observed operation, arguments or revision. Declare again."};
    }catch{return {block:true,reason:"T9 tool action is not valid bounded JSON; declaration cannot match"};}
    return undefined;
  }
  /** Single-use receipt, consumed only after Pi actually executes this tool. */
  consumed(toolName:string):void{
    if(this.pending?.toolName===toolName)this.pending=null;
  }
}
