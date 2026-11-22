// Child process for the PLT-118 seat-transfer race test: attempts a real seat transfer and reports the outcome.
import { executionConfigFromEnv, recordSeatCheckpoint, replaceSeat } from "../../src/execution-seat.ts";

const [, , repo] = process.argv;
try {
  const config = executionConfigFromEnv(process.env)!;
  const cp = recordSeatCheckpoint(config, config.binding.sessionId, repo!, { state: "verified", pendingIds: [] });
  replaceSeat(config, { nextSessionId: "session-race-successor", modelId: "provider/model", checkpoint: cp,
    observedHead: cp.revision.head, sourceSettled: true, recoveryAuthorized: false });
  console.log("TRANSFERRED");
} catch (e) { console.log("REFUSED: " + String((e as Error).message ?? e)); }
