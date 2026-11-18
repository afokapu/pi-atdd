/** Loyalty domain: base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

// TODO(LOY-001): points awarded for an order must apply the active campaign multiplier
// (campaigns are configured in src/loyalty/integration/campaigns.ts).
