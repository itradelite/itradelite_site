#!/usr/bin/env python3
"""Generate v2 fixtures for local testing of the site (dev/fixtures/).

Built from DATA_CONTRACT.md (v2 shapes) using realistic values taken from the
current v1 files in public/ and track-record/. Deterministic (seeded).

    python3 -I dev/make_fixtures.py

Sets written:
  dev/fixtures/            "normal" trading day: night scan done Mon 23 Nov,
                           live check Tue 24 Nov 10:21 Sydney, market open.
  dev/fixtures/preopen/    Tue 24 Nov before the open: live.json pre_open,
                           intraday session_closed, all jobs healthy.
                           (only these 3 files; others come from the base set,
                           see FIXTURE_SETS in assets/itl.js)
  dev/fixtures/edge/       edge cases: published=false, coverage < 90 %,
                           live picks for the wrong session, flat 1-point
                           equity series, empty arrays.
These are NOT the pipeline's files; never copy them into public/.
"""
import copy
import json
import math
import os
import random
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dev", "fixtures")
rnd = random.Random(20261123)


def load(p):
    with open(os.path.join(ROOT, p)) as f:
        return json.load(f)


def dump(rel, obj):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write("\n")


def dec(px):
    return 3 if px < 2 else 2


def tick(px):
    if px < 0.1:
        return 0.001
    if px < 2:
        return 0.005
    return 0.01


def rt(px):
    """Round to ASX tick."""
    if px is None:
        return None
    t = tick(px)
    return round(round(px / t) * t, dec(px))


def env(name, job, gen_utc, phase, session, stale_after, nxt):
    g = datetime.fromisoformat(gen_utc)
    return {
        "schema": f"itl.{name}.v2",
        "job": job,
        "generated_at_utc": g.isoformat(),
        "generated_at_bne": g.astimezone(timezone(timedelta(hours=10))).isoformat(),
        "market_state": {
            "now_sydney": g.astimezone(timezone(timedelta(hours=11))).isoformat(),
            "session_date": session,
            "is_trading_day": True,
            "phase": phase,
            "next_trading_day": nxt,
            "open_sydney": "10:00",
            "close_sydney": "16:10",
        },
        "stale_after_utc": stale_after,
        "run_id": "19412345678",
    }


# ── today.json ─────────────────────────────────────────────────────────────
v1 = load("public/today.json")
EXIT = {"policy_id": "trail_2pct", "trail_pct": 2.0, "activate_after_r": None, "time_stop_days": 20}


def comp(score, status, label, w):
    return {"score": score if status == "ok" else None, "status": status, "label": label, "weight_used": w if status == "ok" else 0.0}


def to_v2(r, extra=None):
    e = r.get("entry")
    entry = rt(float(e)) if e is not None else None
    stop = rt(float(r["stop"])) if r.get("stop") is not None else None
    lab = r.get("sent_label") or ""
    news = comp(None, "failed", "news score failed: HTTP 429 from news provider", 0.4) if "news score failed" in lab else comp(r.get("news_score"), "ok", "news neutral", 0.4)
    if "insider buying" in lab:
        ins = comp(r.get("insider_score"), "ok", lab.split("insider: ")[-1], 0.4)
    else:
        ins = comp(None, "no_data", "no insider trades in the last 90 days", 0.4)
    trends = comp(None, "no_data", "trends not used (pytrends rate-limited)", 0.2)
    ok = [c for c in (news, ins, trends) if c["status"] == "ok"]
    sscore = round(sum(c["score"] for c in ok) / len(ok), 1) if ok else None
    ed = r.get("earnings_days")
    rps = round(abs(entry - stop), 4) if entry and stop else None
    row = {
        "symbol": r["symbol"],
        "strategy": r["strategy"],
        "status": r["status"],
        "score": r["score"],
        "order_type": "LIMIT",
        "trigger": None,
        "limit": entry,
        "entry_ref": entry,
        "entry_text": f"limit={entry}" if entry else "SKIP",
        "last_close": rt(float(r["last_close"])),
        "stop": stop,
        "tp1": rt(r.get("tp1")) if r.get("tp1") else None,
        "tp2": rt(r.get("cap_target")) if r.get("cap_target") else None,
        "atr14": round(rps / 1.2, 4) if rps else None,
        "price_decimals": dec(entry or float(r["last_close"])),
        "r_mult": r.get("r_mult"),
        "risk_per_share": rps,
        "exit_plan": dict(EXIT, initial_stop=stop),
        "composite_score": r.get("composite_score"),
        "sentiment": {"score": sscore, "components": {"news": news, "insider": ins, "trends": trends}},
        "fund_score": r.get("fund_score"),
        "fund_label": r.get("fund_label"),
        "earnings": {"days_to": ed, "suppress": bool(r.get("earnings_suppress")), "status": "ok" if ed is not None else "unknown"},
        "plain_english": r.get("plain_english"),
        "fail_gates": [],
        "also_fired": [],
    }
    if r["status"] == "Watch":
        gates = []
        if (r.get("score") or 0) < 80:
            gates.append(f"score {r['score']:.0f} < 80 (Valid threshold)")
        if (r.get("composite_score") or 0) < 70:
            gates.append(f"composite {r['composite_score']:.1f} < 70")
        if not gates:
            gates.append("rank: outside top 15 setups")
        row["fail_gates"] = gates
    if extra:
        row.update(extra)
    return row


