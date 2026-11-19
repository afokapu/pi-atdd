// Acceptance: acc:pi-atdd:E002-UNIT-004
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadCatalog } from "../src/catalog.ts";
import { ReasoningSession } from "../src/reasoning-context.ts";
import { renderReasoned } from "../src/render-reasoning.ts";

test("Pi package includes a bounded proof chain, canonical guidance and exact source provenance",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-explanation-"));
  try{
    const cfg=loadConfig(cwd),catalog=loadCatalog(cfg.sources,cwd);
    const s=new ReasoningSession(catalog,cfg.selectors);
    const result=s.observe({scope:"review-one",task:"Final behavioral review",operation:"review",
      origin:"pi-event",provenance:"Pi before_agent_start"});
    assert.ok(result.activations.some(a=>a.id==="reviewer.inspectability.owner"));
    const text=renderReasoned(result,undefined,12_000);
    assert.match(text,/Canonical source:/);
    assert.match(text,/Pinned provenance SHA-256: [a-f0-9]{64}/);
    assert.match(text,/Original guidance:/);
    assert.match(text,/Authoritative dependency path:/);
    assert.match(text,/owner-inspection evidence is checked/);
    assert.match(text,/Trigger proof:/);
    assert.match(text,/Required evidence:/);
    assert.match(text,/not a merge verdict/);
    assert.ok(text.length<=12_000);
    const small=renderReasoned(result,undefined,1_200);
    assert.ok(small.length<=1_200);
    assert.match(small,/omitted|incomplete/i);
  }finally{rmSync(cwd,{recursive:true,force:true})}
});
