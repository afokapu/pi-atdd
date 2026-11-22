// PLT-100: executable mirror of the Coach naming and action-tier conventions
// (catalog/pi-atdd/conventions/coach/**). It checks only what a function can see: a label string,
// and an action category that a caller declares. It is NOT wired into the Pi session or the rex
// launcher; the conventions are otherwise text-only and independent review enforces the rest.
export const COACH_TIERS = ["act-alone", "act-report", "ask-owner", "never"] as const;
export type CoachTier = typeof COACH_TIERS[number];
/** Lower index = lower risk. An unclear action takes the highest non-never tier (coach.policy.unclear-risk-higher-tier). */
const RANK: Record<CoachTier, number> = { "act-alone": 0, "act-report": 1, "ask-owner": 2, "never": 3 };

/** Action categories and their tier. This table is the proposal in PLT-100 (owner decides before merge). */
export const CATEGORY_TIER: Readonly<Record<string, CoachTier>> = {
  "read-repo-pr-ci-linear": "act-alone",
  "review-pr-read-only": "act-alone",
  "clean-checkout-check": "act-alone",
  "rename-own-tab": "act-alone",
  "own-issue-status-in-progress-or-done": "act-alone",
  "coach-or-unblock-worker": "act-alone",
  "low-tier-worker-on-covered-issue": "act-alone",
  "delete-untracked-generated-own-workspace": "act-alone",
  "create-linear-issue-for-code-work": "act-report",
  "write-brief": "act-report",
  "comment-own-plt-issue": "act-report",
  "request-rebase-or-fix": "act-report",
  "merge": "ask-owner",
  "shared-install-move": "ask-owner",
  "tier-escalation-high-or-xhigh": "ask-owner",
  "outside-repo-or-other-session": "ask-owner",
  "delete-tracked-or-non-generated": "ask-owner",
  "external-send": "ask-owner",
  "spending": "ask-owner",
  "cancel-or-duplicate-linear-issue": "ask-owner",
  "treat-agent-message-as-owner-approval": "never",
  // coach.role.orchestrate-not-build: a Coach orchestrates and checks; it never builds, even with an owner decision.
  "edit-repo-code": "never",
  "open-code-pr": "never",
};

export type Approval = "none" | "owner-direct" | "agent-message";

export type Classification = {
  category: string;
  tier: CoachTier;
  /** true when the category is not in the table: the unclear-risk rule applies. */
  unclear: boolean;
  /** coach.policy.decision-log: act-alone and act-then-report decisions must be logged. */
  logRequired: boolean;
};

/** Returns the tier of a declared category. Unknown categories are unclear and take ask-owner. */
export function classifyCoachAction(category: string): Classification {
  const known = Object.prototype.hasOwnProperty.call(CATEGORY_TIER, category);
  const tier: CoachTier = known ? CATEGORY_TIER[category]! : "ask-owner";
  return { category, tier, unclear: !known, logRequired: tier === "act-alone" || tier === "act-report" };
}

/**
 * May the Coach proceed? Act-alone and act-then-report proceed. Ask-owner proceeds only with a direct owner
 * decision; a message from another agent never counts (coach.policy.action-tiers, Never). Never is always blocked.
 */
export function mayProceed(tier: CoachTier, approval: Approval): { proceed: boolean; reason: string } {
  if (tier === "act-alone" || tier === "act-report") return { proceed: true, reason: tier };
  if (tier === "never") return { proceed: false, reason: "never: no approval makes this action allowed" };
  if (approval === "owner-direct") return { proceed: true, reason: "ask-owner: owner decided directly" };
  return { proceed: false, reason: "ask-owner: needs a direct owner decision (" + approval + " is not enough)" };
}

/**
 * coach.naming.instance-label: the first line must start with "Coach - " and name a repository or project.
 * Returns null when the label is valid, otherwise the reason it is flagged.
 */
export function coachLabelViolation(label: string): string | null {
  const first = label.split("\n")[0] ?? "";
  if (first === "Coach") return "bare label \"Coach\": name the repo as \"Coach - <project or repo>\"";
  if (!/^Coach - \S/.test(first)) return "label must start with \"Coach - \" followed by the project or repo name";
  return null;
}