rec = [to_v2(r) for r in v1["recommended_orders"]]
rec[1]["also_fired"] = ["TREND_PULLBACK"]
setups = [to_v2(r) for r in v1["setups"]]
setups[1]["also_fired"] = ["TREND_PULLBACK"]
# Synthetic rows to cover v2-only shapes
setups.insert(2, {
    **to_v2(v1["setups"][3]),
    "symbol": "WTC.AX", "strategy": "MOMENTUM", "status": "Valid", "score": 88.0,
    "order_type": "STOP_LIMIT", "trigger": 44.80, "limit": 44.95, "entry_ref": 44.95,
    "entry_text": "trigger=44.80 limit=44.95", "last_close": 44.56, "stop": 43.62,
    "tp1": 46.95, "tp2": 48.95, "atr14": 1.12, "price_decimals": 2, "r_mult": 3.0,
    "risk_per_share": 1.33, "exit_plan": {"initial_stop": 43.62, "policy_id": "trail_2pct_after_1r", "trail_pct": 2.0, "activate_after_r": 1.0, "time_stop_days": 20},
    "earnings": {"days_to": 3, "suppress": True, "status": "ok"},
    "plain_english": "Momentum breakout: STOP-LIMIT buy if price trades through 44.80, pay no more than 44.95. Stop 43.62. Earnings in 3 trading days — suppressed from recommendations.",
    "fail_gates": [], "also_fired": [],
})
setups.insert(3, {
    **to_v2(v1["setups"][4]),
    "symbol": "CSL.AX", "strategy": "TREND_PULLBACK", "status": "Valid", "score": 82.0,
    "order_type": "LIMIT", "trigger": None, "limit": 231.40, "entry_ref": 231.40, "entry_text": "limit=231.40",
    "last_close": 233.15, "stop": 226.80, "tp1": 238.30, "tp2": 245.20, "atr14": 3.83, "price_decimals": 2,
    "r_mult": 3.0, "risk_per_share": 4.60, "exit_plan": dict(EXIT, initial_stop=226.80),
    "earnings": {"days_to": None, "suppress": False, "status": "unknown"},
    "plain_english": "Trend pullback: LIMIT buy at 231.40 near the 20-day mean inside an uptrend. Stop 226.80. Earnings date unknown — check before trading.",
})
watch = [to_v2(r) for r in v1["watchlist_full"][:36]]
watch.insert(5, {
    **to_v2(v1["watchlist_full"][40]),
    "symbol": "XSS.AX", "status": "Watch",
    "plain_english": "Escaping test row: <img src=x onerror=alert('xss')> & <b>bold</b> should render as text.",
    "fund_label": "ROE=<script>alert(1)</script> D/E=1 & CR=2",
    "fail_gates": ["<i>gate</i> with markup", "score 61 < 80 (Valid threshold)"],
})
watch.insert(8, {
    **to_v2(v1["watchlist_full"][41]),
    "symbol": "ZIP.AX", "strategy": "GAP_FADE_CONTINUATION", "status": "Watch",
    "order_type": "MARKET_OPEN", "trigger": None, "limit": None, "entry_ref": None,
    "entry_text": "market on open (no reference price)",
    "fail_gates": ["gap not confirmed", "liquidity < A$2m/day"],
})

today = env("today", "night_scan", "2026-11-23T09:12:00+00:00", "post_close", "2026-11-23",
            "2026-11-24T10:30:00+00:00", "2026-11-24")
