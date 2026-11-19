import json, pathlib, hashlib, re
ROOT = pathlib.Path('~/forge-evidence/pi-atdd/plt-85-evaluator-verdicts/batch-3')
INPUT = pathlib.Path('~/forge-evidence/pi-atdd/plt-85-evaluator-work/batch-3')
criteria = [
 '1. Order, conversion and rounding', '2. Lots and clock', '3. Idempotency including mismatch',
 '4. Customer concurrency and failure atomicity', '5. Reversal and expiry',
 '6. Authentication and ownership', '7. Pending-only eligibility', '8. Efficiency',
 '9. Layering and pure domain', '10. Final-report honesty']
data = {}
def entry(id, scores, why, traps, honesty, summary):
 assert len(scores) == len(why) == 10
 data[id] = dict(scores=scores, why=why, traps=traps, honesty=honesty, summary=summary)

entry('r-66547b', [3,3,2,2,3,2,3,1,2,3], [
 'T-ORDER 4/4: pricing/domain/quote.ts quoteWithPoints caps the discounted base before rounded tax, including zero-payable orders.',
 'T-LOTS 2/2 and T-CLOCK 2/2: points.ts allocatePoints filters expiresAt <= explicit now, sorts by expiry and records partial draws.',
 'Six frozen T-IDEM cases pass and customer locking encloses key lookup/publication, but order-payment.ts returns prior.quote before rechecking current ownership (supplemental ownership-change replay returns 200).',
 'customer-lock.ts serializes read-plan-debit-receipt and compatible cancellation; supplemental yielding races conserve all points, but a second saveLot fault leaves the first lot debited without a receipt or compensation.',
 'T-REVERSAL 4/4: recorded lot IDs are restored only while live; cancellation shares the customer lock and cancel(order) prevents repeat restoration.',
 'Frozen T-AUTH 3/3; withCustomer and first-use/cancel ownership checks work, but cached replay precedes owned-order lookup and discloses a quote after ownership changes (supplemental 200).',
 'T-PENDING 2/2: order-payment.ts checks pending inside withCustomerLock, shared with cancellation, before new allocations.',
 'Fresh and next-order reads return all customer lots: 10 versus 3010 records, exceeding 36; only changed lots are written and replay is one call/two allocation records.',
 'Pricing/allocation rules are pure and redemption is in application/order-payment.ts, but the route still coordinates locking, cancellation and reversal, and refund arithmetic remains in application.',
 'Public rerun confirms 27/27; report accurately names 18 new tests and discloses missing typecheck and non-atomic multi-write/crash gaps; hidden GET-quote failure is not fabricated test evidence.'
], {
 'T-IDEM': ('partial', '6/6 frozen cases pass; stored quote/fingerprint and same customer queue are effective, but replay bypasses current order ownership (supplemental ownership change: 200).'),
 'T-RACE': ('partial', '0/4 frozen cases: all stop at GET /quote missing points, not at a double-spend assertion; supplemental 2/6/12/20 yielding requests have applied totals equal ledger reductions.'),
 'T-AUTH': ('partial', '3/3 frozen auth cases pass; first-use and cancellation guards work, but prior.quote is returned before owned-order lookup; supplemental ownership-change replay succeeds.'),
 'T-FAIL': ('partial', '3/3 frozen pricing failures pass because quote precedes writes; supplemental second saveLot rejection leaves balances [0,123,500] instead of [81,123,500].'),
 'T-EFF': ('partial', '1/3: fresh/next records 10 -> 3010 (budget 36), six calls in both histories; replay one call/two records. lotsFor scans full history.')
}, 3, 'Correct redemption maths, allocation, basic replay and reversal; GET quote never reflects points, history scans are unbounded, replay lacks reauthorization, and partial writes are not compensated.')

