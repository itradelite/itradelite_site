#!/usr/bin/env python3
"""Add the contract v2.1 fields to the dev fixtures (dev/fixtures/).

    python3 -I dev/make_fixtures_v21.py

The original generator (dev/make_fixtures.py) read the v1 files in public/,
which production no longer publishes, so this script augments the existing
v2 fixtures in place instead. It is idempotent and deterministic (seeded).

v2.1 (DATA_CONTRACT.md "v2.1 additions"):
  - today.json rows: exit_plans (fixed_5d default first, trail_2atr, trail_1pct)
  - live.json items: trails {policy_id: {peak_since_fill, trail_level,
    exit_by_date, status}}
  - NEW preclose.json (itl.preclose.v2) + sets: pcstale/ (old session),
    pcunpub/ (published=false), edge/ (missing fields)
  - metrics.json: tracked_policy_ids, streams{night, preclose_proxy,
    preclose_live, comparison}, stake{by, all_setups} -- copied from
    dev/real_metrics_v21.json when present (real simulator shape), and the
    whole real file as set real/ (synthetic fallback otherwise)
  - status.json: preclose_scan job
These are NOT pipeline outputs; never copy them into public/.
"""
import copy
import json
import os
import random
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(ROOT, "dev", "fixtures")
rnd = random.Random(20261124)
TRACKED = ["fixed_5d", "trail_2atr", "trail_1pct"]
LABELS = {"fixed_5d": "Legacy: exit at close of day 5", "trail_2atr": "Trail 2x ATR from peak", "trail_1pct": "Trail 1% from peak"}


def load(rel):
    with open(os.path.join(FX, rel)) as f:
        return json.load(f)


