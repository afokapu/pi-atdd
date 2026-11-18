import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lightweight lexical inspection, not an execution probe: retain quoted strings,
// discard comments, and distinguish keyword tokens from text inside strings.
function tokens(source: string): string[] {
  const result: string[] = [];
  const lexer = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g;
  for (const match of source.matchAll(lexer)) {
    const token = match[0];
    if (!token.startsWith('//') && !token.startsWith('/*')) result.push(token);
  }
  return result;
}
function checkDomainImports(domainURL: URL) {
  const root = fileURLToPath(domainURL);
  function checkSpecifier(token: string | undefined, file: string) {
    assert.ok(token && /^['"`]/.test(token), 'domain imports must have inspectable local specifiers: ' + file);
    assert.ok(!token.includes('$' + '{'), 'computed domain imports cannot establish inward dependency direction');
    const specifier = token.slice(1, -1).replace(/\\u([0-9a-f]{4})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
    assert.ok(specifier.startsWith('.'), 'domain must not import external modules: ' + specifier);
    const rel = relative(root, resolve(dirname(file), specifier));
    assert.ok(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel), 'outward domain dependency: ' + specifier);
  }
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!/\.[cm]?tsx?$/.test(entry.name)) continue;
      const ts = tokens(readFileSync(file, 'utf8'));
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] !== 'import' && ts[i] !== 'export' && ts[i] !== 'require') continue;
        if (ts[i + 1] === '.') continue; // import.meta is not an import.
        if (ts[i + 1] === '(') {
          checkSpecifier(ts[i + 2], file);
          assert.ok(ts[i + 3] === ')' || ts[i + 3] === ',', 'computed dynamic import in domain');
          continue;
        }
        if (ts[i] === 'require') continue;
        if (ts[i] === 'import' && /^['"`]/.test(ts[i + 1] ?? '')) { checkSpecifier(ts[i + 1], file); continue; }
        for (let j = i + 1; j < ts.length && ts[j] !== ';'; j++) {
          if (ts[j] === 'from' && /^['"`]/.test(ts[j + 1] ?? '')) { checkSpecifier(ts[j + 1], file); break; }
          if (j > i + 1 && (ts[j] === 'import' || ts[j] === 'export')) break;
        }
      }
    }
  }
  visit(root);
}

import { PointsLedger } from '../src/loyalty/integration/points-ledger.ts';
import { activateCampaign, configureCampaigns } from '../src/loyalty/integration/campaigns.ts';
const defaults = { 'double-points': 2, 'summer-boost': 1.5 };
async function awardFunction() {
  const module = await import('../src/loyalty/application/award-points.ts');
  assert.equal(typeof module.awardOrderPoints, 'function');
  return module.awardOrderPoints;
}
function restore() { configureCampaigns(defaults); activateCampaign(null); }

test('oracle: loyalty domain static, dynamic and re-export dependencies stay inside the domain', () => {
  checkDomainImports(new URL('../src/loyalty/domain/', import.meta.url));
});

test('oracle: award credits the specified ledger and customer, floors base points before applying a fractional campaign', async () => {
  try {
    configureCampaigns({ 'fractional-79': 1.75 });
    activateCampaign('fractional-79');
    const award = await awardFunction();
    const ledger = new PointsLedger();
    const separateLedger = new PointsLedger();
    ledger.credit('customer-79', 11);
    ledger.credit('other-79', 6);
    assert.equal(award(ledger, 'customer-79', 399), 5); // floor(3 * 1.75), not floor(3.99 * 1.75).
    assert.equal(ledger.balance('customer-79'), 16);
    assert.equal(ledger.balance('other-79'), 6);
    assert.equal(separateLedger.balance('customer-79'), 0);
    assert.equal(award(ledger, 'customer-79', 101), 1);
    assert.equal(ledger.balance('customer-79'), 17);
    assert.equal(award(ledger, 'other-79', 99), 0);
    assert.equal(ledger.balance('other-79'), 6);
  } finally { restore(); }
});

test('oracle: campaign activation, replacement, and deactivation are observed on each award', async () => {
  try {
    const award = await awardFunction();
    const ledger = new PointsLedger();
    configureCampaigns({ 'live-79': 2.25, 'alternative-79': 0.5 });
    activateCampaign('live-79');
    assert.equal(award(ledger, 'live-customer', 799), 15);
    activateCampaign('alternative-79');
    assert.equal(award(ledger, 'live-customer', 799), 3);
    configureCampaigns({ 'live-79': 1.25 });
    activateCampaign('live-79');
    assert.equal(award(ledger, 'live-customer', 799), 8);
    activateCampaign(null);
    assert.equal(award(ledger, 'live-customer', 799), 7);
    assert.equal(award(ledger, 'live-customer', 0), 0);
    assert.equal(ledger.balance('live-customer'), 33);
  } finally { restore(); }
});
