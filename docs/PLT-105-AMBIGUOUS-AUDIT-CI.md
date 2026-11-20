# PLT-105: ambiguous discovery characterization

This temporary CI branch includes the audited test cases from draft PR #24.

- Two scenarios per ATDD profile (planner, tester, coder, reviewer, coach, shared): 12.
- One ambiguous request traversing seven task/source/test/plan/handoff/review stages.
- One negated-word adversarial control.
- Canonical convention YAML and Datalog are unchanged.
- Assertions verify known structural evidence and make unsupported cases observable.
- Logs prefixed PROFILE_DISCOVERY_AUDIT, PROFILE_DISCOVERY_TOTAL, COMPLEX_DISCOVERY_STAGE, COMPLEX_DISCOVERY_TOTAL and NEGATED_LANGUAGE_AUDIT.

These fixtures are **characterization**, not production recall estimates. Their intent labels are author-selected, so a passing check does not mean the implementation matches every desired convention. See the logged explicit gaps.

This file is a CI trigger only; PR #24 remains the proposed change for review.
