// PLT-117 test fixture: loaded by Pi's real extension loader; registers only the seat hooks,
// reading the launch binding from process.env exactly as the shipped extension does.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSeatExecution } from "../../src/execution-pi.ts";

export default function (pi: ExtensionAPI) {
  registerSeatExecution(pi);
}
