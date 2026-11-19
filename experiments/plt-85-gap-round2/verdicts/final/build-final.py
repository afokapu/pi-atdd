import copy
import glob
import json
from collections import defaultdict
from pathlib import Path

FINAL = Path(__file__).resolve().parent
VERDICTS = FINAL.parent
WORK = Path('~/forge-evidence/pi-atdd/plt-85-evaluator-work')
calibration = json.loads((FINAL / 'calibration.json').read_text())
corrections = {(c['id'], c['criterion']): c for c in calibration['corrections']}
assert len(corrections) == len(calibration['corrections']) == 17
rows = []
used = set()
for path in sorted(VERDICTS.glob('batch-*/*/verdict.json')):
    verdict = json.loads(path.read_text())
    hidden = json.loads((path.parent / 'hidden-result.json').read_text())
    counted = [t for t in hidden['tests'] if t.get('counts', False)]
    assert len(counted) == 33, path
    count = sum(t['pass'] for t in counted)
    assert count == verdict['hiddenTests']['countedPass'], path
    rubric = copy.deepcopy(verdict['rubric'])
    assert len(rubric) == 10
    assert sum(v['score'] for v in rubric.values()) == verdict['overall'], path
    for criterion, value in rubric.items():
        change = corrections.get((verdict['id'], criterion))
        if change:
            assert change['from'] == value['score']
            value['score'] = change['to']
            value['why'] = change['why']
            value['calibratedFrom'] = change['from']
            used.add((verdict['id'], criterion))
    scores = [v['score'] for v in rubric.values()]
    assert all(0 <= s <= 3 for s in scores)
    functional = sum(scores[:7])
    quality = sum(scores[7:])
    rows.append({
        'id': verdict['id'], 'batch': path.parent.parent.name,
        'countedPass': count, 'countedTotal': 33,
        'rubric': rubric, 'functionalSubtotal': functional,
        'qualitySubtotal': quality, 'overall': sum(scores),
        'rankingKey': [count, functional, sum(scores), scores[7], scores[8]],
        'evidence': {
            'originalVerdict': str(path),
            'hiddenResult': str(path.parent / 'hidden-result.json'),
            'hiddenLog': str(path.parent / 'hidden.log'),
            'tree': str(WORK / path.parent.parent.name / verdict['id'] / 'tree'),
            'diff': str(WORK / path.parent.parent.name / verdict['id'] / 'result.diff'),
            'report': str(WORK / path.parent.parent.name / verdict['id'] / 'report.md'),
            'supplementalClockProbe': 'clock-probe.json' if verdict['id'] in {'r-8c4084', 'r-e60b3c', 'r-0e2a35', 'r-389a5e', 'r-8403c2'} else None,
            'unavailable': ['Original coder command transcripts are not supplied; earlier public reruns are reproduction evidence.'],
        },
    })
assert len(rows) == 30 and used == set(corrections)
# The ID is used only to display members of a true tie deterministically, never
# as an additional ranking key.
rows.sort(key=lambda r: (tuple(-x for x in r['rankingKey']), r['id']))
groups = defaultdict(list)
for row in rows:
    groups[tuple(row['rankingKey'])].append(row['id'])
