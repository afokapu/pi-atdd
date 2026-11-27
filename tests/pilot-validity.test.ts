// URN: test:pi-atdd:evaluate-delivery:d008-a01
// Acceptance: acc:pi-atdd:d008-a01
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessPilotPair, inspectPiJsonl, type SmokeEvidence } from '../src/pilot-validity.ts';

const quiet = { started: 0, finished: 0 };
const active = { started: 1, finished: 1 };
function smoke(): SmokeEvidence {
  return {
    summary: {
      model: 'weak-coder', baselineAcceptanceRed: true,
      coder: { exit: 0, acceptanceExit: 1 }, reviewer: { exit: 0 },
      jj: { exactDriverParent: true, staleHeadDetected: true, mainUnchanged: true, originalIntegrationHead: 'abc' },
    },
    coderEvents: quiet, reviewerEvents: quiet, sourceChanged: false,
  };
}
test('a JSON-shaped model message does not count as an executed Pi tool', () => {
  const fake = JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '{"type":"tool_execution_start"}' }] } });
  assert.deepEqual(inspectPiJsonl(fake), quiet);
  assert.deepEqual(inspectPiJsonl('not json\n' + JSON.stringify({ type: 'tool_call' }) + '\n'), quiet);
  assert.deepEqual(inspectPiJsonl(JSON.stringify({ type: 'tool_execution_start' }) + '\n' + JSON.stringify({ type: 'tool_execution_end' })), active);
});
test('both zero-tool conditions are unqualified, regardless of zero subprocess exit', () => {
  const result = assessPilotPair(smoke(), smoke());
  assert.equal(result.status, 'UNQUALIFIED_TOOL_USE');
  assert.equal(result.toolUseQualified, false);
  assert.equal(result.d008, 'NOT_ESTABLISHED');
  assert.ok(result.reasons.some(reason => reason.includes('no completed Pi coder tool execution')));
});
test('a single tool-using condition is not a qualified paired smoke', () => {
  const graph = smoke(); graph.coderEvents = active; graph.reviewerEvents = active;
  assert.equal(assessPilotPair(graph, smoke()).status, 'UNQUALIFIED_TOOL_USE');
});
test('real completed tool events qualify only the exploratory smoke, never D008', () => {
  const graph = smoke(); const baseline = smoke();
  graph.coderEvents = active; graph.reviewerEvents = active;
  baseline.coderEvents = active; baseline.reviewerEvents = active;
  graph.sourceChanged = true; graph.summary.coder.acceptanceExit = 0;
  const result = assessPilotPair(graph, baseline);
  assert.equal(result.status, 'TOOL_USE_OBSERVED');
  assert.equal(result.toolUseQualified, true);
  assert.equal(result.d008, 'NOT_ESTABLISHED');
});
test('mismatched model or failed JJ harness is invalid even with real tool events', () => {
  const graph = smoke(); const baseline = smoke();
  graph.coderEvents = active; graph.reviewerEvents = active;
  baseline.coderEvents = active; baseline.reviewerEvents = active;
  baseline.summary.model = 'other-model';
  assert.equal(assessPilotPair(graph, baseline).status, 'INVALID_HARNESS');
  baseline.summary.model = 'weak-coder'; baseline.summary.jj.mainUnchanged = false;
  assert.equal(assessPilotPair(graph, baseline).status, 'INVALID_HARNESS');
});