today.update({
    "signal_session": "2026-11-23",
    "valid_for": "2026-11-24",
    "risk_mode": "risk_off",
    "regime": {"axjo_close": 8412.3, "ma50": 8530.1, "ma200": 8475.6, "risk_on": False},
    "data_fresh": True,
    "coverage": {"universe": 147, "downloaded": 146, "fresh": 145, "coverage_pct": 98.6},
    "published": True,
    "reason": None,
    "recommended_orders": rec,
    "setups": setups,
    "watchlist_full": watch,
})
dump("today.json", today)

# ── live.json ──────────────────────────────────────────────────────────────
amp, pme = rec[0], rec[1]
live = env("live", "live_check", "2026-11-23T23:21:00+00:00", "open", "2026-11-24",
           "2026-11-24T01:45:00+00:00", "2026-11-25")
live.update({
    "picks_signal_session": "2026-11-23",
    "picks_valid_for": "2026-11-24",
    "items": [
        {
            "symbol": "AMP.AX", "strategy": amp["strategy"], "order_type": "LIMIT", "trigger": None,
            "limit": amp["limit"], "entry_ref": amp["entry_ref"], "stop": amp["stop"], "original_score": amp["score"],
            "price_decimals": 3,
            "live_price": 2.040, "live_time_utc": "2026-11-23T23:15:00+00:00",
            "day_open": 2.030, "day_high": 2.050, "day_low": 2.010, "gap_pct_open": 1.75,
            "fill_status": "not_triggered", "fill_price_est": None,
            "signal_still_valid": True, "revalidated_score": 71,
            "peak_since_fill": None, "trail_level": None,
            "verdict": "WAIT",
            "reasons": ["Low so far 2.010 is above the 1.995 limit — order not filled yet.",
                        "Opened +1.75% above last close; still inside the setup's range.",
                        "Leave the limit order in; re-check at ~12:30 Sydney."],
        },
        {
            "symbol": "PME.AX", "strategy": pme["strategy"], "order_type": "LIMIT", "trigger": None,
            "limit": pme["limit"], "entry_ref": pme["entry_ref"], "stop": pme["stop"], "original_score": pme["score"],
            "price_decimals": 2,
            "live_price": 185.10, "live_time_utc": "2026-11-23T23:15:00+00:00",
            "day_open": 186.90, "day_high": 188.42, "day_low": 184.05, "gap_pct_open": -0.46,
            "fill_status": "filled", "fill_price_est": 186.90,
            "signal_still_valid": True, "revalidated_score": 84,
            "peak_since_fill": 188.42, "trail_level": 184.65,
            "verdict": "HOLD",
            "reasons": ["Opened at 186.90, below the 187.76 limit — filled at the open (est.).",
                        "Trail (2% below peak 188.42) is 184.65; initial stop 178.00.",
                        "Price 185.10 is above the trail — hold."],
        },
    ],
})
dump("live.json", live)

# ── intraday.json ──────────────────────────────────────────────────────────
iv1 = load("public/intraday.json")
sigs = []
base = datetime(2026, 11, 23, 23, 0, tzinfo=timezone.utc)  # 10:00 Sydney Tue
for i, s in enumerate(iv1["signals"]):
    s = copy.deepcopy(s)
    mins = {"15m": 15, "30m": 30, "1h": 60}.get(s.get("interval"), 15)
    bar = base + timedelta(minutes=mins * (1 + i % 3))
    s["bar_time_utc"] = bar.isoformat()
    s["bar_is_complete"] = i not in (0, 4)
    s["signal_time"] = None
    for o in s.get("other_signals", []) or []:
        o["bar_time_utc"] = bar.isoformat()
        o["bar_is_complete"] = True
    sigs.append(s)
sigs.append({"strategy": "VWAP <Reclaim>", "direction": "short", "entry": 0.885, "stop": 0.905, "target": 0.845,
             "score": 62, "symbol": "<b>BAD</b>.AX", "interval": "30m", "note": "escaping test <script>x</script>",
             "bar_time_utc": (base + timedelta(minutes=60)).isoformat(), "bar_is_complete": True})
intr = env("intraday", "intraday_scan", "2026-11-23T23:47:00+00:00", "open", "2026-11-24",
           "2026-11-24T00:30:00+00:00", "2026-11-25")
intr.update({"interval": "15m,30m,1h", "universe_size": 147, "session_closed": False, "signals": sigs})
dump("intraday.json", intr)