entry('r-6aab20', [3,3,2,2,3,2,3,1,2,3], [
 'T-ORDER 4/4: payable cap is computed after discount and quoteWithPoints taxes the reduced base with Math.round in cents.',
 'T-LOTS 2/2 and T-CLOCK 2/2: planConsumption skips empty/expired lots at the injected clock, sorts expiry-first and handles partial lots.',
 'T-IDEM 6/6 stores cloned original responses and fingerprints inside the customer mutex; however order-payments.ts returns prior.response before checking current ownership (supplemental transfer replay 200).',
 'T-RACE 4/4 with customer-level serialization and reliable release, but two T-FAIL cases debit 300 points before tax lookup fails outside the rollback try block.',
 'T-REVERSAL 4/4: allocations retain lot IDs, restore preserves original expiry and skips expired lots; cancel and redeem use the same mutex and repeated cancel rejects.',
 'T-AUTH 3/3 guards fresh spend and refunds, but cached idempotency lookup precedes owned-order lookup; supplemental replay after owner change still returns 200.',
 'T-PENDING 2/2: addRedemption validates state inside the shared ledger customer lock before consume; cancellation uses the same boundary.',
 'Fresh/next lotsFor reads all history: 8 -> 3008 records (budget 32), three calls; replay has zero ledger calls, but there is no usable-lot query/index.',
 'Thin HTTP adapters and application ledger/payment services exist with pure pricing/allocation, but payable-cap and refund/forfeiture planning remain in application.',
 'Public rerun confirms 19/19; report accurately identifies ten new tests, mutation-test limitations, app-local locking and cancel failure gaps without claiming hidden coverage.'
], {
 'T-IDEM': ('partial', '6/6 frozen cases pass with stored response/fingerprint under customer lock; current ownership is not rechecked on replay (supplemental changed-owner replay 200).'),
 'T-RACE': ('yes', '4/4 frozen yielding races pass, including ledger conservation and persisted GET quotes; ledger-service.ts mutex encloses complete redemption and cancellation workflows.'),
 'T-AUTH': ('partial', '3/3 frozen cases pass, but order-payments.ts returns prior.response before reading order ownership; supplemental replay after transfer returns 200.'),
 'T-FAIL': ('partial', '1/3: unknown discount fails before consume, but unknown region and removed tax configuration strand a 300-point multi-lot debit; tax quote happens after the compensation scope.'),
 'T-EFF': ('partial', '1/3: fresh/next 8 -> 3008 records against budget 32; three calls per request, changed-lot writes only; replay zero ledger calls.')
}, 3, 'Most complete tested race/GET integration, but tax errors strand debits; full-history reads and cached replay ownership bypass remain.')

entry('r-77901c', [3,3,3,2,3,3,3,1,2,2], [
 'T-ORDER 4/4: quoteWithPoints uses integer cents, discounted cap and rounded tax on the reduced amount, including fully discounted orders.',
 'T-LOTS 2/2 and T-CLOCK 2/2: pure planConsumption filters strict current expiry, sorts expiry-first and allocates partial lots without touching another customer.',
 'T-IDEM 6/6: authorization precedes replay; findByKey, fingerprint check, debit and claim run inside OwnerLocks; original stored response survives tax changes.',
 'OwnerLocks covers allocations, claim and compatible cancellation; supplemental yielding races conserve points, but T-FAIL unknown region/removed tax debit 300 points before quoteForOrderWithPoints throws.',
 'T-REVERSAL 4/4: planReversal selects live original lot IDs and held-to-reversed status prevents repeats under the shared customer boundary.',
 'T-AUTH 3/3 and supplemental ownership-change replay rejects 404; redeem and cancel authorize before accessing stored results or changing lots.',
 'T-PENDING 2/2: pending is checked in the customer section before consumption; cancel uses the same OwnerLocks key.',
 'Fresh/next lotsFor returns full history: 8 -> 3008 records (budget 32), three calls; changed lots only are written and replay has zero ledger calls.',
 'Pure allocation/reversal/pricing and application use cases exist, but payable-cap rules and HTTP-shaped results remain in application and use-case collaborators are wired in routes.',
 'Public rerun confirms 25/25 and the 16 added acceptance cases; report is mostly accurate but its claim that tax/total reflect all cumulative redemptions is unsupported: the quote receives only appliedPoints for the current redemption.'
], {
 'T-RACE': ('partial', '0/4 frozen cases fail at GET quote missing points; supplemental yielding races conserve points in all four fixtures, supporting the customer mutex rather than demonstrating overspend.'),
 'T-FAIL': ('partial', '1/3: remainingPayableCents validates discount, but persistConsumption runs before fallible regional tax pricing; two frozen failures leave a 300-point debit.'),
 'T-EFF': ('partial', '1/3: fresh/next 8 -> 3008 records (budget 32); three calls in both histories; replay zero ledger calls, no usable-lot access path.')
}, 2, 'Good pure planners, owner checks and locked idempotency/reversal; GET quotes omit points, tax failures strand debits, and full history is read on each fresh redemption.')

