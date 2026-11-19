#!/usr/bin/env bash
set -euo pipefail
export JJ_PAGER=cat GIT_PAGER=cat PI_TELEMETRY=0 PI_SKIP_VERSION_CHECK=1 JJ_EDITOR=true
ROOT="$RUNNER_TEMP/weak-model-pi-jj-baseline"
COORD="$ROOT/coordinator"; DRIVER="$ROOT/driver"; REVIEWER="$ROOT/reviewer"
RESULTS="$GITHUB_WORKSPACE/experiments/weak-model-pi-jj/results-baseline"
mkdir -p "$COORD/src/orders/domain" "$COORD/test" "$RESULTS"
export HOME="$ROOT/home"
mkdir -p "$HOME/.pi/agent"
cat > "$HOME/.pi/agent/models.json" <<'JSON'
{
 "providers": {
   "local-weak": {
     "baseUrl":"http://127.0.0.1:8081/v1","api":"openai-completions","apiKey":"local-only",
     "compat":{"supportsDeveloperRole":false,"supportsReasoningEffort":false},
     "models":[{"id":"weak-coder","name":"Qwen2.5-Coder-0.5B-Instruct-Q4_K_M",
       "reasoning":false,"input":["text"],
       "cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},
       "contextWindow":16384,"maxTokens":1024}]
   }
 }
}
JSON
cat > "$COORD/package.json" <<'JSON'
{"name":"two-agent-smoke","version":"0.0.0","private":true,"type":"module"}
JSON
cat > "$COORD/src/orders/domain/format-order-id.ts" <<'TS'
export function formatOrderId(value: string): string {
  return value.trim();
}
TS
cat > "$COORD/test/order-id.test.mjs" <<'JS'
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOrderId } from "../src/orders/domain/format-order-id.ts";
test("normalize case, spaces and underscores as one separator", () => {
  assert.equal(formatOrderId("  ACME__ 42  "), "acme-42");
});
test("already normalized identifiers remain unchanged", () => {
  assert.equal(formatOrderId("order-12"), "order-12");
});
test("blank or punctuation-only identifiers are rejected", () => {
  assert.throws(() => formatOrderId("  __ --  "), /empty|invalid|characters|identifier/i);
});
JS
git -C "$COORD" init -q -b main
git -C "$COORD" config user.name "ATDD experimental base"
git -C "$COORD" config user.email "experiment@example.invalid"
git -C "$COORD" add .
git -C "$COORD" commit -qm "fixture: independent failing order ID acceptance"
jj config set --user user.name "ATDD experiment"
jj config set --user user.email "experiment@example.invalid"
(cd "$COORD" && jj git init --colocate)
jj -R "$COORD" bookmark create integration/demo -r main
BASE="$(jj -R "$COORD" log -r integration/demo --no-graph -T 'commit_id')"
jj -R "$COORD" workspace add "$DRIVER" --name driver -r integration/demo
ACTUAL_BASE="$(jj -R "$DRIVER" log -r '@-' --no-graph -T 'commit_id')"
if [ "$BASE" != "$ACTUAL_BASE" ]; then
  echo "JJ_ERROR: driver parent not equal to coordinator head"; exit 25
fi
echo "JJ driver exact parent: $BASE"
set +e
(cd "$DRIVER" && node --experimental-strip-types --test test/order-id.test.mjs) > "$RESULTS/before-tests.txt" 2>&1
BEFORE=$?
set -e
if [ "$BEFORE" -eq 0 ]; then echo "FIXTURE_ERROR: tests already green"; exit 26; fi

PI="$GITHUB_WORKSPACE/node_modules/.bin/pi"
EXTENSION="$GITHUB_WORKSPACE/extensions/atdd.ts"
CODER_PROMPT="You are the CODER agent working on a disposable JJ driver workspace. Implement GREEN behavior in src/orders/domain/format-order-id.ts only. Contract: trim and lowercase an order ID, replace consecutive spaces and underscores with a single hyphen, collapse repeated hyphens, and reject identifiers with no letters or digits by throwing Error('invalid identifier'). Independent tests in test/order-id.test.mjs must not be edited. Use built-in read/edit/bash tools to make the smallest change and run node --experimental-strip-types --test test/order-id.test.mjs. Do not merge or change integration head."
REVIEWER_PROMPT="You are the REVIEWER agent (different process and JJ workspace). Independently examine the delivered source and run node --experimental-strip-types --test test/order-id.test.mjs. Compare the observable result against intent: lowercase normalized IDs, collapse separators, reject blank strings. Do not edit any file, do not merge, and finish with APPROVE or RETURN and the evidence."

