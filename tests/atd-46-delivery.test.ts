// URN: test:pi-atdd:deliver-guidance:atd-46
// Acceptance: acc:pi-atdd:atd-46-01
// Acceptance: acc:pi-atdd:atd-46-02
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";
import { digestSource } from "../src/catalog.ts";

function sandbox(count=24) {
  const cwd=mkdtempSync(join(tmpdir(),"atd-46-"));
  const git=(...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"});
  git("init","-q");git("config","user.name","test");git("config","user.email","test@example.invalid");
  mkdirSync(join(cwd,"extra/conventions"),{recursive:true});
  const ids=Array.from({length:count},(_,i)=>"extra.context."+String(i).padStart(count>100?3:2,"0"));
  for(const id of ids)writeFileSync(join(cwd,"extra/conventions",id+".convention.yaml"),[
    "rule_id: "+id,"kind: rule","status: active","statement: Follow "+id+".","content:",
    "  summary: Inspect evidence.","  fix_hint: |",...Array(15).fill("    Inspect evidence and affected behavior before implementation."),"",
  ].join("\n"));
  writeFileSync(join(cwd,"extra/conventions/extra.aaa.current.convention.yaml"),[
    "rule_id: extra.aaa.current","kind: rule","status: active","statement: Current task guidance.",
    "content:","  summary: Current evidence.","  fix_hint: Check the current task.","",
  ].join("\n"));
  const checksum=digestSource(join(cwd,"extra"),"extension");
  writeFileSync(join(cwd,"atdd-pi.yaml"),["schema: pi-atdd/config/v2","sources:","  - id: Extra","    kind: extension","    path: extra","    sha256: "+checksum,"selectors: extra-selectors.yaml",""].join("\n"));
  writeFileSync(join(cwd,"extra-selectors.yaml"),["schema: pi-atdd/selectors/v1","selectors:","  - id: every-rule","    always: true","    rules:",...ids.map(id=>"      - "+id),"  - id: current-rule","    terms: [urgentcurrent]","    rules:","      - extra.aaa.current","      - "+ids[0],""].join("\n"));
  writeFileSync(join(cwd,"target.ts"),"export const x=1;\n");git("add",".");git("commit","-qm","base");
  const handlers=new Map<string,Function>();
  atdd({on:(n:string,f:Function)=>handlers.set(n,f),registerCommand:()=>{},registerTool:()=>{},sendMessage:()=>{}} as any);
  const ctx={cwd,isProjectTrusted:()=>true,ui:{notify:()=>{}}};
  const start=(prompt="continue this task")=>handlers.get("before_agent_start")!({messageType:"user",prompt},ctx)?.message?.content as string;
  const tool=(i:number)=>handlers.get("tool_result")!({toolName:"bash",toolCallId:String(i),content:[{type:"text",text:"ok"}]},ctx)?.content?.map((x:any)=>x.text).join("\n") as string|undefined;
  return {cwd,ids,start,tool,cleanup:()=>rmSync(cwd,{recursive:true,force:true})};
}
const delivered=(text:string)=>[...text.matchAll(/Convention (extra\.context\.\d+) —/g)].map(m=>m[1]!);

test("omitted task rules advance across user turns instead of restarting at the top",()=>{
  const x=sandbox();try{
    const seen=new Set<string>();let first="";
    for(let i=0;i<30&&seen.size<x.ids.length;i++){
      const text=x.start();if(i===0)first=text;
      for(const id of delivered(text))seen.add(id);
    }
    assert.match(first,/omitted by budget/);
    assert.deepEqual([...seen].sort(),x.ids);
  }finally{x.cleanup();}
});

test("a changed proof for an active rule is delivered once, without repeating unchanged proofs",()=>{
  const x=sandbox();try{
    const first=x.start();
    assert.match(first,/Convention extra\.context\.00 —/);
    const changed=x.start("urgentcurrent");
    assert.match(changed,/Convention extra\.context\.00 —/);
    assert.match(changed,/current-rule/);
    const same=x.start("urgentcurrent");
    assert.doesNotMatch(same,/Convention extra\.context\.00 —/);
  }finally{x.cleanup();}
});

test("many turns do not defer a newly relevant current rule behind old scopes",(t)=>{
  const x=sandbox();
  t.mock.timers.enable({apis:["Date"],now:Date.now()});
  try{
    for(let i=0;i<50;i++){x.start();t.mock.timers.tick(1000);}
    const current=x.start("urgentcurrent");
    assert.match(current,/Convention extra\.aaa\.current —/);
    const scope=current.match(/Task scope: (.*); state:/)?.[1];
    assert.match(scope??"",/:task$/);
    assert.equal(scope,"pi-run:51:task");
  }finally{t.mock.timers.reset();x.cleanup();}
});

test("task queue overflow is explicitly disclosed with a retrieval path",()=>{
  const x=sandbox(260);try{
    const page=x.start();
    assert.match(page,/task guidance queue overflow: 4/);
    assert.match(page,/atdd context --task/);
  }finally{x.cleanup();}
});

test("post-tool queue overflow is disclosed instead of growing without bound",()=>{
  const x=sandbox();try{
    x.start();
    for(let i=0;i<270;i++)writeFileSync(join(x.cwd,`overflow${i}.ts`),"export const x=1;\n");
    const page=x.tool(300)??"";
    assert.match(page,/post-tool guidance queue overflow/);
    assert.match(page,/atdd context --task/);
  }finally{x.cleanup();}
});

test("output cap does not mark hidden changed-file guidance delivered",()=>{
  const x=sandbox();try{
    x.start();
    for(let i=0;i<12;i++)writeFileSync(join(x.cwd,`file${i}.ts`),"export const x=1;\n");
    const chunks=[x.tool(100)??""];
    for(let i=0;i<180;i++)chunks.push(x.tool(101+i)??"");
    for(let i=0;i<12;i++){
      const section=chunks.join("\n").split(/ATDD post-tool reconciliation(?: \(continued\))?\. Changed file /)
        .filter(part=>part.startsWith(`file${i}.ts:`)).join("\n");
      assert.deepEqual([...new Set(delivered(section))].sort(),x.ids,`file${i}.ts`);
    }
  }finally{x.cleanup();}
});

test("post-tool continuation does not claim to block an edit and drains beyond two pages",()=>{
  const x=sandbox();try{
    x.start();writeFileSync(join(x.cwd,"target.ts"),"export const x=2;\n");
    const first=x.tool(0)??"";assert.match(first,/omitted by budget/);
    assert.doesNotMatch(first,/Retries must receive remaining reasoning before the edit can proceed/);
    const seen=new Set(delivered(first));
    x.start(); // A later user turn must not discard the pending file scope.
    for(let i=1;i<40&&seen.size<x.ids.length;i++)for(const id of delivered(x.tool(i)??""))seen.add(id);
    assert.deepEqual([...seen].sort(),x.ids);
  }finally{x.cleanup();}
});
