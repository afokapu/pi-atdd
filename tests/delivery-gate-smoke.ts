// URN: test:pi-atdd:evaluate-delivery:E001-INTEGRATION-007
// Acceptance: acc:pi-atdd:E001-INTEGRATION-007
// Run the complete gate outside npm test to avoid recursion. A successful exit
// witnesses both the test suite and an extension loaded by a real Pi runtime.
import { spawnSync } from "node:child_process";

for (const script of ["check", "smoke:pi", "smoke:attention", "smoke:install"]) {
  console.log(`delivery gate: npm run ${script}`);
  const result = spawnSync("npm", ["run", script], { stdio: "inherit", shell: false });
  if (result.error) {
    console.error(`delivery gate: could not run ${script}`, result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`delivery gate: ${script} failed (status ${result.status}, signal ${result.signal})`);
    process.exit(1);
  }
}
console.log("delivery gate: tests and real Pi smokes passed");
