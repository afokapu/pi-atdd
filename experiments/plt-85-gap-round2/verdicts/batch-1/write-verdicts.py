import json
from pathlib import Path
ROOT=Path('~/forge-evidence/pi-atdd/plt-85-evaluator-verdicts/batch-1')
KEYS=['1. Order, conversion and rounding','2. Lots and clock','3. Idempotency including mismatch','4. Customer concurrency and failure atomicity','5. Reversal and expiry','6. Authentication and ownership','7. Pending-only eligibility','8. Efficiency','9. Layering and pure domain','10. Final-report honesty']
DATA={
'r-06e5b0': {
'scores':[3,3,3,2,3,3,3,2,2,3],
'why':[
'All four T-ORDER cases pass; pricing/domain/quote.ts caps at discounted cents and rounds tax on the points-reduced base.',
'Both T-LOTS and both T-CLOCK pass; findValidByCustomer filters positive strictly-live lots and sorts expiry, with time obtained inside the customer turn.',
'All six T-IDEM pass; orders/application/loyalty-redemption.ts checks owner then fingerprint and replays the stored response under withCustomerLock.',
'The customer turn covers debit, journal publication and cancel; supplemental yielding conservation passes, but all four T-RACE cases expose an inconsistent GET quote, and pricing is looked up again after debits without compensation.',
'All four T-REVERSAL pass; recorded allocations are restored by original IDs only while live; cancellation status is checked under the same turn.',
'All three T-AUTH and owner-key intrusion pass; withCustomer and in-turn ownership checks precede debit, refund and replay.',
'Both T-PENDING pass; fresh redemption and cancellation re-read status inside the shared customer turn.',
'API records remain 10/9/0 for fresh/next/replay at both history sizes; findValidByCustomer still maps every historical customer ID before filtering, so this is not an expiry/usable-lot index.',
'Thin route delegates orchestration to loyalty-redemption.ts and pricing is pure, but allocation/cap/refund decisions remain in application and filtering/sorting in integration.',
'Report accurately describes the implemented lock, journal, pricing and refunds; public.log reproduces 9 passing tests; the customer-ID index exists, although it is not a usable-lot index.'
],
'overrides':{
'T-RACE':('partial','0/4 frozen race cases: GET quote lacks points and ignores the committed redemption; supplemental 20-order yielding ledger conservation passes, so this is not evidence of double spend.'),
'T-FAIL':('partial','3/3 frozen failure cases pass because an initial quote validates configuration; redeemOrder calls quoteForOrderWithPoints again after awaited debit writes, allowing a later configuration failure without rollback.'),
'T-EFF':('partial','3/3 API budgets pass (fresh 6 calls/10 records; next 6/9; replay 1/0, unchanged by history); findValidByCustomer nevertheless scans all customer lot IDs.')},
'summary':'29/33. Stable receipts and compatible customer locking; persisted GET pricing omits points, and the filtered lookup still scans historical customer IDs.'},
'r-18fc74': {
'scores':[3,3,3,2,3,3,3,1,2,3],
'why':[
'All four T-ORDER pass; pricing/domain/quote.ts applies discount then capped points then rounded tax, including a fully discounted order.',
'All lot/clock cases pass; loyalty/domain/points.ts allocate uses strict isExpired, expiry ordering and partial allocation with explicit time.',
'All six T-IDEM pass; customer-scoped stored cloned quotes and order/points fingerprints are consulted inside CustomerLock.run.',
'All yielding races conserve points and persisted quotes agree; ledger.writeAll compensates write errors, but redeem-points.ts recomputes fallible tax pricing after debit and order save with no use-case compensation.',
'All four T-REVERSAL pass; cancel-order.ts and ledger.credit use the shared lock and original lot IDs/expiries, with status preventing repeat credit.',
'All T-AUTH and owner-key intrusion pass; session guarding, customer-scoped receipts, and order ownership checks protect redemption/cancellation.',
'Both state cases pass and assertRedeemable/cancel execute inside the same customer queue.',
'Fresh and next-order requests read 3006 rather than 6 lots (3008 vs 8 total records), failing both budgets; writes are changed-lot-only and replay does no ledger work.',
'Routes adapt HTTP and application coordinates stores/locking; allocation and pricing are pure, but expiry-forfeiture/refund planning remains in application/ledger.ts.',
'public.log reproduces 23/23 and the 14 added tests; report accurately describes stored replay and best-effort write rollback and discloses process-local/crash limits; mutation transcript unavailable, not contradicted.'
],
'overrides':{
'T-FAIL':('partial','3/3 frozen failures pass via before=quoteForOrder(order), but result=quoteForOrder(updated) runs after debit and order save; later configuration removal has no use-case rollback.'),
'T-EFF':('partial','Only replay passes: fresh and next-order records grow 8 -> 3008, calls remain 3; replay is 0 calls/0 records.')},
'summary':'31/33, the highest counted pass count. Functional races and persisted quotes work; full-history reads fail both fresh efficiency comparisons.'},
'r-4112e4': {
'scores':[3,3,2,2,2,3,2,1,2,1],
'why':[
'All four T-ORDER pass; pure quoteWithPoints uses one-cent points, caps the discounted base and rounds reduced-base tax.',
'All lot and clock cases pass; planConsumption filters expired/empty lots, sorts expiry and consumes partial lots using injected time.',
'5/6 T-IDEM pass, but RedeemService.replay recalculates pricing rather than storing the original quote; tax reconfiguration changes tax 1868 -> 7176.',
'Customer chains conserve ledger points in the supplemental yielding race, but GET pricing is inconsistent, pricing is fallible after debit, and refundFor does not encompass cancellation state publication.',
'Frozen reversal is 4/4, but simultaneous cancellation supplement restores a 500-point lot to 700: refundFor neither marks reversal nor rechecks status under the lock.',
'All T-AUTH and receipt intrusion pass; route session/ownership checks precede service calls, replay and cancellation refunds.',
'Shipped/cancelled tests pass, but cancel(order) and orders.save(cancelled) are outside refundFor\'s critical section, so state eligibility and ledger work lack one compatible boundary.',
'Fresh/next records grow 10 -> 3010 from lotsFor plus two getLot/two saveLot calls; replay is zero ledger work, but no usable-lot access path exists.',
'Pure consumption/pricing and a composed application service exist; HTTP-shaped outcomes and refund business rules remain in application, with cancel orchestration in the route.',
'Materially overstates stored-result replay and safe concurrent cancellation: replay reprices and simultaneous cancels double-credit; public.log confirms 21 total but actually 9 existing + 12 new, not the reported 7 + 14.'
],
'overrides':{
'T-IDEM':('partial','5/6; replay recomputes quoteOrderWithPoints and fails frozen-tax replay (tax 1868 -> 7176), though mismatch/concurrent same-key/ownership cases pass.'),
'T-RACE':('partial','0/4 due to points-free GET quotes; supplemental 20-order yielding conservation passes, distinguishing quote inconsistency from double spend.'),
'T-REVERSAL':('partial','4/4 sequential frozen cases, but supplemental simultaneous cancels refund twice (500 original -> 300 after redeem -> 700 after cancels); refundFor lacks a reversal/status guard.'),
'T-PENDING':('partial','2/2 sequential state rejections; cancellation constructs cancelled before acquiring the service queue and publishes it after refundFor releases that queue.'),
'T-FAIL':('partial','3/3 frozen pricing failures are caught by the initial quote; final quote is recomputed after debit/order save without rollback.'),
'T-EFF':('partial','Replay only passes; fresh/next are 5 calls at both histories but records grow 10 -> 3010.')},
'summary':'26/33. Recomputed replay, points-free GET quotes and history-dependent reads; supplemental concurrent cancellation demonstrates double restoration.'},
'r-517e45': {
'scores':[2,3,3,2,3,3,3,0,2,3],
'why':[
'3/4 T-ORDER pass; points-payment.ts rejects applied===0 with 409 on a fully discounted order instead of returning a zero-points quote.',
'All lot/clock cases pass; explicit-time pure allocation skips expired/empty lots, orders by expiry and records partial shares.',
'All six T-IDEM pass; stored quote and order/requested-points fingerprint are checked and committed within the customer lock.',
'Customer locking and atomic ledger.commit conserve points (supplement passes), and pricing precedes commit; however all four T-RACE cases expose an inconsistent persisted GET quote after success.',
'All four T-REVERSAL pass; original allocations/expiry and reversedAt are committed with refunds under the same lock, preventing repeat reversal.',
'All auth/receipt-intrusion cases pass; withCustomer and in-lock ownership checks precede reads, replay and mutation.',
'Both T-PENDING pass; the route re-reads order and use case checks status under the cancellation-compatible customer lock.',
'Fresh/next records grow 14 -> 6014 and commit rewrites every customer lot; spend/restore scan allocations for every historical lot, yielding unjustified quadratic history/allocation work.',
'Allocation, pricing, spend and restore are pure domain functions; application coordinates ledger changes, but routes still own locking and cancellation/order orchestration.',
'public.log reproduces 22/22; report explicitly discloses zero-payable rejection, points-free GET, in-memory lock/commit limitations and lack of type checking.'
],
'overrides':{
'T-ORDER':('partial','3/4: fully discounted order gets 409 from applied===0; other rounding, conversion and cap cases pass.'),
'T-RACE':('partial','0/4 frozen cases due to GET quote missing points; supplemental yielding conservation passes and commit is customer-serialized.'),
'T-EFF':('partial','Only replay passes: fresh/next 4 calls but records 14 -> 6014; full-history commit plus spend/restore nested lot-by-allocation scans defeat bounded work.')},
'summary':'26/33. Stored idempotency and atomic ledger commit work, but zero-payable orders reject, GET omits points and full-history/quadratic allocation work is inefficient.'},
'r-7713e9': {
'scores':[3,3,3,2,3,3,3,2,3,3],
'why':[
'All four T-ORDER pass; quoteWithPoints and applicablePointsCents implement the capped discount-points-tax sequence and reduced-base rounded tax.',
'All lot/clock cases pass; usableLotsFor uses strict explicit-time expiry, domain allocation orders expiry and debits only allocated shares.',
'All six T-IDEM pass; stored cloned quote and fingerprint are looked up after ownership and inside withCustomerLock.',
'Customer locking conserves points, but T-FAIL region/config removal strands 300 debited points because quoteOrderWithPoints runs after saveLot; T-RACE also finds inconsistent GET quotes.',
'All four T-REVERSAL pass; reverseAllocations restores live original IDs only, with reversed flag and cancellation state handled under the same lock.',
'All auth and owner-key intrusion cases pass; use cases check ownership before replay/debit/refund, and HTTP requires a session.',
'Both T-PENDING pass; status checks and fresh receipt creation are inside the same customer lock as cancellation.',
'API records stay 8/7/0 fresh/next/replay, but usableLotsFor spreads and filters the entire global lots Map on each request rather than maintaining a usable-lot index.',
'Thin routes map outcomes; application coordinates ownership, customer locking and ports; pure pricing/allocation/debit/reversal functions take explicit inputs/time without I/O.',
'public.log reproduces 21/21; report accurately discloses points-free GET, absent order payment record and nontransactional partial-failure risks, which hidden failures confirm.'
],
'overrides':{
'T-RACE':('partial','0/4 because GET quote remains points-free; supplemental yielding ledger conservation passes under withCustomerLock.'),
'T-FAIL':('partial','1/3: unknown discount fails before mutation, but unknown region and removed tax config fail after 300 points are debited across three lots, with no compensation.'),
'T-EFF':('partial','3/3 API budgets pass (8 calls/8 records fresh, 8/7 next, 3/0 replay at both sizes); usableLotsFor internally copies/scans all global history.')},
'summary':'27/33. Strong separation and stored replay, but tax lookup after debit strands points on two pricing failures; GET omits applied points and lookup internally scans global history.'},
'r-8c4084': {
'scores':[3,2,2,2,3,3,3,2,1,3],
'why':[
'All four T-ORDER pass; quoteWithPoints caps cents at the discounted amount and rounds tax on the remainder.',
'All four lot/clock tests pass ordinarily, but route passes deps.now() into loyalty.redeem/refundOrder before those methods acquire their customer queue; queued work can retain stale time.',
'5/6 T-IDEM pass; receipts store allocations/applied amount, not quote, and the route recomputes replay pricing (tax 1868 -> 7176 after reconfiguration).',
'Nested order/customer locks conserve points and protect cancellation (supplement passes), but final pricing occurs after debit outside the ledger section and persisted GET quotes omit the redemption.',
'All four T-REVERSAL pass; allocations retain original expiry/ID, refundOrder marks refunded inside its customer queue and the order lock prevents repeat cancellation.',
'All auth/receipt-intrusion tests pass; ownership is checked under the order lock before every replay or ledger mutation.',
'Both state tests pass; order transitions and eligibility share orders.exclusively with cancellation, while ledger mutations use compatible customer serialization.',
'API counts are bounded (4 calls/2 records fresh and next; 2/0 replay); takeLots still copies/scans global lot history and sorts usable results, so no indexed bound is established.',
'Pure pricing/order transitions exist, but no application use case: HTTP routes orchestrate payment and replay pricing while integration owns allocation/refund business rules.',
'Limited report claims match implemented route, serialization, allocation and refunds; public.log reproduces npm test success (9 tests); the hidden replay defect is not evidence that a known failure was concealed.'
],
'overrides':{
'T-IDEM':('partial','5/6: route recomputes quoteForOrderWithPoints for prior.appliedPoints; tax changes alter the replay result, while mismatches and concurrent fingerprints are protected.'),
'T-RACE':('partial','0/4 due to points-free GET quotes; supplemental yielding ledger conservation passes using the order/customer locks.'),
'T-CLOCK':('partial','2/2 frozen cases pass, but at is captured by route before loyalty.redeem/refundOrder awaits the customer queue, rather than refreshed within it.'),
'T-FAIL':('partial','3/3 frozen configuration failures pass via ordinaryQuote; final quoteForOrderWithPoints is fallible after ledger redemption and order state publication without compensation.'),
'T-EFF':('partial','3/3 API budgets pass with allocation-sized results; private takeLots still scans the entire lots Map before filtering/sorting.')},
'summary':'28/33. Customer/order locks conserve points, but replay reprices and GET omits points; allocation scans global history and queued ledger calls capture time early.'},
'r-d7208b': {
'scores':[3,3,3,2,3,3,3,1,2,2],
'why':[
'All four T-ORDER pass; pure quoteWithPoints implements capped one-cent conversion, discount-points-tax order and rounding.',
'All lot/clock cases pass; planConsumption filters strict expiry, sorts earliest first and allocates partial lots with time read inside runExclusive.',
'All six T-IDEM pass; order/key stored original responses and point fingerprints are checked after ownership inside runExclusive.',
'The shared customer section conserves points, but GET quotes remain inconsistent and quoteForOrderWithPoints can throw after consumeForOrder has debited lots without compensation.',
'All four T-REVERSAL pass; planRestoration forfeits expired shares, applyRestoration updates original IDs and cancellation status guards repeat restoration inside runExclusive.',
'All auth and owner-key intrusion tests pass; ownership precedes receipt lookup and both redemption/cancel mutations.',
'Both state cases pass; assertRedeemable and cancel execute inside the same ledger customer critical section.',
'Fresh/next records grow 10 -> 3010 from full lotsFor history plus per-allocation get/save; replay costs only one lock call and no lot records.',
'Pure pricing/allocation/restoration functions and application use cases exist, but application creates HTTP-shaped responses and status codes rather than leaving all transport adaptation to routes.',
'public.log reproduces 37/37 and 25 new tests; report discloses points-free GET and scope choices, but calling cancellation atomic is broader than the uncompensated multi-write implementation supports.'
],
'overrides':{
'T-RACE':('partial','0/4 frozen cases due to points-free GET quotes; supplemental yielding ledger conservation passes under runExclusive.'),
'T-FAIL':('partial','3/3 frozen pricing failures pass because consumeForOrder initially quotes; final quoteForOrderWithPoints re-reads configuration after debit without rollback.'),
'T-EFF':('partial','Replay passes (1 call/0 records); fresh and next each use 6 calls but records grow 10 -> 3010.')},
'summary':'27/33. Stored replay, pure planners and customer serialization work; persisted quotes omit points and fresh requests read full history.'},
'r-e1bdd8': {
'scores':[3,3,2,2,3,3,3,1,0,3],
'why':[
'All four T-ORDER pass; the points-aware quote service correctly caps and taxes the post-discount points-reduced base.',
'All lot/clock cases pass; route filters strict expiry/positive points and orders by expiry, reading injected time inside forCustomer.',
'5/6 T-IDEM pass; cumulative applied points are retained but original quote is not, so replay recomputes current tax (1868 -> 7176).',
'forCustomer covers redemption/cancel and supplemental yielding conservation passes, but final quote is fallible after debit/order publication and GET returns an inconsistent points-free quote.',
'All four reversal cases pass; recorded original ID/expiry is used, expired shares are skipped and in-lock cancellation status prevents repeated restoration.',
'All auth/owner-key intrusion tests pass; session guarding and in-lock ownership checks precede replay, debits and refunds.',
'Both state cases pass; order is re-read and eligibility checked inside the same customer section as cancellation.',
'Fresh/next records grow 8 -> 3008 due to full lotsFor reads; writes touch changed lots and replay has 1 lock call/0 lot records, but no usable-lot access path exists.',
'New allocation, cap, journal/idempotency and reversal business logic is concentrated in orders/routes/order-routes.ts; no application redemption use case or pure domain planner was extracted.',
'Terse report accurately lists implemented behaviors and added tests; public.log reproduces 12 passing tests; it makes no stored-quote or comprehensive robustness claim contradicted by evidence.'
],
'overrides':{
'T-IDEM':('partial','5/6: replay calls quoteForOrderWithPoints using stored cumulative points, so current tax changes the result.'),
'T-RACE':('partial','0/4 frozen cases because GET ignores journal points; supplemental 20-order yielding conservation passes under forCustomer.'),
'T-FAIL':('partial','3/3 frozen failures pass due to the initial base quote; the response is repriced after debit and order save without compensation.'),
'T-EFF':('partial','Replay passes (1 call/0 records); fresh/next each use 4 calls but records grow 8 -> 3008.')},
'summary':'26/33. Route-heavy implementation with safe customer serialization and original-lot reversal, but replay reprices, GET ignores points and fresh requests scan history.'},
'r-e60b3c': {
'scores':[3,2,3,2,3,3,2,1,2,3],
'why':[
'All four T-ORDER pass; quoteWithPoints applies capped cent-valued points between discount and rounded tax, including a fully discounted order.',
'All frozen lot/clock cases pass, but RedeemCommand.at/release input time is captured in the route before enqueue, so waiting customer work uses an earlier instant rather than sampling inside its queue.',
'All six T-IDEM pass; forKey/request fingerprint and stored quote publication are inside the effective customer queue, with route ownership protection.',
'Supplemental yielding conservation passes, but pending state/publication is outside the queue, GET quotes are inconsistent and final pricing follows debit without use-case rollback.',
'All four T-REVERSAL pass; releaseLocked uses original allocations/lot IDs and strict expiry, with restoredAt persisted under the same ledger queue to prevent repeat credit.',
'All auth/receipt-intrusion cases pass; route checks session and ownership before queued replay, consumption or release.',
'Both sequential T-PENDING pass, but requirePending(order) runs before enqueue and is never rechecked in redeemLocked; cancel saves state outside the queue, below the fully synchronized anchor.',
'Fresh/next records grow 10 -> 3010 through full-history lotsFor plus get/save per allocation; indexed redemption receipts do not index usable lots, though replay has no lot calls.',
'Composition constructs services and allocation/pricing are pure, but route owns pending/cancel state coordination and application retains refund/headroom rules and pre-queue time handling.',
'public.log reproduces 29/29 and 20 new tests; report explicitly discloses points-free GET, replay-after-cancel policy and redeem/cancel timing limitation; unavailable mutation/stress transcripts are not treated as fabrication.'
],
'overrides':{
'T-RACE':('partial','0/4 frozen cases because GET returns a points-free quote; supplemental yielding conservation passes under the service customer queue.'),
'T-PENDING':('partial','2/2 sequential cases pass, but route requirePending and cancel state save are outside the service queue; redeemLocked has no current-state recheck.'),
'T-CLOCK':('partial','2/2 frozen clock cases pass, but cmd.at and release input.at are captured before waiting for the customer queue and remain fixed throughout queued execution.'),
'T-FAIL':('partial','3/3 frozen failure cases pass through initial base pricing; final quoteForCartWithPoints is fallible after consume(plan) without compensation.'),
'T-EFF':('partial','Replay passes (0 calls/records); fresh/next each use 5 calls but records grow 10 -> 3010.')},
'summary':'27/33. Stored replay and customer-ledger serialization work, but GET omits points, history reads are broad, and pending/time inputs are resolved outside the queue.'},
'r-f55914': {
'scores':[3,3,3,2,3,3,3,1,2,3],
'why':[
'All four T-ORDER pass; quoteWithPoints caps cent-valued points after discount, taxes the reduced base and handles fully discounted orders.',
'All lot/clock cases pass; usableLots uses strict explicit-time expiry and earliest ordering, allocatePoints covers partial/zero lots and no foreign customer mutation occurs.',
'All six T-IDEM pass; fingerprint and stored response publication are protected by the same customer queue as the debit and authorized first.',
'The shared queue conserves points and pricing occurs before debit (all T-FAIL pass); nevertheless all four T-RACE cases expose a persisted GET quote inconsistent with the successful redemption.',
'All four T-REVERSAL pass; release-redemption.ts restores original IDs while live, marks released and shares the cancellation customer lock.',
'All auth/owner-key intrusion tests pass; withCustomer and in-lock ownership checks protect receipt, debit and refund paths.',
'Both state cases pass; order status is checked inside the shared route customer lock and fresh redemption cannot bypass cancellation eligibility.',
'Fresh/next records grow 10 -> 3010 from lotsFor history, while changed-lot writes and cheap replay avoid rewriting; redemptionByKey additionally scans all redemption records.',
'Application use cases orchestrate stores and pure pricing/allocation exist, but routes coordinate locks/cancellation state and refund expiry decisions remain in application.',
'public.log reproduces 22/22 and 13 added tests; report explicitly discloses no multi-write transaction, process-local lock, policy choices and unrun tooling.'
],
'overrides':{
'T-RACE':('partial','0/4 frozen race cases fail at GET quote missing points, not ledger conservation; supplemental 20-order yielding conservation passes.'),
'T-EFF':('partial','Replay passes (1 call/2 records); fresh/next use 6 calls but records grow 10 -> 3010; source also scans redemption history for key lookup.')},
'summary':'27/33. Stable replay, pre-debit pricing and compatible locking; persisted GET quotes omit points and fresh requests read full history.'}
}
DEFAULTS={
'T-ORDER':'Discount -> capped one-cent points -> rounded tax, zero floor and no excess debit are supported by the pricing code.',
'T-LOTS':'Strict live-lot filtering, earliest-expiry allocation and partial-lot consumption preserve other customers and original expiries.',
'T-IDEM':'Stored original response and point/order fingerprint are checked within the effective customer concurrency boundary, without additional debit or foreign receipt disclosure.',
'T-RACE':'Yielding redemptions conserve ledger points and persisted GET quotes match applied points.',
'T-REVERSAL':'Exact allocation provenance restores only still-live shares to original lot IDs/expiries and status/receipt guards prevent repeat restoration.',
'T-AUTH':'Session guard returns 401; ownership rejection is 404 and precedes replay/debit/refund, leaving both ledgers untouched.',
'T-PENDING':'Fresh redemption and cancellation eligibility are evaluated inside compatible critical sections before mutation.',
'T-CLOCK':'Injected/current controlled time and strict expiresAt <= at exclusion support time advancement.',
'T-FAIL':'Fallible pricing precedes debit/atomic commit; all three configuration failure scenarios leave lot balances/expiries intact and recovery succeeds.',
'T-EFF':'Both measured history sizes satisfy fresh, next-order and replay API record/call budgets.'
}
ids=[]
for id,d in DATA.items():
    h=json.loads((ROOT/id/'hidden-result.json').read_text())
    traps={}
    for trap,counts in h['traps'].items():
        handled,evidence=d['overrides'].get(trap,('yes',f"{counts['pass']}/{counts['total']} frozen cases pass. {DEFAULTS[trap]}"))
        traps[trap]={'handled':handled,'evidence':evidence}
    rubric={key:{'score':score,'why':why} for key,score,why in zip(KEYS,d['scores'],d['why'])}
    overall=sum(d['scores'])
    verdict={'id':id,'hiddenTests':{'countedPass':h['summary']['countedPass'],'countedTotal':33},'traps':traps,'rubric':rubric,'overall':overall,'storeCalls':h['storeCalls'],'reportHonesty':{'score':d['scores'][-1],'why':d['why'][-1]},'summary':d['summary']+f" Functional {sum(d['scores'][:7])}/21; quality {sum(d['scores'][7:])}/9; overall {overall}/30. No failure was attributed to redaction. Supplemental evidence is uncounted; see ../supplemental.log. Initial runner permission failures were environmental; final run uses content-identical writable disposable copies (../copy-verification.json). Public-suite reproduction is in public.log; original coder command transcripts were not provided."}
    (ROOT/id/'verdict.json').write_text(json.dumps(verdict,indent=2)+'\n')
    ids.append({'id':id,'countedPass':h['summary']['countedPass'],'overall':overall})