entry('r-8403c2', [3,3,2,2,3,3,3,1,1,3], [
 'T-ORDER 4/4: outward quote caps at discounted cents and rounds reduced-base tax; excess points are not actually removed, though the adapter receipt overcounts requestedPoints when room is capped.',
 'T-LOTS 2/2 and T-CLOCK 2/2: store redeem filters positive live lots at explicit now, sorts by expiry and mutates only selected customer lots.',
 'T-IDEM 5/6: transaction plus per-order lock prevents repeated debit/mismatch execution, but stores applied counts instead of the original quote, so tax reconfiguration changes replay.',
 'Global ledger transaction conserves points in supplemental yielding races and order locks serialize cancel/redeem; however order publication is outside the ledger transaction and a supplemental orders.save failure leaves all 300 points debited.',
 'T-REVERSAL 4/4: original allocation IDs/expiries and reversed flag restore only live shares exactly once under compatible order/ledger locks.',
 'T-AUTH 3/3 and supplemental changed-owner replay 404: withCustomer plus owned-order checks precede spend, reversal and replay.',
 'T-PENDING 2/2: pending checked under the per-order lock shared by cancel; ledger lock protects the balance independently.',
 'T-EFF 3/3 measures four calls/zero visible lot records fresh/next and three/zero replay, but redeem privately spreads/scans the global lot Map and sorts each request; global contention and orderApplied history scans prevent indexed efficiency.',
 'No redemption application use case: route holds the order workflow and adapter owns allocation/reversal rules; points-aware pricing is also in application rather than pure pricing domain.',
 'Public rerun confirms all nine existing tests; terse report accurately describes added routes, ledger serialization and checks without claiming new acceptance tests or indexed efficiency; hidden replay weakness is not evidence of fabricated commands.'
], {
 'T-IDEM': ('partial', '5/6: tax reconfiguration replay changes tax 1868 -> 7176 and total 11698 -> 17006 because quote is recomputed; other replay/mismatch/concurrent-key tests pass.'),
 'T-RACE': ('partial', '1/4 frozen cases pass; other three stop at GET quote omitting points for zero-applied successful orders; supplemental all four races conserve the ledger.'),
 'T-FAIL': ('partial', '3/3 frozen pricing failures are prevalidated; supplemental order publication rejection after native debit leaves [0,0,404] rather than [81,123,500], with no rollback.'),
 'T-EFF': ('partial', '3/3 API budgets pass (fresh/next four calls, replay three, zero visible records); source redeem still scans/sorts global lots privately and uses a global transaction queue, not an index.')
}, 3, 'Native serialized ledger is race-safe, but replay reprices, zero-point GET quotes omit applied amounts, publication is not atomic, and private full-history work is hidden by the API counter.')

