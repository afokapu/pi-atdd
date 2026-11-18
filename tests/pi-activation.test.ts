// Acceptance: acc:pi-atdd:E002-INTEGRATION-006
// Acceptance: acc:pi-atdd:E002-UNIT-001
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";

function sandbox() {
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-pi-live-"));
  const git=(...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"});
  git("init","-q");git("config","user.name","Pi tester");git("config","user.email","test@example.invalid");
  mkdirSync(join(cwd,"src/orders/routes"),{recursive:true});
  writeFileSync(join(cwd,"src/orders/routes/create.ts"),"export const created = false;\n");
  git("add",".");git("commit","-qm","base");
  const handlers=new Map<string,Function>();
  const messages:Array<{message:{customType:string;content:string};options:unknown}>=[];
  const p={
    on:(name:string,fn:Function)=>{handlers.set(name,fn);},
    registerCommand:()=>{},
    sendMessage:(message:{customType:string;content:string},options:unknown)=>messages.push({message,options}),
  };
  atdd(p as any);
  const ctx={cwd,isProjectTrusted:()=>true,ui:{notify:()=>{}}};
  return {cwd,handlers,messages,ctx,git,cleanup:()=>rmSync(cwd,{recursive:true,force:true})};
}

test("Pi delivers typed graph reasoning automatically at task start and first edit",()=>{
  const x=sandbox();
  try {
    const initial=x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Implement authorization"},x.ctx);
    assert.match(initial.message.content,/coder\.bun\.security-missing-auth/);
    assert.match(initial.message.content,/Canonical source:/);
    assert.match(initial.message.content,/Original guidance:/);
    assert.equal(x.handlers.get("before_agent_start")!({messageType:"extension",prompt:""},x.ctx),undefined,
      "same task facts should not inject redundant reasoning every run");
    const event={toolName:"edit",input:{path:"src/orders/routes/create.ts"}};
    const pre=x.handlers.get("tool_call")!(event,x.ctx);
    assert.equal(pre.block,true);
    assert.match(pre.reason,/ATDD contextual preflight/);
    assert.match(pre.reason,/Trigger proof/);
    // A retry after seeing guidance must not produce an infinite preflight loop.
    assert.equal(x.handlers.get("tool_call")!(event,x.ctx),undefined);
    assert.equal(x.messages.length,0);
  } finally {x.cleanup();}
});

test("Pi observes a bash bypass and sends the applicable rule evidence after the change",()=>{
  const x=sandbox();
  try{
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Update order"},x.ctx);
    // No 'edit' or 'write' call is made. The shell/custom tool modified a file.
    writeFileSync(join(x.cwd,"src/orders/routes/create.ts"),"export const created = true;\n");
    x.handlers.get("tool_execution_end")!({toolName:"bash",isError:false},x.ctx);
    assert.ok(x.messages.some(m=>m.message.customType==="pi-atdd-post-tool-reconciliation"));
    const notice=x.messages.find(m=>m.message.customType==="pi-atdd-post-tool-reconciliation")!;
    assert.match(notice.message.content,/src\/orders\/routes\/create\.ts/);
    assert.match(notice.message.content,/coder\.bun\.security-missing-auth/);
    assert.match(notice.message.content,/not a merge verdict/);
    const count=x.messages.length;
    x.handlers.get("tool_execution_end")!({toolName:"bash",isError:false},x.ctx);
    assert.equal(x.messages.length,count,"unchanged snapshot should not repeatedly prompt");
  } finally {x.cleanup();}
});

test("a new Pi user task resets task-scoped supports rather than inheriting stale activations",()=>{
  const x=sandbox();
  try{
    const start=x.handlers.get("before_agent_start")!;
    const first=start({messageType:"user",prompt:"Perform behavioral review"},x.ctx);
    assert.match(first.message.content,/atdd-bun\.review\.behavioral-reconciliation/);
    const second=start({messageType:"user",prompt:"Update an opaque note"},x.ctx);
    assert.match(second.message.content,/UNKNOWN|unresolved/);
    assert.ok(!second.message.content.includes("atdd-bun.review.behavioral-reconciliation"));
    const untrusted={...x.ctx,isProjectTrusted:()=>false};
    assert.equal(start({messageType:"user",prompt:"Perform review"},untrusted),undefined);
  } finally{x.cleanup();}
});

test("Pi session-tree restoration invalidates old supports and reconstructs a verified task prompt",()=>{
  const x=sandbox();
  try{
    const start=x.handlers.get("before_agent_start")!;
    start({messageType:"user",prompt:"Implement authorization"},x.ctx);
    const resumed={...x.ctx,sessionManager:{getBranch:()=>[
      {type:"message",message:{role:"user",content:[{type:"text",text:"Perform final behavioral review"}]}},
    ]}};
    x.handlers.get("session_tree")!({},resumed);
    const result=start({messageType:"extension",prompt:""},resumed);
    assert.match(result.message.content,/atdd-bun\.review\.behavioral-reconciliation/);
    assert.ok(!result.message.content.includes("coder.bun.security-missing-auth"));
    assert.equal(start({messageType:"extension",prompt:""},resumed),undefined);
  }finally{x.cleanup();}
});
