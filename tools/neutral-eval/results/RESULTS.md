### Bun regression (SN-001): 0.2.0 vs new

| Arm | Accepted | Rate | Cost total | Cost / run | Valid | Wall s / run |
| -- | -- | -- | -- | -- | -- | -- |
| v020 | 17/24 | 0.71 | $0.74 | $0.031 | 24/24 | 52 |
| new | 16/24 | 0.67 | $0.72 | $0.030 | 24/24 | 54 |

| Per model | v020 | new |
| -- | -- | -- |
| glm | 8/12 | 7/12 |
| kimi | 9/12 | 9/12 |

| Per task | v020 | new |
| -- | -- | -- |
| F1-AUTH | 6/6 | 6/6 |
| F2-AUTH | 6/6 | 5/6 |
| F3-ARCH | 0/6 | 0/6 |
| F4-ARCH | 5/6 | 5/6 |

Failed oracle checks by trap (count of runs failing it):

| Trap | v020 | new |
| -- | -- | -- |
| ACCEPT-ARITHMETIC | 6 | 6 |
| ACCEPT-FRESH-ID | 0 | 1 |
| ACCEPT-VALIDATION | 6 | 7 |

### Second stack (ts-hexagon): A none, B core+profile, C core+profile+Bun reference

| Arm | Accepted | Rate | Cost total | Cost / run | Valid | Wall s / run |
| -- | -- | -- | -- | -- | -- | -- |
| A | 13/24 | 0.54 | $0.27 | $0.011 | 24/24 | 31 |
| B | 15/24 | 0.63 | $0.35 | $0.015 | 24/24 | 37 |
| C | 15/24 | 0.63 | $0.37 | $0.015 | 24/24 | 35 |

| Per model | A | B | C |
| -- | -- | -- | -- |
| glm | 6/12 | 6/12 | 7/12 |
| kimi | 7/12 | 9/12 | 8/12 |

| Per task | A | B | C |
| -- | -- | -- | -- |
| F1-AUTH | 6/6 | 6/6 | 6/6 |
| F2-AUTH | 5/6 | 6/6 | 5/6 |
| F3-ARCH | 0/6 | 0/6 | 0/6 |
| F4-ARCH | 2/6 | 3/6 | 4/6 |

Failed oracle checks by trap (count of runs failing it):

| Trap | A | B | C |
| -- | -- | -- | -- |
| ACCEPT-ARITHMETIC | 6 | 6 | 5 |
| ACCEPT-FRESH-ID | 1 | 0 | 1 |
| ACCEPT-VALIDATION | 10 | 9 | 8 |

### Differences (second arm minus first)

| Comparison | D | Fisher p (descriptive) | Rule result |
| -- | -- | -- | -- |
| bun v020 → new | -0.042 | 1.00 | NO REGRESSION |
| hex B → C | +0.000 | 1.00 | NO DIFFERENCE |
| hex A → B | +0.083 | 0.77 | NO DIFFERENCE |
| hex A → C | +0.083 | 0.77 | NO DIFFERENCE |

Bun activation audit (target rule reached the model before the first edit): v020 24/24, new 24/24.
Unauthorized paths changed: 0 runs. Invalid runs: 0. Total notional cost: $2.45 over 120 runs.