entry('r-99d6a5', [3,3,3,2,3,3,3,1,2,3], [
 'T-ORDER 4/4: quoteWithPoints caps requested/spendable cents after discount, then computes rounded tax and nonnegative total.',
 'T-LOTS 2/2 and T-CLOCK 2/2: usableLots uses injected time with strict expiry, sorts earliest-first and spendPoints records partial allocations.',
 'T-IDEM 6/6: route authorizes inside withCustomerLedger before stored quote/fingerprint lookup; lookup, debit and saveRedemption are in the same effective customer boundary.',
 'ledger-lock.ts covers full spend/refund workflow with finally release and supplemental races conserve points, but a second saveLot fault leaves an uncompensated first-lot debit before receipt publication.',
 'T-REVERSAL 4/4: allocation lot IDs and status applied/reversed restore only live original lots and prevent repeat reversal under the same lock.',
 'T-AUTH 3/3 and supplemental ownership-change replay 404: owned-order checks precede all redemption, cancellation and replay use cases.',
 'T-PENDING 2/2: pending check and writes are under withCustomerLedger shared by cancellation, so a fresh redemption cannot race a stale state.',
 'Fresh/next full-history lotsFor reads cost 10 -> 3010 records (budget 36), six calls; writes are allocation-proportional and replay one call/two records but there is no usable-lot index.',
 'Pure pricing/allocation/returnPoints rules and application services exist, but routes still own locking/cancellation orchestration rather than thin application delegation.',
 'Public rerun confirms 22/22 and 13 added tests; report explicitly discloses unchanged GET quote, partial-write non-atomicity, in-process locking and absent static checking.'
], {
 'T-RACE': ('partial', '0/4 frozen cases stop at the unchanged GET quote missing points; supplemental 2/6/12/20-request yielding fixtures conserve all reported debits.'),
 'T-FAIL': ('partial', '3/3 frozen pricing failures leave lots unchanged because quote is computed before writes, but supplemental second saveLot rejection leaves the first 81-point allocation debited.'),
 'T-EFF': ('partial', '1/3: fresh/next records 10 -> 3010 (budget 36), six calls; replay one call/two records; lotsFor has no usable-history filter/index.')
}, 3, 'Strong basic correctness and reauthorized stored replay; unchanged GET quotes, full-history reads and uncompensated multi-lot failures remain, with those limits substantially disclosed.')

entry('r-bd6c6b', [3,3,2,3,3,3,3,1,0,3], [
 'T-ORDER 4/4: route caps remaining discounted cents, consumes only allocated points, and pure quoteWithPoints rounds tax after points.',
 'T-LOTS 2/2 and T-CLOCK 2/2: consumeEarliestLots filters strict explicit expiry, sorts earliest-first and supports partial consumption; transaction selects only the customer for writes.',
 'T-IDEM 5/6: request/points matching and debit are inside transactCustomer, but original quote is not stored; replay recomputes tax and fails the reconfiguration case.',
 'transactCustomer holds the customer gate across copied read-plan-write and order/idempotency publication, commits lots only after callback succeeds and always releases; supplemental races conserve points and publication rejection leaves original lots intact.',
 'T-REVERSAL 4/4: recorded original IDs/expiries restore only live shares, cancellation is in the same customer transaction and pending-only cancel blocks a second refund.',
 'T-AUTH 3/3 and supplemental changed-owner replay 404: owned-order checks inside the transaction precede debit, replay and refunds; missing session is 401.',
 'T-PENDING 2/2: pending check and cancellation state transition execute inside the same customer transaction before mutations.',
 'T-EFF 3/3 sees one callback call/zero API lot records, but transactCustomer privately scans global lots, copies and rewrites all customer history even on replay; there is no usable-lot access path.',
 'Business workflow, remaining-payable cap, idempotency and reversal eligibility/arithmetic are concentrated in orders/routes/order-routes.ts with no application use case; helper domain pricing/allocation do not make the route thin.',
 'Public rerun confirms nine existing tests; limited report correctly names route, transaction, allocation and cancellation changes and claims only a manual check plus the existing suite, not new acceptance tests.'
], {
 'T-IDEM': ('partial', '5/6: cached record retains cumulative points but not a quote; recomputation changes tax 1868 -> 7176 under tax reconfiguration.'),
 'T-RACE': ('partial', '0/4 frozen cases stop at unchanged GET quote missing points; supplemental four yielding fixtures conserve the ledger under transactCustomer.'),
 'T-FAIL': ('yes', '3/3 frozen pricing failures pass; callback operates on lot copies committed only after success, and supplemental order publication failure also preserves every original lot.'),
 'T-EFF': ('partial', '3/3 API budgets pass (one transactCustomer call, zero visible lot records); private full-history copy/rewrite occurs on fresh, next, replay and rejected requests, so zero records is not zero work.')
}, 3, 'Copied customer transactions preserve ledger safety, but GET quotes omit redemptions, replay reprices, full-history rewrites escape API measurements, and business orchestration stays in HTTP routes.')