set +e
(cd "$DRIVER" && timeout -k 10s 260s "$PI" --mode json --approve --no-session --no-mcp \
 --no-skills --no-prompt-templates --no-context-files --no-themes \
 --no-extensions --provider local-weak --model weak-coder --api-key local-only \
 --thinking off "$CODER_PROMPT") > "$RESULTS/coder.jsonl" 2> "$RESULTS/coder.stderr"
CODER_EXIT=$?
set -e
jj -R "$DRIVER" status > "$RESULTS/driver-status.txt" 2>&1 || true
jj -R "$DRIVER" describe -m "Agent delivery: order ID normalization" >/dev/null
DELIVERY="$(jj -R "$DRIVER" log -r @ --no-graph -T 'commit_id')"
jj -R "$DRIVER" diff --from "$BASE" --to "$DELIVERY" > "$RESULTS/driver.diff" 2>&1 || true
set +e
(cd "$DRIVER" && node --experimental-strip-types --test test/order-id.test.mjs) > "$RESULTS/after-coder-tests.txt" 2>&1
CODER_TESTS_EXIT=$?
set -e

jj -R "$COORD" workspace add "$REVIEWER" --name reviewer -r "$DELIVERY"
REVIEWER_BASE="$(jj -R "$REVIEWER" log -r '@-' --no-graph -T 'commit_id')"
if [ "$REVIEWER_BASE" != "$DELIVERY" ]; then echo "JJ_ERROR: reviewer parent not equal to delivery"; exit 27; fi
set +e
(cd "$REVIEWER" && timeout -k 10s 200s "$PI" --mode json --approve --no-session --no-mcp \
 --no-skills --no-prompt-templates --no-context-files --no-themes \
 --no-extensions --tools read,bash,grep,ls \
 --provider local-weak --model weak-coder --api-key local-only \
 --thinking off "$REVIEWER_PROMPT") > "$RESULTS/reviewer.jsonl" 2> "$RESULTS/reviewer.stderr"
REVIEWER_EXIT=$?
set -e

jj -R "$COORD" new integration/demo >/dev/null
jj -R "$COORD" bookmark set integration/demo -r @ >/dev/null
NEW_HEAD="$(jj -R "$COORD" log -r integration/demo --no-graph -T 'commit_id')"
STALE="false"
if [ "$ACTUAL_BASE" != "$NEW_HEAD" ]; then STALE="true"; fi
MAIN_UNCHANGED="false"
MAIN="$(jj -R "$COORD" log -r main --no-graph -T 'commit_id')"
if [ "$MAIN" = "$BASE" ]; then MAIN_UNCHANGED="true"; fi
export RESULTS CODER_EXIT REVIEWER_EXIT CODER_TESTS_EXIT STALE MAIN_UNCHANGED BASE DELIVERY NEW_HEAD
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir=process.env.RESULTS;
function inspect(file) {
  const raw=readFileSync(join(dir,file),'utf8');
  const events=raw.split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}});
  const tools=events.filter(x=>x.type==='tool_execution_start'||x.type==='tool_call'||x.type==='tool_call_start');
  const responses=events.filter(x=>x.type==='message_end'&&x.message?.role==='assistant');
  const parts=responses.at(-1)?.message?.content;
  const text=Array.isArray(parts)?parts.filter(x=>x.type==='text').map(x=>x.text).join('\n'):'';
  return {events:events.length,toolEvents:tools.length,finalText:text.slice(0,1800)};
}
const summary={
  kind:'real-local-weak-model-baseline-no-atdd',
  model:'Qwen2.5-Coder-0.5B-Instruct-Q4_K_M',
  diagnosticProxy:true,
  atddExtensionLoaded:false,
  agentRuntime:'two independent Pi CLI processes without pi-atdd extension, same local llama.cpp server',
  baselineAcceptanceRed:true,
  coder:{exit:Number(process.env.CODER_EXIT),acceptanceExit:Number(process.env.CODER_TESTS_EXIT),...inspect('coder.jsonl')},
  reviewer:{exit:Number(process.env.REVIEWER_EXIT),...inspect('reviewer.jsonl')},
  jj:{exactDriverParent:true,delivery:process.env.DELIVERY,
    originalIntegrationHead:process.env.BASE,newIntegrationHead:process.env.NEW_HEAD,
    staleHeadDetected:process.env.STALE==='true',mainUnchanged:process.env.MAIN_UNCHANGED==='true'},
  caveat:'One real-model two-agent smoke task, not the full paired D008 model-effectiveness experiment.'
};
writeFileSync(join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2).slice(0,4000));
JS
