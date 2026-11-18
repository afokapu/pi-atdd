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

import { quoteForCart } from '../src/pricing/application/quote-service.ts';
import { configureTaxRates } from '../src/pricing/integration/tax-rates.ts';
const defaults = { DE: 0.19, FR: 0.2, US: 0 };

test('oracle: pricing domain static, dynamic and re-export dependencies stay inside the domain', () => {
  checkDomainImports(new URL('../src/pricing/domain/', import.meta.url));
});

test('oracle: quotes use arbitrary live configured rates, quantities, and nearest-cent rounding', () => {
  try {
    configureTaxRates({ 'region-79': 0.137, 'zero-79': 0 });
    const lines = [{ sku: 'first', unitPriceCents: 137, quantity: 3 }, { sku: 'second', unitPriceCents: 29, quantity: 2 }];
    const before = structuredClone(lines);
    const quote = quoteForCart(lines, 'region-79');
    assert.equal(quote.region, 'region-79');
    assert.equal(quote.subtotalCents, 469);
    assert.equal(quote.taxCents, 64);
    assert.equal(quote.totalCents, 533);
    assert.deepEqual(lines, before);
    const zero = quoteForCart(lines, 'zero-79');
    assert.equal(zero.taxCents, 0);
    assert.equal(zero.totalCents, 469);
    const empty = quoteForCart([], 'region-79');
    assert.equal(empty.subtotalCents, 0);
    assert.equal(empty.taxCents, 0);
    assert.equal(empty.totalCents, 0);
  } finally { configureTaxRates(defaults); }
});

test('oracle: reconfiguring an existing region affects subsequent quotes rather than a cached or copied rate', () => {
  try {
    const lines = [{ sku: 'runtime', unitPriceCents: 101, quantity: 1 }];
    for (const rate of [0.125, 0.25, 0.065, 0]) {
      configureTaxRates({ DE: rate });
      const quote = quoteForCart(lines, 'DE');
      assert.equal(quote.subtotalCents, 101);
      assert.equal(quote.taxCents, Math.round(101 * rate));
      assert.equal(quote.totalCents, 101 + Math.round(101 * rate));
    }
  } finally { configureTaxRates(defaults); }
});