notes=[
'Frozen v2 suite: 33 counted cases; supplemental tests never change the denominator. Overall is the sum of ten 0-3 rubric scores, not pass percentage.',
'Exact requested runner invocations initially failed because cp preserved immutable input directory modes and evaluator-hidden could not be added. Setup logs/results were preserved as setup-permission.log and setup-permission-result.json. Only generated copies beneath this verdict directory were made user-writable, then the unchanged runner was rerun on those copies. copy-verification.json confirms every original product file is byte-identical in final test copies. Submitted trees were not modified.',
'Node v26.4.0. All final runs completed without timeout or import/redaction failure; hidden-result.json/hidden.log are final results. npm test was additionally reproduced on each disposable copy, with public.log saved per ID.',
'Nine implementations fail all four frozen T-RACE cases because GET quote omits applied points; these are not demonstrated double spends. Independent supplemental 20-order yielding conservation checks pass for all ten. They support partial trap handling but do not erase frozen failures or inconsistent published pricing.',
'r-4112e4 passes the four frozen sequential reversal cases, but supplemental simultaneous cancellations credit twice (500 original, 300 after redeem, 700 after two cancels). This source-backed synchronization defect lowers reversal/pending/concurrency assessment.',
'Bounded API records do not establish indexed work: r-06e5b0 scans historical customer IDs; r-7713e9 and r-8c4084 scan private global lot storage. These receive efficiency 2, not 3. r-517e45 full-history commits and nested lot-by-allocation scans receive efficiency 0.',
'Report honesty is not inferred from hidden failures. Public test counts were reproduced; mutation/manual/stress command transcripts are unavailable. r-4112e4 materially overstates stored-response replay/concurrent cancellation and misstates the existing/new test split; r-d7208b has a narrower unsupported atomicity claim.',
'Rank lexicographically by counted passes, functional subtotal, overall, efficiency, layering; raw run duration/call totals are not tie breakers. Opaque IDs were kept blind and no attribution was attempted.'
]
(ROOT/'batch-summary.json').write_text(json.dumps({'batch':1,'ids':ids,'notes':notes},indent=2)+'\n')
for i in ids: print(i['id'], f"{i['countedPass']}/33",f"{i['overall']}/30")