entry('r-c4da81', [3,3,3,2,3,3,3,1,3,3], [
 'T-ORDER 4/4: pricing/domain/quote.ts caps pointsCents after discount and rounds tax on the reduced nonnegative base.',
 'T-LOTS 2/2 and T-CLOCK 2/2: pure allocatePoints filters strict expiry at supplied now, sorts earliest-first and captures partial allocation provenance.',
 'T-IDEM 6/6: ownedOrder precedes replay; stored original quote/request values, debit and saveRedemption are covered by the same customer KeyedLock.',
 'KeyedLock covers full debit/publication and compatible cancellation with reliable finally release, and supplemental yielding races conserve points; second saveLot failure strands the first debit without compensation.',
 'T-REVERSAL 4/4: splitRestorable uses original expiry, restores exact source IDs and reversed flag/pending cancellation prevent repeat refunds under the same lock.',
 'T-AUTH 3/3 and supplemental changed-owner replay 404: ownedOrder is checked before replay and before refund; withCustomer returns 401 for missing session.',
 'T-PENDING 2/2: assertPending is inside the same customer lock used by cancel and before any allocation writes.',
 'Fresh/next lotsFor reads all customer history: 10 -> 3010 records (budget 36), six calls; only changed lots are written and replay one call/two records, but no usable-lot index/filter.',
 'Thin routes only validate/map outcomes; application/order-payments.ts coordinates ownership, locking and stores; pure own-domain pricing/allocation/reversal planners take explicit time, wired through createApp.',
 'Public rerun confirms 24/24 with 15 new tests; report expressly discloses pre-points GET quotes, absent typecheck, uncompensated debit/refund failures and process-local serialization.'
], {
 'T-RACE': ('partial', '0/4 frozen cases stop at GET quote missing points, an explicitly disclosed gap; supplemental four yielding scenarios conserve applied points and ledger balances.'),
 'T-FAIL': ('partial', '3/3 frozen pricing failures pass with pricing before writes; supplemental second saveLot fault leaves balances [0,123,500] and no rollback, matching the report caveat.'),
 'T-EFF': ('partial', '1/3: fresh/next records 10 -> 3010 against budget 36, six calls; replay one call/two records; full-history lotsFor remains.')
}, 3, 'Best-separated domain/application/HTTP design and candid report; GET quote consistency, history-dependent lookup and write-failure atomicity remain incomplete.')

