// PLT-126: post-tool reconciliation must stay bounded.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";

const CAP=20_000;
function sandbox(){
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-flood-"));
  const git=(...a:string[])=>execFileSync("git",a,{cwd,encoding:"utf8"});
  git("init","-q");git("config","user.name","t");git("config","user.email","t@example.invalid");
  writeFileSync(join(cwd,".gitignore"),"dist/\n");
  mkdirSync(join(cwd,"src/orders/routes"),{recursive:true});
  writeFileSync(join(cwd,"src/orders/routes/create.ts"),"export const a = 1;\n");
  git("add",".");git("commit","-qm","base");
  const handlers=new Map<string,Function>();
  const messages:Array<{message:{customType:string;content:string}}>=[];
  atdd({on:(n:string,f:Function)=>{handlers.set(n,f);},registerCommand:()=>{},registerTool:()=>{},
    sendMessage:(m:any)=>messages.push({message:m})} as any);
  const ctx={cwd,isProjectTrusted:()=>true,ui:{notify:()=>{}}};
  handlers.get("before_agent_start")!({messageType:"user",prompt:"Implement authorization"},ctx);
  const result=(toolName:string,id:string)=>{
    const r=handlers.get("tool_result")!({toolName,toolCallId:id,content:[{type:"text",text:"ok"}]},ctx);
    return (r?.content??[]).map((c:any)=>c.text).join("\n\n") as string;
  };
  return {cwd,result,ctx,handlers,messages,cleanup:()=>rmSync(cwd,{recursive:true,force:true})};
}
function burst(cwd:string,n:number,dir="src/orders/routes"){
  mkdirSync(join(cwd,dir),{recursive:true});
  for(let i=0;i<n;i++)writeFileSync(join(cwd,dir,"f"+i+".ts"),"export const v"+i+" = "+i+";\n");
}

test("a burst of 120 changed paths is capped with a one-line summary",()=>{
  const x=sandbox();
  try{
    x.result("bash","0");
    burst(x.cwd,120);
    const out=x.result("bash","1");
    assert.ok(out.length<=CAP+500,"hook text "+out.length+" exceeds cap");
    assert.match(out,/ATDD: \d+ more changed file/);
  }finally{x.cleanup();}
});

test("git-ignored build output is not reconciled as source",()=>{
  const x=sandbox();
  try{
    x.result("bash","0");
    burst(x.cwd,100,"dist/assets");
    const out=x.result("bash","1");
    assert.ok(!out.includes("dist/"),"dist output was reconciled");
  }finally{x.cleanup();}
});

test("read-only tools never receive pending redelivery and the queue drains",()=>{
  const x=sandbox();
  try{
    x.result("bash","0");
    burst(x.cwd,60);
    x.result("bash","1");
    for(let i=0;i<5;i++){
      const out=x.result("read","r"+i);
      assert.equal(out,"","read-only call "+i+" carried hook text");
    }
    let last="";
    for(let i=0;i<6;i++)last=x.result("bash","b"+i);
    assert.equal(last,"","queue did not drain after bounded redeliveries");
  }finally{x.cleanup();}
});