reasons = {
 'r-18fc74': '31/33 with functional 20/21 leads, despite full-history reads and an uncompensated post-debit repricing window',
 'r-1a5cc8': '31/33 is second on functional 18/21 because cached replay bypasses current ownership, despite strong layering',
 'r-06e5b0': '29/33, functional 20/21 and overall 27/30 combine stored replay, compatible locking and a usable-only API, with GET-quote and atomicity gaps',
 'r-c6c9a1': '29/33, functional 20/21 and overall 27/30 combine stored replay, compatible locking and a usable-only API, with GET-quote and atomicity gaps',
 'r-6aab20': '29/33 retains working yielding races and persisted quotes, but ownership-bypassing replay and post-debit tax failures limit functional credit to 18/21',
 'r-8403c2': '29/33 ranks above all 28-pass results, but repriced replay and queued debit/refund expiry defects reduce functional credit to 17/21',
 'r-bd6c6b': '28/33 and functional 20/21 lead the 28-pass group through copied-ledger failure safety, despite repriced replay, route-heavy logic and quadratic refund/history rewrites',
 'r-8c4084': '28/33 with functional 17/21 beats the remaining 28-pass results, despite repriced replay, queued refund expiry errors and full-history allocation scans',
 'r-389a5e': '28/33 with functional 16/21 exceeds the other remaining 28-pass result, but stale pending checks, repriced replay and queued expiry defects remain',
 'r-0e2a35': '28/33 still outranks lower pass counts, but claimed-versus-debited point mismatch, repriced replay and queued expiry defects leave functional 15/21',
 'r-7713e9': '27/33, functional 20/21 and overall 28/30 lead the 27-pass group through pure-domain layering and a usable-only query, despite tax-failure debits and stale GET quotes',
 'r-4e064f': '27/33, functional 20/21 and overall 27/30 win the efficiency tie-break over equal-total peers through an explicit customer-indexed filtered query, despite copying history',
 'r-2b7afa': '27/33, functional 20/21 and overall 27/30 reflect authorized stored replay and pure-domain rules, with stale GET quotes, full-history reads and uncompensated writes',
 'r-ae736d': '27/33, functional 20/21 and overall 27/30 reflect authorized stored replay and pure-domain rules, with stale GET quotes, full-history reads and uncompensated writes',
 'r-afbc49': '27/33, functional 20/21 and overall 27/30 reflect authorized stored replay and pure-domain rules, with stale GET quotes, full-history reads and uncompensated writes',
 'r-c4da81': '27/33, functional 20/21 and overall 27/30 reflect authorized stored replay and pure-domain rules, with stale GET quotes, full-history reads and uncompensated writes',
 'r-f55914': '27/33 and functional 20/21 retain safe customer serialization and stored replay, while overall 26/30 trails the better-layered equal-function peers',
 'r-d7208b': '27/33, functional 20/21 and overall 25/30 beat the equal-total quadratic peer on efficiency, while full-history reads and overbroad atomicity wording remain',
 'r-99d6a5': '27/33 and functional 20/21 preserve strong replay and guards, but repeated full-history searches lower efficiency to 0 and overall to 25/30',
 'r-7c9b86': '27/33 with functional 18/21 and overall 23/30 is limited by replay reauthorization gaps and quadratic allocation/history searches',
 'r-66547b': '27/33 with functional 18/21 and overall 23/30 is limited by replay reauthorization gaps and quadratic allocation/history searches',
 'r-e60b3c': '27/33 precedes all 26-pass results, but stale pending eligibility and queued refund expiry defects lower functional credit to 17/21',
 'r-517e45': '26/33, functional 19/21 and overall 24/30 lead the 26-pass group despite zero-payable rejection, stale GET quotes and quadratic full-history commits',
 'r-e1bdd8': '26/33 and functional 19/21 beat lower-functional peers despite route-concentrated logic, repriced replay and full-history reads',
 'r-2d7791': '26/33, functional 18/21 and overall 24/30 exceed other equal-functional peers through a candid report, despite replay authorization and publication gaps',
 'r-d49316': '26/33 and functional 18/21 exceed the lower-functional 26-pass result, but repriced unauthorized replay and overstated stored/atomic claims reduce overall to 22/30',
 'r-4112e4': '26/33 outranks all 25-pass results, but simultaneous cancellation double-restoration and stale eligibility reduce functional credit to 17/21',
 'r-f9af78': '25/33, functional 20/21 and overall 26/30 beat the equal-pass peer, despite post-debit tax failures, stale GET quotes and full-history reads',
 'r-77901c': '25/33 and functional 20/21 trail the equal-pass peer on overall 24/30 after quadratic reversal/history searches, with tax-failure debits and stale GET quotes remaining',
 'r-59f404': '24/33 is last under the pass-first rule, with repriced replay, post-debit tax failures, quadratic history searches and an unsupported stored-quote claim',
}
ranking = []
previous = None
for position, row in enumerate(rows, 1):
    key = tuple(row['rankingKey'])
    if key != previous:
        rank = position
    row['rank'] = rank
    reason = reasons[row['id']]
    peers = groups[key]
    if len(peers) > 1:
        others = ', '.join(p for p in peers if p != row['id'])
        reason += f'; tied with {others} because all five prescribed ranking keys are equal'
    ranking.append({'rank': rank, 'id': row['id'], 'countedPass': row['countedPass'], 'overall': row['overall'], 'reason': reason + '.'})
    previous = key
notes = [
    'Frozen rule, descending lexicographic order: countedPass/33, functional subtotal (criteria 1-7), calibrated overall, efficiency (criterion 8), layering (criterion 9); runner speed, arbitrary raw method totals and uncounted probe counts are never tie-breakers.',
    'Competition ranks are used: tied entries share the same rank and subsequent ranks skip the occupied positions; IDs only order the display within a tie.',
    'The ties are r-06e5b0/r-c6c9a1 at (29,20,27,2,2); r-2b7afa/r-ae736d/r-afbc49/r-c4da81 at (27,20,27,1,3); and r-66547b/r-7c9b86 at (27,18,23,0,2): each group is indistinguishable under every remaining permitted ranking key, although its implementations are not identical.',
    'Pass counts were checked against every existing hidden-result.json: all 30 have 33 counted cases and agree with their batch verdict; supplemental calibration probes do not alter counted passes.',
    'calibration.json records all 17 score corrections with source evidence; calibrated-scores.json publishes all ten criterion scores/evidence and recomputed functional/quality/overall totals for every result.',
    'No batch verdicts or result trees were modified; only final/ outputs were written, and no model/condition attribution was sought.'
]
(FINAL / 'ranking.json').write_text(json.dumps({'ranking': ranking, 'notes': notes}, indent=2) + '\n')
(FINAL / 'calibrated-scores.json').write_text(json.dumps({'results': rows, 'notes': notes}, indent=2) + '\n')
print('rank id         pass functional overall eff layer')
for row in rows:
    print(f"{row['rank']:>4} {row['id']} {row['countedPass']:>4} {row['functionalSubtotal']:>10} {row['overall']:>7} {row['rankingKey'][3]:>3} {row['rankingKey'][4]:>5}")
print(f'Validated {len(rows)} results, {len(used)} corrections, {sum(len(g)>1 for g in groups.values())} tie groups.')