# ── metrics.json ───────────────────────────────────────────────────────────
def trading_days(a, b):
    d = a
    while d <= b:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


days = list(trading_days(date(2026, 2, 5), date(2026, 11, 20)))
eq, bm = [], []
e, b = 100000.0, 100000.0
for d in days:
    e *= 1 + rnd.gauss(0.0002, 0.006)
    b *= 1 + rnd.gauss(0.00035, 0.008)
    eq.append({"date": d.isoformat(), "equity": round(e, 2)})
    bm.append({"date": d.isoformat(), "equity": round(b, 2)})


def maxdd(series):
    peak, mdd = -1, 0.0
    for p in series:
        peak = max(peak, p["equity"])
        mdd = min(mdd, p["equity"] / peak - 1)
    return round(mdd, 4)


def stats(n, wr, avg_r, hold):
    aw = round(1.1 + rnd.random() * 0.8, 2)
    al = round(-(0.6 + rnd.random() * 0.35), 2)
    return {"n": n, "winrate": wr, "avg_r": avg_r, "median_r": round(avg_r - 0.15, 2),
            "avg_ret_pct": round(avg_r * 2.1, 2), "expectancy_aud_per_trade": round(avg_r * 410 - 20, 2),
            "profit_factor": round(max(0.3, 1 + avg_r * 1.6), 2), "avg_hold_days": hold,
            "avg_win_r": aw, "avg_loss_r": al, "min_r": -1.0 if avg_r > -0.5 else -1.6, "max_r": round(2 + rnd.random() * 4, 2)}


POL = [
    ("fixed_5d", "Legacy: exit at close of day 5", {"kind": "time", "days": 5}, 0.53, -0.08, 5.0),
    ("trail_1pct", "Trail 1% from peak", {"kind": "trail_pct", "pct": 1.0, "time_stop_days": 20}, 0.41, -0.11, 1.9),
    ("trail_2pct", "Trail 2% from peak", {"kind": "trail_pct", "pct": 2.0, "time_stop_days": 20}, 0.46, 0.04, 3.6),
    ("trail_3pct", "Trail 3% from peak", {"kind": "trail_pct", "pct": 3.0, "time_stop_days": 20}, 0.49, 0.02, 5.8),
    ("trail_1atr", "Trail 1x ATR from peak", {"kind": "trail_atr", "atr_mult": 1.0, "time_stop_days": 20}, 0.44, -0.02, 3.1),
    ("trail_2atr", "Trail 2x ATR from peak", {"kind": "trail_atr", "atr_mult": 2.0, "time_stop_days": 20}, 0.50, 0.01, 7.2),
    ("trail_2pct_after_1r", "Trail 2% once +1R reached", {"kind": "trail_pct", "pct": 2.0, "activate_after_r": 1.0, "time_stop_days": 20}, 0.38, 0.03, 6.4),
]
policies = []
for pid, label, params, wr, ar, hold in POL:
    by = {
        "MEAN_REVERSION": stats(121, round(wr - 0.01, 2), round(ar - 0.02, 2), hold),
        "TREND_PULLBACK": stats(22, round(wr + 0.03, 2), round(ar + 0.09, 2), hold + 0.8),
        "MOMENTUM": stats(5, round(wr - 0.1, 2), round(ar - 0.3, 2), hold - 0.5),
        "GAP_FADE_CONTINUATION": stats(1, 1.0, 1.4, 2.0),
    }
    policies.append({"id": pid, "label": label, "params": params, "stats": stats(149, wr, ar, hold), "by_strategy": by})

metrics = env("metrics", "metrics", "2026-11-23T09:40:00+00:00", "post_close", "2026-11-23",
              "2026-11-24T12:00:00+00:00", "2026-11-24")
