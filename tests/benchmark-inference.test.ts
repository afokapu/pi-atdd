// Acceptance: acc:pi-atdd:E002-UNIT-003
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { loadCatalog, loadConfig } from "../src/catalog.ts";
import { ReasoningSession } from "../src/reasoning-context.ts";

test("pinned full corpus: incremental update agrees with cold replay and reports time/memory",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-update-benchmark-"));
  try {
    const cfg=loadConfig(cwd),catalog=loadCatalog(cfg.sources,cwd);
    assert.equal(catalog.rules.size,358);
    assert.equal(catalog.edges.length,508);
    const metrics=[];
    for(let i=0;i<3;i++){
      const scope="bench-"+i, hot=new ReasoningSession(catalog,cfg.selectors);
      const old={scope,task:"Update order model",path:"src/shop/domain/order.ts",operation:"edit" as const,
        origin:"pi-event" as const,provenance:"controlled-edit"};
      const next={...old,path:"src/shop/infrastructure/service.ts"};
      const oldResults=hot.observe(old);
      assert.ok(oldResults.activations.some(a=>a.id==="coder.bun.design-hierarchy-import"));
      const start=performance.now();
      const incremental=hot.observe(next);
      const updateMs=performance.now()-start;
      const coldStart=performance.now();
      const fresh=new ReasoningSession(catalog,cfg.selectors);
      const recomputed=fresh.observe(next);
      const coldMs=performance.now()-coldStart;
      assert.deepEqual(incremental.activations.map(a=>a.id),recomputed.activations.map(a=>a.id));
      assert.ok(incremental.removed.includes("coder.bun.design-hierarchy-import"));
      metrics.push({updateMs:Math.round(updateMs*100)/100,coldMs:Math.round(coldMs*100)/100,
        affected:incremental.stats.affected,scans:incremental.stats.scans,
        heapMiB:Math.round(process.memoryUsage().heapUsed/1024/1024)});
    }
    console.log("pi-atdd full-corpus incremental/cold replay measurements (environment-dependent):",JSON.stringify(metrics));
    assert.ok(metrics.every(m=>Number.isFinite(m.updateMs)&&Number.isFinite(m.coldMs)));
    // No ungrounded performance or model-quality claim based on a microbenchmark.
  }finally{rmSync(cwd,{recursive:true,force:true});}
});
