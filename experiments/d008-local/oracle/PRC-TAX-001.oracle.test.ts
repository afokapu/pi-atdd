/** Held-out evaluator oracle for task T2-ARCH / PRC-TAX-001 (behaviour + real dependency direction). */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { quoteForCart } from "../src/pricing/application/quote-service.ts";
import { configureTaxRates } from "../src/pricing/integration/tax-rates.ts";

const DEFAULT = { DE: 0.19, FR: 0.2, US: 0 };
afterEach(() => configureTaxRates(DEFAULT));

test("oracle: default DE rate applied", () => {
  const q = quoteForCart([{ sku: "a", unitPriceCents: 2500, quantity: 4 }], "DE");
  assert.deepEqual([q.subtotalCents, q.taxCents, q.totalCents], [10000, 1900, 11900]);
});
test("oracle: rounding to nearest cent", () => {
  const q = quoteForCart([{ sku: "a", unitPriceCents: 2549, quantity: 1 }], "DE");
  assert.deepEqual([q.subtotalCents, q.taxCents, q.totalCents], [2549, 484, 3033]);
});
test("oracle: rates come from the configured provider, not a copied table", () => {
  configureTaxRates({ DE: 0.07, ZZ: 0.5 });
  assert.equal(quoteForCart([{ sku: "a", unitPriceCents: 1000, quantity: 1 }], "DE").taxCents, 70);
  assert.equal(quoteForCart([{ sku: "a", unitPriceCents: 1000, quantity: 2 }], "ZZ").totalCents, 3000);
});
test("oracle: zero-rate region", () => {
  const q = quoteForCart([{ sku: "a", unitPriceCents: 999, quantity: 3 }], "US");
  assert.deepEqual([q.taxCents, q.totalCents], [0, 2997]);
});
test("oracle: unknown region is rejected, not silently untaxed", () => {
  assert.throws(() => quoteForCart([{ sku: "a", unitPriceCents: 100, quantity: 1 }], "XX"));
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
}
function specifiers(src: string): string[] {
  const out: string[] = [];
  const res = [
    /\bimport\s+(?:type\s+)?[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g, /\bimport\s*\(/g,
  ];
  for (const re of res) for (const m of src.matchAll(re)) out.push(m[1] ?? "<dynamic-non-literal>");
  return out;
}
test("oracle: domain modules depend only on domain modules (real import graph)", () => {
  const violations: string[] = [];
  for (const file of files(join(root, "src")).filter(f => f.split(sep).includes("domain") && /\.[cm]?[jt]s$/.test(f))) {
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith("node:") ) continue;
      if (spec === "<dynamic-non-literal>") { violations.push(relative(root, file) + " -> non-literal dynamic import"); continue; }
      if (!spec.startsWith(".")) { violations.push(relative(root, file) + " -> package " + spec); continue; }
      const target = relative(root, resolve(dirname(file), spec));
      const parts = target.split(sep);
      if (parts[0] !== "src" || parts[2] !== "domain") violations.push(relative(root, file) + " -> " + target);
    }
  }
  assert.deepEqual(violations, []);
});
