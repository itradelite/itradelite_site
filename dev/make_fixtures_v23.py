#!/usr/bin/env python3
"""Add the contract v2.3 (ranking option1) fields to the dev fixtures.

    python3 -I dev/make_fixtures_v23.py

Idempotent and deterministic. v2.3 (engine docs/DATA_CONTRACT.md "v2.3"):
  - today.json / preclose.json run fields: ranking_version, ranking,
    ranking_degraded
  - rows: composite_v1_legacy, fund_v2 (+ pillars), fund_v2_percentile,
    fund_filter {eligible, reason, cutoff}, tiebreak_note
    (today: BEN.AX setup excluded by the fundamentals filter; pre-close: one
    excluded setup and a tiebreak note on the TREND_PULLBACK order)
  - metrics.json (default and real/): ranking_variants copied from
    dev/real_ranking_variants_v23.json (the real engine output of 24 Nov 2026)
  - real/today.json is a REAL night scan output (engine branch claude/v5-rank,
    run as of 20 Nov 2026 evening against Yahoo, full universe) -- not
    generated here.
These are NOT pipeline outputs; never copy them into public/.
"""
import hashlib
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(ROOT, "dev", "fixtures")
CUTOFF = 38.22
PILLARS = ("valuation", "cash", "quality", "balance", "growth")
RANKING = {
    "version": "option1_v1", "weights": {"ta": 0.55, "fund_v2": 0.25, "sentiment": 0.2},
    "fund_filter": {"enabled": True, "bottom_pct": 20.0},
    "tiebreak": {"enabled": True, "window_points": 3.0, "pillar": "growth",
                 "strategies": ["TREND_PULLBACK", "MOMENTUM", "HIGH52W_MOMENTUM", "GAP_FADE_CONTINUATION", "PEAD"]},
    "degrade": {"min_fund_v2_coverage": 0.5}, "source": "config/ranking.json",
    "fund_v2_population": {"n_scored": 117, "n_applicable": 117, "coverage": 1.0, "bottom_pct": 20.0,
                           "cutoff": CUTOFF, "degraded": False, "reason": None, "population": "scanned symbols"},
}
ETFS = {"DHHF.AX", "AFI.AX"}


def h(sym, salt=""):
    return int(hashlib.sha1((sym + salt).encode()).hexdigest()[:8], 16)


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dump(p, d):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
        f.write("\n")


def aug_row(r, excluded=None):
    sym = r.get("symbol") or ""
    if "composite_v1_legacy" not in r:
        r["composite_v1_legacy"] = r.get("composite_score")
    if sym in ETFS:
        r.update({"fund_v2": None, "fund_v2_pillars": {p: None for p in PILLARS},
                  "fund_v2_label": "not applicable (ETF/fund)", "fund_v2_coverage": 0.0, "sector": "ETF/fund",
                  "fund_v2_percentile": None,
                  "fund_filter": {"eligible": True, "reason": "fundamentals: no data", "cutoff": CUTOFF}})
    else:
        v2 = r.get("fund_v2")
        if v2 is None:
            v2 = round(40 + h(sym) % 55 + (h(sym, "d") % 10) / 10, 1)
            r["fund_v2"] = v2
            r["fund_v2_pillars"] = {p: round(20 + h(sym, p) % 80, 1) for p in PILLARS}
            r["fund_v2_label"] = "vs peers: middle of the pack"
            r["fund_v2_coverage"] = 1.0
        if sym == excluded:
            r["fund_v2"] = 31.0
            r["fund_v2_label"] = "vs Banks: expensive, low quality"
        r["fund_v2_percentile"] = round(min(99.0, max(1.0, (r["fund_v2"] - 20) * 1.2)), 1)
        bad = r["fund_v2"] < CUTOFF
        r["fund_filter"] = {"eligible": not bad,
                            "reason": f"fundamentals bottom 20% (v2 = {r['fund_v2']:.1f}, cutoff {CUTOFF:.2f})" if bad else None,
                            "cutoff": CUTOFF}
    r.setdefault("tiebreak_note", None)
    return r


def aug_run(d):
    d["ranking_version"] = "option1_v1"
    d["ranking"] = json.loads(json.dumps(RANKING))
    d["ranking_degraded"] = {"degraded": False, "reason": None}


def main():
    t = load(os.path.join(FX, "today.json"))
    aug_run(t)
    for k in ("recommended_orders", "setups", "watchlist_full", "withheld_orders"):
        for r in t.get(k) or []:
            aug_row(r, excluded="BEN.AX")
    dump(os.path.join(FX, "today.json"), t)

    p = load(os.path.join(FX, "preclose.json"))
    aug_run(p)
    for k in ("recommended_orders", "setups", "watchlist_full", "withheld_orders"):
        for r in p.get(k) or []:
            ex = None
            if k != "recommended_orders" and r.get("symbol") not in {x.get("symbol") for x in p.get("recommended_orders") or []}:
                ex = (p.get("setups") or [{}])[-1].get("symbol")
            aug_row(r, excluded=ex)
            if k == "recommended_orders" and r.get("strategy") == "TREND_PULLBACK":
                r["tiebreak_note"] = ("tiebreak: growth 81 vs 22 for WTC.AX (composite "
                                      f"{(r.get('composite_score') or 0):.1f} vs {(r.get('composite_score') or 0) + 1.8:.1f}, within 3 pts)")
                r["fund_v2_pillars"]["growth"] = 81.0
    dump(os.path.join(FX, "preclose.json"), p)

    rv = load(os.path.join(ROOT, "dev", "real_ranking_variants_v23.json"))
    for path, compact in ((os.path.join(FX, "metrics.json"), False), (os.path.join(FX, "real", "metrics.json"), True)):
        m = load(path)
        m["ranking_variants"] = rv
        with open(path, "w", encoding="utf-8") as f:
            if compact:
                json.dump(m, f, ensure_ascii=False, separators=(",", ":"))
            else:
                json.dump(m, f, indent=1, ensure_ascii=False)
                f.write("\n")
    print("v2.3 fixtures written")


if __name__ == "__main__":
    main()
