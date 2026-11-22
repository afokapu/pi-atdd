/**
 * ATD-41 source-quality evidence, not a blanket compliance/admission verdict.
 * Reuse the exact TypeScript metric algorithms at the pinned ATDD-Bun source.
 * This Node/Pi project does not become a Bun application by running the checks.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const pin="5945d97e18310e7c862c08e73985400935d21346";
const upstream=resolve(".cache-sources/atdd-bun");
const metricFile=resolve(upstream,"detectors/bun_ts_metrics_detector/ts_metrics.mjs");
const sourceFiles=[
  "src/observation-envelope.ts",
  "src/operational-observers.ts",
  "src/pi-activation.ts",
  "src/reasoning-context.ts",
  "src/render-reasoning.ts",
  "src/shell-targets.ts",
  "tools/profile-naming/probe.ts",
  "tools/sidecar-activation-matrix.ts",
];
// These functions are new or substantively expanded in the ATD-41 patch.
// Metrics for legacy top-level Pi hosts are reported by the native checker but
// are not silently counted as newly introduced code-quality debt.
const reviewFunctions=new Set([
  "observationEnvelope","scanDomainImports","observeDomainImports",
  "classifyFileKind","sourceSyntaxEvidence","shellStaticWriteContents",
  "validateObservation","hierarchyObservationRules","typedRules",
  "ReasoningSession.inputs","ReasoningSession.sourceInputs",
  "ReasoningSession.selectorInputs",
]);
if(!existsSync(metricFile))throw Error("pinned ATDD-Bun metrics unavailable; run after source checkout");
const revision=spawnSync("git",["rev-parse","HEAD"],{cwd:upstream,encoding:"utf8",shell:false});
if(revision.status!==0||revision.stdout.trim()!==pin)
  throw Error("ATDD-Bun metrics source pin mismatch: "+revision.stdout.trim());
const m=await import(pathToFileURL(metricFile).href);
const records=[], findings=[];
for(const file of sourceFiles){
  const source=readFileSync(resolve(file),"utf8");
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const diagnostics=ast.parseDiagnostics??[];
  if(diagnostics.length)throw Error("cannot audit unparseable source: "+file);
  const ratio=m.commentRatio(source), mi=m.maintainabilityIndex(source);
  records.push({rule:"coder.quality.comments",file,measured:ratio,threshold:0.10});
  records.push({rule:"coder.quality.mi",file,measured:mi,threshold:20});
  if(ratio<0.10)findings.push({rule:"coder.quality.comments",file,measured:ratio});
  if(mi<20)findings.push({rule:"coder.quality.mi",file,measured:mi});
  // Official checker implementation does not recognize class methods.
  // Also test specifically changed methods with identical numeric functions.
  const visit=(node,className="")=>{
    let name=null;
    if(ts.isFunctionDeclaration(node)&&node.name)name=node.name.text;
    if(ts.isMethodDeclaration(node)&&node.name)name=(className?className+".":"")+node.name.getText(ast);
    if(name&&reviewFunctions.has(name)&&node.body){
      const body=node.getText(ast);
      const line=m.countCodeLines(body);
      const cc=m.cyclomatic(body);
      const depth=m.nestingDepth(body);
      for(const [rule,measure,limit] of [
        ["coder.complexity.length",line,50],
        ["coder.complexity.cyclomatic",cc,10],
        ["coder.complexity.nesting",depth,4]
      ]){
        records.push({rule,file,function:name,measured:measure,threshold:limit});
        if(measure>limit)findings.push({rule,file,function:name,measured:measure,threshold:limit});
      }
    }
    const next=ts.isClassDeclaration(node)&&node.name?node.name.text:className;
    ts.forEachChild(node,n=>visit(n,next));
  };
  visit(ast);
  const actualConsole=[];
  const scan=n=>{
    if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)
      &&ts.isIdentifier(n.expression.expression)&&n.expression.expression.text==="console"
      &&["log","info","warn","error","debug","trace","dir"].includes(n.expression.name.text))
      actualConsole.push(ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1);
    ts.forEachChild(n,scan);
  };
  scan(ast);
  records.push({rule:"coder.logging.console",file,measured:actualConsole.length,threshold:0});
  for(const line of actualConsole)findings.push({rule:"coder.logging.console",file,line});
}
const totals={files:sourceFiles.length,checks:records.length,findings:findings.length,
  algorithmSource:pin,nonAutomated:[
    "semantic_behavioral_review","complete_sidecar_acceptance","real_validator_result_ingestion",
    "whole_repo_Bun_app_profile_not_applicable_to_Node_Pi",
  ]};
for(const entry of findings)process.stdout.write("ATD41_CONVENTION_FINDING "+JSON.stringify(entry)+"\n");
process.stdout.write("ATD41_CONVENTION_SOURCE_AUDIT "+JSON.stringify(totals)+"\n");
// Exit failure on --enforce only after the findings have been remediated.
// The report is not a substitute for independent reviewer approval.
if(process.argv.includes("--enforce")&&findings.length)process.exitCode=1;
