// PLT-117 test fixture: a Pi-like process that claims its seat, optionally records a
// checkpoint, then dies by SIGKILL before the lease compare-and-swap. Driven by execution-seat.test.ts.
import { claimSeatHolder, executionConfigFromEnv, recordSeatCheckpoint } from "../../src/execution-seat.ts";

const [repo, stage] = process.argv.slice(2);
if (!repo || (stage !== "before-checkpoint" && stage !== "after-checkpoint")) throw new Error("usage: <repo> <stage>");
const config = executionConfigFromEnv(process.env)!;
claimSeatHolder(config, "session-a");
if (stage === "after-checkpoint")
  recordSeatCheckpoint(config, "session-a", repo, { state: "verified", pendingIds: ["ati_123456789abc"] });
process.kill(process.pid, "SIGKILL"); // crash between checkpoint and lease CAS
