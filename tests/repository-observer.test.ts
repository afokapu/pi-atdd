// Acceptance: acc:pi-atdd:E002-INTEGRATION-006
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeRepository } from "../src/repository-observer.ts";

function setup() {
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-repo-watch-"));
  const git=(...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"});
  git("init","-q"); git("config","user.name","Test reviewer"); git("config","user.email","test@example.invalid");
  writeFileSync(join(cwd,"app.ts"),"export const answer = 1;\n");
  git("add","app.ts");git("commit","-qm","initial");
  return {cwd,git,finish:()=>rmSync(cwd,{recursive:true,force:true})};
}
test("read-only observation detects shell bypass with dirty and committed changes",()=>{
  const t=setup();
  try {
    const start=observeRepository(t.cwd);
    assert.equal(start.status,"observed");
    assert.deepEqual(start.changedPaths,[]);
    assert.ok(start.snapshot?.revision);
    writeFileSync(join(t.cwd,"app.ts"),"export const answer = 2;\n");
    const edit=observeRepository(t.cwd,start.snapshot);
    assert.equal(edit.status,"observed");
    assert.deepEqual(edit.changedPaths,["app.ts"]);
    t.git("add","app.ts");t.git("commit","-qm","shell-bypassed");
    const committed=observeRepository(t.cwd,edit.snapshot);
    assert.deepEqual(committed.changedPaths,["app.ts"]);
    assert.notEqual(committed.snapshot?.revision,start.snapshot?.revision);
    writeFileSync(join(t.cwd,"untracked.test.ts"),"export {}\n");
    const untracked=observeRepository(t.cwd,committed.snapshot);
    assert.deepEqual(untracked.changedPaths,["untracked.test.ts"]);
  } finally {t.finish();}
});
test("absent VCS returns UNKNOWN, never 'no changed files'",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-unknown-vcs-"));
  try {
    const r=observeRepository(cwd);
    assert.equal(r.status,"unknown");
    assert.ok(r.reason?.includes("cannot be independently observed"));
  } finally {rmSync(cwd,{recursive:true,force:true});}
});