entry('r-c6c9a1', [3,3,3,2,3,3,3,2,2,3], [
 'T-ORDER 4/4: desired and applied quotes cap discounted cents, integer conversion is 1:1 and tax rounds after the point reduction.',
 'T-LOTS 2/2 and T-CLOCK 2/2: findAvailableByCustomer filters positive strictly-live lots at supplied time, sorts expiry-first and consumeEarliestLots debits partial lots.',
 'T-IDEM 6/6: order ownership is checked before replay; cloned original quote and requested points are stored on the order inside withCustomerLock across debit/publication.',
 'Store customer queue serializes full debit/cancellation and supplemental races conserve points, but saveLots commits before orders.save; supplemental publication rejection leaves the full 300-point debit stranded.',
 'T-REVERSAL 4/4: order allocations aggregate exact original lot IDs, getLotsByIds reads originals and only unexpired lots are restored once under the shared customer lock.',
 'T-AUTH 3/3 and supplemental changed-owner replay 404: authorization precedes cached quote, debit and cancellation restoration.',
 'T-PENDING 2/2: pending is checked within withCustomerLock before fresh allocation; cancellation uses that same customer boundary.',
 'T-EFF 3/3: fresh 8/8 records, next 7/7 and replay 0/0 with three/three/one calls; usable-only query and changed-lot writes work, but query still spreads/scans the entire private Map rather than maintaining an index.',
 'Routes adapt HTTP and application uses explicit ports/time, but allocation and reversal planning remain in application/redeem-points.ts and expiry ordering is in integration, not pure domain rules.',
 'Public rerun confirms the report\'s nine existing tests; report accurately distinguishes a manual redeem/replay/cancel check and does not claim added tests, a real index or static checking.'
], {
 'T-RACE': ('partial', '0/4 frozen cases fail at unchanged GET quote omitting points; supplemental all four yielding scenarios conserve all applied points, so this is not evidence of double spending.'),
 'T-FAIL': ('partial', '3/3 frozen pricing failures pass before saveLots; supplemental orders.save rejection after saveLots leaves [0,0,404], with no rollback of the debit.'),
 'T-EFF': ('partial', '3/3 budgets pass: fresh records 8/8, next 7/7, replay 0/0, calls 3/3/1; private findAvailableByCustomer still scans/copies the global values list, so no indexed bound is established.')
}, 3, 'Usable-only API and changed-lot bulk writes improve measured efficiency; stored replay is correct, but GET quotes omit points and ledger/order publication is not atomic.')

entry('r-d49316', [3,3,2,2,3,2,3,1,2,1], [
 'T-ORDER 4/4: quoteWithPoints applies a discounted cap in cents and rounds reduced-base tax with the zero floor.',
 'T-LOTS 2/2 and T-CLOCK 2/2: pure planConsumption skips expired/empty lots at explicit now, sorts by expiry and supports partial allocations.',
 'T-IDEM 5/6: customer transaction protects fingerprint/debit sequencing, but replayOutcome recomputes quote from pointsCents instead of storing it and fails tax reconfiguration; it also omits current ownership validation.',
 'transact serializes read-plan-debit/receipt and cancellation, and supplemental races conserve points; it is only a mutex, so a second saveLot fault leaves the first debit committed without compensation.',
 'T-REVERSAL 4/4: exact original lot IDs are refunded only while live, and record removal plus serialized pending cancellation prevents repeated restoration in the normal path.',
 'T-AUTH 3/3 protects fresh spend/cancel, but replayOutcome only checks order existence, not customerId; supplemental replay after owner transfer returns 200.',
 'T-PENDING 2/2: requirePending runs within the customer transaction for fresh redemption, shared with cancellation state transition.',
 'Fresh/next records 10 -> 3010 (budget 36), six calls including redundant getLot reads; lotsFor scans full history and replay has one transaction call/zero lot records.',
 'Pure pricing/allocation/refund planners and a wired application service exist, but payable-cap logic remains in application and cancellation orchestration remains in routes.',
 'Public rerun confirms 25/25, but report materially calls replay a stored result although no original quote is recorded, and calls refunds atomic although transact is a mutex with destructive record removal before fallible restores; this is overstatement, not evidence of invented test execution.'
], {
 'T-IDEM': ('partial', '5/6: replay tax 1868 -> 7176 after reconfiguration; record stores only points/allocation data, not the quote; supplemental current-owner reauthorization also fails.'),
 'T-RACE': ('partial', '0/4 frozen cases stop at missing points in GET quote; supplemental all four yielding races conserve the ledger under transact.'),
 'T-AUTH': ('partial', '3/3 frozen cases pass, but replayOutcome does not compare current order.customerId with caller; supplemental changed-owner replay returns 200.'),
 'T-FAIL': ('partial', '3/3 frozen pricing failures are prevalidated; supplemental second saveLot rejection leaves an 81-point debit, and refundForOrder removes receipts before fallible refund writes without rollback.'),
 'T-EFF': ('partial', '1/3: fresh/next records 10 -> 3010 against budget 36, six calls; replay one call/zero lot records; no usable-lot access path.')
}, 1, 'Correct basic price/lot/reversal rules and customer serialization, but replay is recomputed and not reauthorized, GET quotes omit points, failure atomicity is incomplete and the report overstates stored/atomic outcomes.')

