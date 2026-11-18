/** Loyalty domain: base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

/** Pure points calculation with the campaign multiplier supplied by the use case. */
export function orderPoints(subtotalCents: number, multiplier: number): number {
  return Math.floor(basePoints(subtotalCents) * multiplier);
}
