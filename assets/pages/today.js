/* Today page: tonight's picks for the next session (today.json v2).
 * Pure render/sizing helpers are exported for dev/test_site.mjs. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../itl.js"));
  else root.ITL_TODAY = factory(root.ITL);
})(typeof self !== "undefined" ? self : this, function (ITL) {
  "use strict";
  const { html, num, fmtPrice, fmtNum, fmtInt, fmtAud, fmtPct, fmtDate, fmtDateTime, ago, DASH } = ITL;

  const DATA_PATH = "/public/today.json";
  const PREFS_KEY = "itradelite_today_prefs";
  const RISK_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const DEFAULT_PREFS = { view: "all", strat: "all", q: "", sort: "status_score", portfolio: 100000, riskPct: 1, maxPosPct: 25, watchOpen: false };

  // ── Prefs ───────────────────────────────────────────────────────────────
  function normalizePrefs(obj) {
    const p = Object.assign({}, DEFAULT_PREFS);
    if (!obj || typeof obj !== "object") return p;
    if (["all", "recommended", "setups", "watch"].indexOf(obj.view) >= 0) p.view = obj.view;
    if (obj.view === "valid") p.view = "setups"; // v1 value
    if (typeof obj.strat === "string" && obj.strat) p.strat = obj.strat;
    if (typeof obj.q === "string") p.q = obj.q.slice(0, 40);
    if (["status_score", "score_desc", "composite_desc", "r_mult_desc", "risk_desc", "symbol_asc"].indexOf(obj.sort) >= 0) p.sort = obj.sort;
    const pf = num(obj.portfolio);
    if (pf !== null && pf >= 100 && pf <= 1e9) p.portfolio = pf;
    const rp = num(obj.riskPct);
    if (rp !== null && rp >= 0.25 && rp <= 3) p.riskPct = rp;
    const mp = num(obj.maxPosPct);
    if (mp !== null && mp >= 1 && mp <= 100) p.maxPosPct = mp;
    if (typeof obj.watchOpen === "boolean") p.watchOpen = obj.watchOpen;
    return p;
  }

  /** Strategy dropdown options. A saved strategy that has no rows today is
   *  still listed (marked) so the dropdown always shows the filter that is
   *  really applied — the v1 bug was a saved filter applied while the
   *  dropdown showed "All". */
  function strategyOptions(rows, saved) {
    const set = new Set();
    (rows || []).forEach(r => { if (r && r.strategy) set.add(String(r.strategy).trim()); });
    const opts = [{ value: "all", label: "All strategies" }];
    [...set].sort().forEach(s => opts.push({ value: s, label: ITL.strategyLabel(s) }));
    if (saved && saved !== "all" && !set.has(saved)) opts.push({ value: saved, label: ITL.strategyLabel(saved) + " (none today)" });
    return opts;
  }

  // ── Row normalisation (v2, with a v1 adapter) ───────────────────────────
  function parseEntryText(t) {
    const s = String(t || "").trim();
    if (!s) return null;
    if (/\bSKIP\b/i.test(s)) return { skip: true, trigger: null, limit: null };
    const mt = s.match(/trigger\s*=\s*([0-9]*\.?[0-9]+)/i);
    const ml = s.match(/limit\s*=\s*([0-9]*\.?[0-9]+)/i);
    const trigger = mt ? num(mt[1]) : null;
    const limit = ml ? num(ml[1]) : null;
    if (trigger === null && limit === null) return null;
    return { skip: false, trigger, limit };
  }

  function v1Sentiment(r) {
    const lab = String(r.sent_label || "");
    const c = (score, failedRe, noDataRe, label) => {
      if (failedRe.test(lab)) return { score: null, status: "failed", label };
      if (noDataRe.test(lab) || num(score) === null) return { score: null, status: "no_data", label };
      return { score: num(score), status: "ok", label };
    };
    const news = c(r.news_score, /news score failed/i, /no news/i, (lab.match(/news: ([^|]*)/) || [])[1] || "");
    const insider = c(r.insider_score, /insider score failed/i, /no insider/i, (lab.match(/insider: ([^|]*)/) || [])[1] || "");
    const tl = String(r.trends_label || "");
    const trends = /failed/i.test(tl) ? { score: null, status: "failed", label: tl } :
      (num(r.trends_score_val) === null || /not used|not installed/i.test(tl) || !tl) ? { score: null, status: "no_data", label: tl || "trends not used" } :
      { score: num(r.trends_score_val), status: "ok", label: tl };
    return { score: num(r.sent_score), components: { news, insider, trends }, _legacy: true };
  }

  function normalizeRow(r, legacy) {
    const row = Object.assign({}, r || {});
    row.fail_gates = Array.isArray(row.fail_gates) ? row.fail_gates : [];
    row.also_fired = Array.isArray(row.also_fired) ? row.also_fired : [];
    if (!legacy) return row;
    const pe = parseEntryText(row.entry_text);
    let entry = num(row.entry_ref);
    if (entry === null && num(row.entry) > 0) entry = num(row.entry);
    if (entry === null && pe && !pe.skip) entry = pe.limit !== null ? pe.limit : pe.trigger;
    row.entry_ref = entry;
    if (!row.order_type) row.order_type = pe && pe.trigger !== null ? "STOP_LIMIT" : (entry !== null ? "LIMIT" : null);
    if (row.trigger === undefined) row.trigger = pe ? pe.trigger : null;
    if (row.limit === undefined) row.limit = row.order_type === "LIMIT" ? entry : (pe ? pe.limit : null);
    if (row.tp2 === undefined) row.tp2 = row.cap_target !== undefined ? row.cap_target : null;
    if (!row.sentiment) row.sentiment = v1Sentiment(row);
    if (!row.earnings) {
      const d = num(row.earnings_days);
      row.earnings = { days_to: d, suppress: !!row.earnings_suppress, status: d === null ? "unknown" : "ok" };
    }
    row._legacy = true;
    return row;
  }

  function normalizeData(data) {
    const info = ITL.schemaInfo(data, "today");
    const legacy = !info.ok;
    const arr = (k) => (Array.isArray(data && data[k]) ? data[k] : []).filter(x => x && typeof x === "object").map(r => normalizeRow(r, legacy));
    let rec = arr("recommended_orders");
    const setups = arr("setups");
    if (!Array.isArray(data && data.recommended_orders) && legacy) rec = setups.filter(r => r.status === "Valid");
    return { info, legacy, rec, setups, watch: arr("watchlist_full") };
  }

  // ── Fragments ───────────────────────────────────────────────────────────
  function orderTypeLabel(t) {
    return ({ LIMIT: "LIMIT", STOP: "STOP", STOP_LIMIT: "STOP-LIMIT", MARKET_OPEN: "MARKET @ OPEN", MARKET_CLOSE: "MARKET @ CLOSE" })[t] || (t ? String(t) : DASH);
  }

  function orderLevels(row) {
    const t = row.order_type;
    const lv = (k, v) => html`<span class="lvl"><span>${k}</span>${fmtPrice(v, row)}</span>`;
    if (t === "LIMIT") return html`${lv("lim", row.limit !== null && row.limit !== undefined ? row.limit : row.entry_ref)}`;
    if (t === "STOP") return html`${lv("trig", row.trigger)}`;
    if (t === "STOP_LIMIT") return html`${lv("trig", row.trigger)}${lv("lim", row.limit)}`;
    if (t === "MARKET_OPEN") return html`<span class="lvl">at the open</span>`;
    if (t === "MARKET_CLOSE") return html`<span class="lvl"><span>ref</span>${fmtPrice(row.entry_ref, row)}</span>`;
    return html`<span class="lvl">${row.entry_text || DASH}</span>`;
  }

  /** e.g. "Initial stop 1.895. Trail 2% below highest price since entry, max 20 days." */
  function exitPlanText(plan, row) {
    if (!plan || typeof plan !== "object") return DASH;
    const parts = [];
    const stop = num(plan.initial_stop) !== null ? plan.initial_stop : (row ? row.stop : null);
    if (num(stop) !== null) parts.push("Initial stop " + fmtPrice(stop, row) + ".");
    let trail = null;
    const pct = num(plan.trail_pct), aud = num(plan.trail_atr_aud);
    if (pct !== null) trail = "trail " + fmtNum(pct, pct % 1 ? 1 : 0) + "% below highest price since entry";
    else if (aud !== null) trail = "trail A$" + fmtNum(aud, aud < 2 ? 3 : 2) + (num(plan.atr_mult) !== null ? " (" + fmtNum(plan.atr_mult, 1) + "×ATR)" : "") + " below highest price since entry";
    const act = num(plan.activate_after_r);
    const days = num(plan.time_stop_days);
    let s = "";
    if (trail) {
      s = act !== null && act > 0 ? "Once up +" + fmtNum(act, act % 1 ? 1 : 0) + "R, " + trail : trail.charAt(0).toUpperCase() + trail.slice(1);
      if (days !== null) s += ", max " + fmtInt(days) + " days";
      s += ".";
    } else {
      const m = String(plan.policy_id || "").match(/^fixed_(\d+)d$/);
      if (m) s = "Exit at the close of trading day " + m[1] + ".";
      else if (days !== null) s = "Time stop: exit after " + fmtInt(days) + " days.";
    }
    if (s) parts.push(s);
    return parts.length ? parts.join(" ") : DASH;
  }

  function scoreClass(n) {
    if (n === null) return "chip--muted";
    if (n >= 65) return "chip--pos";
    if (n <= 35) return "chip--neg";
    return "chip--muted";
  }

  const COMP_NAMES = { news: "News", insider: "Insider", trends: "Trends" };
  function sentimentChips(row) {
    const s = row.sentiment;
    if (!s || typeof s !== "object") return [html`<span class="chip chip--nodata" title="No sentiment block published">Sentiment: no data</span>`];
    const out = [];
    const sc = num(s.score);
    out.push(sc === null
      ? html`<span class="chip chip--nodata" title="No usable sentiment component (failed/no data are not counted as neutral)">Sentiment —</span>`
      : html`<span class="chip ${scoreClass(sc)}" title="Weighted over components with status ok only">Sentiment ${fmtNum(sc, 0)}</span>`);
    const comps = s.components && typeof s.components === "object" ? s.components : {};
    ["news", "insider", "trends"].forEach(k => {
      const c = comps[k];
      const name = COMP_NAMES[k];
      if (!c || typeof c !== "object") { out.push(html`<span class="chip chip--nodata">${name}: no data</span>`); return; }
      const title = (c.label ? c.label : "") + (num(c.weight_used) !== null ? " (weight " + fmtNum(c.weight_used, 2) + ")" : "");
      if (c.status === "failed") out.push(html`<span class="chip chip--failed" title="${title}">${name}: failed</span>`);
      else if (c.status === "no_data" || (c.status === "ok" && num(c.score) === null)) out.push(html`<span class="chip chip--nodata" title="${title}">${name}: no data</span>`);
      else if (c.status === "ok") out.push(html`<span class="chip ${scoreClass(num(c.score))}" title="${title}">${name} ${fmtNum(c.score, 0)}</span>`);
      else out.push(html`<span class="chip chip--nodata" title="${title}">${name}: ${c.status || "?"}</span>`);
    });
    return out;
  }

  function earningsChip(e) {
    if (!e || typeof e !== "object") return html`<span class="chip chip--nodata">Earnings: —</span>`;
    const d = num(e.days_to);
    if (e.suppress) return html`<span class="chip chip--neg" title="Earnings too close: excluded from recommendations">⚠ Earnings ${d !== null ? "in " + fmtInt(d) + " d" : "soon"} — suppressed</span>`;
    if (e.status === "unknown" || d === null) return html`<span class="chip chip--warn" title="Earnings date not known: check before trading">⚠ Earnings date unknown</span>`;
    return html`<span class="chip ${d <= 10 ? "chip--warn" : "chip--muted"}" title="Trading days to next earnings">Earnings in ${fmtInt(d)} d</span>`;
  }

  function gateChips(row) {
    return row.fail_gates.map(g => html`<span class="chip chip--neg" title="Gate this row failed">✗ ${typeof g === "string" ? g : JSON.stringify(g)}</span>`);
  }

  function alsoFiredChips(row) {
    if (!row.also_fired.length) return [];
    const names = row.also_fired.map(a => (a && typeof a === "object") ? (a.strategy || JSON.stringify(a)) : String(a));
    return [html`<span class="chip chip--info" title="Other strategies that also fired on this symbol">Also fired: ${names.map(ITL.strategyLabel).join(", ")}</span>`];
  }

  function statusCell(st) {
    if (st === "Valid") return html`<span class="nowrap"><span class="status-dot dot--valid"></span>Valid</span>`;
    if (st === "Watch") return html`<span class="nowrap"><span class="status-dot dot--watch"></span>Watch</span>`;
    return html`<span class="nowrap"><span class="status-dot dot--other"></span>${st || DASH}</span>`;
  }

  // ── Sizing ──────────────────────────────────────────────────────────────
  function sizeFor(row, prefs) {
    return ITL.computeSize({ entry: row.entry_ref, stop: row.stop, portfolio: prefs.portfolio, riskPct: prefs.riskPct, maxPosPct: prefs.maxPosPct });
  }

  function qtyCell(s, row) {
    if (!s.ok) return html`<span class="dim" title="${s.message}">n/a</span>`;
    return html`<span class="nowrap">${fmtInt(s.qty)}${s.capped ? html` <span class="cap" title="${ITL.sizeTooltip(s, row)}">(cap)</span>` : ""}</span>`;
  }

  function riskCell(s) {
    if (!s.ok) return html`—`;
    return html`<span title="${"Actual risk if stopped at the initial stop. Notional " + fmtAud(s.notional)}">${fmtAud(s.actualRisk)}</span>`;
  }

  function sizeSummary(s, row, prefs) {
    if (!s.ok) return html`<div class="order__size"><b>No size</b> — ${s.message}</div>`;
    const capTxt = s.binding === "max_position" ? "Max position " + fmtNum(prefs.maxPosPct, prefs.maxPosPct % 1 ? 1 : 0) + "%" : "portfolio cash";
    return html`<div class="order__size" title="${ITL.sizeTooltip(s, row)}">
      Buy <b>${fmtInt(s.qty)}</b> sh${s.capped ? html` <span class="cap">(cap)</span>` : ""} ≈ ${fmtAud(s.notional)}
      · risk <b>${fmtAud(s.actualRisk)}</b>
      ${s.capped ? html`<div class="small">Capped by ${capTxt}: risk ${fmtAud(s.actualRisk)} instead of your ${fmtAud(s.riskBudget)} budget (${fmtNum(prefs.riskPct, 2)}%).</div>` : ""}
      ${s.qty === 0 ? html`<div class="small">${s.message}</div>` : ""}
    </div>`;
  }

  // ── Filter / sort ───────────────────────────────────────────────────────
  function applyFilters(rows, prefs) {
    let out = rows.slice();
    if (prefs.strat && prefs.strat !== "all") out = out.filter(r => String(r.strategy || "").trim() === prefs.strat);
    if (prefs.q) { const q = prefs.q.toUpperCase(); out = out.filter(r => String(r.symbol || "").toUpperCase().indexOf(q) >= 0); }
    const rank = st => st === "Valid" ? 2 : (st === "Watch" ? 1 : 0);
    const val = (x) => { const n = num(x); return n === null ? -Infinity : n; };
    const risk = (r) => { const s = sizeFor(r, prefs); return s.ok ? s.actualRisk : -Infinity; };
    const cmp = {
      symbol_asc: (a, b) => String(a.symbol || "").localeCompare(String(b.symbol || "")),
      score_desc: (a, b) => val(b.score) - val(a.score),
      composite_desc: (a, b) => val(b.composite_score) - val(a.composite_score),
      r_mult_desc: (a, b) => val(b.r_mult) - val(a.r_mult),
      risk_desc: (a, b) => risk(b) - risk(a),
      status_score: (a, b) => (rank(b.status) - rank(a.status)) || (val(b.score) - val(a.score)),
    }[prefs.sort] || ((a, b) => 0);
    out.sort((a, b) => { const c = cmp(a, b); return Number.isNaN(c) ? 0 : c; });
    return out;
  }

  // ── Header / banners ────────────────────────────────────────────────────
  function renderBanners(data, nd, now, preclose) {
    const out = [];
    if (preclose) out.push(ITL.precloseBanner(preclose, now));
    if (nd.legacy) out.push(ITL.outdatedBanner("today.json", nd.info));
    out.push(ITL.staleBanner(data, now, "today.json (tonight's picks)"));
    const today = ITL.sydneyDate(now);
    if (data.valid_for && ITL.parseYmd(data.valid_for) && data.valid_for < today) {
      out.push(ITL.banner("stale", "STALE: these picks were for " + fmtDate(data.valid_for),
        html`Today in Sydney is ${fmtDate(today)}. The night scan has not published picks for a later session.`, "OLD PICKS"));
    }
    if (data.published === false) {
      out.push(ITL.banner("error", "Not published: no recommendations tonight",
        html`${data.reason ? "Reason: " + data.reason : "The night scan withheld recommendations."} Setups and watchlist below (if any) are for reference only.`, "WITHHELD"));
    }
    if (data.data_fresh === false) {
      out.push(ITL.banner("stale", "Data freshness gate: daily bars not updated",
        html`Prices used for tonight's scan were not confirmed fresh. Tables below are dimmed and should not be treated as confirmed.`, "NOT FRESH"));
    }
    const cov = data.coverage && num(data.coverage.coverage_pct);
    if (cov !== null && cov !== undefined && cov < 90) {
      out.push(ITL.banner("warn", "Low data coverage: " + fmtPct(cov, { dp: 1 }) + " of the universe",
        html`${fmtInt(data.coverage.fresh)} fresh of ${fmtInt(data.coverage.universe)} symbols. Missing symbols could not generate signals.`, "COVERAGE"));
    }
    if (data.is_preview === true) out.push(ITL.banner("violet", "Pre-close preview", "Built from intraday prices before the close; the final night scan replaces it.", "PREVIEW"));
    return out;
  }

  function renderMeta(data, nd, now) {
    const reg = data.regime && typeof data.regime === "object" ? data.regime : null;
    const cov = data.coverage && typeof data.coverage === "object" ? data.coverage : null;
    const covPct = cov ? num(cov.coverage_pct) : null;
    const st = ITL.staleness(data, now);
    const ph = ITL.marketPhase(data.market_state);
    const riskOn = reg && typeof reg.risk_on === "boolean" ? reg.risk_on : (data.risk_mode ? /on/i.test(data.risk_mode) : null);
    return html`
      <span class="pill">Signal session <b>${fmtDate(data.signal_session || data.axjo_last_bar || data.date)}</b></span>
      <span class="pill pill--ok">Valid for <b>${fmtDate(data.valid_for)}</b></span>
      <span class="pill ${riskOn === false ? "pill--bad" : riskOn ? "pill--ok" : ""}">Risk mode <b>${data.risk_mode ? String(data.risk_mode).replace(/_/g, " ").toUpperCase() : DASH}</b></span>
      ${reg ? html`<span class="pill" title="Regime: ASX200 close vs moving averages">AXJO <b>${fmtNum(reg.axjo_close, 1)}</b> · MA50 ${fmtNum(reg.ma50, 1)} · MA200 ${fmtNum(reg.ma200, 1)}</span>` : ""}
      <span class="pill ${covPct !== null && covPct < 90 ? "pill--warn" : ""}">Coverage <b>${cov ? fmtInt(cov.fresh) + "/" + fmtInt(cov.universe) : (data.universe_size ? fmtInt(data.universe_size) + " symbols" : DASH)}</b>${covPct !== null ? " (" + fmtPct(covPct, { dp: 1 }) + ")" : ""}</span>
      <span class="pill ${data.data_fresh === false ? "pill--warn" : data.data_fresh ? "pill--ok" : ""}">Data fresh <b>${data.data_fresh === true ? "yes" : data.data_fresh === false ? "NO" : DASH}</b></span>
      <span class="pill">Generated <b>${fmtDateTime(data.generated_at_utc)}</b> (${ago(data.generated_at_utc, now)})</span>
      <span class="pill ${st.stale ? "pill--bad" : ""}">Fresh until <b>${st.staleAfter ? fmtDateTime(st.staleAfter) : DASH}</b></span>
      ${ph.key ? html`<span class="pill" title="Market phase when this file was generated (from market_state)">Phase at generation <b>${ph.label}</b></span>` : ""}
    `;
  }

  // ── Sections ────────────────────────────────────────────────────────────
  // ── Fundamentals: current score + fund_v2 (contract v2.2, evaluation only) ──
  const FUND_V2_PILLARS = ["valuation", "cash", "quality", "balance", "growth"];
  const FUND_V2_TIP = "v2 is being evaluated; it does not affect rankings yet";

  /** Rows from engines before v2.2 have no fund_v2 keys at all: keep the old line. */
  function hasFundV2(row) {
    return !!row && (Object.prototype.hasOwnProperty.call(row, "fund_v2") || (row.fund_v2_pillars && typeof row.fund_v2_pillars === "object"));
  }

  /** "v2: 62 — valuation 71, cash 58, quality 66, balance 40, growth —" (null pillar = —). */
  function fundV2Text(row) {
    const p = row && row.fund_v2_pillars && typeof row.fund_v2_pillars === "object" ? row.fund_v2_pillars : {};
    const parts = FUND_V2_PILLARS.map(k => k + " " + fmtNum(p[k], 0));
    return "v2: " + fmtNum(row && row.fund_v2, 0) + " \u2014 " + parts.join(", ");
  }

  /** Fundamentals line for order cards and row details. Without v2 fields
   *  it is exactly the pre-v2.2 line ("Fundamentals 45/100: label"). */
  function fundamentalsHtml(row) {
    if (!row) return "";
    if (!hasFundV2(row)) {
      return row.fund_label ? html`Fundamentals ${fmtNum(row.fund_score, 0)}/100: ${row.fund_label}` : "";
    }
    const v2Label = row.fund_v2_label ? html`<br><span class="dim">v2 ${row.fund_v2_label}</span>` : "";
    return html`Fundamentals: ${fmtNum(row.fund_score, 0)} (current) \u00b7 <span class="fund-v2" title="${FUND_V2_TIP}">${fundV2Text(row)}</span><span class="sr-only"> (${FUND_V2_TIP})</span>${row.fund_label ? html`<br><span class="dim">current: ${row.fund_label}</span>` : ""}${v2Label}`;
  }

  function rowChips(row, ctx) {
    return [ITL.edgeBadge(row.strategy, ctx.edges)].concat(sentimentChips(row), [earningsChip(row.earnings)], gateChips(row), alsoFiredChips(row));
  }

  function orderCard(row, prefs, ctx) {
    const s = sizeFor(row, prefs);
    return html`<article class="order">
      <div class="order__head">
        <div>
          <div class="symbol-line"><span class="order__sym">${row.symbol || DASH}</span>${ITL.yahooLink(row.symbol)}</div>
          ${ctx.names && ctx.names[row.symbol] ? html`<span class="company-name">${ctx.names[row.symbol]}</span>` : ""}
          <div class="small">${ITL.strategyLabel(row.strategy)} · score ${fmtNum(row.score, 0)} · composite ${fmtNum(row.composite_score, 1)}</div>
        </div>
        <span class="order__type">${orderTypeLabel(row.order_type)}</span>
      </div>
      <div class="order__grid">
        ${row.order_type === "STOP" || row.order_type === "STOP_LIMIT" ? html`<div><span class="k">Trigger</span><span class="v">${fmtPrice(row.trigger, row)}</span></div>` : ""}
        ${row.order_type === "LIMIT" || row.order_type === "STOP_LIMIT" ? html`<div><span class="k">Limit</span><span class="v">${fmtPrice(row.limit, row)}</span></div>` : ""}
        <div><span class="k">${row.order_type === "MARKET_CLOSE" ? "Entry ref (live)" : "Entry ref"}</span><span class="v">${fmtPrice(row.entry_ref, row)}</span></div>
        <div><span class="k">Stop</span><span class="v neg">${fmtPrice(row.stop, row)}</span></div>
        <div><span class="k">TP1 / TP2</span><span class="v">${fmtPrice(row.tp1, row)} / ${fmtPrice(row.tp2, row)}</span></div>
        <div><span class="k">R multiple</span><span class="v">${fmtNum(row.r_mult, 2)}</span></div>
        <div><span class="k">Last close</span><span class="v">${fmtPrice(row.last_close, row)}</span></div>
      </div>
      ${row.order_type === "MARKET_CLOSE" ? html`<div class="order__exit"><b>How to buy:</b> in the closing auction, or at market before ${ctx.tradeBy || "the close"}. Entry ref is the live price${ctx.priceAsOf ? " at " + ctx.priceAsOf : ""} (worst case used for sizing).</div>` : ""}
      ${sizeSummary(s, row, prefs)}
      ${ITL.exitPlansHtml(row, { defaultId: ctx.defaultPolicy })}
      <div class="chips">${rowChips(row, ctx)}</div>
      ${row.plain_english ? html`<div class="order__note">${row.plain_english}</div>` : ""}
      ${(row.fund_label || hasFundV2(row)) ? html`<div class="small fund-line" style="margin-top:6px;">${fundamentalsHtml(row)}</div>` : ""}
    </article>`;
  }

  function renderOrders(rows, prefs, ctx) {
    const pre = ctx.stream === "preclose";
    if (!rows.length) {
      return html`<section class="card"><div class="card__head"><h2>${pre ? "Pre-close orders" : "Recommended orders"}</h2><span class="count">0</span></div>
        <div class="empty-state"><div class="empty-state__title">No ${pre ? "pre-close" : "recommended"} orders for ${fmtDate(ctx.validFor)}</div>
        ${ctx.published === false ? "Publishing was withheld (see the notice above)." : pre ? "No setup passed the final selection in this pre-close scan, or your filters hide them." : "No setup passed the final selection tonight, or your filters hide them."}</div></section>`;
    }
    return html`<section class="card" aria-label="${pre ? "Pre-close orders" : "Recommended orders"}">
      <div class="card__head"><h2>${pre ? "Pre-close orders" : "Recommended orders"}</h2><span class="count">${rows.length} (max 2, one per symbol) · ${pre ? "buy before the close of" : "place for"} ${fmtDate(ctx.validFor)}</span></div>
      <div class="orders">${rows.map(r => orderCard(r, prefs, ctx))}</div>
    </section>`;
  }

  function rowKey(title, r) { return title + "|" + (r.symbol || "") + "|" + (r.strategy || ""); }

  /** Compact one-line rows; notes, sentiment components, fail gates and the
   *  exit plan live in a per-row detail row, collapsed unless ctx.open has it. */
  function renderTable(title, rows, prefs, ctx, opts) {
    const o = opts || {};
    const open = ctx.open instanceof Set ? ctx.open : new Set();
    if (!rows.length) {
      return html`<div class="empty-state">${o.emptyText || "No rows match your filters."}</div>`;
    }
    const limit = o.limit || rows.length;
    const shown = rows.slice(0, limit);
    const body = shown.map(r => {
      const s = sizeFor(r, prefs);
      const key = rowKey(title, r);
      const isOpen = open.has(key);
      const gates = r.fail_gates.length;
      return html`<tr class="row-main row-compact" data-key="${key}" aria-expanded="${isOpen ? "true" : "false"}">
          <td data-label="" class="td-toggle"><button type="button" class="row-toggle" aria-expanded="${isOpen ? "true" : "false"}" aria-label="${"Details for " + (r.symbol || "row")}">${isOpen ? "\u25be" : "\u25b8"}</button></td>
          <td data-label="Symbol">${ITL.symbolCell(r.symbol, ctx.names)}</td>
          <td data-label="Strategy" class="small nowrap">${ITL.strategyLabel(r.strategy)}</td>
          <td data-label="Order" class="mono nowrap"><b>${orderTypeLabel(r.order_type)}</b>${orderLevels(r)}</td>
          <td data-label="Stop" class="mono right">${fmtPrice(r.stop, r)}</td>
          <td data-label="R" class="mono right">${fmtNum(r.r_mult, 2)}</td>
          <td data-label="Score" class="mono right nowrap" title="TA score / composite">${fmtNum(r.score, 0)} / ${fmtNum(r.composite_score, 1)}</td>
          <td data-label="Sentiment">${sentimentChips(r)[0]}</td>
          <td data-label="Qty" class="mono right">${qtyCell(s, r)}</td>
          <td data-label="Risk" class="mono right">${riskCell(s)}</td>
          <td data-label="Status" class="nowrap">${statusCell(r.status)}${gates ? html` <span class="dim small" title="Failed gates: see details">(${String(gates)})</span>` : ""}</td>
        </tr>
        <tr class="row-detail"${isOpen ? "" : html` hidden`}><td colspan="11" class="td-full">
          <div class="chips">${rowChips(r, ctx)}</div>
          <div class="small" style="margin-top:5px;"><b>Entry ref</b> ${fmtPrice(r.entry_ref, r)} \u00b7 <b>TP1 / TP2</b> ${fmtPrice(r.tp1, r)} / ${fmtPrice(r.tp2, r)} \u00b7 <b>Last close</b> ${fmtPrice(r.last_close, r)}</div>
          ${ITL.exitPlansHtml(r, { defaultId: ctx.defaultPolicy })}
          ${r.plain_english ? html`<p class="small" style="margin:6px 0 0;">${r.plain_english}</p>` : ""}
          ${(r.fund_label || hasFundV2(r)) ? html`<p class="small fund-line" style="margin:4px 0 0;">${fundamentalsHtml(r)}</p>` : ""}
        </td></tr>`;
    });
    return html`<div class="tableWrap"><table class="stack compact">
        <thead><tr><th class="td-toggle"><span class="sr-only">Details</span></th><th>Symbol</th><th>Strategy</th><th>Order</th><th class="right">Stop</th><th class="right">R</th><th class="right">Score</th><th>Sentiment</th><th class="right">Qty</th><th class="right">Risk</th><th>Status</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      ${rows.length > limit ? html`<div class="card__body"><button class="btn btn--ghost" type="button" data-more="${o.moreKey || ""}">Show all ${rows.length}</button></div>` : ""}`;
  }

  function tableCard(title, rows, prefs, ctx, opts) {
    const o = opts || {};
    const count = rows.length > (o.limit || rows.length) ? "showing " + o.limit + " of " + rows.length : rows.length + " row(s)";
    return html`<section class="card" aria-label="${title}">
      <div class="card__head"><h2>${title}</h2><span class="count">${count}${o.subtitle ? " \u00b7 " + o.subtitle : ""}</span></div>
      ${renderTable(title, rows, prefs, ctx, o)}
    </section>`;
  }

  /** Full watchlist: collapsed <details> by default (state remembered). */
  function watchCard(rows, total, prefs, ctx, opts) {
    const o = opts || {};
    return html`<details class="card card--fold" id="watchDetails"${ctx.watchOpen ? html` open` : ""}>
      <summary class="card__head"><h2>Full watchlist</h2><span class="count">${String(rows.length)}${rows.length !== total ? " of " + total : ""} row(s) \u00b7 every evaluated symbol; Watch rows list the gates they failed \u00b7 <span class="fold-hint">${ctx.watchOpen ? "click to collapse" : "click to expand"}</span></span></summary>
      ${ctx.watchOpen ? renderTable("Full watchlist", rows, prefs, ctx, o) : ""}
    </details>`;
  }

  function renderSections(data, nd, prefs, ctx) {
    const dim = ctx.dim;
    const rec = applyFilters(nd.rec, Object.assign({}, prefs, { sort: prefs.sort === "status_score" ? "score_desc" : prefs.sort }));
    const setups = applyFilters(nd.setups, prefs);
    const watch = applyFilters(nd.watch, prefs);
    const parts = [];
    const v = prefs.view;
    if (v === "all" || v === "recommended") parts.push(dim ? html`<div class="dimmed">${renderOrders(rec, prefs, ctx)}</div>` : renderOrders(rec, prefs, ctx));
    const rest = [];
    if (v === "all" || v === "setups") rest.push(tableCard("Setups", setups, prefs, ctx, { subtitle: "valid and near-miss setups ranked by the scan \u00b7 click / tap a row for details", emptyText: nd.setups.length ? null : "No setups published tonight." }));
    if (v === "all" || v === "watch") rest.push(watchCard(watch, nd.watch.length, prefs, Object.assign({}, ctx, { watchOpen: ctx.watchOpen || v === "watch" }), { limit: ctx.showAllWatch ? 0 : 40, moreKey: "watch", emptyText: nd.watch.length ? null : "No watchlist published tonight." }));
    if (rest.length) parts.push(dim ? html`<div class="banner banner--stale"><div class="banner__body"><div class="banner__text">Built from the same stale/unconfirmed data flagged above: dimmed, not confirmed for ${fmtDate(data.valid_for)}.</div></div></div><div class="dimmed">${rest}</div>` : html`${rest}`);
    return html`${parts}`;
  }

  /** Default exit policy id published with the file (exit_policy.id). */
  function defaultPolicyId(data) {
    const ep = data && data.exit_policy && typeof data.exit_policy === "object" ? data.exit_policy : null;
    return ep && (ep.id || ep.policy_id) ? String(ep.id || ep.policy_id) : null;
  }

  // ── Browser boot ────────────────────────────────────────────────────────
  function boot() {
    const $ = (id) => document.getElementById(id);
    const prefs = normalizePrefs(ITL.store.get(PREFS_KEY));
    const state = { data: null, nd: null, names: {}, edges: {}, showAllWatch: false, open: new Set(), preclose: null };
    const now = () => ITL.now();

    function save() { ITL.store.set(PREFS_KEY, prefs); }

    function populateStrategies() {
      const sel = $("strategyFilter");
      const all = state.nd ? state.nd.rec.concat(state.nd.setups, state.nd.watch) : [];
      const opts = strategyOptions(all, prefs.strat);
      ITL.setHtml(sel, html`${opts.map(o => html`<option value="${o.value}">${o.label}</option>`)}`);
      sel.value = prefs.strat; // options exist now, so the dropdown matches the applied filter
      if (sel.value !== prefs.strat) { prefs.strat = "all"; sel.value = "all"; }
    }

    function render() {
      if (!state.data) return;
      const data = state.data, nd = state.nd, n = now();
      const st = ITL.staleness(data, n);
      ITL.setHtml($("banners"), html`${renderBanners(data, nd, n, state.preclose)}`);
      ITL.setHtml($("meta"), renderMeta(data, nd, n));
      $("kpiRec").textContent = String(nd.rec.length);
      $("kpiSetups").textContent = String(nd.setups.filter(r => r.status === "Valid").length) + " / " + nd.setups.length;
      $("kpiWatch").textContent = String(nd.watch.length);
      $("kpiRisk").textContent = data.risk_mode ? String(data.risk_mode).replace(/_/g, " ").toUpperCase() : DASH;
      const ctx = { names: state.names, edges: state.edges, now: n, validFor: data.valid_for, published: data.published,
        dim: st.stale === true || data.data_fresh === false, showAllWatch: state.showAllWatch,
        open: state.open, watchOpen: prefs.watchOpen, defaultPolicy: defaultPolicyId(data) };
      ITL.setHtml($("tables"), renderSections(data, nd, prefs, ctx));
      const more = document.querySelector('[data-more="watch"]');
      if (more) more.addEventListener("click", () => { state.showAllWatch = true; render(); });
      const wd = $("watchDetails");
      if (wd) wd.addEventListener("toggle", () => {
        if (wd.open === prefs.watchOpen) return;
        prefs.watchOpen = wd.open; save(); render();
      });
    }

    // Row details: click the row (not a link/button inside it) or the toggle.
    $("tables").addEventListener("click", (e) => {
      const tr = e.target.closest("tr.row-compact");
      if (!tr) return;
      if (e.target.closest("a") || (e.target.closest("button") && !e.target.closest(".row-toggle"))) return;
      const detail = tr.nextElementSibling;
      if (!detail || !detail.classList.contains("row-detail")) return;
      const opening = detail.hidden;
      detail.hidden = !opening;
      const key = tr.getAttribute("data-key");
      if (opening) state.open.add(key); else state.open.delete(key);
      tr.setAttribute("aria-expanded", opening ? "true" : "false");
      const btn = tr.querySelector(".row-toggle");
      if (btn) { btn.setAttribute("aria-expanded", opening ? "true" : "false"); btn.textContent = opening ? "\u25be" : "\u25b8"; }
    });

    async function load() {
      $("reloadBtn").disabled = true;
      try {
        const [data, names, edges, pc] = await Promise.all([ITL.fetchJSON(DATA_PATH), ITL.loadNames(), ITL.loadEdgeVerdicts(), ITL.tryFetchJSON("/public/preclose.json")]);
        state.data = data; state.nd = normalizeData(data); state.names = names; state.edges = edges; state.preclose = pc.data;
        ITL.setHtml($("loadError"), html``);
        populateStrategies();
        render();
      } catch (e) {
        ITL.setHtml($("loadError"), ITL.errorBox(e, "tonight's picks (today.json)"));
        if (typeof console !== "undefined") console.error(e);
      } finally {
        $("reloadBtn").disabled = false;
      }
    }

    // Controls
    const pf = $("portfolio"), pfHint = $("portfolioHint"), mp = $("maxPos"), mpHint = $("maxPosHint");
    $("viewMode").value = prefs.view;
    $("q").value = prefs.q;
    $("sortBy").value = prefs.sort;
    ITL.setHtml($("riskPct"), html`${RISK_OPTIONS.map(v => html`<option value="${String(v)}">${fmtNum(v, 2)}%</option>`)}`);
    $("riskPct").value = String(prefs.riskPct);
    if ($("riskPct").value !== String(prefs.riskPct)) { prefs.riskPct = 1; $("riskPct").value = "1"; }
    pf.value = String(prefs.portfolio);
    pfHint.textContent = "= " + fmtAud(prefs.portfolio, 0);
    mp.value = String(prefs.maxPosPct);

    $("viewMode").addEventListener("change", e => { prefs.view = e.target.value; save(); render(); });
    $("strategyFilter").addEventListener("change", e => { prefs.strat = e.target.value; save(); render(); });
    $("sortBy").addEventListener("change", e => { prefs.sort = e.target.value; save(); render(); });
    $("q").addEventListener("input", e => { prefs.q = e.target.value.trim(); save(); render(); });
    $("riskPct").addEventListener("change", e => { const v = num(e.target.value); if (v !== null) { prefs.riskPct = v; save(); render(); } });
    pf.addEventListener("input", () => {
      const r = ITL.readMoneyLike(pf.value);
      if (r.ok) {
        prefs.portfolio = r.value; save();
        pf.classList.remove("invalid"); pfHint.classList.remove("err");
        pfHint.textContent = "= " + fmtAud(r.value, 0);
        render();
      } else {
        pf.classList.add("invalid"); pfHint.classList.add("err");
        pfHint.textContent = r.error + " — sizing still uses " + fmtAud(prefs.portfolio, 0);
      }
    });
    mp.addEventListener("input", () => {
      const v = num(mp.value);
      if (v !== null && v >= 1 && v <= 100) {
        prefs.maxPosPct = v; save();
        mp.classList.remove("invalid"); mpHint.classList.remove("err"); mpHint.textContent = "of portfolio per position";
        render();
      } else {
        mp.classList.add("invalid"); mpHint.classList.add("err");
        mpHint.textContent = "Enter 1–100 — still using " + fmtNum(prefs.maxPosPct, 0) + "%";
      }
    });
    $("reloadBtn").addEventListener("click", load);

    ITL.bootCommon();
    load();
    setInterval(render, 60000); // re-evaluate staleness while the page is open
  }

  return {
    DATA_PATH, PREFS_KEY, DEFAULT_PREFS, RISK_OPTIONS,
    normalizePrefs, strategyOptions, parseEntryText, normalizeRow, normalizeData, v1Sentiment, defaultPolicyId,
    sizeSummary, orderCard, FUND_V2_PILLARS, FUND_V2_TIP, hasFundV2, fundV2Text, fundamentalsHtml,
    orderTypeLabel, exitPlanText, sentimentChips, earningsChip, sizeFor, applyFilters,
    renderBanners, renderMeta, renderOrders, renderTable, tableCard, watchCard, renderSections, boot,
  };
});
