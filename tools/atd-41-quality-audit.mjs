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
  "src/activation-telemetry.ts",
  "tools/atd-41-observation-envelope.ts",
  "src/operational-observers.ts",
  "src/layer-import-observer.ts",
  "src/validator-observer.ts",
  "src/pi-activation.ts",
  "src/reasoning-context.ts",
  "src/render-reasoning.ts",
  "src/shell-targets.ts",
  "tools/profile-naming/probe.ts",
  "tools/sidecar-activation-matrix.ts",
  "tools/sidecar-witness-replay.ts",
];
// These functions are new or substantively expanded in the ATD-41 patch.
// Metrics for legacy top-level Pi hosts are reported by the native checker but
// are not silently counted as newly introduced code-quality debt.
const reviewFunctions=new Set([
  // All newly introduced named source-observer functions, not just examples.
  "observationEnvelope","generatedMarker","testMarker","classifyFileKind",
  "sourceSyntaxEvidence","domainPrefix","staticSpecifier","collectStaticImport",
  "markDynamicUnknowns","scanDomainImports","observeDomainImports",
  "safeCatHeader","parseStaticHeredocHeader","readStaticHeredoc","shellStaticWriteContents",
  // Datalog fact origin / trust boundary and adapter rule construction.
  "hierarchyObservationRules","typedRules","validateIdentity","validateSourcePair",
  "validateProviderEvidence","validateDetectorEvidence","validateObservation",
  "ReasoningSession.sourceInputs","ReasoningSession.syntaxInputs","ReasoningSession.changeInputs",
  "ReasoningSession.findingInputs","ReasoningSession.selectorInputs","ReasoningSession.inputs",
  "architectureExcludedBySource",
  // ATD-22 follow-up: the live validator, generic layer scan and witness replay.
  "validRevision","validateImportBoundary","roleInPath","specifierOf",
  "collect","dynamicUnknowns","scan","observeOutwardImports",
  "replayQualifiedSidecarWitnesses","fullWitnessGapSummary",
  // Existing Pi and telemetry functions touched by Stream B.
  "sourceFor","beforeSource","preflightPath","observe","recordReasoned","evidenceIds",
  "safeSessionId","safeReasonCode","safeCatalogDigest","safeDurationMs",
  "sanitizedRecord","countLine","countFile",
  "isDisabled","root","activationLogPath","appendActivation","activationSummary",
  "formatActivationSummary",
]);
if(!existsSync(metricFile))throw Error("pinned ATDD-Bun metrics unavailable; run after source checkout");
const revision=spawnSync("git",["rev-parse","HEAD"],{cwd:upstream,encoding:"utf8",shell:false});
if(revision.status!==0||revision.stdout.trim()!==pin)
  throw Error("ATDD-Bun metrics source pin mismatch: "+revision.stdout.trim());
const m=await import(pathToFileURL(metricFile).href);
const records=[], findings=[], measuredFunctions=new Set();
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
    let name=null,bodyNode=node.body;
    if(ts.isFunctionDeclaration(node)&&node.name)name=node.name.text;
    if(ts.isMethodDeclaration(node)&&node.name)name=(className?className+".":"")+node.name.getText(ast);
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&
      (ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer))){
      name=node.name.text;
      bodyNode=node.initializer.body;
    }
    if(name&&reviewFunctions.has(name)&&bodyNode){
      measuredFunctions.add(name);
      const body=bodyNode.getText(ast);
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

const testFiles=[
  "tests/activation-telemetry.test.ts",
  "tests/operational-activation.test.ts",
  "tests/operational-observers.test.ts",
  "tests/layer-import-observer.test.ts",
  "tests/sidecar-witness-replay.test.ts",
  "tests/validator-observer.test.ts",
  "tests/pi-activation.test.ts",
  "tests/reasoning-context.test.ts",
  "tests/sidecar-activation-matrix.test.ts",
];
// The shared-state and self-skip rules are stack-neutral. This scan checks
// observable forbidden syntax; filesystem path provenance remains reviewer work.
function envTarget(node){
  return ts.isPropertyAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text==="process" &&
    node.expression.name.text==="env";
}
let isolationChecks=0;
for(const file of testFiles){
  const source=readFileSync(resolve(file),"utf8");
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  if(ast.parseDiagnostics?.length)throw Error("cannot audit test syntax: "+file);
  const visit=node=>{
    const assign=ts.isBinaryExpression(node)&&
      node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind<=ts.SyntaxKind.LastAssignment &&
      envTarget(node.left);
    const remove=ts.isDeleteExpression(node)&&envTarget(node.expression);
    const skip=ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
      node.expression.name.text==="skip" &&
      ts.isIdentifier(node.expression.expression)&&
      ["test","it","describe"].includes(node.expression.expression.text);
    isolationChecks++;
    if(assign||remove||skip){
      const line=ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;
      findings.push({rule:skip?"tester.test.no-self-skip":"tester.test.isolation-no-live-state",file,line});
    }
    ts.forEachChild(node,visit);
  };
  visit(ast);
}

// Fail closed if a refactor renamed a tracked function without updating the audit.
const missed=[...reviewFunctions].filter(name=>!measuredFunctions.has(name));
if(missed.length)throw Error("source metric coverage lost for "+missed.join(", "));
const totals={files:sourceFiles.length,checks:records.length,findings:findings.length,
  namedFunctionsCovered:measuredFunctions.size,
  testFiles:testFiles.length,testSyntaxChecks:isolationChecks,
  algorithmSource:pin,nonAutomated:[
    "semantic_behavioral_review","complete_sidecar_acceptance","real_validator_result_ingestion",
    "whole_repo_Bun_app_profile_not_applicable_to_Node_Pi",
  ]};
for(const entry of findings)process.stdout.write("ATD41_CONVENTION_FINDING "+JSON.stringify(entry)+"\n");
process.stdout.write("ATD41_CONVENTION_SOURCE_AUDIT "+JSON.stringify(totals)+"\n");
// Exit failure on --enforce only after the findings have been remediated.
// The report is not a substitute for independent reviewer approval.
if(process.argv.includes("--enforce")&&findings.length)process.exitCode=1;
