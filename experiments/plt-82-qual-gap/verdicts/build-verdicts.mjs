import { readFile, writeFile } from 'node:fs/promises';
const root = '~/forge-evidence/pi-atdd/plt-82-evaluator-verdicts';
const criteria = [
  '1_order_conversion_rounding', '2_lots_clock', '3_idempotency_mismatch',
  '4_customer_concurrency', '5_reversal_expiry', '6_authentication_ownership',
  '7_pending_eligibility', '8_efficiency', '9_layering_pure_domain', '10_report_honesty',
];
const data = {
  'r-16090e': {
    scores: [3,3,2,3,3,3,3,1,3,3],
    why: [
      'All three T-ORDER cases pass; pricing/domain/quote.ts::quoteWithPoints caps after discount and rounds tax on the reduced base.',
      'T-LOTS and both T-CLOCK cases pass; points.ts::spendableLots uses strict expiry, FEFO and copied partial-lot deductions.',
      'Both hidden replay cases and simultaneous same-key probe pass, but order-payments.ts::replayRedemption recomputes pricing: configureTaxRates changes the replay total from 952 to 1000.',
      'order-payments.ts reads the order, allocates, debits and publishes the receipt under withCustomerLock; cancellation shares it and the rejection-safe tail releases reliably; both hidden races and cancel probes pass.',
      'Exact allocations are retained; returnPoints restores original live lots; both reversal cases and simultaneous cancels pass, with the second cancel rejected before refund.',
      'withCustomer supplies 401; ownedOrder runs before receipt lookup/refund and hides foreign orders with 404; hidden guards and changed-owner replay probe pass.',
      'Pending validation and cancel(order) execute after reading the order inside the shared customer boundary; both hidden status tests and both cancel/redeem orderings pass.',
      'Each fresh request reads all 1240 lots and writes two; lotsFor scans global history and spendableLots filters/sorts again for balance and allocation, with no usable-lot index; replay makes one receipt call.',
      'Thin redeem/error adapters call application use cases; pure domain quote, spendPoints and returnPoints take explicit inputs/time, and createApp injects stores/clock.',
      'The reported 21 tests (12 new plus 9 existing) reproduce exactly; the report explicitly discloses recomputed replay tax, in-process locking and no type-check; historical lock-disable experiment is not independently observable.',
    ],
    trapOverrides: {
      'T-IDEM': ['partial', '2/2 hidden cases pass and concurrent replay spends once, but the public tax-configuration probe changes the returned quote on an identical replay.'],
    },
    calls: 'Fresh requests: 5/5 observed calls, 1240/1240 lots read, 2/2 writes; replay: 1 call, no lot reads/writes. Receipt methods are included; source confirms broad scans despite proportional writes.',
    summary: '16/16 counted; functional 20/21, quality 7/9, total 27/30. Strongest pure-domain separation and cancel synchronization; identical replay is not stable across supported tax configuration changes, and fresh requests scan history. Submitted suite reproduced 21/21.',
  },
  'r-3581b3': {
    scores: [3,3,3,3,3,2,3,1,2,3],
    why: [
      'All three T-ORDER cases pass; pricing/domain/quote.ts caps whole points after discount and rounds tax only on the remaining cents.',
      'T-LOTS and both T-CLOCK cases pass; planConsumption filters strictly expired/empty lots, sorts by expiry and plans partial debits without mutation.',
      'redeem-points.ts checks fingerprint and publishes a cloned response inside KeyedLock; hidden replay/mismatch, concurrent replay and changed-tax replay probes pass without another debit.',
      'Customer KeyedLock surrounds order read, consumePoints, redemption/order saves and key publication; finally releases it; both hidden races and both cancel orderings pass.',
      'ledger.ts restores original lot IDs/expiry, skips expired lots and records per-lot reversed progress; both hidden reversal tests and concurrent cancel probe pass.',
      'Hidden guards pass and cancellation rechecks ownership, but redeem-points.ts returns getKey results before loading/authorizing the current order; changed-owner replay probe returns 200 rather than 403/404.',
      'applyPoints and cancel run on fresh order reads inside the same customer lock; hidden shipped/cancelled tests and cancel/redeem probes reject new spending after cancellation.',
      'Each fresh redemption calls lotsFor once (1240 returned) and saveLot twice; consumePoints scans/copies full customer history with no usable index; replay makes no measured loyalty-store calls.',
      'Routes adapt HTTP and use cases orchestrate locking/storage with pure allocation/pricing, but ledger.ts retains refund/addition/forfeiture rules in application rather than a pure reversal plan.',
      'Reported 21/21 tests with 12 new cases reproduce; code supports the described rollback/progress attempts and the report acknowledges non-atomic, single-process limits; historical mutation experiment remains unverified.',
    ],
    trapOverrides: {
      'T-AUTH': ['partial', '2/2 hidden guards pass; supplementary replay after changing order ownership through OrderStore.save still discloses the saved quote because getKey precedes authorization.'],
    },
    calls: 'Fresh requests: 3/3 loyalty-store calls, 1240/1240 lots read and 2/2 writes; replay: 0 measured loyalty calls. Separate synchronous redemption-store calls are outside the loyalty counter, not zero total application work.',
    summary: '16/16 counted; functional 20/21, quality 6/9, total 26/30. Stable stored responses and well-bounded redeem/cancel locking with refund progress; replay bypasses current ownership authorization and every fresh debit scans history. Submitted suite reproduced 21/21.',
  },
  'r-3790dc': {
    scores: [3,3,3,2,3,2,3,1,2,3],
    why: [
      'All three T-ORDER cases pass; discountedSubtotal bounds the applied amount and quoteWithPoints rounds reduced-base tax with a zero floor.',
      'T-LOTS and both T-CLOCK cases pass; allocatePoints filters strict expiry, sorts FEFO and preserves source expiry on partial allocations.',
      'Customer lock encloses key lookup, debit and saved quote; both hidden idempotency cases, concurrent replay and tax-change replay probes pass.',
      'Both races conserve points and lock tails release, but order-use-cases.ts computes quoteForOrderWithPoints after saveLot: removing DE through configureTaxRates throws after consuming 200, without a receipt.',
      'Exact source allocations plus strict isExpired preserve identities/expiry and reversed status prevents re-restoration; both hidden reversal cases and concurrent cancels pass.',
      'Fresh debit/cancel ownership guards and both hidden AUTH tests pass, but redemptionByKey returns a saved quote before current order authorization; changed-owner replay probe returns 200.',
      'Order state is read/checked and cancellation committed within the shared customer lock; both hidden state checks and both cancel/redeem orderings pass.',
      'Fresh requests each return all 1240 lots and write two; lotsFor scans global lots, and redemptionByKey/redemptionForOrder also scan all receipts; replay still scans receipts once.',
      'Application owns orchestration and routes are adapters; allocation/pricing are pure, but payable capping and refund construction/forfeiture remain in order-use-cases.ts.',
      'Reported 20 tests with 11 additions reproduce exactly; in-process and non-transactional limitations are disclosed, with no fabricated coverage inferred from hidden failures; historical lock-disable experiment cannot be reverified from artifacts.',
    ],
    trapOverrides: {
      'T-RACE': ['partial', '2/2 hidden races and cancel orderings pass; a supported tax-configuration failure occurs after debit and before receipt publication (balance 1000 -> 800 on a thrown request).'],
      'T-AUTH': ['partial', '2/2 hidden guards pass, but key replay precedes owned-order lookup; changed-owner replay returns 200 in review-probes.json.'],
    },
    calls: 'Fresh requests: 6/6 calls, 1240/1240 lots read, 2/2 writes; replay: 1 receipt-lookup call, no observed lot access. Source reveals linear global receipt scans hidden behind that lookup.',
    summary: '16/16 counted; functional 19/21, quality 6/9, total 25/30. Strong normal-path synchronization and stable replay, but authorization is bypassed on replay and tax lookup can fail after debit. No usable-lot or receipt index. Submitted suite reproduced 20/20.',
  },
  'r-86b4ee': {
    scores: [3,3,2,2,2,3,2,1,1,3],
    why: [
      'All three T-ORDER cases pass; store.redeem caps allocation by the discounted maximum and domain quoteWithPoints rounds tax on the reduced cents.',
      'T-LOTS and both T-CLOCK tests pass; store.redeem filters customer/non-empty/strictly live lots and applies FEFO partial allocations.',
      'Hidden replay/mismatch and simultaneous same-key tests pass inside serialized, but only pointsApplied is retained and the route recomputes tax: identical replay changes total from 952 to 1000 after configureTaxRates.',
      'Both hidden ledger races conserve points and serialized uses finally, but order status lies outside it: cancel-first/redeem-second succeeds twice and leaves a cancelled order with 200 points consumed.',
      'Both hidden reversal cases pass with original expiry snapshots and active flags, but the unlocked eligibility/order-save boundary permits a new redemption after refund has already run.',
      'withCustomer and route ownership checks precede every debit, refund and replay; both hidden AUTH tests and changed-owner replay probe return the required rejections.',
      'Sequential shipped/cancelled checks pass, but order.status is checked before entering serialized; the cancel-then-redeem probe returns [200,200] with balance 800 on a cancelled order.',
      'Bulk redeem scans [...this.lots.values()] globally for every fresh request and sorts usable entries; no index and a store-global lock; two wrapper calls do not mean zero lot work.',
      'No redemption application use case: routes compute the maximum and coordinate order state while the storage adapter owns allocation, expiry and refund business rules; pricing alone remains pure domain logic.',
      'The limited report accurately describes the endpoint, atomic ledger mutations and expiry refunds; npm test reproduces the explicitly stated 9/9 existing tests, without any claim of added coverage; unknown hidden race/replay defects are not evidence of deception.',
    ],
    trapOverrides: {
      'T-IDEM': ['partial', '2/2 hidden cases pass but a tax-configuration change alters an identical replay because the stored result contains applied points, not the original quote.'],
      'T-RACE': ['partial', '2/2 hidden debit races pass; the supplementary cancel-first race consumes 200 points on an already cancelled order despite serialized ledger operations.'],
      'T-REVERSAL': ['partial', '2/2 hidden reversal cases pass and active flags prevent duplicate refunds, but cancellation and redemption do not atomically coordinate order state and refund.'],
      'T-PENDING': ['partial', '2/2 sequential hidden state tests pass; review cancelThenRedeem succeeds for both requests and leaves status cancelled with balance 800 instead of 1000.'],
    },
    calls: 'Each fresh request and replay reports redeem=1, serialized=1 (2 calls), lotsRead/lotsWritten=0 at the base API. These zeros are instrumentation blind spots: the bulk method scans all global lots and directly mutates allocations; replay only looks up a record.',
    summary: '16/16 counted; functional 17/21, quality 5/9, total 22/30. Correct hidden arithmetic and lot debit, but replay is tax-dependent and pending checks race cancellation. Business rules live largely in integration with global scans/locking. Submitted suite reproduced 9/9, none newly added.',
  },
  'r-c15e3d': {
    scores: [3,3,3,1,2,3,2,0,2,2],
    why: [
      'All three T-ORDER cases pass; planRedemption caps consumption by requested/payable amounts and quoteAfterPoints rounds tax after discount and points.',
      'T-LOTS and both T-CLOCK cases pass; pure planRedemption uses strict expiry, FEFO and exact partial allocations with unchanged source expiry.',
      'Idempotency lookup/mismatch and stored outcome publication share the customer lock; hidden cases, simultaneous replay and changed-tax replay probe pass with one debit.',
      'Both hidden debit races pass, but the lock ends before the route saves the order receipt and does not encompass cancel state: simultaneous cancels inflate balance 1000 -> 1200 and redeem/cancel can resurrect pending state.',
      'Both hidden reversal tests restore live original lots, but restoreForOrder has no reversed marker and uses stale route snapshots; two concurrent cancels refund the same allocation twice.',
      'withCustomer plus route ownership checks precede redemption/replay/refund; hidden AUTH cases and changed-owner replay probe reject without mutations.',
      'Both hidden status cases reject sequentially, but route eligibility and order saves are outside the customer boundary; the redeem-then-cancel probe returns success twice while leaving the order pending and points spent.',
      'Each fresh request reads all 1240 lots and writes two, then performs lots.find over the history for every allocation; with many source lots this is quadratic history work, not indexed/allocation-proportional lookup.',
      'Pure planRedemption and an application service exist, but quoteAfterPoints/refund rules remain application logic and routes own eligibility plus receipt/state publication outside the use case.',
      'The 19-pass npm result reproduces, but the report repeatedly miscounts 11 added test blocks (there are 10) and contradicts its own arithmetic; feature descriptions and disclosed GET/in-memory limitations are otherwise substantially accurate.',
    ],
    trapOverrides: {
      'T-RACE': ['partial', '2/2 hidden debit races pass, but supplemental concurrent cancellations mint 200 points and redeem/cancel loses the cancelled state; receipt/state publication sits outside the lock.'],
      'T-REVERSAL': ['partial', '2/2 hidden reversals pass, but two concurrent cancels both refund the same order: review-probes.json records balance 1200 from an initial 1000.'],
      'T-PENDING': ['partial', '2/2 sequential status checks pass, but redeemThenCancel succeeds twice and ends pending with a 200-point debit because the route saves a stale order.'],
    },
    calls: 'Fresh requests: 3/3 calls, 1240/1240 returned lots and 2/2 writes; replay: no loyalty calls. The counter does not count repeated application-level lots.find scans, which cause the efficiency deduction.',
    summary: '16/16 counted; functional 17/21, quality 4/9, total 21/30. Stored replay and pure allocation work, but receipt/order publication outside the lock permits cancellation resurrection and duplicate refunds; repeated history searches are inefficient. Submitted suite reproduced 19/19 (10 additions, not 11).',
  },
  'r-d67a68': {
    scores: [2,3,3,2,2,3,2,1,2,2],
    why: [
      'T-ORDER rounding and cap pass, but quote.ts omits pointsAppliedCents when zero: the fully-discounted case cannot return the required numeric applied-points field.',
      'T-LOTS and both T-CLOCK cases pass; allocateLots strictly excludes expired/empty lots, sorts FEFO and keeps partial consumption and original expiry.',
      'The customer promise chain encloses idempotency lookup, debit and cached response; hidden replay/mismatch plus simultaneous and changed-tax replay probes pass.',
      'Customer serialization conserves distinct-order ledger points; the six-way hidden failure is missing zero-valued points, not proven double spending, but stale Order arguments let redeem/cancel resurrect pending state outside the effective boundary.',
      'Both hidden reversals return live original lots, and ordinary repeat cancellation rejects, but a cancel racing an in-flight first redemption captures no receipt, skips restoration and is overwritten by the stale pending order.',
      'withCustomer and route ownership checks protect fresh debit, refund and replay; both hidden guards and changed-owner replay probe reject correctly.',
      'Both sequential hidden status tests pass, but redeemLocked checks the Order snapshot supplied before lock acquisition, not a fresh read; redeemThenCancel leaves pending with balance 800 after two successful requests.',
      'Fresh requests each read 1240 lots plus getLot twice and write two; no usable-lot index, and per-customer chains retain entries indefinitely; replay uses no measured loyalty calls.',
      'Allocation and pricing are pure with application orchestration, but refund construction and capacity calculation remain application rules, cancellation orchestration stays in HTTP, and RedeemError embeds HTTP status.',
      'The total 21/21 tests reproduces, but the report claims 13 additions plus 8 existing instead of the actual 12 plus 9; it also overstates all-flow mutex coverage while otherwise accurately describing the implementation.',
    ],
    trapOverrides: {
      'T-ORDER': ['partial', '2/3 hidden cases pass; fully discounted redemption omits numeric pointsAppliedCents rather than returning zero, although arithmetic/debit are correctly zero.'],
      'T-RACE': ['partial', '1/2 hidden cases pass; the six-way failure is an omitted zero-points response, not a demonstrated ledger double spend; supplemental cancel/redeem also shows stale order publication.'],
      'T-REVERSAL': ['partial', '2/2 sequential hidden reversals pass, but a simultaneous initial redeem/cancel loses the cancellation and refund because the route captured no redemption before the debit.'],
      'T-PENDING': ['partial', '2/2 sequential status cases pass; application checks a stale Order supplied by the route, and the redeemThenCancel probe ends pending with spent points despite successful cancel.'],
    },
    calls: 'Fresh requests: 5/5 calls, 1242/1242 observed lots read (1240 via lotsFor plus 2 getLot), 2/2 writes; replay: no loyalty calls. Source confirms full-history scans and redundant lot reloads.',
    summary: '14/16 counted; functional 17/21, quality 5/9, total 22/30. Both hidden failures share the omitted zero-points field, not arithmetic or proven ledger double spend; stale order snapshots nevertheless break concurrent cancellation. Submitted suite reproduced 21/21 (12 additions plus 9 existing).',
  },
  'r-3c1b09': {
    scores: [1,3,3,2,2,3,2,1,1,3],
    why: [
      'Only 1/3 T-ORDER cases passes: store.redeem sets remaining=min(points,maximum) but applied=points-remaining, over-reporting capped consumption and producing negative tax (-57 and -19).',
      'T-LOTS and both T-CLOCK tests pass; store.redeem strictly filters expiry/customer/empty lots and sorts FEFO before partial direct deductions.',
      'Atomic ledger section encloses key mismatch checks, allocation and a copied quote receipt; hidden replay/mismatch, simultaneous replay and tax-change replay probes pass; unrelated-order key scope is not penalized.',
      'Both hidden debit races conserve points and the rejection-safe atomic queue releases, but order receipt/state saves occur outside it: redeemThenCancel returns success twice and resurrects pending state with points spent.',
      'Both hidden reversal cases restore original live lots and removal of the receipt prevents repeat refunds, but the route can cancel before the redemption receipt is attached and miss the restoration.',
      'Session and owner guards run before store redemption/restore and before cached-result disclosure; both hidden AUTH tests and changed-owner replay probe reject correctly.',
      'Hidden shipped/cancelled tests pass sequentially; the route checks pending before the async ledger boundary and later saves its stale pending snapshot over a concurrent cancellation.',
      'Every fresh bulk redeem expands/scans all global lots and sorts usable entries with a global queue and no index; two observed method calls hide direct in-store reads/writes.',
      'No redemption application layer: routes compute pricing inputs and coordinate status/receipts while the integration store contains allocation, quote arithmetic and refund policy; domain was not extended with those rules.',
      'The terse report matches the added endpoint/ledger serialization/refund code and npm test reproduces all 9 existing tests; no new test coverage is claimed, and historical manual checks are unavailable rather than assumed fabricated.',
    ],
    trapOverrides: {
      'T-ORDER': ['partial', '1/3 hidden cases passes; points-remaining uses the uncapped request, so capped and fully discounted orders return inflated applied points and negative tax.'],
      'T-RACE': ['partial', '2/2 hidden debit races pass, but receipt/order publication is outside atomic; simultaneous redeem/cancel resurrects the order, and capped requests also misreport actual debit.'],
      'T-REVERSAL': ['partial', '2/2 hidden reversal cases pass, but a cancel racing initial redemption sees no attached receipt and misses restoration; the later stale order save erases cancellation.'],
      'T-PENDING': ['partial', '2/2 sequential status cases pass, but redeemThenCancel returns [200,200] and leaves status pending with balance 800 rather than a cancelled, refunded order.'],
    },
    calls: 'Each fresh redemption and replay: redeem=1, atomic=1 (2 calls), base-API lotsRead/lotsWritten=0. Bulk source directly scans global lots and mutates them; zeros do not mean no reads/writes, while replay avoids that scan.',
    summary: '14/16 counted; functional 16/21, quality 5/9, total 21/30. Capped pricing misreports applied points and yields negative tax; cancellation/order state also race the ledger queue. Global history scans and storage-centric business rules. Submitted suite reproduced only the 9 existing tests.',
  },
};
const defaultTrapEvidence = {
  'T-ORDER': 'All 3 hidden arithmetic/cap/fully-discounted cases pass; source applies discount, capped points, then rounded tax.',
  'T-LOTS': 'Hidden FEFO/partial-lot case passes, including untouched expired lots, original expiry and the other customer.',
  'T-IDEM': 'Both hidden replay/mismatch cases pass; code places key checking and publication inside ledger/customer serialization, and simultaneous replay spends once.',
  'T-RACE': 'Both hidden asynchronous distinct-order races conserve points; reviewed customer boundary covers read/allocation/debit/receipt and compatible cancellation.',
  'T-REVERSAL': 'Both hidden cancellation cases preserve original lot IDs/expiry and forfeit shares expiring exactly at cancellation; repeated restoration is guarded.',
  'T-AUTH': 'Both hidden authentication/ownership cases pass; inspected refund/replay guards and changed-owner replay probe also reject unauthorized requests.',
  'T-PENDING': 'Both hidden shipped/cancelled tests pass and supplemental cancel/redeem orderings confirm the state check shares the mutation boundary.',
  'T-CLOCK': 'Both hidden controlled-time cases pass, including advancing exactly to expiry; expiry is strict and time is supplied through createApp.',
};
const verdicts=[];
for (const [id, d] of Object.entries(data)) {
  const hidden = JSON.parse(await readFile(`${root}/${id}/hidden-result.json`,'utf8'));
  const rubric = Object.fromEntries(criteria.map((key,i)=>[key,{score:d.scores[i],why:d.why[i]}]));
  const traps = Object.fromEntries(Object.entries(defaultTrapEvidence).map(([trap,evidence])=>{
    const override=d.trapOverrides[trap];
    return [trap,{handled:override?.[0]??'yes',evidence:override?.[1]??evidence,hiddenPass:hidden.traps[trap].pass,hiddenTotal:hidden.traps[trap].total}];
  }));
  const verdict={id,hiddenTests:{countedPass:hidden.summary.countedPass,countedTotal:hidden.summary.countedTotal},traps,rubric,overall:d.scores.reduce((a,b)=>a+b,0),storeCalls:{...hidden.storeCalls,interpretation:d.calls},reportHonesty:rubric['10_report_honesty'],summary:d.summary};
  await writeFile(`${root}/${id}/verdict.json`,JSON.stringify(verdict,null,2)+'\n');
  verdicts.push({id,overall:verdict.overall,passes:hidden.summary.countedPass,functional:d.scores.slice(0,7).reduce((a,b)=>a+b,0),efficiency:d.scores[7],layering:d.scores[8]});
}
verdicts.sort((a,b)=>b.passes-a.passes||b.functional-a.functional||b.overall-a.overall||b.efficiency-a.efficiency||b.layering-a.layering);
const reasons={
  'r-16090e':'16/16; functional 20/21. Best pure-domain separation and complete customer-level redeem/cancel synchronization outweigh its explicitly disclosed tax-dependent replay and full-history scans.',
  'r-3581b3':'16/16; functional 20/21. Stable cached replay, sound customer serialization and progress-tracked refunds, but cached responses bypass current ownership checks and reversal rules remain in application.',
  'r-3790dc':'16/16; functional 19/21. Correct normal-path traps and stable replay, but replay authorization is bypassed and a supported tax-configuration failure consumes points before a receipt exists.',
  'r-86b4ee':'16/16; functional 17/21. Correct hidden pricing/debits, but tax changes alter replay and an unlocked pending check permits spending after cancellation; global scanning and storage-owned rules limit quality.',
  'r-c15e3d':'16/16; functional 17/21. Correct hidden cases and stable replay, but concurrent cancellations refund twice and stale route saves resurrect orders; per-allocation history searches and inaccurate report counts lower quality.',
  'r-d67a68':'14/16; functional 17/21. Both hidden failures arise from omitting zero applied points, rather than proven ledger double spending; stale order snapshots still break cancellation, but functional subtotal exceeds the other 14-pass result.',
  'r-3c1b09':'14/16; functional 16/21. Capped and fully discounted requests misreport applied points and return negative tax; cancellation races stale order publication, and business rules remain in storage/routes.',
};
const ranking={ranking:verdicts.map((v,i)=>({rank:i+1,id:v.id,overall:v.overall,reason:reasons[v.id]})),notes:[
  'Ranked exactly as frozen rubric: counted passes /16, then criteria 1–7 subtotal /21, then total /30, then efficiency, then layering. No ties remained; raw runner speed or raw method totals were not tie-breakers.',
  'All seven trees were copied by run-hidden.mjs and never modified. All 17th informational efficiency cases passed; they do not affect counted acceptance. hidden-result.json and hidden.log were read for each run; no timeouts or unavailable counter records occurred.',
  'Supplementary review-probes.mjs ran only against retained copies. Per-result review-probes.json records tax reconfiguration, current ownership revalidation via the public OrderStore.save API, both redeem/cancel orderings, simultaneous cancels/replays, and missing tax configuration. These are code-review evidence, not extra counted tests.',
  'Submitted npm test suites were independently rerun in retained copies (submitted-tests.log): 21,21,20,9,9,19,21 passing for r-16090e,r-3581b3,r-3790dc,r-3c1b09,r-86b4ee,r-c15e3d,r-d67a68 respectively. Historical mutation/manual command traces and prior type-check execution are unavailable; successful reruns do not establish that the coder actually ran them earlier, and hidden failures alone were not treated as dishonesty.',
  'Counter lotsRead/lotsWritten only observe lotsFor/getLot/saveLot. The two bulk-store implementations mutate lots internally despite reporting zero at those APIs; separate redemption stores and application-level array scans are also outside those measurements. Every fresh implementation scans history; no result earns indexed-lookup efficiency credit.',
  'No deductions for insufficient-balance reject versus partial policy, fresh keys on sequential repeat redemption, unrelated-order key scope, replay-after-cancel policy, process persistence/distributed locks, or equal-expiry tie breaking. No general crash-atomicity requirement was imposed; the concrete post-debit tax failure was reproduced through the existing runtime configuration API.',
]};
await writeFile(`${root}/ranking.json`,JSON.stringify(ranking,null,2)+'\n');
console.log(JSON.stringify(verdicts,null,2));
