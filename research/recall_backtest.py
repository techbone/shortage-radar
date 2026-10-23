"""Does a recent recall of the same drug precede an FDA shortage posting?

Research script behind the finding in docs/build-log.md (answer: no, 0.7-0.9x vs baseline).

Inputs in <data_dir> (fetch with curl -g):
  sh0.json, sh1.json   https://api.fda.gov/drug/shortages.json?limit=1000&skip={0,1000}
  rc_<n>.json          https://api.fda.gov/drug/enforcement.json?limit=1000&skip={0..18000 step 1000}
  ndc_anda_generics.json  https://api.fda.gov/drug/ndc.json?search=marketing_category:"ANDA"&count=generic_name.exact&limit=1000

Usage: python3 research/recall_backtest.py <data_dir> [window_days=365]
Caveats: ingredient matching is a crude first-token key; the shortage feed only holds entries still listed,
so resolved shortages are under-represented.
"""
import json, glob, re, sys, random, datetime as dt
D = sys.argv[1]
SALTS = r"\b(hydrochloride|hcl|sodium|potassium|sulfate|acetate|citrate|phosphate|tartrate|maleate|mesylate|besylate|succinate|bromide|chloride|calcium|magnesium|injection|injectable|tablets?|capsules?|solution|usp|for|oral|extended|release|and|in|water|dextrose)\b"
def key(name):
    n = re.sub(r"[^a-z ]", " ", (name or "").lower())
    n = re.sub(SALTS, " ", n)
    toks = [t for t in n.split() if len(t) > 3]
    return toks[0] if toks else None
def d_mdy(s): return dt.datetime.strptime(s, "%m/%d/%Y").date()
def d_ymd(s): return dt.datetime.strptime(s, "%Y%m%d").date()

sh = json.load(open(f"{D}/sh0.json"))["results"] + json.load(open(f"{D}/sh1.json"))["results"]
rc = []
for f in glob.glob(f"{D}/rc_*.json"): rc += json.load(open(f)).get("results", [])
recalls = {}  # ingredient key -> list of (date, firm, classification, reason)
for r in rc:
    text = (r.get("product_description") or "").lower()
    gens = r.get("openfda", {}).get("generic_name") or []
    keys = {key(g) for g in gens} | {key(text)}
    for k in keys - {None}:
        recalls.setdefault(k, []).append((d_ymd(r["recall_initiation_date"]), r.get("recalling_firm",""), r.get("classification"), r.get("reason_for_recall","")[:80]))

# earliest posting per ingredient, posted 2025-2026
first = {}
for s in sh:
    k = key((s.get("openfda", {}).get("generic_name") or [s.get("generic_name")])[0])
    if not k: continue
    p = d_mdy(s["initial_posting_date"])
    if k not in first or p < first[k][0]: first[k] = (p, s.get("company_name"), s.get("status"))
shortage_keys = set(first)
test = {k: v for k, v in first.items() if v[0].year >= 2025}

def hit(k, ref, days):
    return [x for x in recalls.get(k, []) if ref - dt.timedelta(days=days) <= x[0] < ref]

W = int(sys.argv[2]) if len(sys.argv) > 2 else 365
pos = {k: hit(k, v[0], W) for k, v in test.items()}
rate_short = sum(1 for v in pos.values() if v) / len(pos)

# baseline: ANDA generics never on shortage list, reference dates sampled from shortage posting dates
base = [key(x["term"]) for x in json.load(open(f"{D}/ndc_anda_generics.json"))["results"]]
base = sorted({b for b in base if b and b not in shortage_keys})
random.seed(7)
ref_dates = [v[0] for v in test.values()]
trials = [(b, random.choice(ref_dates)) for b in base for _ in range(5)]
rate_base = sum(1 for b, d in trials if hit(b, d, W)) / len(trials)

print(f"window={W}d  shortage ingredients posted 2025-26: {len(test)}  baseline Rx generics: {len(base)}")
print(f"had a recall of same ingredient in prior window: shortages {rate_short:.1%}  vs  baseline {rate_base:.1%}  lift x{rate_short/max(rate_base,1e-9):.1f}")
same_firm = sum(1 for k, v in pos.items() if any(test[k][1] and test[k][1].split()[0].lower() in h[1].lower() for h in v))
print(f"...recall by the SAME company that later reported the shortage: {same_firm}/{len(test)}")
ex = sorted(((k, test[k][0], h) for k, h in pos.items() if h), key=lambda x: -len(x[2]))[:6]
for k, p, h in ex:
    h = sorted(h)
    print(f"  {k:<16} shortage posted {p}  recalls before: {len(h)}  first {h[0][0]} {h[0][1][:28]!r} {h[0][2]}  {h[0][3][:50]!r}")
