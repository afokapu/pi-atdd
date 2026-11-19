#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error('Usage: node run-hidden.mjs <resultTreeDir> <outDir>');
  process.exit(2);
}
const input = resolve(inputArg), output = resolve(outputArg);
// Prevent recursively copying an output directory placed inside the input.
if (output === input || output.startsWith(input + sep)) {
  console.error('outDir must not be inside resultTreeDir'); process.exit(2);
}
const catalog = JSON.parse(await readFile(join(here, 'hidden/cases.json'), 'utf8'));
await mkdir(output, { recursive: true });
let log = '', exitCode = null, timedOut = false, work;
const storeFile = join(output, `.store-calls-${process.pid}-${Date.now()}.json`);
try {
  // Retained for reproducibility, never edited in the submitted result tree.
  work = await mkdtemp(join(output, '.hidden-run-'));
  const tree = join(work, 'result');
  await cp(input, tree, { recursive: true });
  // Remove only a destination inside our disposable copy, never input files.
  await rm(join(tree, 'evaluator-hidden'), { recursive: true, force: true });
  await cp(join(here, 'hidden'), join(tree, 'evaluator-hidden'), { recursive: true });
  const child = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap', 'evaluator-hidden/acceptance.test.ts'], {
    cwd: tree,
    env: { ...process.env, EVALUATOR_STORE_CALLS: storeFile, FORCE_COLOR: '0', NODE_OPTIONS: '' },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise(resolveRun => {
    const timeout = setTimeout(() => {
      timedOut = true;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, 120000);
    child.stdout.on('data', chunk => { log += chunk.toString(); });
    child.stderr.on('data', chunk => { log += chunk.toString(); });
    child.on('error', error => { log += `\nRunner spawn error: ${error.stack}\n`; });
    child.on('close', code => { clearTimeout(timeout); exitCode = code; resolveRun(); });
  });
} catch (error) {
  log += `\nRunner setup error: ${error.stack}\n`;
}
// A fixed catalog ensures syntax/import failures still yield one failed result
// per counted test, not a misleading zero-test summary.
const passedNames = new Set([...log.matchAll(/^ok \d+ - (.+)\r?$/gm)].map(m => m[1].trim()));
const tests = catalog.map(c => ({ ...c, pass: !timedOut && passedNames.has(c.name) }));
const traps = {};
for (const t of tests.filter(t => t.counts)) {
  const entry = traps[t.trap] ??= { pass: 0, total: 0 };
  entry.total++; if (t.pass) entry.pass++;
}
let storeCalls;
try { storeCalls = JSON.parse(await readFile(storeFile, 'utf8')); }
catch { storeCalls = { unavailable: true, reason: 'Measurement test did not produce a record (see hidden.log).' }; }
const result = {
  tests,
  summary: {
    pass: tests.filter(t => t.pass).length,
    fail: tests.filter(t => !t.pass).length,
    countedPass: tests.filter(t => t.counts && t.pass).length,
    countedTotal: tests.filter(t => t.counts).length,
  },
  traps, storeCalls,
  run: { exitCode, timedOut, workDirectory: work ?? null },
};
await writeFile(join(output, 'hidden.log'), log);
await writeFile(join(output, 'hidden-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.summary));