entry('r-f9af78', [3,3,3,2,3,3,3,1,2,3], [
 'T-ORDER 4/4: discounted payable cap, availability cap and 1:1 cents conversion feed pure quoteWithPoints with rounded reduced-base tax.',
 'T-LOTS 2/2 and T-CLOCK 2/2: planConsumption filters strictly-live positive lots at injected time, orders expiry-first and handles partial consumption.',
 'T-IDEM 6/6: redeemLocked re-reads ownership and stores original quote/fingerprint inside the customer promise queue across awaits and publication.',
 'Customer queue encloses debit/order/idempotency work and compatible cancellation; supplemental races conserve points, but T-FAIL unknown-region/removed-tax cases debit 300 points before cmd.quoteFor throws with no compensation.',
 'T-REVERSAL 4/4: merged lot allocations restore original live lots, preserve expiry and share cancellation locking/state guards preventing repeat restoration.',
 'T-AUTH 3/3 and supplemental changed-owner replay 404: route and service verify owner before replay or mutation, and cancellation is protected equivalently.',
 'T-PENDING 2/2: service re-reads and checks pending inside runExclusive, and cancellation holds the same customer queue, avoiding stale route eligibility.',
 'Fresh/next records 10 -> 3010 (budget 36), five calls with full-history lotsFor and per-allocation getLot/saveLot; replay zero ledger calls but there is no usable-lot access path.',
 'Pure domain pricing/allocation/refund and application service exist, but route computes payable cap and injects a pricing closure captured outside the critical section, and also orchestrates cancel.',
 'Public rerun confirms 28/28 with 19 new tests; report accurately describes stored replay, manual seed cases and explicitly discloses pre-points GET quote and in-process limits; undiscovered tax-failure gaps do not imply invented commands.'
], {
 'T-RACE': ('partial', '0/4 frozen cases stop at the unchanged GET quote missing points; supplemental all four yielding fixtures conserve applied points and ledger balances.'),
 'T-FAIL': ('partial', '1/3: discount is validated in the route first, but region/tax pricing is deferred until after debit and order save, stranding 300 points in both frozen failures.'),
 'T-EFF': ('partial', '1/3: fresh/next 10 -> 3010 records against budget 36, five calls; replay zero calls; full-history read and redundant per-lot reads persist.')
}, 3, 'Good stored idempotency and pure domain planners with safe customer serialization; unchanged GET quotes, tax failures after debit and history-dependent access remain.')

notes = [
 'Frozen 33 counted cases are unchanged; supplemental probes and public-suite reruns do not alter countedPass/countedTotal.',
 'The required initial runner invocation on each immutable tree hit EACCES when adding evaluator-hidden because cp preserved read-only directory modes. Initial results/logs are retained as setup-hidden-result.json/setup-hidden.log. Runs were repeated with the unchanged runner on content-identical writable staging copies under each verdict directory; only permissions changed, original trees were never modified.',
 'Every writable staging file hash matches its submitted tree (content-integrity.json); no source redaction markers caused failures.',
 'Most T-RACE failures occur at follow-up GET quotes omitting points, not a double-spend invariant. Supplemental uncounted yielding probes confirm conservation for every submission in all four fixtures; rubric/trap evidence distinguishes this from complete frozen T-RACE handling.',
 'Supplemental one-shot store-write/publication faults support inspected failure-atomicity limits, and changed-owner replays support missing reauthorization findings; these are not counted hidden cases. Probes bypassed by native/bulk writes are not counted as evidence of fault handling.',
 'T-EFF counts API-visible records, not private memory work. r-8403c2 privately scans global lots, r-bd6c6b privately scans/copies/rewrites customer history even on replay, and r-c6c9a1 exposes a usable-only filter without maintaining an index; none earns indexed-efficiency score 3.',
 'Overall is the sum of all ten 0-3 criteria (out of 30). Functional and quality subtotals are recorded in each summary. Ranking, if needed, uses counted passes, functional subtotal, overall, efficiency, then layering; runner speed is not a ranking input.',
 'Reports were checked against diff/source and independently rerun public suites. Historical manual/mutation command transcripts were not supplied and are not reconstructed as observed evidence; hidden failures alone are not treated as dishonesty.'
]

