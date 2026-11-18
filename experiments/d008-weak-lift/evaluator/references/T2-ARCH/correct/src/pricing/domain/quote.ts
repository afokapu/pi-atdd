export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; taxCents: number; totalCents: number };

export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/** Price a cart for a region. */
export function quote(lines: Line[], region: string, taxRate = 0): Quote {
  const subtotalCents = subtotal(lines);
  const taxCents = Math.round(subtotalCents * taxRate);
  return { region, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
