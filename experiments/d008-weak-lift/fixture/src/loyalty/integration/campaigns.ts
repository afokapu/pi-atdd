/**
 * Adapter over the marketing campaign service. Multipliers are configured by
 * operations and can change at runtime; at most one campaign is active.
 */
let multipliers: Record<string, number> = { "double-points": 2, "summer-boost": 1.5 };
let active: string | null = null;

export class UnknownCampaignError extends Error {}

/** Multiplier of the active campaign, or 1 when no campaign is active. */
export function activeMultiplier(): number {
  return active === null ? 1 : multipliers[active]!;
}

/** Operations hook: activate a configured campaign (null deactivates). */
export function activateCampaign(id: string | null): void {
  if (id !== null && !(id in multipliers)) throw new UnknownCampaignError("unknown campaign " + id);
  active = id;
}

/** Operations hook: replace the configured multipliers (deactivates the current campaign). */
export function configureCampaigns(next: Record<string, number>): void {
  multipliers = { ...next };
  active = null;
}
