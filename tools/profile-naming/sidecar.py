#!/usr/bin/env python3
"""PLT-87: re-key the PLT-81 sidecar manifest to profile-first ids.

The frozen sidecar files (conventions-sidecar/{conventions,splits,evidence,shared}/)
are NOT touched: their sidecarSha256 pins stay valid and their inner rule_id stays
the pre-rename id (it resolves through conventions/aliases.json).

manifest.json:
  * entries / splits / excluded are keyed by the new id; each keeps `legacyId`;
  * sourcePath + sourceSha256 point at the relocated canonical file;
    `legacySourcePath` + `legacySourceSha256` keep the PLT-81 pin (restoring the
    old rule_id in the new file reproduces it, see conventions/provenance.json);
  * split `parts` get new ids (`<new source id>-<part suffix>`), old part ids kept
    in `legacyParts`.
conventions/aliases.json gains `splitParts` (old part id -> new part id).
Run once after move.py, from the repository root.
"""
import hashlib, json, re

ALIASES = "conventions/aliases.json"
MANIFEST = "conventions-sidecar/manifest.json"
PROV = "conventions/provenance.json"
ID_RE = re.compile(r"^(planner|tester|coder|reviewer|coach|shared)\.[a-z0-9-]+\.[a-z0-9-]+$")


def main():
    al = json.load(open(ALIASES))
    aliases = al["aliases"]
    prov = {r["old"]: r for r in json.load(open(PROV))["files"] if "old" in r}
    m = json.load(open(MANIFEST))
    if "legacyCanonicalCatalogLockSha256" in m:
        raise SystemExit("manifest already re-keyed")

    def rekey(entry, old):
        r = prov[old]
        assert entry["sourcePath"] == r["oldPath"] and entry["sourceSha256"] == r["oldSha256"], old
        return {"legacyId": old, **entry, "sourcePath": r["newPath"], "sourceSha256": r["newSha256"],
                "legacySourcePath": r["oldPath"], "legacySourceSha256": r["oldSha256"]}

    parts = {}
    for old, e in m["splits"].items():
        for p in e["parts"]:
            assert p.startswith(old + "."), p
            new = aliases[old] + "-" + p[len(old) + 1:]
            assert ID_RE.match(new) and new not in aliases.values() and new not in parts.values(), new
            parts[p] = new
    m["entries"] = {aliases[k]: rekey(v, k) for k, v in m["entries"].items()}
    m["splits"] = {aliases[k]: {**rekey(v, k), "parts": [parts[p] for p in v["parts"]], "legacyParts": v["parts"]}
                   for k, v in m["splits"].items()}
    m["excluded"] = {aliases[k]: {"legacyId": k, **v} for k, v in m["excluded"].items()}
    m["legacyCanonicalCatalogLockSha256"] = m["canonicalCatalogLockSha256"]
    m["canonicalCatalogLockSha256"] = hashlib.sha256(open("vendor/catalog.lock.json", "rb").read()).hexdigest()
    m["renamedBy"] = {"issue": "PLT-87", "aliases": ALIASES, "provenance": PROV,
                      "note": "ids and source pins re-keyed; frozen sidecar files unchanged (their rule_id is the legacy id)"}
    with open(MANIFEST, "w") as fh:
        json.dump(m, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    al["splitParts"] = dict(sorted(parts.items()))
    with open(ALIASES, "w") as fh:
        fh.write(json.dumps(al, indent=2) + "\n")
    print(len(m["entries"]), "entries,", len(m["splits"]), "splits,", len(parts), "parts re-keyed")


if __name__ == "__main__":
    main()
