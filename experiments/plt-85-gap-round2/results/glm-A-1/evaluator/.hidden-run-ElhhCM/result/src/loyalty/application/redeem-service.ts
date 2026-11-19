import { isExpired } from "../domain/points.ts";
import { planConsumption, type LotConsumption } from "../domain/redeem.ts";
import type { Redemption, RedemptionQuote } from "../domain/redemption.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";
import type { InMemoryRedemptionStore } from "../integration/redemption-store.ts";
import { quoteForCartWithPoints } from "../../pricing/application/quote-service.ts";
import type { Line } from "../../pricing/domain/quote.ts";

/** The idempotency key was already used with a different request body. */
export class IdempotencyConflictError extends Error {}

export type RedeemCommand = {
  customerId: string;
  orderId: string;
  points: number;
  idempotencyKey: string;
  lines: Line[];
  region: string;
  discountCode?: string;
  at: Date;
};

export type RedeemResult = { quote: RedemptionQuote; replayed: boolean };

/**
 * Use case: pay part of a pending order with loyalty points.
 *
 * Every ledger read-modify-write for a customer runs on that customer's queue,
 * so concurrent redemptions for one customer never spend the same points even
 * though the stores are asynchronous.
 */
export class RedeemService {
  private readonly loyalty: InMemoryLoyaltyStore;
  private readonly redemptions: InMemoryRedemptionStore;
  /** One promise chain per customer: tasks run strictly one after another. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(loyalty: InMemoryLoyaltyStore, redemptions: InMemoryRedemptionStore) {
    this.loyalty = loyalty;
    this.redemptions = redemptions;
  }

  /** Run `task` after every other task queued for this customer has settled. */
  private enqueue<T>(customerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(customerId) ?? Promise.resolve();
    const run = previous.then(task, task);
    this.queues.set(customerId, run.then(() => undefined, () => undefined));
    return run;
  }

  /** Redeem points against an order; idempotent per (customer, idempotencyKey). */
  redeem(cmd: RedeemCommand): Promise<RedeemResult> {
    return this.enqueue(cmd.customerId, () => this.redeemLocked(cmd));
  }

  private async redeemLocked(cmd: RedeemCommand): Promise<RedeemResult> {
    const existing = await this.redemptions.forKey(cmd.customerId, cmd.idempotencyKey);
    if (existing) {
      const sameRequest = existing.orderId === cmd.orderId && existing.requestedPoints === cmd.points;
      if (!sameRequest) throw new IdempotencyConflictError("idempotency key already used with a different request");
      return { quote: existing.quote, replayed: true };
    }

    // Points already applied to this order by earlier redemptions.
    const appliedBefore = (await this.redemptions.forOrder(cmd.orderId))
      .filter(r => r.restoredAt === undefined)
      .reduce((sum, r) => sum + r.appliedPoints, 0);

    // Points reduce the amount after discounts; never below zero, so the
    // amount left after earlier redemptions caps what this one may take.
    const base = quoteForCartWithPoints(cmd.lines, cmd.region, appliedBefore, cmd.discountCode);
    const headroom = base.subtotalCents - base.discountCents - appliedBefore;
    const requested = Math.max(0, Math.min(cmd.points, headroom));

    // Consume non-expired lots, earliest expiry first.
    const plan = planConsumption(await this.loyalty.lotsFor(cmd.customerId), requested, cmd.at);
    await this.consume(plan);
    const appliedNow = plan.reduce((sum, c) => sum + c.points, 0);

    const quote = quoteForCartWithPoints(cmd.lines, cmd.region, appliedBefore + appliedNow, cmd.discountCode);
    const redemption: Redemption = {
      id: "rd-" + crypto.randomUUID(),
      customerId: cmd.customerId,
      orderId: cmd.orderId,
      idempotencyKey: cmd.idempotencyKey,
      requestedPoints: cmd.points,
      appliedPoints: appliedNow,
      quote,
      lots: plan,
      createdAt: cmd.at,
    };
    await this.redemptions.save(redemption);
    return { quote, replayed: false };
  }

  /** Take points from lots according to a consumption plan. */
  private async consume(plan: LotConsumption[]): Promise<void> {
    for (const step of plan) {
      const lot = await this.loyalty.getLot(step.lotId);
      if (!lot) continue;
      await this.loyalty.saveLot({ ...lot, points: Math.max(0, lot.points - step.points) });
    }
  }

  /**
   * Return the points redeemed for an order to their original lots (with the
   * lots' original expiry). Points whose lot expired in the meantime are
   * forfeited. Idempotent: each redemption is restored at most once.
   */
  releaseForOrder(input: { orderId: string; customerId: string; at: Date }): Promise<void> {
    return this.enqueue(input.customerId, () => this.releaseLocked(input));
  }

  private async releaseLocked(input: { orderId: string; customerId: string; at: Date }): Promise<void> {
    for (const redemption of await this.redemptions.forOrder(input.orderId)) {
      if (redemption.restoredAt !== undefined) continue;
      const perLot = new Map<string, number>();
      for (const c of redemption.lots) perLot.set(c.lotId, (perLot.get(c.lotId) ?? 0) + c.points);
      for (const [lotId, points] of perLot) {
        const lot = await this.loyalty.getLot(lotId);
        if (!lot || isExpired(lot, input.at)) continue; // lot expired by now: points forfeited
        await this.loyalty.saveLot({ ...lot, points: lot.points + points });
      }
      await this.redemptions.save({ ...redemption, restoredAt: input.at });
    }
  }
}