tr = round(eq[-1]["equity"] / 100000 - 1, 4)
btr = round(bm[-1]["equity"] / 100000 - 1, 4)
trades = []
for i in range(30):
    d = days[-(i * 3 + 6)]
    s = rnd.choice(["MEAN_REVERSION", "MEAN_REVERSION", "MEAN_REVERSION", "TREND_PULLBACK", "MOMENTUM"])
    sym = rnd.choice(["AMP.AX", "PME.AX", "NST.AX", "BOQ.AX", "QAN.AX", "SUN.AX", "ORG.AX", "WTC.AX", "COH.AX", "ALL.AX"])
    px = round(rnd.uniform(1.5, 120), 2)
    r = round(rnd.choice([-1.0, -1.0, -0.6, 0.2, 0.8, 1.5, 2.4, -0.3]), 2)
    ex = round(px * (1 + r * 0.025), dec(px))
    vf = days[-(i * 3 + 5)]
    hold = rnd.randint(1, 6)
    xd = days[min(len(days) - 1, len(days) - (i * 3 + 5) + hold)]
    trades.append({"signal_session": d.isoformat(), "valid_for": vf.isoformat(), "symbol": sym, "strategy": s,
                   "entry_time": f"{vf.isoformat()}T00:00:00+00:00", "entry_px": rt(px),
                   "exit_time": f"{xd.isoformat()}T04:00:00+00:00", "exit_px": rt(ex),
                   "exit_reason": "trail" if r > 0 else ("stop" if r <= -1 else rnd.choice(["trail", "time"])),
                   "r": r, "ret_pct": round(r * 2.5, 2), "policy_id": "trail_2pct"})
metrics.update({
    "universe": {"n_signals": 226, "n_dedup": 212, "n_filled": 149, "n_unfilled": 57,
                 "excluded": {"no_bars_after_signal": 4, "duplicate_symbol_same_day": 14, "entry_ref_missing": 2}},
    "fill_model": "LIMIT fills at min(open, limit) if low <= limit; STOP/STOP_LIMIT fill at max(open, trigger) if high >= trigger and that price <= limit; gaps past the limit are unfilled. Same rules as the live check.",
    "bar_resolution": "1h where available (since 2026-06-01), else 1d conservative (stop assumed hit before target on the same bar)",
    "costs": {"brokerage_per_side_aud": 10.0, "slippage_ticks": 1},
    "policies": policies,
    "default_policy_id": "trail_2pct",
    "portfolio": {"start_aud": 100000, "risk_pct": 1.0, "max_position_pct": 25, "max_concurrent": 4, "policy_id": "trail_2pct",
                  "equity": eq, "benchmark": {"symbol": "A200.AX", "equity": bm},
                  "total_return": tr, "benchmark_total_return": btr,
                  "cagr": round((1 + tr) ** (252 / len(eq)) - 1, 4), "max_drawdown": maxdd(eq), "benchmark_max_drawdown": maxdd(bm)},
    "trades": trades,
    "verdict": f"{'Underperforming' if tr < btr else 'Outperforming'} the ASX200 ETF (A200.AX) by {abs(tr - btr) * 100:.1f} pp since 5 Feb 2026 under the default exit policy (trail 2%), after costs.",
})
dump("metrics.json", metrics)

# ── status.json ────────────────────────────────────────────────────────────
status = env("status", "status", "2026-11-24T00:00:00+00:00", "open", "2026-11-24", "2026-11-24T02:00:00+00:00", "2026-11-25")
status["jobs"] = {
    "night_scan": {"last_success_utc": "2026-11-23T09:12:00+00:00", "last_attempt_utc": "2026-11-23T09:05:00+00:00", "last_status": "success", "expected_every": "trading_day@19:00 Sydney", "stale": False},
    "live_check": {"last_success_utc": "2026-11-23T23:21:00+00:00", "last_attempt_utc": "2026-11-23T23:20:00+00:00", "last_status": "success", "expected_every": "trading_day@10:20,12:30,15:00 Sydney", "stale": False},
    "intraday_scan": {"last_success_utc": "2026-11-21T04:30:00+00:00", "last_attempt_utc": "2026-11-23T23:45:00+00:00", "last_status": "failure", "expected_every": "trading_day hourly 10:00-16:00 Sydney", "stale": True},
    "metrics": {"last_success_utc": "2026-11-23T09:40:00+00:00", "last_attempt_utc": "2026-11-23T09:38:00+00:00", "last_status": "success", "expected_every": "trading_day@19:30 Sydney", "stale": False},
}
dump("status.json", status)

# ── pending_exits.json ─────────────────────────────────────────────────────
pe = env("pending_exits", "portfolio_monitor", "2026-11-23T09:45:00+00:00", "post_close", "2026-11-23", "2026-11-24T12:00:00+00:00", "2026-11-24")
pe.update({
    "as_of": "2026-11-23 20:45:00 AEDT",
    "pending_exits": [
        {"symbol": "NST.AX", "action": "SELL_TRAIL", "category": "exit", "streak_days": 3, "status": "PENDING", "pnl_%": -1.8},
        {"symbol": "<b>QAN</b>.AX", "action": "TAKE_PROFIT_2R", "category": "profit_take", "streak_days": 4, "status": "PENDING", "pnl_%": 5.2},
    ],
    "recent_auto_closes": [{"symbol": "ORG.AX", "closed_date": "2026-11-20", "pnl_pct": -2.4}],
})
dump("pending_exits.json", pe)

