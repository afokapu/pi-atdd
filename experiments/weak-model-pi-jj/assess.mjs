/** Post-run model-competence gate. Evidence collection may succeed even when agents fail. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessPilotPair, inspectPiJsonl } from '../../src/pilot-validity.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
function evidence(directory) {
  const file = name => join(root, directory, name);
  return {
    summary: JSON.parse(readFileSync(file('summary.json'), 'utf8')),
    coderEvents: inspectPiJsonl(readFileSync(file('coder.jsonl'), 'utf8')),
    reviewerEvents: inspectPiJsonl(readFileSync(file('reviewer.jsonl'), 'utf8')),
    sourceChanged: Boolean(readFileSync(file('driver.diff'), 'utf8').trim()),
  };
}
const verdict = assessPilotPair(evidence('results'), evidence('results-baseline'));
writeFileSync(join(root, 'results', 'pair-validity.json'), JSON.stringify(verdict, null, 2) + '\n');
console.log(JSON.stringify(verdict, null, 2));
if (verdict.status !== 'TOOL_USE_OBSERVED') {
  console.log('::warning::Pi/JJ pilot ' + verdict.status + '; a passing workflow is not evidence of agent success or a graph benefit');
}
