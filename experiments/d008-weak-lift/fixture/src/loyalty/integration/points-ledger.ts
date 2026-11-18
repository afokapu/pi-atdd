/** Adapter over the loyalty points ledger (in memory for this service). */
export class PointsLedger {
  private balances = new Map<string, number>();
  credit(customerId: string, points: number): void {
    if (!Number.isInteger(points) || points < 0) throw new RangeError("points must be a non-negative integer");
    this.balances.set(customerId, this.balance(customerId) + points);
  }
  balance(customerId: string): number {
    return this.balances.get(customerId) ?? 0;
  }
}
