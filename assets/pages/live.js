/* Live check page: re-checks the picks valid for the current session
 * against live prices (live.json v2). Replaces the old before-close page. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../itl.js"));
  else root.ITL_LIVE = factory(root.ITL);
})(typeof self !== "undefined" ? self : this, function (ITL) {
  "use strict";
  const { html, num, fmtPrice, fmtNum, fmtPct, fmtDate, fmtDateTime, fmtTime, ago, DASH } = ITL;

  const DATA_PATH = "/public/live.json";
  const LEGACY_PATH = "/public/before_close.json";
  const VERDICTS = ["ENTER", "HOLD", "WAIT", "SKIP", "EXIT"];
  const VERDICT_HELP = {
    ENTER: "Conditions still valid: place / keep the order.",
    HOLD: "Filled: hold, manage with the trailing stop.",
    WAIT: "Not triggered yet: leave the order working, re-check later.",
    SKIP: "Setup no longer valid: cancel the order.",
    EXIT: "Exit the position (stop or trail hit).",
  };
  const FILL_LABELS = {
    not_triggered: "Not triggered", filled: "Filled", gapped_past_limit: "Gapped past limit",
    stopped_out: "Stopped out", invalidated_pre_fill: "Invalidated before fill",
  };

  /** Map the v1 before_close.json shape onto live items (best effort). */
  function adaptLegacy(bc) {
    const ups = Array.isArray(bc && bc.updates) ? bc.updates : [];
    return {
      _legacy: true,
      generated_at_utc: bc && bc.generated_at_utc,
      picks_valid_for: null,
      picks_signal_session: null,
      skipped: !!(bc && bc.skipped),
      items: ups.filter(u => u && typeof u === "object").map(u => ({
        symbol: u.symbol, strategy: u.strategy, order_type: null, entry_ref: u.original_entry, stop: u.original_stop,
        original_score: u.original_score, revalidated_score: u.updated_score,
        live_price: u.current_price, live_time_text: u.current_price_time, gap_pct_signal: u.gap_pct,
        verdict: null, legacy_status: u.status, reasons: u.plain_english ? [u.plain_english] : [],
      })),
    };
  }

  function verdictBadge(it) {
    const v = it.verdict ? String(it.verdict).toUpperCase() : null;
    if (v && VERDICTS.indexOf(v) >= 0) return html`<span class="badge badge--${v}" title="${VERDICT_HELP[v]}">${v}</span>`;
    if (it.legacy_status) return html`<span class="badge badge--LEGACY" title="Old before-close status (v1)">${it.legacy_status}</span>`;
    return html`<span class="badge badge--SKIP">${v || DASH}</span>`;
  }

  function orderCell(it) {
    const t = it.order_type;
    const lvl = (k, v) => html`<span class="lvl"><span>${k}</span>${fmtPrice(v, it)}</span>`;
    const label = ({ LIMIT: "LIMIT", STOP: "STOP", STOP_LIMIT: "STOP-LIMIT", MARKET_OPEN: "MARKET @ OPEN" })[t] || (t || "");
    return html`${label ? html`<b class="mono">${label}</b>` : ""}
      ${t === "STOP" || t === "STOP_LIMIT" ? lvl("trig", it.trigger) : ""}
      ${t === "LIMIT" || t === "STOP_LIMIT" ? lvl("lim", it.limit) : ""}
      ${lvl("ref", it.entry_ref)}`;
  }

  function gapCell(it) {
    const g = num(it.gap_pct_open !== undefined ? it.gap_pct_open : it.gap_pct_signal);
    if (g === null) return html`—`;
    return html`<span class="${g >= 0 ? "pos" : "neg"}">${fmtPct(g, { dp: 2, sign: true })}</span>`;
  }

  function liveCell(it) {
    const t = it.live_time_utc ? fmtTime(it.live_time_utc) : (it.live_time_text || "");
    return html`<b>${fmtPrice(it.live_price, it)}</b>${t ? html`<span class="lvl small">${t}</span>` : ""}`;
  }

  function fillCell(it) {
    const s = it.fill_status;
    if (!s) return html`—`;
    const cls = s === "filled" ? "pos" : (s === "stopped_out" || s === "invalidated_pre_fill" || s === "gapped_past_limit") ? "neg" : "muted";
    return html`<span class="${cls}">${FILL_LABELS[s] || s}</span>`;
  }

  function renderItems(items, ctx) {
    if (!items.length) {
      return html`<section class="card"><div class="empty-state"><div class="empty-state__title">No picks to check</div>
        The night scan published no recommended orders for this session.</div></section>`;
    }
    const rows = items.map(it => {
      const filled = it.fill_status === "filled" || num(it.fill_price_est) !== null;
      const reasons = Array.isArray(it.reasons) ? it.reasons : (it.reasons ? [String(it.reasons)] : []);
      const valid = it.signal_still_valid;
      return html`<tr class="row-main">
        <td data-label="Symbol">${ITL.symbolCell(it.symbol, ctx.names)}</td>
        <td data-label="Strategy">${ITL.strategyLabel(it.strategy)}<span class="lvl small">score ${fmtNum(it.original_score, 0)}${num(it.revalidated_score) !== null ? " → " + fmtNum(it.revalidated_score, 0) : ""}</span></td>
        <td data-label="Order" class="mono">${orderCell(it)}</td>
        <td data-label="Stop" class="mono right">${fmtPrice(it.stop, it)}</td>
        <td data-label="Live" class="mono right">${liveCell(it)}</td>
        <td data-label="Day O / H / L" class="mono right nowrap">${fmtPrice(it.day_open, it)} / ${fmtPrice(it.day_high, it)} / ${fmtPrice(it.day_low, it)}</td>
        <td data-label="Gap" class="mono right">${gapCell(it)}</td>
        <td data-label="Fill">${fillCell(it)}${num(it.fill_price_est) !== null ? html`<span class="lvl small mono">est. ${fmtPrice(it.fill_price_est, it)}</span>` : ""}</td>
        <td data-label="Peak / trail" class="mono right">${filled ? html`${fmtPrice(it.peak_since_fill, it)}<span class="lvl small">trail ${fmtPrice(it.trail_level, it)}</span>` : "—"}</td>
        <td data-label="Verdict">${verdictBadge(it)}</td>
      </tr>
      <tr class="row-note"><td colspan="10" class="td-full">
        ${reasons.length ? html`<ul class="health-list">${reasons.map(r => html`<li>${r}</li>`)}</ul>` : html`<span class="dim">No reasons given.</span>`}
        ${valid === false ? html`<div class="small neg">Signal no longer valid on revalidation.</div>` : ""}
      </td></tr>`;
    });
    return html`<section class="card" aria-label="Live check">
      <div class="card__head"><h2>Picks vs live prices</h2><span class="count">${items.length} pick(s)</span></div>
      <div class="tableWrap"><table class="stack">
        <thead><tr><th>Symbol</th><th>Strategy</th><th>Order</th><th class="right">Stop</th><th class="right">Live</th><th class="right">Day O / H / L</th><th class="right">Gap</th><th>Fill</th><th class="right">Peak / trail</th><th>Verdict</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }

  function verdictCounts(items) {
    const c = {};
    items.forEach(it => { const v = it.verdict || it.legacy_status || "?"; c[v] = (c[v] || 0) + 1; });
    return c;
  }

  function renderBanners(data, now, todayData) {
    const out = [];
    if (data._legacy) {
      out.push(ITL.banner("warn", "Data format outdated: live.json not published yet",
        "Showing the old before_close.json instead. It has no fill status or verdicts; its status is the old CONFIRMED / IMPROVED / INVALIDATED label.", "OLD FORMAT"));
      const ran = ITL.parseIso(data.generated_at_utc) ? ITL.sydneyDate(ITL.parseIso(data.generated_at_utc)) : null;
      const today = ITL.sydneyDate(now);
      if (ran !== today) out.push(ITL.banner("stale", "STALE: this check ran " + (ran ? "on " + fmtDate(ran) : "at an unknown time"),
        html`Today in Sydney is ${fmtDate(today)}. Nothing below applies to today's session.`, "STALE"));
    } else {
      const info = ITL.schemaInfo(data, "live");
      if (!info.ok) out.push(ITL.outdatedBanner("live.json", info));
    }
    out.push(ITL.staleBanner(data, now, "live.json"));
    if (!data._legacy) {
      const ps = ITL.picksStale(data, now);
      if (ps.upcoming) {
        out.push(ITL.banner("info", "Picks for " + fmtDate(ps.validFor) + " — market not open yet for that session",
          "Tonight's picks are listed below. Live verdicts start after the 10:00 Sydney open; scheduled checks run at ~10:20, ~12:30 and ~15:00 Sydney. Today's earlier checks are archived.", "UPCOMING"));
      } else if (ps.stale) {
        const tv = todayData && todayData.valid_for === ps.today && Array.isArray(todayData.recommended_orders) ? todayData.recommended_orders : null;
        out.push(ITL.banner("stale", "STALE PICKS: this check is for " + (ps.validFor ? fmtDate(ps.validFor) : "an unknown session"),
          html`Today in Sydney is ${fmtDate(ps.today)}. Nothing below applies to today's session.${tv ? html` Tonight's scan has ${tv.length} pick(s) valid today (${tv.map(r => r.symbol).join(", ") || "none"}); they have not been live-checked yet — see <a href="/today/">Today</a>.` : ""}`, "STALE PICKS"));
      }
    }
    const ph = ITL.marketPhase(data.market_state);
    if (ph.preOpen && !(ITL.picksStale(data, now).upcoming)) {
      out.push(ITL.banner("info", "Market not open yet",
        "This check ran before the 10:00 Sydney open, so there are no live prices. Orders can be placed for the open; scheduled checks run at ~10:20, ~12:30 and ~15:00 Sydney.", "PRE-OPEN"));
    } else if (ph.key && !ph.open && !ITL.picksStale(data, now).stale && !ITL.picksStale(data, now).upcoming) {
      out.push(ITL.banner("info", "Market phase at check time: " + ph.label, "Prices below are the last available for the session.", ph.label.toUpperCase()));
    }
    return out;
  }

  function renderMeta(data, now) {
    const ph = ITL.marketPhase(data.market_state);
    const st = ITL.staleness(data, now);
    return html`
      <span class="pill">Picks from <b>${fmtDate(data.picks_signal_session)}</b></span>
      <span class="pill">Valid for <b>${fmtDate(data.picks_valid_for)}</b></span>
      <span class="pill">Checked <b>${fmtDateTime(data.generated_at_utc)}</b> (${ago(data.generated_at_utc, now)})</span>
      <span class="pill" title="Market phase when the check ran (from market_state)">Phase <b>${ph.label}</b></span>
      <span class="pill ${st.stale ? "pill--bad" : ""}">Fresh until <b>${st.staleAfter ? fmtDateTime(st.staleAfter) : DASH}</b></span>`;
  }

  function boot() {
    const $ = (id) => document.getElementById(id);
    const state = { data: null, today: null, names: {} };

    function setStatus(text, s) { const el = $("refreshStatus"); el.textContent = text; el.setAttribute("data-state", s || "info"); }

    function render() {
      const d = state.data;
      if (!d) return;
      const n = ITL.now();
      const items = Array.isArray(d.items) ? d.items.filter(x => x && typeof x === "object") : [];
      ITL.setHtml($("banners"), html`${renderBanners(d, n, state.today)}`);
      ITL.setHtml($("meta"), renderMeta(d, n));
      const c = verdictCounts(items);
      ITL.setHtml($("kpis"), html`${["ENTER", "HOLD", "WAIT", "SKIP", "EXIT"].map(v => html`<div class="kpiBox"><div class="kpiLabel">${v}</div><div class="kpiValue">${String(c[v] || 0)}</div><div class="kpiSub">${VERDICT_HELP[v]}</div></div>`)}`);
      const stale = !d._legacy && (ITL.picksStale(d, n).stale || ITL.staleness(d, n).stale === true);
      const table = d.skipped ? html`<section class="card"><div class="empty-state"><div class="empty-state__title">No check today</div>The market was closed.</div></section>` : renderItems(items, { names: state.names });
      ITL.setHtml($("items"), stale ? html`<div class="dimmed">${table}</div>` : table);
    }

    async function load() {
      $("reloadBtn").disabled = true;
      try {
        const [res, today, names] = await Promise.all([ITL.tryFetchJSON(DATA_PATH), ITL.tryFetchJSON("/public/today.json"), ITL.loadNames()]);
        state.names = names; state.today = today.data;
        if (res.data) state.data = res.data;
        else if (res.error && res.error.kind === "missing") {
          const legacy = await ITL.fetchJSON(LEGACY_PATH);
          state.data = adaptLegacy(legacy);
        } else throw res.error;
        ITL.setHtml($("loadError"), html``);
        render();
      } catch (e) {
        ITL.setHtml($("loadError"), ITL.errorBox(e, "the live check (live.json)"));
        if (typeof console !== "undefined") console.error(e);
      } finally {
        $("reloadBtn").disabled = false;
      }
    }

    const refresher = ITL.createRefresher({
      key: "live_check", workflows: ["live_check", "before_close"], dataPath: DATA_PATH,
      fixtures: !!ITL.fixturesMode(),
      getBaseline: () => state.data && !state.data._legacy ? state.data.generated_at_utc : null,
      onData: (d) => { state.data = d; render(); },
      onStatus: setStatus,
      setDisabled: (dis, label) => { const b = $("refreshBtn"); b.disabled = dis; b.textContent = label || "Run live check now"; },
    });
    $("refreshBtn").addEventListener("click", () => refresher.start());
    $("reloadBtn").addEventListener("click", () => { refresher.cancel("Auto-check stopped (manual reload)."); load(); });

    ITL.bootCommon();
    refresher.restore();
    load();
    setInterval(render, 60000);
  }

  return { DATA_PATH, adaptLegacy, verdictBadge, renderItems, renderBanners, renderMeta, verdictCounts, boot };
});
