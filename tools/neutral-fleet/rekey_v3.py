"""PLT-84: re-key neutral records that use stage-2 key proposals onto vocabulary v3 (seed for re-audit).
Usage: python3 tools/neutral-fleet/rekey_v3.py <seed-dir>   -> <seed-dir>/<rule_id>/{neutral.json,seed.json}, ids.txt
Only key references change: profileRequirements keys (merged when two old keys land on one target),
classification 'profile:' targets, and literal key names in core, notes and bunOnly text."""
import json, glob, os, re, sys
sys.path.insert(0, os.path.dirname(__file__)); import consolidate_v3 as C
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
P = set(json.load(open(os.path.join(ROOT, "profiles/proposed-keys.json")))["proposals"])
OLD_REF = r"(?<![\w.#])(%s)(?![\w#])(?!\.[a-z])"
pat = re.compile(OLD_REF % "|".join(map(re.escape, sorted(P, key=len, reverse=True))))
sub = lambda t: pat.sub(lambda m: C.target(m.group(1)), t)
def deep(x):
    if isinstance(x, str): return sub(x)
    if isinstance(x, list): return [deep(y) for y in x]
    if isinstance(x, dict): return {k: deep(v) for k, v in x.items()}
    return x
retarget = lambda a: ("profile:" + (C.target(a[8:]) if a[8:] in P else a[8:])) if a.startswith("profile:") else a
if __name__ == "__main__":
    out = sys.argv[1]; ids = []; stats = {"records": 0, "textRefs": 0, "merged": 0}
    for f in sorted(glob.glob(os.path.join(ROOT, "conventions-neutral/**/*.json"), recursive=True)):
        r = json.load(open(f))
        if not any(p["key"] in P for p in r["profileRequirements"]): continue
        reqs = {}
        for p in r["profileRequirements"]:
            k = C.target(p["key"]) if p["key"] in P else p["key"]
            q = {"key": k, "meaning": sub(p["meaning"]), "bunValue": sub(str(p["bunValue"]))}
            if k in reqs:
                stats["merged"] += 1
                reqs[k] = {"key": k, "meaning": reqs[k]["meaning"] + " | " + q["meaning"], "bunValue": reqs[k]["bunValue"] + " | " + q["bunValue"]}
            else: reqs[k] = q
        stats["textRefs"] += len(pat.findall(json.dumps([r["core"], r.get("neutralityNotes", ""), r["bunOnly"], r["classification"]])))
        cls = [{**deep({k: v for k, v in c.items() if k != "as"}), "as": list(dict.fromkeys(retarget(a) for a in c["as"]))} for c in r["classification"]]
        n = {"rule_id": r["rule_id"], "core": deep(r["core"]), "profileRequirements": list(reqs.values()), "proposedKeys": [],
             "bunOnly": deep(r["bunOnly"]), "classification": cls, "neutralityNotes": deep(r.get("neutralityNotes", ""))}
        d = os.path.join(out, r["rule_id"]); os.makedirs(d, exist_ok=True)
        json.dump(n, open(os.path.join(d, "neutral.json"), "w"), indent=2)
        json.dump({"rekey": "vocabulary v3 (tools/neutral-fleet/consolidate_v3.py)", "previousAudit": r["audit"]}, open(os.path.join(d, "seed.json"), "w"), indent=2)
        ids.append(r["rule_id"]); stats["records"] += 1
    open(os.path.join(out, "ids.txt"), "w").write("\n".join(ids) + "\n")
    print(json.dumps(stats))
