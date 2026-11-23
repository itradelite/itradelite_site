/* Intraday scanner page (intraday.json v2). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../itl.js"));
  else root.ITL_INTRADAY = factory(root.ITL);
})(typeof self !== "undefined" ? self : this, function (ITL) {
  "use strict";
  const { html, num, fmtPrice, fmtNum, fmtDate, fmtDateTime, ago, DASH } = ITL;

  const DATA_PATH = "/public/intraday.json";
  const PREFS_KEY = "itl_intraday_prefs";
  const DEFAULT_PREFS = { interval: "all", strat: "all", dir: "all", q: "" };

  function intervalMinutes(iv) {
    const m = String(iv || "").trim().match(/^(\d+)\s*(m|min|h|d)$/i);
    if (!m) return 1e9;
    const n = Number(m[1]), u = m[2].toLowerCase();
    return u === "h" ? n * 60 : u === "d" ? n * 1440 : n;
  }

  function otherSignals(r) { return Array.isArray(r && r.other_signals) ? r.other_signals.filter(o => o && typeof o === "object") : []; }

  /** Every interval present: primary rows, other_signals[] and the file's list. */
  function intervalsOf(data) {
    const set = new Set();
    const sigs = Array.isArray(data && data.signals) ? data.signals : [];
    sigs.forEach(r => {
      if (r && r.interval) set.add(String(r.interval));
      otherSignals(r).forEach(o => { if (o.interval) set.add(String(o.interval)); });
    });
    String((data && data.interval) || "").split(",").map(s => s.trim()).filter(Boolean).forEach(s => set.add(s));
    return [...set].sort((a, b) => intervalMinutes(a) - intervalMinutes(b) || a.localeCompare(b));
  }

  /** Interval filter: the row's own interval OR any other_signals[].interval. */
  function matchesInterval(r, sel) {
    if (!sel || sel === "all") return true;
    if (String(r.interval || "") === sel) return true;
    return otherSignals(r).some(o => String(o.interval || "") === sel);
  }

  function applyFilters(rows, p) {
    return rows.filter(r => {
      if (!matchesInterval(r, p.interval)) return false;
      if (p.strat !== "all" && String(r.strategy || "") !== p.strat) return false;
      if (p.dir !== "all" && String(r.direction || "").toLowerCase() !== p.dir) return false;
      if (p.q && String(r.symbol || "").toUpperCase().indexOf(p.q.toUpperCase()) < 0) return false;
      return true;
    });
  }

  function normalizePrefs(o) {
    const p = Object.assign({}, DEFAULT_PREFS);
    if (o && typeof o === "object") {
      ["interval", "strat", "dir"].forEach(k => { if (typeof o[k] === "string" && o[k]) p[k] = o[k]; });
      if (typeof o.q === "string") p.q = o.q.slice(0, 40);
    }
    return p;
  }

  function sessionState(data, now) {
    const ph = ITL.marketPhase(data && data.market_state);
    if (data && data.session_closed === true) return { closed: true, phase: ph };
    if (ph.key) return { closed: !ph.open, phase: ph };
    if (data && typeof data.market_open === "boolean") return { closed: !data.market_open, phase: { key: data.market_open ? "open" : "closed", label: data.market_open ? "Market open" : "Closed (v1 flag)" } };
    return { closed: null, phase: ph };
  }

  /** Session the signals came from: latest bar (Sydney date), else scan time. */
  function lastSessionDate(data) {
    let best = null;
    (Array.isArray(data && data.signals) ? data.signals : []).forEach(r => {
      const d = r && ITL.parseIso(r.bar_time_utc);
      if (d && (!best || d > best)) best = d;
    });
    if (!best) best = ITL.parseIso(data && data.generated_at_utc);
    return best ? ITL.sydneyDate(best) : (data && (data.valid_for || data.generated)) || null;
  }

  function barCell(r) {
    const t = r.bar_time_utc ? fmtDateTime(r.bar_time_utc) : (r.signal_time || DASH);
    let st = html``;
    if (r.bar_is_complete === true) st = html`<span class="chip chip--pos" title="The bar had closed when the signal fired">complete</span>`;
    else if (r.bar_is_complete === false) st = html`<span class="chip chip--warn" title="The bar was still forming: the signal can disappear when it closes">forming</span>`;
    else st = html`<span class="chip chip--nodata" title="Bar completeness not published (v1 data)">unknown</span>`;
    return html`<span class="nowrap small">${t}</span><div>${st}</div>`;
  }

  function renderTable(rows, ctx) {
    if (!rows.length) {
      return html`<section class="card"><div class="empty-state"><div class="empty-state__title">${ctx.total ? "No signals match your filters" : "No intraday signals"}</div>
        ${ctx.total ? "Try another interval, strategy or direction." : "The last scan found nothing, or has not run yet."}</div></section>`;
    }
    const body = rows.map(r => {
      const dir = String(r.direction || "").toLowerCase();
      const others = otherSignals(r);
      const viaOther = ctx.interval !== "all" && String(r.interval || "") !== ctx.interval;
      return html`<tr class="row-main">
        <td data-label="Symbol">${ITL.symbolCell(r.symbol, ctx.names)}</td>
        <td data-label="Interval" class="mono">${r.interval || DASH}${others.length ? html`<span class="lvl small">also ${others.map(o => o.interval || "?").join(", ")}</span>` : ""}</td>
        <td data-label="Strategy">${r.strategy || DASH}</td>
        <td data-label="Direction">${dir === "long" ? html`<span class="pos">▲ Long</span>` : dir === "short" ? html`<span class="neg">▼ Short</span>` : DASH}</td>
        <td data-label="Entry" class="mono right">${fmtPrice(r.entry, r)}</td>
        <td data-label="Stop" class="mono right">${fmtPrice(r.stop, r)}</td>
        <td data-label="Target" class="mono right">${fmtPrice(r.target, r)}</td>
        <td data-label="Score" class="mono right">${fmtNum(r.score, 0)}</td>
        <td data-label="Bar">${barCell(r)}</td>
      </tr>
      <tr class="row-note"><td colspan="9" class="td-full small">
        ${r.note || ""}
        ${viaOther ? html` <span class="chip chip--info">matched on ${ctx.interval} (also fired)</span>` : ""}
        ${others.length ? html` <span class="dim">Also fired on ${others.map(o => (o.interval || "?") + (o.strategy && o.strategy !== r.strategy ? " (" + o.strategy + ")" : "")).join(", ")}; the highest-conviction signal is shown.</span>` : ""}
      </td></tr>`;
    });
    return html`<section class="card" aria-label="Intraday signals">
      <div class="card__head"><h2>Signals</h2><span class="count">${rows.length} of ${ctx.total}</span></div>
      <div class="tableWrap"><table class="stack">
        <thead><tr><th>Symbol</th><th>Interval</th><th>Strategy</th><th>Direction</th><th class="right">Entry</th><th class="right">Stop</th><th class="right">Target</th><th class="right">Score</th><th>Bar</th></tr></thead>
        <tbody>${body}</tbody></table></div></section>`;
  }

  function renderBanners(data, now) {
    const out = [];
    const info = ITL.schemaInfo(data, "intraday");
    if (!info.ok) out.push(ITL.outdatedBanner("intraday.json", info));
    out.push(ITL.staleBanner(data, now, "intraday.json"));
    const ss = sessionState(data, now);
    if (ss.closed) {
      const sess = lastSessionDate(data);
      out.push(ITL.banner("info", "Session closed — showing the last session's signals" + (sess ? " (" + fmtDate(sess) + ")" : ""),
        "Intraday signals only mean something while the ASX is trading (10:00–16:00 Sydney). These rows are dimmed and are not live.", ss.phase.label ? String(ss.phase.label).toUpperCase() : "CLOSED"));
    }
    return out;
  }

  function renderMeta(data, now) {
    const ss = sessionState(data, now);
    const st = ITL.staleness(data, now);
    return html`
      <span class="pill">Scanned <b>${fmtDateTime(data.generated_at_utc)}</b> (${ago(data.generated_at_utc, now)})</span>
      <span class="pill">Session <b>${fmtDate(ITL.sessionDateOf(data.market_state) || data.valid_for)}</b></span>
      <span class="pill" title="Market phase at scan time (from market_state)">Phase <b>${ss.phase.label || DASH}</b></span>
      <span class="pill">Intervals <b>${data.interval || DASH}</b></span>
      <span class="pill">Universe <b>${data.universe_size ? String(data.universe_size) : DASH}</b></span>
      <span class="pill ${st.stale ? "pill--bad" : ""}">Fresh until <b>${st.staleAfter ? fmtDateTime(st.staleAfter) : DASH}</b></span>`;
  }

  function boot() {
    const $ = (id) => document.getElementById(id);
    const prefs = normalizePrefs(ITL.store.get(PREFS_KEY));
    const state = { data: null, names: {} };
    const save = () => ITL.store.set(PREFS_KEY, prefs);

    function setOptions(id, opts, key) {
      const sel = $(id);
      const values = opts.map(o => o.value);
      if (values.indexOf(prefs[key]) < 0) opts = opts.concat([{ value: prefs[key], label: prefs[key] + " (none now)" }]);
      ITL.setHtml(sel, html`${opts.map(o => html`<option value="${o.value}">${o.label}</option>`)}`);
      sel.value = prefs[key];
    }

    function populate() {
      const rows = Array.isArray(state.data.signals) ? state.data.signals : [];
      setOptions("intervalFilter", [{ value: "all", label: "All intervals" }].concat(intervalsOf(state.data).map(v => ({ value: v, label: v }))), "interval");
      const strats = [...new Set(rows.map(r => r && r.strategy).filter(Boolean).map(String))].sort();
      setOptions("stratFilter", [{ value: "all", label: "All strategies" }].concat(strats.map(s => ({ value: s, label: s }))), "strat");
      $("dirFilter").value = prefs.dir;
      $("symSearch").value = prefs.q;
    }

    function render() {
      const d = state.data;
      if (!d) return;
      const n = ITL.now();
      const rows = (Array.isArray(d.signals) ? d.signals : []).filter(r => r && typeof r === "object");
      ITL.setHtml($("banners"), html`${renderBanners(d, n)}`);
      ITL.setHtml($("meta"), renderMeta(d, n));
      const ss = sessionState(d, n);
      $("kpiSignals").textContent = String(rows.length);
      $("kpiPhase").textContent = ss.phase.label || DASH;
      $("kpiComplete").textContent = String(rows.filter(r => r.bar_is_complete === true).length) + " / " + rows.length;
      $("kpiAge").textContent = ago(d.generated_at_utc, n);
      const filtered = applyFilters(rows, prefs);
      const t = renderTable(filtered, { names: state.names, total: rows.length, interval: prefs.interval });
      const dim = ss.closed || ITL.staleness(d, n).stale === true;
      ITL.setHtml($("tables"), dim ? html`<div class="dimmed">${t}</div>` : t);
    }

    async function load() {
      $("reloadBtn").disabled = true;
      try {
        const [d, names] = await Promise.all([ITL.fetchJSON(DATA_PATH), ITL.loadNames()]);
        state.data = d; state.names = names;
        ITL.setHtml($("loadError"), html``);
        populate();
        render();
      } catch (e) {
        ITL.setHtml($("loadError"), ITL.errorBox(e, "intraday signals (intraday.json)"));
      } finally { $("reloadBtn").disabled = false; }
    }

    [["intervalFilter", "interval"], ["stratFilter", "strat"], ["dirFilter", "dir"]].forEach(([id, k]) =>
      $(id).addEventListener("change", e => { prefs[k] = e.target.value; save(); render(); }));
    $("symSearch").addEventListener("input", e => { prefs.q = e.target.value.trim(); save(); render(); });

    const refresher = ITL.createRefresher({
      key: "intraday", workflows: ["intraday", null], dataPath: DATA_PATH,
      fixtures: !!ITL.fixturesMode(),
      getBaseline: () => state.data ? state.data.generated_at_utc : null,
      onData: (d) => { state.data = d; populate(); render(); },
      onStatus: (text, s) => { const el = $("refreshStatus"); el.textContent = text; el.setAttribute("data-state", s); },
      setDisabled: (dis, label) => { const b = $("refreshBtn"); b.disabled = dis; b.textContent = label || "Run intraday scan now"; },
    });
    $("refreshBtn").addEventListener("click", () => refresher.start());
    $("reloadBtn").addEventListener("click", () => { refresher.cancel("Auto-check stopped (manual reload)."); load(); });

    ITL.bootCommon();
    refresher.restore();
    load();
    setInterval(render, 60000);
  }

  return { DATA_PATH, lastSessionDate, intervalsOf, matchesInterval, applyFilters, normalizePrefs, sessionState, renderTable, renderBanners, renderMeta, boot };
});