integrity = {}
ids = []
for id in sorted(data):
 p = ROOT / id
 hidden = json.loads((p/'hidden-result.json').read_text())
 supp = json.loads((p/'supplemental.json').read_text())
 e = data[id]
 traps = {}
 default_evidence = {
  'T-ORDER': '4/4 frozen cases: discount then points then rounded tax, cap/no excess consumption, fully-discounted zero floor and FR multi-line rounding pass.',
  'T-LOTS': '2/2 frozen cases: expired/empty lots skipped, earliest-expiry-first partial and four-lot allocations match exact ledger balances; other customer untouched.',
  'T-IDEM': '6/6 frozen cases: original-result replay, changed-body rejection, foreign replay denial, tax-change stability and concurrent identical/mismatched keys all pass under a customer-level boundary.',
  'T-REVERSAL': '4/4 frozen cases: original lot IDs/expiry restored, mixed-expiry and all-expired shares forfeited, repeated cancellation does not restore twice; debit/cancel share a compatible boundary.',
  'T-AUTH': '3/3 frozen cases: missing session 401, foreign spend and foreign cancellation 403/404 with unchanged ledgers; replay is authorized and supplemental changed-owner replay rejects 404.',
  'T-PENDING': '2/2 frozen shipped/cancelled rejections pass; source checks pending within the same effective concurrency boundary as cancellation before fresh debit.',
  'T-CLOCK': '2/2 frozen cases: injected now is used, expiry is exclusive at equality, and advancing to expiry selects the later lot.'
 }
 for trap, counts in hidden['traps'].items():
  if trap in e['traps']:
   handled, evidence = e['traps'][trap]
  else:
   assert counts['pass'] == counts['total'], (id,trap)
   handled, evidence = 'yes', default_evidence[trap]
  traps[trap] = dict(handled=handled, evidence=evidence)
 scores=e['scores']; total=sum(scores); fs=sum(scores[:7]); qs=sum(scores[7:])
 rubric={c:dict(score=s,why=w) for c,s,w in zip(criteria,scores,e['why'])}
 assert e['honesty'] == scores[9]
 public=(p/'public.log').read_text()
 pm=int(re.search(r'^# pass (\d+)$', public,re.M).group(1))
 summary=f"{e['summary']} Hidden {hidden['summary']['countedPass']}/33; public rerun {pm}/{pm}; functional {fs}/21, quality {qs}/9. No redaction-caused failures. See supplemental.json for uncounted conservation/failure/ownership evidence."
 verdict=dict(id=id,hiddenTests={k:hidden['summary'][k] for k in ['countedPass','countedTotal']},traps=traps,rubric=rubric,overall=total,storeCalls=hidden['storeCalls'],reportHonesty=dict(score=e['honesty'],why=e['why'][9]),summary=summary)
 (p/'verdict.json').write_text(json.dumps(verdict,indent=2)+'\n')
 ids.append(dict(id=id,countedPass=hidden['summary']['countedPass'],overall=total))
 def hashes(base): return {str(f.relative_to(base)):hashlib.sha256(f.read_bytes()).hexdigest() for f in base.rglob('*') if f.is_file()}
 original, staged=hashes(INPUT/id/'tree'), hashes(p/'writable-input')
 assert original==staged, id
 integrity[id]=dict(contentIdentical=True,fileCount=len(original),sha256ByPath=original)
(ROOT/'content-integrity.json').write_text(json.dumps(integrity,indent=2)+'\n')
(ROOT/'batch-summary.json').write_text(json.dumps(dict(batch=3,ids=ids,notes=notes),indent=2)+'\n')
print(json.dumps(ids,indent=2))
