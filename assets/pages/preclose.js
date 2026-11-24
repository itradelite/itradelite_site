/* Pre-close picks page (preclose.json, schema itl.preclose.v2, job
 * preclose_scan): today's signals from a scan ~45 min before the close, to
 * buy in the closing auction instead of at the next open. Reuses the Today
 * page's cards, tables and sizing (ITL_TODAY). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../itl.js"), require("./today.js"));
  else root.ITL_PRECLOSE = factory(root.ITL, root.ITL_TODAY);
})(typeof self !== "undefined" ? self : this, function (ITL, TODAY) {
  "use strict";
  const { html, num, fmtNum, fmtAud, fmtDate, fmtDateTime, fmtTime, ago, DASH } = ITL;

  const DATA_PATH = "/public/preclose.json";
  const COUNTDOWN_URGENT_MS = 10 * 60e3;

  /** Session/publication state of a pre-close file at `now`. */
  function pcState(pc, now) {
    const today = ITL.sydneyDate(now);
    const session = pc && pc.signal_session ? String(pc.signal_session) : null;
    const deadline = ITL.precloseDeadline(pc);
    const cd = ITL.countdown(deadline, now);
    const isToday = !!session && session === today;
    return {
      today, session, deadline, countdown: cd, isToday,
      oldSession: !isToday,                       // not today's session -> stale
      published: !!pc && pc.published !== false,
      passed: isToday && cd.passed,               // today's trade-by time is over
      envStale: ITL.staleness(pc, now).stale === true,
    };
  }

  function normalize(pc) {
    const nd = TODAY.normalizeData(Object.assign({}, pc, { schema: "itl.today.v2" })); // same row shape as today.json
    const withheld = (Array.isArray(pc && pc.withheld_orders) ? pc.withheld_orders : []).filter(r => r && typeof r === "object").map(r => TODAY.normalizeRow(r, false));
    return Object.assign(nd, { info: ITL.schemaInfo(pc, "preclose"), withheld });
  }

  function renderBanners(pc, now) {
    const out = [];
    const info = ITL.schemaInfo(pc, "preclose");
    if (!info.ok) out.push(ITL.outdatedBanner("preclose.json", info));
    const s = pcState(pc, now);
    if (s.oldSession) {
      out.push(ITL.banner("stale", "STALE: these pre-close picks were for " + (s.session ? fmtDate(s.session) : "an unknown session"),
        html`Today in Sydney is ${fmtDate(s.today)}. Pre-close picks are only actionable before the close of their own session; today's scan runs ~15:15 Sydney on trading days (or press <i>Run pre-close scan now</i> during the session).`, "OLD PICKS"));
    } else if (s.passed) {
      out.push(ITL.banner("info", "Trade-by time has passed (" + ITL.tradeByText(s.deadline) + ")",
        "These picks were for today's closing auction. They are kept here and forward-tracked against the night picks on the track record.", "CLOSED"));
    }
    if (!s.oldSession) out.push(ITL.staleBanner(pc, now, "preclose.json"));
    if (pc && pc.published === false) {
      out.push(ITL.banner("error", "Not published: no pre-close picks from this scan",
        html`${pc.reason ? "Reason: " + pc.reason + ". " : "The pre-close scan withheld its orders. "}It withholds when the market is not open, there are under 15 min to the close, coverage is below 90% or live prices are over 20 min old. Do not trade the withheld orders below; they are shown for reference only.`, "WITHHELD"));
    }
    if (pc && pc.data_fresh === false) {
      out.push(ITL.banner("stale", "Live prices not confirmed fresh", "The scan could not confirm its live prices were current; treat every row as unconfirmed.", "NOT FRESH"));
    }
    const cov = pc && pc.coverage && num(pc.coverage.coverage_pct);
    if (cov !== null && cov !== undefined && cov < 90) {
      out.push(ITL.banner("warn", "Low data coverage: " + ITL.fmtPct(cov, { dp: 1 }) + " of the universe", "Missing symbols could not generate signals.", "COVERAGE"));
    }
    return out;
  }

  function deadlineCard(pc, now, job) {
    const s = pcState(pc, now);
    const cls = !s.isToday || s.countdown.passed ? "passed" : (s.countdown.ms !== null && s.countdown.ms < COUNTDOWN_URGENT_MS ? "urgent" : "");
    const cdText = !s.isToday ? "not today's session" : s.countdown.text;
    const ph = ITL.marketPhase(pc && pc.market_state);
    const ms = pc && pc.market_state && typeof pc.market_state === "object" ? pc.market_state : {};
    const recs = Array.isArray(pc && pc.recommended_orders) ? pc.recommended_orders.length : 0;
    return html`<div class="deadline">
        <div><div class="deadline__label">Trade by</div><div class="deadline__val">${ITL.tradeByText(s.deadline)}</div></div>
        <div><div class="deadline__label">Time left</div><div class="deadline__big ${cls}" id="countdown" aria-live="off">${cdText}</div></div>
        <div><div class="deadline__label">Prices as of</div><div class="deadline__val">${ITL.sydBneTime(pc && pc.price_as_of_utc)}${pc && pc.price_as_of_utc ? html` <span class="small">(${ago(pc.price_as_of_utc, now)})</span>` : ""}</div></div>
        <div><div class="deadline__label">Session</div><div class="deadline__val">${fmtDate(s.session)}</div></div>
        <div><div class="deadline__label">Orders</div><div class="deadline__val">${pc && pc.published === false ? "withheld" : String(recs)}</div></div>
      </div>
      <div class="meta" style="padding-top:0;">
        <span class="pill">Scan <b>${fmtTime(pc && pc.scan_started_utc, { noTz: true })} → ${fmtTime(pc && (pc.scan_finished_utc || pc.scan_completed_at_utc))}</b> Brisbane</span>
        <span class="pill">Generated <b>${fmtDateTime(pc && pc.generated_at_utc)}</b> (${ago(pc && pc.generated_at_utc, now)})</span>
        <span class="pill" title="Market phase when the scan ran (from market_state)">Phase at scan <b>${ph.label}</b>${num(ms.minutes_to_close) !== null ? " · " + fmtNum(ms.minutes_to_close, 0) + " min to close" : ""}</span>
        <span class="pill">Mode <b>${pc && pc.signal_mode ? String(pc.signal_mode) : DASH}</b></span>
        ${jobPill(job, now)}
      </div>`;
  }

  /** status.json jobs.preclose_scan as a pill. */
  function jobPill(job, now) {
    if (!job || typeof job !== "object") return html`<span class="pill">Job <b>preclose_scan</b> · no status yet</span>`;
    const bad = job.stale === true || (job.last_status && !/^(ok|success|succeeded|skipped|not_in_session|stale_data|refused_older)$/i.test(String(job.last_status)));
    return html`<span class="pill ${bad ? "pill--bad" : "pill--ok"}" title="${job.health ? "health: " + job.health : ""}">Job <b>preclose_scan</b> · ${job.last_status || DASH}${job.last_success_utc ? " · last success " + fmtDateTime(job.last_success_utc) + " (" + ago(job.last_success_utc, now) + ")" : " · no recorded success"}</span>`;
  }

  function renderSections(pc, nd, prefs, ctx) {
    const s = pcState(pc, ctx.now);
    const c = Object.assign({ stream: "preclose", validFor: pc && (pc.valid_for || pc.signal_session), published: pc && pc.published,
      tradeBy: ITL.tradeByText(s.deadline), priceAsOf: pc && pc.price_as_of_utc ? ITL.sydBneTime(pc.price_as_of_utc) : null,
      defaultPolicy: TODAY.defaultPolicyId(pc) }, ctx);
    const dim = s.oldSession || s.passed || s.envStale || pc.published === false;
    const parts = [TODAY.renderOrders(nd.rec, prefs, c)];
    if (nd.withheld.length) {
      parts.push(html`<section class="card" aria-label="Withheld orders"><div class="card__head"><h2>Withheld orders</h2><span class="count">${String(nd.withheld.length)} · NOT published — reference only, do not trade</span></div>
        <div class="orders">${nd.withheld.map(r => TODAY.orderCard(r, prefs, c))}</div></section>`);
    }
    parts.push(TODAY.tableCard("Setups", nd.setups, prefs, c, { subtitle: "valid and near-miss setups on today's spliced bar · click / tap a row for details", emptyText: "No setups published by this scan." }));
    return dim ? html`<div class="dimmed">${parts}</div>` : html`${parts}`;
  }

  function whyCard() {
    return html`<section class="card" aria-label="Why pre-close picks">
      <div class="card__head"><h2>Why this page exists</h2><a class="small" href="${ITL.siteHref("/track-record/")}">Night vs pre-close on the track record &rarr;</a></div>
      <div class="card__body small">
        <p style="margin-top:0;">The night scan uses the completed daily bar, so its picks can only be traded at the <b>next open</b> — when everyone else running similar scans has the same signals. The pre-close scan runs the same strategies ~45 minutes before the close on <b>today's</b> bar (live price spliced in), so you can buy in the closing auction or at market before the close instead of waiting for tomorrow's open.</p>
        <p>Same rules as the night scan: max 2 orders, one per symbol, same stops, targets, sizing and exit plans. Entry ref is the live price rounded up a tick (worst case for sizing); the real fill is the closing price.</p>
        <p style="margin-bottom:0;">It is an experiment, tracked against the night picks: the track record shows a <i>historical estimate</i> (night signals entered at that day's close) and the <i>forward-tracked</i> real pre-close picks, collected from 25 Nov 2026.</p>
      </div></section>`;
  }

  function emptyState(err) {
    if (err && err.kind === "missing") {
      return html`<section class="card"><div class="empty-state"><div class="empty-state__title">No pre-close scan published yet</div>
        The scheduled scan runs ~15:15 Sydney on trading days. During the session you can run one now with the button above (~2–4 min).</div></section>`;
    }
    return ITL.errorBox(err, "the pre-close picks (preclose.json)");
  }

  // ── Browser boot ────────────────────────────────────────────────────────
  function boot() {
    const $ = (id) => document.getElementById(id);
    const prefs = TODAY.normalizePrefs(ITL.store.get(TODAY.PREFS_KEY)); // same sizing as Today
    const state = { data: null, nd: null, names: {}, edges: {}, job: null, open: new Set() };

    function savePrefs() {
      const all = TODAY.normalizePrefs(ITL.store.get(TODAY.PREFS_KEY));
      all.portfolio = prefs.portfolio; all.riskPct = prefs.riskPct; all.maxPosPct = prefs.maxPosPct;
      ITL.store.set(TODAY.PREFS_KEY, all);
    }
    function setStatus(text, s) { const el = $("refreshStatus"); el.textContent = text; el.setAttribute("data-state", s || "info"); }

    function tick() {
      const el = $("countdown");
      if (!el || !state.data) return;
      const s = pcState(state.data, ITL.now());
      el.textContent = s.isToday ? s.countdown.text : "not today's session";
      el.className = "deadline__big " + (!s.isToday || s.countdown.passed ? "passed" : (s.countdown.ms < COUNTDOWN_URGENT_MS ? "urgent" : ""));
    }

    function render() {
      const d = state.data;
      if (!d) return;
      const n = ITL.now();
      ITL.setHtml($("banners"), html`${renderBanners(d, n)}`);
      ITL.setHtml($("deadline"), deadlineCard(d, n, state.job));
      ITL.setHtml($("tables"), renderSections(d, state.nd, prefs, { names: state.names, edges: state.edges, now: n, open: state.open }));
    }

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
      if (btn) { btn.setAttribute("aria-expanded", opening ? "true" : "false"); btn.textContent = opening ? "▾" : "▸"; }
    });

    async function load() {
      $("reloadBtn").disabled = true;
      try {
        const [res, names, edges, st] = await Promise.all([ITL.tryFetchJSON(DATA_PATH), ITL.loadNames(), ITL.loadEdgeVerdicts(), ITL.tryFetchJSON("/public/status.json")]);
        state.names = names; state.edges = edges;
        state.job = st.data && st.data.jobs && typeof st.data.jobs === "object" ? st.data.jobs.preclose_scan || null : null;
        if (!res.data) {
          state.data = null;
          ITL.setHtml($("deadline"), html`<div class="meta">${jobPill(state.job, ITL.now())}</div>`);
          ITL.setHtml($("tables"), html``);
          ITL.setHtml($("banners"), html``);
          ITL.setHtml($("loadError"), emptyState(res.error));
          return;
        }
        state.data = res.data; state.nd = normalize(res.data);
        ITL.setHtml($("loadError"), html``);
        render();
      } catch (e) {
        ITL.setHtml($("loadError"), ITL.errorBox(e, "the pre-close picks (preclose.json)"));
        if (typeof console !== "undefined") console.error(e);
      } finally {
        $("reloadBtn").disabled = false;
      }
    }

    const refresher = ITL.createRefresher({
      key: "preclose_scan", workflows: ["preclose_scan"], dataPath: DATA_PATH,
      maxMs: 8 * 60e3, fixtures: !!ITL.fixturesMode(),
      getBaseline: () => state.data ? state.data.generated_at_utc : null,
      onData: (d) => { state.data = d; state.nd = normalize(d); ITL.setHtml($("loadError"), html``); render(); },
      onStatus: setStatus,
      setDisabled: (dis, label) => { const b = $("refreshBtn"); b.disabled = dis; b.textContent = label || "Run pre-close scan now"; },
    });
    $("refreshBtn").addEventListener("click", () => refresher.start());
    $("reloadBtn").addEventListener("click", () => { refresher.cancel("Auto-check stopped (manual reload)."); load(); });

    // Sizing controls (shared with Today)
    const pf = $("portfolio"), pfHint = $("portfolioHint"), mp = $("maxPos"), mpHint = $("maxPosHint");
    ITL.setHtml($("riskPct"), html`${TODAY.RISK_OPTIONS.map(v => html`<option value="${String(v)}">${fmtNum(v, 2)}%</option>`)}`);
    $("riskPct").value = String(prefs.riskPct);
    if ($("riskPct").value !== String(prefs.riskPct)) { prefs.riskPct = 1; $("riskPct").value = "1"; }
    pf.value = String(prefs.portfolio);
    pfHint.textContent = "= " + fmtAud(prefs.portfolio, 0);
    mp.value = String(prefs.maxPosPct);
    $("riskPct").addEventListener("change", e => { const v = num(e.target.value); if (v !== null) { prefs.riskPct = v; savePrefs(); render(); } });
    pf.addEventListener("input", () => {
      const r = ITL.readMoneyLike(pf.value);
      if (r.ok) {
        prefs.portfolio = r.value; savePrefs();
        pf.classList.remove("invalid"); pfHint.classList.remove("err"); pfHint.textContent = "= " + fmtAud(r.value, 0);
        render();
      } else {
        pf.classList.add("invalid"); pfHint.classList.add("err");
        pfHint.textContent = r.error + " — sizing still uses " + fmtAud(prefs.portfolio, 0);
      }
    });
    mp.addEventListener("input", () => {
      const v = num(mp.value);
      if (v !== null && v >= 1 && v <= 100) {
        prefs.maxPosPct = v; savePrefs();
        mp.classList.remove("invalid"); mpHint.classList.remove("err"); mpHint.textContent = "of portfolio per position";
        render();
      } else {
        mp.classList.add("invalid"); mpHint.classList.add("err");
        mpHint.textContent = "Enter 1–100 — still using " + fmtNum(prefs.maxPosPct, 0) + "%";
      }
    });

    ITL.setHtml($("why"), whyCard());
    ITL.bootCommon();
    refresher.restore();
    load();
    setInterval(tick, 1000);
    setInterval(render, 60000);
  }

  return { DATA_PATH, pcState, normalize, renderBanners, deadlineCard, jobPill, renderSections, whyCard, emptyState, boot };
});
