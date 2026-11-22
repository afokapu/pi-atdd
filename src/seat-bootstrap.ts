/**
 * ATD-36 — launcher-callable provisioning of the standalone generation-1 seat lease.
 *
 * The launcher runs `atdd seat bootstrap` with the PI_ATDD_EXECUTION_* variables it will hand to Pi,
 * before Pi starts. Pi itself never calls this (see bootstrapSeat in execution-seat.ts). The lease is
 * exact-match idempotent: the same binding succeeds again; a different session or execution is refused
 * with "seat already assigned", so a stale or foreign seat stays fail-closed. The owner token is never
 * returned or printed.
 */
import { bootstrapSeat, executionConfigFromEnv, missingExecutionVariables } from "./execution-seat.ts";

export type BootstrappedSeat = {
  seatAddress: string;
  executionId: string;
  sessionId: string;
  generation: number;
  leasePath: string;
};

export function bootstrapSeatFromEnv(env: NodeJS.ProcessEnv): BootstrappedSeat {
  const config = executionConfigFromEnv(env);
  if (!config) {
    throw new Error("no ATDD execution binding to bootstrap; missing " + missingExecutionVariables(env).join(", "));
  }
  if (config.mode !== "standalone")
    throw new Error("only standalone seats are bootstrapped here; Flow-owned seats are provisioned by Flow");
  const bound = bootstrapSeat(config);
  return {
    seatAddress: bound.seatAddress, executionId: bound.executionId, sessionId: bound.sessionId,
    generation: bound.generation, leasePath: config.leasePath,
  };
}
