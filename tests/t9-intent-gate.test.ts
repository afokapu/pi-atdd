// ATD-22: synthetic compiler-v0.4.1 contract conformance, not OoC admission.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createT9,type OntologySnapshot,type Perimeter} from "@forgeonehundred/frg-t9-semantic-compiler";
import {T9IntentGate,actionFingerprint,readOnlyAction,
  type AuthenticatedT9Authority} from "../src/t9-intent-gate.ts";

const fixture=(f:string)=>JSON.parse(readFileSync(new URL(f,import.meta.url),"utf8"));
const snapshot=fixture("./fixtures/t9-demo-snapshot.json") as OntologySnapshot;
const perimeter=fixture("./fixtures/t9-demo-perimeter.json") as Perimeter;
const revision="a".repeat(40);
const action={toolName:"write",input:{path:"src/orders/price.ts",content:"export const price=1;\n"}};
const document={languageVersion:"t9-expression/2",pin:snapshot.pin,
  expression:{kind:"change",intention:{focus:"customers",phase:"modify",
    outcomeDimension:"financial"},ooc:{authority:"decision-os",
      id:"DEMO:ooc:unit-selling-price"},direction:"decrease"}};
const request=()=>({documentJson:JSON.stringify(document),
  toolName:action.toolName,toolInputJson:JSON.stringify(action.input)});
const provider=(attest:AuthenticatedT9Authority["attest"]):AuthenticatedT9Authority=>({
  snapshot,perimeter,attest,
});

test("the actual installed T9 compiler 0.4.1 resolves a typed desired expression",()=>{
  const t9=createT9({snapshot,perimeter});
  assert.equal(t9.status,"READY");
  if(t9.status!=="READY")return;
  assert.equal(t9.compileExpression(document as any).status,"RESOLVED");
  assert.equal(t9.compileExpression({...document,expression:{...document.expression,direction:"undo"}} as any).status,
    "REFUSED");
});

test("mandatory T9 gate refuses without authenticated snapshot and host",async()=>{
  const gate=new T9IntentGate();
  assert.equal((await gate.declare(request(),revision)).status,"REFUSED");
  assert.match(gate.check(action.toolName,action.input,revision)!.reason,/T9 declaration required/);
  assert.equal(gate.check("read",{path:"src/orders/price.ts"},revision),undefined);
});

test("T9 compilation plus independent attestation binds exactly one action and revision",async()=>{
  let calls=0;
  const gate=new T9IntentGate(provider(async({compiledChange,action:actual})=>{
    calls++;
    assert.equal(compiledChange.kind,"change");
    assert.equal(actual.toolName,"write");
    assert.equal(actual.repositoryRevision,revision);
    return {status:"AUTHORIZED",attestationId:"host:approval-1",
      repositoryRevision:revision};
  }));
  assert.equal((await gate.declare(request(),revision)).status,"DECLARED");
  assert.equal(calls,1);
  assert.equal(gate.check("write",{content:action.input.content,path:action.input.path},revision),undefined);
  assert.match(gate.check("write",{...action.input,content:"different"},revision)!.reason,/does not match/);
  assert.match(gate.check("edit",action.input,revision)!.reason,/does not match/);
  assert.match(gate.check("write",action.input,"b".repeat(40))!.reason,/does not match/);
  gate.consumed("write");
  assert.match(gate.check("write",action.input,revision)!.reason,/declaration required/);
});

test("host refusal or mismatch never promotes T9 RESOLVED into execution approval",async()=>{
  const gate=new T9IntentGate(provider(async()=>({status:"REFUSED",
    reason:"Provider has not authorized this Resource and Situation"})));
  const denied=await gate.declare(request(),revision);
  assert.equal(denied.status,"REFUSED");
  assert.match(denied.reason,/Resource and Situation/);
  assert.ok(gate.check(action.toolName,action.input,revision));
  const stale=new T9IntentGate(provider(async()=>({status:"AUTHORIZED",
    attestationId:"bad",repositoryRevision:"b".repeat(40)})));
  assert.equal((await stale.declare(request(),revision)).status,"REFUSED");
  assert.ok(stale.check(action.toolName,action.input,revision));
});

test("non-desired, fake, ambiguous and malformed expressions never grant a receipt",async()=>{
  const gate=new T9IntentGate(provider(async()=>({status:"AUTHORIZED",
    attestationId:"host:test",repositoryRevision:revision})));
  for(const invalid of [
    {...document,languageVersion:"t9-expression/3"},
    {...document,expression:{kind:"node-ref",ref:{scope:"local",nodeKind:"ooc",entry:"x"}}},
    {...document,expression:{...document.expression,direction:"undo"}},
    {...document,expression:{...document.expression,ooc:{candidateTerm:"maybe price"}}},
    {...document,pin:{...snapshot.pin,snapshotDigest:"invalid"}},
  ]){
    assert.equal((await gate.declare({...request(),documentJson:JSON.stringify(invalid)},revision)).status,
      "REFUSED");
    assert.ok(gate.check(action.toolName,action.input,revision));
  }
  assert.equal((await gate.declare({...request(),toolInputJson:"{"},revision)).status,"REFUSED");
  assert.equal((await gate.declare({...request(),toolInputJson:'{"__proto__":1}'},revision)).status,
    "REFUSED");
  assert.equal((await gate.declare(request(),null)).status,"REFUSED");
});

test("read-only commands are exempt, but shell metacharacters and custom tools are governed",()=>{
  for(const cmd of ["git status --short","git diff --stat","pwd","ls -la"])
    assert.equal(readOnlyAction("bash",{command:cmd}),true,cmd);
  for(const cmd of [
    "git status; rm -rf src","git status && touch src/a","echo x > src/a",
    "npm test","git status $(touch src/a)","git diff | tee src/x"
  ])assert.equal(readOnlyAction("bash",{command:cmd}),false,cmd);
  assert.equal(readOnlyAction("my_custom_write",{x:1}),false);
  assert.equal(actionFingerprint("write",{a:1,b:2}),
    actionFingerprint("write",{b:2,a:1}));
  assert.notEqual(actionFingerprint("write",{a:1}),actionFingerprint("edit",{a:1}));
  assert.throws(()=>actionFingerprint("write",{danger:undefined}),/not an ordinary JSON value/);
});