def dump(rel, obj):
    p = os.path.join(FX, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write("\n")


def dec(px):
    return 3 if px < 2 else 2


def rt(px, up=False):
    t = 0.001 if px < 0.1 else 0.005 if px < 2 else 0.01
    n = px / t
    n = -(-n // 1) if up else round(n)
    return round(n * t, dec(px))


def exit_plans(row, exit_by):
    stop = row.get("stop")
    atr = row.get("atr14")
    px = row.get("entry_ref") or row.get("last_close") or 10
    fixed = {"policy_id": "fixed_5d", "label": LABELS["fixed_5d"], "kind": "time", "initial_stop": stop,
             "days": 5, "time_stop_days": 5, "activate_after_r": None, "exit_by_date": exit_by}
    atrp = {"policy_id": "trail_2atr", "label": LABELS["trail_2atr"], "kind": "trail_atr", "initial_stop": stop,
            "atr_mult": 2.0, "trail_atr_aud": rt(2 * atr, up=False) if atr else None, "activate_after_r": None, "time_stop_days": 20}
    if atrp["trail_atr_aud"] is not None and px < 2:
        atrp["trail_atr_aud"] = round(2 * atr, 3)
    pct = {"policy_id": "trail_1pct", "label": LABELS["trail_1pct"], "kind": "trail_pct", "initial_stop": stop,
           "trail_pct": 1.0, "activate_after_r": None, "time_stop_days": 20}
    return [fixed, atrp, pct]


def default_plan(plans):
    return dict(plans[0])


# ── today.json ─────────────────────────────────────────────────────────────
NIGHT_EXIT_BY = "2026-11-30"  # day 1 = valid_for Tue 24 Nov -> day 5 = Mon 30 Nov
td = load("today.json")
td["exit_policy"] = {"id": "fixed_5d", "label": LABELS["fixed_5d"], "kind": "time", "days": 5}
td["tracked_policy_ids"] = TRACKED
for key in ("recommended_orders", "setups", "watchlist_full"):
    for r in td[key]:
        if r.get("symbol") == "WTC.AX":
            # keep one legacy-shaped row: exit_plan only, no exit_plans
            r.pop("exit_plans", None)
            continue
        plans = exit_plans(r, NIGHT_EXIT_BY)
        r["exit_plans"] = plans
        r["exit_plan"] = default_plan(plans)
dump("today.json", td)

te = load("edge/today.json")
for r in te["watchlist_full"]:
    if r.get("exit_plan") is not None:
        plans = exit_plans(r, None)  # exit_by_date not published -> wording without date
        plans[1]["trail_atr_aud"] = None
        r["exit_plans"] = plans
        r["exit_plan"] = default_plan(plans)
dump("edge/today.json", te)

# ── live.json ──────────────────────────────────────────────────────────────
lv = load("live.json")
lv["exit_policy"] = {"id": "fixed_5d", "label": LABELS["fixed_5d"], "kind": "time", "days": 5}
lv["tracked_policy_ids"] = TRACKED
for it in lv["items"]:
    if it["symbol"] == "PME.AX":
        it["peak_since_fill"] = 188.42
        it["trail_level"] = None  # default fixed_5d has no trail
        it["effective_stop"] = it["stop"]
        it["trails"] = {
            "fixed_5d": {"peak_since_fill": 188.42, "trail_level": None, "exit_by_date": "2026-11-30", "status": "HOLD"},
            "trail_2atr": {"peak_since_fill": 188.42, "trail_level": 184.65, "exit_by_date": None, "status": "HOLD"},
            "trail_1pct": {"peak_since_fill": 188.42, "trail_level": 186.54, "exit_by_date": None, "status": "EXIT"},
        }
        it["reasons"] = ["Opened at 186.90, below the 187.76 limit — filled at the open (est.).",
                         "Default exit (fixed 5 days): hold, sell at the close on Mon 30 Nov; initial stop 178.00.",
                         "Tracked alternatives: 2×ATR trail 184.65 (hold); 1% trail 186.54 was broken at 185.10 (would exit)."]
    else:
        it["trails"] = None
dump("live.json", lv)

le = load("edge/live.json")
for it in le["items"]:
    if it["symbol"] == "CBA.AX":
        it["trails"] = {"fixed_5d": {"status": "EXIT"}, "trail_2atr": {"trail_level": 157.8, "status": "EXIT"},
                        "trail_9pct": {"trail_level": None, "status": "n/a"}}
    if it["symbol"] == "PME.AX":
        it["trails"] = "not-an-object"
dump("edge/live.json", le)

# ── preclose.json ──────────────────────────────────────────────────────────
night_rows = {r["symbol"]: r for r in td["setups"]}


def pc_row(src, symbol, strategy, live_px, stop, atr, score, comp, status="Valid", gates=None, note=None):
    r = copy.deepcopy(src)
    entry = rt(live_px, up=True)
    rps = round(entry - stop, 4)
    r.update({
        "symbol": symbol, "strategy": strategy, "status": status, "score": score, "composite_score": comp,
        "order_type": "MARKET_CLOSE", "trigger": None, "limit": None, "entry_ref": entry,
        "entry_text": f"market on close (closing auction); ref {entry}",
        "last_close": live_px, "stop": stop, "atr14": atr, "price_decimals": dec(entry),
        "tp1": rt(entry + 1.5 * atr), "tp2": rt(entry + 3 * atr), "risk_per_share": rps,
        "r_mult": round(3 * atr / rps, 2) if rps > 0 else None,
        "fail_gates": gates or [], "also_fired": [],
        "plain_english": note or f"{strategy.replace('_', ' ').title()} on today's bar (live price {live_px} spliced in): buy in the closing auction / at market before the close. Stop {stop}.",
    })
    plans = exit_plans(r, "2026-12-01")
    r["exit_plans"] = plans
    r["exit_plan"] = default_plan(plans)
    return r


base_src = night_rows["AFI.AX"]
pc_rec = [
    pc_row(base_src, "LTR.AX", "MEAN_REVERSION", 0.553, 0.505, 0.0417, 91.0, 72.4,
           note="Mean reversion (oversold into the close): buy in the closing auction or at market before 15:59 Sydney. Live price 0.553 at 15:15; stop 0.505 (~1.2 ATR). Reward/risk 3.0R."),
    pc_row(base_src, "BSL.AX", "TREND_PULLBACK", 30.81, 29.75, 0.8417, 86.0, 70.1),
]
pc_setups = copy.deepcopy(pc_rec) + [
    pc_row(base_src, "NST.AX", "MEAN_REVERSION", 21.93, 20.66, 1.075, 78.0, 64.0, status="Watch",
           gates=["score 78 < 80 (Valid threshold)", "composite 64.0 < 70"]),
    pc_row(base_src, "CDA.AX", "MEAN_REVERSION", 48.95, 45.52, 2.9333, 81.0, 70.6, status="Valid"),
]
pc = copy.deepcopy({k: td[k] for k in ("schema", "job", "generated_at_utc", "generated_at_bne", "market_state", "stale_after_utc", "run_id")})
pc.update({
    "schema": "itl.preclose.v2", "job": "preclose_scan",
    "generated_at_utc": "2026-11-24T04:16:40+00:00", "generated_at_bne": "2026-11-24T14:16:40+10:00",
    "market_state": {"now_syd": "2026-11-24T15:16:40+11:00", "now_bne": "2026-11-24T14:16:40+10:00", "trading_day": True,
                     "phase": "open", "session_date": "2026-11-24", "open_syd": "2026-11-24T10:00:00+11:00",
                     "close_syd": "2026-11-24T16:00:00+11:00", "minutes_to_close": 43.3, "minutes_since_open": 316.7,
                     "last_completed_session": "2026-11-23", "next_session": "2026-11-25"},
    "stale_after_utc": "2026-11-24T05:10:00+00:00",
    "run_id": "45399911111.1",
    "signal_mode": "preclose", "signal_session": "2026-11-24", "valid_for": "2026-11-24",
    "price_as_of_utc": "2026-11-24T04:15:00+00:00", "trade_by_syd": "15:59",
    "scan_started_utc": "2026-11-24T04:13:05+00:00", "scan_finished_utc": "2026-11-24T04:16:31+00:00",
    "scan_completed_at_utc": "2026-11-24T04:16:31+00:00",
    "published": True, "reason": None, "reasons": [], "is_preview": False, "data_fresh": True,
    "risk_mode": "risk_off", "regime": td["regime"],
    "coverage": {"universe": 147, "downloaded": 145, "fresh": 145, "coverage_pct": 98.6},
    "exit_policy": td["exit_policy"], "tracked_policy_ids": TRACKED,
    "recommended_orders": pc_rec, "withheld_orders": [], "excluded": [], "setups": pc_setups,
    "watchlist_full": [], "warnings": [],
})
dump("preclose.json", pc)

ps = copy.deepcopy(pc)
ps.update({"generated_at_utc": "2026-11-20T04:17:00+00:00", "generated_at_bne": "2026-11-20T14:17:00+10:00",
           "signal_session": "2026-11-20", "valid_for": "2026-11-20", "price_as_of_utc": "2026-11-20T04:15:00+00:00",
           "stale_after_utc": "2026-11-20T05:10:00+00:00"})
ps["market_state"] = dict(pc["market_state"], session_date="2026-11-20", close_syd="2026-11-20T16:00:00+11:00",
                          now_syd="2026-11-20T15:17:00+11:00")
dump("pcstale/preclose.json", ps)

pu = copy.deepcopy(pc)
pu.update({"published": False, "reason": "live prices older than 20 min (latest bar 14:50 Sydney)",
           "reasons": ["live_prices_stale"], "recommended_orders": [], "withheld_orders": copy.deepcopy(pc_rec)})
dump("pcunpub/preclose.json", pu)

dump("edge/preclose.json", {
    "schema": "itl.preclose.v2", "job": "preclose_scan", "generated_at_utc": "2026-11-24T04:16:40+00:00",
    "signal_session": "2026-11-24", "published": True,
    "recommended_orders": [{"symbol": "<b>EVIL</b>.AX", "strategy": "MEAN_REVERSION", "order_type": "MARKET_CLOSE",
                            "entry_ref": None, "stop": 1.2, "exit_plans": "not-a-list", "plain_english": "<img src=x onerror=alert(1)>"}],
    "setups": None,
})

# ── metrics.json ───────────────────────────────────────────────────────────
def trading_days(a, b):
    d = a
    while d <= b:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


DAYS = list(trading_days(date(2026, 2, 9), date(2026, 11, 20)))
STAKE = 25000.0


def stake_block(n, mean_ret, sd, conc):
    pnl = []
    picked = sorted(rnd.sample(range(len(DAYS)), min(n, len(DAYS))) if n <= len(DAYS) else [rnd.randrange(len(DAYS)) for _ in range(n)])
    for i in picked:
        r = rnd.gauss(mean_ret, sd)
        pnl.append((DAYS[i].isoformat(), round(STAKE * r - 20.0, 2)))
    cum, curve, by_date = 0.0, [], {}
    for d, p in pnl:
        by_date[d] = by_date.get(d, 0.0) + p
    for d in sorted(by_date):
        cum += by_date[d]
        curve.append({"date": d, "cum_pnl_aud": round(cum, 2)})
    vals = [p for _, p in pnl]
    total = round(sum(vals), 2)
    peak = conc * STAKE
    return {"n": len(vals), "total_pnl_aud": total, "avg_pnl_aud": round(total / len(vals), 2) if vals else None,
            "winrate": round(sum(1 for v in vals if v > 0) / len(vals), 4) if vals else None,
            "best_aud": max(vals) if vals else None, "worst_aud": min(vals) if vals else None,
            "peak_capital_aud": peak if vals else None,
            "return_on_peak_capital": round(total / peak, 4) if vals else None, "pnl_curve": curve}


def empty_block():
    return {"n": 0, "total_pnl_aud": 0.0, "avg_pnl_aud": None, "winrate": None, "best_aud": None, "worst_aud": None,
            "peak_capital_aud": None, "return_on_peak_capital": None, "pnl_curve": []}


SPEC = {  # stream -> policy -> (n, mean return per trade, sd, max concurrent)
    "night": {"fixed_5d": (138, 0.0028, 0.035, 6), "trail_2atr": (138, 0.0041, 0.042, 9), "trail_1pct": (138, 0.0012, 0.018, 3)},
    "preclose_proxy": {"fixed_5d": (184, 0.0036, 0.036, 7), "trail_2atr": (184, 0.0047, 0.043, 10), "trail_1pct": (184, 0.0006, 0.019, 3)},
}
ALL_SPEC = {
    "night": {"fixed_5d": (612, 0.0019, 0.036, 21), "trail_2atr": (612, 0.0030, 0.043, 30), "trail_1pct": (612, 0.0002, 0.019, 9)},
    "preclose_proxy": {"fixed_5d": (790, 0.0025, 0.037, 24), "trail_2atr": (790, 0.0035, 0.044, 33), "trail_1pct": (790, -0.0004, 0.019, 10)},
}


def by_from(spec):
    out = {}
    for s, pols in spec.items():
        out[s] = {pid: stake_block(*v) for pid, v in pols.items()}
    out["preclose_live"] = {pid: empty_block() for pid in TRACKED}
    return out


mt = load("metrics.json")
mt["default_policy_id"] = "fixed_5d"
mt["tracked_policy_ids"] = TRACKED
mt["portfolio"]["policy_id"] = "fixed_5d"
if isinstance(mt.get("verdict"), str):
    mt["verdict"] = mt["verdict"].replace("(trail 2%)", "(fixed 5 days)")
pols = {p["id"]: p for p in mt["policies"]}


def stream_pols(scale):
    out = []
    for pid in TRACKED:
        p = copy.deepcopy(pols[pid])
        p["stats"]["n"] = int(round(p["stats"]["n"] * scale))
        p.pop("by_strategy", None)
        out.append(p)
    return out


mt["streams"] = {
    "night": {"n_signals": 212, "n_filled": 149, "policies": stream_pols(1.0)},
    "preclose_proxy": {"n_signals": 212, "n_filled": 184, "policies": stream_pols(184 / 149),
                       "note": "historical estimate: same night signals, entered at the signal session's close (closing auction + 1 tick)"},
    "preclose_live": {"n_signals": 0, "n_filled": 0, "policies": [], "since": "2026-11-25"},
    "comparison": {
        "preclose_proxy_vs_night": {
            "fixed_5d": {"n": 149, "mean_diff_r": 0.061, "se": 0.044, "t": 1.39, "mean_diff_aud": 23.4, "better_share": 0.55},
            "trail_2atr": {"n": 149, "mean_diff_r": 0.034, "se": 0.051, "t": 0.67, "mean_diff_aud": 14.1, "better_share": 0.52},
            "trail_1pct": {"n": 149, "mean_diff_r": -0.012, "se": 0.031, "t": -0.39, "mean_diff_aud": -4.0, "better_share": 0.47},
        },
        "preclose_live_vs_night": {"fixed_5d": {"n": 0, "mean_diff_r": None, "se": None, "t": None}},
    },
}
mt["stake"] = {
    "stake_aud": STAKE, "brokerage_per_side_aud": 10.0,
    "method": "fixed A$25,000 per trade, every recommended order taken, capital assumed sufficient, P&L added (no compounding), after brokerage and 1-tick slippage",
    "by": by_from(SPEC),
    "all_setups": {"by": by_from(ALL_SPEC)},
}
# Prefer the REAL simulator output's v2.1 blocks when it is available
# (dev/real_metrics_v21.json, supplied by the coordinator, not committed as
# live data): stake / streams / tracked_policy_ids are copied verbatim so the
# fixtures have the exact production shape; the synthetic blocks above are
# only the fallback.
REAL = os.path.join(ROOT, "dev", "real_metrics_v21.json")
if os.path.exists(REAL):
    with open(REAL) as f:
        real = json.load(f)
    for k in ("stake", "streams", "tracked_policy_ids"):
        if k in real:
            mt[k] = real[k]
    # whole real file as its own fixture set (?fixtures=1&set=real), with a
    # stale_after far enough out that screenshots do not show STALE
    rr = copy.deepcopy(real)
    rr["stale_after_utc"] = "2026-12-31T00:00:00+00:00"
    rp = os.path.join(FX, "real", "metrics.json")
    os.makedirs(os.path.dirname(rp), exist_ok=True)
    with open(rp, "w") as f:  # compact: it is big
        json.dump(rr, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
dump("metrics.json", mt)

# edge metrics: no stake / streams at all (older backend) -> site must say "not published yet"
me = load("edge/metrics.json")
me.pop("stake", None)
me.pop("streams", None)
dump("edge/metrics.json", me)

# ── status.json ────────────────────────────────────────────────────────────
PJ = {"last_success_utc": "2026-11-23T04:16:40+00:00", "last_attempt_utc": "2026-11-23T04:13:00+00:00",
      "last_status": "success", "last_session": "2026-11-23", "expected_every": "trading_day@15:15 Sydney",
      "stale": False, "stale_after_utc": "2026-11-24T16:00:00+11:00", "health": "ok", "detail": None}
st = load("status.json")
st["stale_after_utc"] = "2026-11-24T06:00:00+00:00"
st["jobs"]["preclose_scan"] = dict(PJ)
dump("status.json", st)
sp = load("preopen/status.json")
sp["jobs"]["preclose_scan"] = dict(PJ)
dump("preopen/status.json", sp)
se = load("edge/status.json")
se["jobs"]["preclose_scan"] = dict(PJ, last_status="failure", stale=True, health="no success since 15:15 Sydney",
                                   last_attempt_utc="2026-11-24T04:14:00+00:00")
dump("edge/status.json", se)
print("v2.1 fixtures written to", FX)