# ── preopen set ────────────────────────────────────────────────────────────
lp = copy.deepcopy(live)
lp.update(env("live", "live_check", "2026-11-23T22:40:00+00:00", "pre_open", "2026-11-24", "2026-11-23T23:45:00+00:00", "2026-11-25"))
for it in lp["items"]:
    for k in ("live_price", "live_time_utc", "day_open", "day_high", "day_low", "gap_pct_open", "fill_price_est", "peak_since_fill", "trail_level", "revalidated_score", "signal_still_valid"):
        it[k] = None
    it["fill_status"] = "not_triggered"
    it["verdict"] = "WAIT"
    it["reasons"] = ["Market not open yet — order can be placed for the open."]
dump("preopen/live.json", lp)
ip = copy.deepcopy(intr)
ip.update(env("intraday", "intraday_scan", "2026-11-23T05:15:00+00:00", "pre_open", "2026-11-24", "2026-11-24T00:30:00+00:00", "2026-11-25"))
ip["session_closed"] = True
dump("preopen/intraday.json", ip)
sp = copy.deepcopy(status)
sp["jobs"]["intraday_scan"].update({"stale": False, "last_status": "success", "last_success_utc": "2026-11-23T05:15:00+00:00"})
dump("preopen/status.json", sp)

# ── edge set ───────────────────────────────────────────────────────────────
te = copy.deepcopy(today)
te.update({"published": False, "reason": "coverage 81.0% < 90% (Yahoo returned 119/147 symbols)", "data_fresh": False,
           "coverage": {"universe": 147, "downloaded": 119, "fresh": 119, "coverage_pct": 81.0},
           "recommended_orders": [], "setups": [], "watchlist_full": te["watchlist_full"][:3]})
te["watchlist_full"][0]["sentiment"] = None
te["watchlist_full"][0]["earnings"] = None
te["watchlist_full"][0]["exit_plan"] = None
te["watchlist_full"][1]["stop"] = None
dump("edge/today.json", te)
le = copy.deepcopy(live)
le["picks_valid_for"] = "2026-11-21"
le["items"].append({"symbol": "BHP.AX", "strategy": "TREND_PULLBACK", "order_type": "STOP", "trigger": 44.10, "limit": None,
                    "entry_ref": 44.10, "stop": 42.80, "live_price": 42.60, "day_open": 43.10, "day_high": 43.20, "day_low": 42.55,
                    "gap_pct_open": -2.3, "fill_status": "invalidated_pre_fill", "verdict": "SKIP", "reasons": ["Traded below the stop before the trigger — setup invalid."]})
le["items"].append({"symbol": "CBA.AX", "strategy": "MOMENTUM", "order_type": "STOP_LIMIT", "trigger": 160.0, "limit": 160.5,
                    "entry_ref": 160.5, "stop": 156.0, "live_price": 155.2, "fill_status": "stopped_out", "fill_price_est": 160.2,
                    "peak_since_fill": 161.0, "trail_level": 157.8, "verdict": "EXIT", "reasons": ["Trail 157.80 broken."]})
dump("edge/live.json", le)
me = copy.deepcopy(metrics)
me["portfolio"]["equity"] = [{"date": "2026-11-20", "equity": 100000}]
me["portfolio"]["benchmark"]["equity"] = [{"date": "2026-11-20", "equity": 100000}, {"date": "2026-11-21", "equity": 100000}]
me["trades"] = []
me["verdict"] = None
me["policies"] = me["policies"][:2]
me["policies"][1]["stats"] = {}
dump("edge/metrics.json", me)
ie = copy.deepcopy(intr)
ie["signals"] = []
dump("edge/intraday.json", ie)
dump("edge/status.json", {**status, "stale_after_utc": "2026-11-20T00:00:00+00:00"})
dump("edge/pending_exits.json", {"as_of": "2026-11-01 04:00:06 AEST", "pending_exits": [{"symbol": "OLD.AX", "action": "SELL_STOP", "category": "exit", "streak_days": 9, "status": "AUTO_CLOSE_IMMINENT"}], "recent_auto_closes": []})
print("fixtures written to", OUT)
