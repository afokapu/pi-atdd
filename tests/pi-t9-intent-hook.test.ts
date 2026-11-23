// ATD-22: integration through actual Pi tool_call and registered declaration tool.
import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync,mkdtempSync,rmSync,writeFileSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import atdd from "../extensions/atdd.ts";
import type {AuthenticatedT9Authority} from "../src/t9-intent-gate.ts";
import type {OntologySnapshot,Perimeter} from "@forgeonehundred/frg-t9-semantic-compiler";

const fixture=(f:string)=>JSON.parse(readFileSync(new URL(f,import.meta.url),"utf8"));
const snapshot=fixture("./fixtures/t9-demo-snapshot.json") as OntologySnapshot;
const perimeter=fixture("./fixtures/t9-demo-perimeter.json") as Perimeter;
const document={languageVersion:"t9-expression/2",pin:snapshot.pin,expression:{
  kind:"change",intention:{focus:"customers",phase:"modify",outcomeDimension:"financial"},
  ooc:{authority:"decision-os",id:"DEMO:ooc:unit-selling-price"},direction:"decrease"
}};
const t9Authority:AuthenticatedT9Authority={snapshot,perimeter,
  attest:async({action,compiledChange})=>{
    if(compiledChange.kind!=="change"||action.toolName!=="write"||
      (action.input as {path?:string}).path!=="src/orders/domain/price.ts")
      return {status:"REFUSED",reason:"No Resource and target approval"};
    return {status:"AUTHORIZED",attestationId:"fixture-authority-only",
      repositoryRevision:action.repositoryRevision};
  }};
function sandbox(authority?:AuthenticatedT9Authority){
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-t9-hook-"));
  const git=(...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"});
  git("init","-q");git("config","user.name","T9 gate test");git("config","user.email","test@example.invalid");
  mkdirSync(join(cwd,"src/orders/domain"),{recursive:true});
  writeFileSync(join(cwd,"src/orders/domain/price.ts"),"export const price=0;\n");
  writeFileSync(join(cwd,"atdd-pi.yaml"),"mode: atdd\n");
  git("add",".");git("commit","-qm","T9 fixture baseline");
  const handlers=new Map<string,Function>(),tools=new Map<string,any>();
  const p={on:(id:string,fn:Function)=>handlers.set(id,fn),
    registerTool:(v:any)=>tools.set(v.name,v),registerCommand:()=>{},
    sendMessage:()=>{}};
  const env:NodeJS.ProcessEnv={PI_ATDD_MODE:"atdd",PI_ATDD_REQUIRE_T9:"1"};
  atdd(p as any,{env,t9Authority:authority});
  const ctx={cwd,isProjectTrusted:()=>true,ui:{notify:()=>{}}};
  const before=handlers.get("before_agent_start")!;
  before({messageType:"user",prompt:"Edit a price, but do not infer approval"},ctx);
  return {cwd,ctx,handlers,tools,git,close:()=>rmSync(cwd,{recursive:true,force:true})};
}
const action={toolName:"write",input:{path:"src/orders/domain/price.ts",
  content:"export const price=1;\n"}};
const declaration=()=>({documentJson:JSON.stringify(document),
  toolName:action.toolName,toolInputJson:JSON.stringify(action.input)});

test("Pi refuses an unauthenticated governed mutation before touching source",async()=>{
  const x=sandbox();
  try{
    const missing=x.handlers.get("tool_call")!(action,x.ctx);
    assert.equal(missing.block,true);
    assert.match(missing.reason,/T9 declaration required/);
    const t9=x.tools.get("declare_t9_change");
    assert.ok(t9);
    const outcome=await t9.execute("call:1",declaration(),null,null,x.ctx);
    assert.equal(outcome.details.status,"REFUSED");
    assert.equal(outcome.isError,true);
    assert.match(x.handlers.get("tool_call")!(action,x.ctx).reason,/T9 declaration required/);
    assert.equal(readFileSync(join(x.cwd,action.input.path),"utf8"),"export const price=0;\n");
    assert.equal(x.handlers.get("tool_call")!({toolName:"bash",input:{command:"git status"}},x.ctx),
      undefined,"read-only shell inspection must not fabricate a desired change");
  }finally{x.close();}
});
test("Pi calls T9 compiler, requires provider attestation and matches exact next tool invocation",async()=>{
  const x=sandbox(t9Authority);
  try{
    const submit=x.tools.get("declare_t9_change");
    const declarationResult=await submit.execute("call:2",declaration(),null,null,x.ctx);
    assert.equal(declarationResult.details.status,"DECLARED");
    const wrong=x.handlers.get("tool_call")!({toolName:"write",input:{
      ...action.input,content:"export const price=2;\n"}},x.ctx);
    assert.equal(wrong.block,true);
    assert.match(wrong.reason,/does not match/);
    const actual=x.handlers.get("tool_call")!(action,x.ctx);
    assert.ok(!actual||!/T9 declaration/.test(actual.reason??""),
      "T9 must permit the declared exact call; existing convention guidance may still block once");
    // A conventional guidance block is not a T9 attestation waiver.
    x.handlers.get("tool_execution_end")!({toolName:"write",isError:false},x.ctx);
    const consumed=x.handlers.get("tool_call")!(action,x.ctx);
    assert.equal(consumed.block,true);
    assert.match(consumed.reason,/T9 declaration required/);
    x.handlers.get("session_tree")!({},{
      ...x.ctx,sessionManager:{getBranch:()=>[]},
    });
    assert.match(x.handlers.get("tool_call")!(action,x.ctx).reason,/T9 declaration required/);
  }finally{x.close();}
});
test("Pi blocks opaque/mutating shell bypass even if action text claims to be a read",()=>{
  const x=sandbox(t9Authority);
  try{
    for(const command of ["git status; touch src/x","npm test",
      'echo "bad" > src/orders/domain/price.ts']){
      const refused=x.handlers.get("tool_call")!({toolName:"bash",input:{command}},x.ctx);
      assert.equal(refused.block,true,command);
      assert.match(refused.reason,/T9 declaration required/);
    }
    assert.equal(x.handlers.get("tool_call")!({toolName:"read",
      input:{path:"src/orders/domain/price.ts"}},x.ctx),undefined);
  }finally{x.close();}
});
