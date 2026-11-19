/**
 * Adapter over the remote tax configuration service. Rates are fractional
 * (0.19 = 19%). Configuration can be replaced at runtime by operations.
 */
let rates: Record<string, number> = { DE: 0.19, FR: 0.2, US: 0 };

export class UnknownRegionError extends Error {}

export function getTaxRate(region: string): number {
  const rate = rates[region];
  if (rate === undefined) throw new UnknownRegionError("no tax rate configured for region " + region);
  return rate;
}

/** Operations hook: replace the configured rates. */
export function configureTaxRates(next: Record<string, number>): void {
  rates = { ...next };
}
