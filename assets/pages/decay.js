/* Strategy Decay page: per-archetype edge audit. Each section loads and
 * renders inside its own try/catch so one missing JSON cannot blank the page. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../itl.js"));
  else root.ITL_DECAY = factory(root.ITL);
})(typeof self !== "undefined" ? self : this, function (ITL) {
  "use strict";
  const { html, num, DASH } = ITL;

  const ANALYSIS_PATH = "/public/strategy_decay_analysis.json";
  const INTRADAY_PATH = "/public/strategy_decay_intraday.json";
  const DISPLAY_ORDER = ["TREND_PULLBACK", "MOMENTUM", "MEAN_REVERSION", "PEAD", "HIGH52W_MOMENTUM", "GAP_FADE_CONTINUATION", "BASELINE_RANDOM"];
  const DISPLAY_NAME = {
    TREND_PULLBACK: "Trend Pullback", MOMENTUM: "Momentum Breakout", MEAN_REVERSION: "Mean Reversion",
    PEAD: "Post-Earnings Drift", HIGH52W_MOMENTUM: "52-Week-High Momentum",
    GAP_FADE_CONTINUATION: "Gap Fade/Continuation", BASELINE_RANDOM: "Baseline (Random Entry)",
  };
  const NEW_KEYS = new Set(["PEAD", "HIGH52W_MOMENTUM", "GAP_FADE_CONTINUATION", "BASELINE_RANDOM"]);
  const PRIMARY_HORIZON_FALLBACK = 5;

  const fmtPct = (x) => { const v = num(x); return v === null ? DASH : (v * 100).toFixed(1) + "%"; };
  const fmtR = (x) => { const v = num(x); return v === null ? DASH : (v >= 0 ? "+" : "") + v.toFixed(3); };
  const fmtP = (x, d) => { const v = num(x); return v === null ? DASH : v.toFixed(d === undefined ? 4 : d); };
  const txt = (x) => (x === null || x === undefined || x === "") ? DASH : String(x);

  function verdictBadgeClass(v) {
    if (v === "edge persists throughout") return "persists";
    if (v === "had edge, then decayed") return "decayed";
    if (v === "insufficient data") return "insufficient";
    return "noedge";
  }

  /** As-of date and the exit policy the audit used (the live exit policy
   *  may differ; say which one this audit is about). */
  function asOfInfo(analysis) {
    const m = (analysis && analysis.methodology) || {};
    const horizon = num(m.primary_horizon_days !== undefined ? m.primary_horizon_days : m.r_horizon_days);
    const policy = analysis && (analysis.policy_id || analysis.exit_policy_id || m.exit_policy || m.policy_id);
    return {
      asOf: analysis && (analysis.generated_at_utc || analysis.as_of),
      policy: policy ? String(policy) : "fixed " + (horizon !== null ? horizon : PRIMARY_HORIZON_FALLBACK) + "-trading-day hold, stop-first (legacy horizon method, not the live trailing-stop policy)",
      policyIsExplicit: !!policy,
    };
  }

  // ── Canvas charts (unchanged drawing logic; canvas, no HTML) ────────────
  function setupCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 600, h = rect.height || 320;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }

  function drawEquityChart(canvas, strategyPts, benchmarkPts) {
    strategyPts = Array.isArray(strategyPts) ? strategyPts : [];
    benchmarkPts = Array.isArray(benchmarkPts) ? benchmarkPts : [];
    if (!strategyPts.length) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const padLeft = 60, padRight = 20, padTop = 20, padBottom = 40;
    const allVals = strategyPts.map(p => p.equity).concat(benchmarkPts.map(p => p.equity)).filter(v => num(v) !== null);
    const minV = Math.min(...allVals) * 0.98, maxV = Math.max(...allVals) * 1.02;
    const range = (maxV - minV) || 1;
    const n = strategyPts.length;
    const getX = (i) => padLeft + (i / Math.max(1, n - 1)) * (w - padLeft - padRight);
    const getY = (v) => h - padBottom - ((v - minV) / range) * (h - padTop - padBottom);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    ctx.font = "10px JetBrains Mono, monospace"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i / 4), y = h - padBottom - (i / 4) * (h - padTop - padBottom);
      ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(w - padRight, y); ctx.stroke();
      ctx.fillText(v.toFixed(2) + "x", padLeft - 8, y + 3);
    }
    [[0, "left"], [Math.floor(n / 2), "center"], [n - 1, "right"]].forEach(([i, align]) => {
      if (strategyPts[i]) { ctx.textAlign = align; ctx.fillText(String(strategyPts[i].date), getX(i), h - padBottom + 18); }
    });
    function line(pts, color) {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach((p, i) => { const x = getX(i * (n - 1) / Math.max(1, pts.length - 1)), y = getY(p.equity); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    }
    line(benchmarkPts, "#c97a12");
    line(strategyPts, "#1a95d8");
  }

  function drawEdgeChart(canvas, windowPoints, changepointDate) {
    windowPoints = Array.isArray(windowPoints) ? windowPoints : [];
    const scored = windowPoints.filter(p => p.real_mean_r !== null && p.real_mean_r !== undefined);
    if (!scored.length) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const padLeft = 60, padRight = 20, padTop = 20, padBottom = 40;
    const lows = windowPoints.map(p => p.band_mean_r ? p.band_mean_r[0] : null).filter(v => v !== null);
    const highs = windowPoints.map(p => p.band_mean_r ? p.band_mean_r[1] : null).filter(v => v !== null);
    const all = scored.map(p => p.real_mean_r).concat(lows, highs);
    const minV = Math.min(...all, 0) * 1.15, maxV = Math.max(...all, 0) * 1.15;
    const range = (maxV - minV) || 1;
    const n = windowPoints.length;
    const getX = (i) => padLeft + (i / Math.max(1, n - 1)) * (w - padLeft - padRight);
    const getY = (v) => h - padBottom - ((v - minV) / range) * (h - padTop - padBottom);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    ctx.font = "10px JetBrains Mono, monospace"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i / 4), y = h - padBottom - (i / 4) * (h - padTop - padBottom);
      ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(w - padRight, y); ctx.stroke();
      ctx.fillText(fmtR(v), padLeft - 8, y + 3);
    }
    const zeroY = getY(0);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath(); ctx.moveTo(padLeft, zeroY); ctx.lineTo(w - padRight, zeroY); ctx.stroke();
    [[0, "left"], [Math.floor(n / 2), "center"], [n - 1, "right"]].forEach(([i, align]) => {
      if (windowPoints[i]) { ctx.textAlign = align; ctx.fillText(String(windowPoints[i].date), getX(i), h - padBottom + 18); }
    });
    ctx.beginPath();
    let started = false;
    windowPoints.forEach((p, i) => {
      if (!p.band_mean_r) return;
      const x = getX(i);
      if (!started) { ctx.moveTo(x, getY(p.band_mean_r[1])); started = true; } else ctx.lineTo(x, getY(p.band_mean_r[1]));
    });
    for (let i = windowPoints.length - 1; i >= 0; i--) { const p = windowPoints[i]; if (p.band_mean_r) ctx.lineTo(getX(i), getY(p.band_mean_r[0])); }
    ctx.closePath(); ctx.fillStyle = "rgba(148,163,184,0.15)"; ctx.fill();
    windowPoints.forEach((p, i) => {
      if (p.real_mean_r === null || p.real_mean_r === undefined) return;
      ctx.beginPath(); ctx.arc(getX(i), getY(p.real_mean_r), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = p.outside_band ? (p.real_mean_r > 0 ? "#10b981" : "#ef4444") : "#3b82f6"; ctx.fill();
    });
    ctx.beginPath();
    let ls = false;
    windowPoints.forEach((p, i) => {
      if (p.real_mean_r === null || p.real_mean_r === undefined) return;
      const x = getX(i), y = getY(p.real_mean_r);
      if (!ls) { ctx.moveTo(x, y); ls = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 1.5; ctx.stroke();
    if (changepointDate) {
      const idx = windowPoints.findIndex(p => p.date >= changepointDate);
      if (idx >= 0) {
        const x = getX(idx);
        ctx.setLineDash([4, 4]); ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, h - padBottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#fbbf24"; ctx.textAlign = "center"; ctx.fillText("change-point", x, padTop - 6 < 10 ? 12 : padTop - 6);
      }
    }
  }

  // ── HTML sections (all via html``) ──────────────────────────────────────
  function renderMethodology(meta) {
    meta = meta || {};
    const primary = meta.primary_horizon_days !== undefined ? meta.primary_horizon_days : meta.r_horizon_days;
    const sweep = Array.isArray(meta.sweep_horizons_days) ? meta.sweep_horizons_days.join("d, ") + "d" : null;
    return html`<b>How this was computed</b> — per-archetype backtest, no composite blending.
      <dl>
        <dt>Benchmark</dt><dd>${txt(meta.benchmark)}</dd>
        <dt>R horizon (default view)</dt><dd>${txt(primary)} trading days, stop-first</dd>
        ${sweep ? html`<dt>Holding-period sweep</dt><dd>${sweep} (see "Holding-Period Sensitivity" below each archetype)</dd>` : ""}
        <dt>Rolling window</dt><dd>${txt(meta.window_days)} days, ${txt(meta.step_days)}-day step, min ${txt(meta.min_trades_per_window)} trades/window</dd>
        <dt>Bootstrap</dt><dd>${txt(meta.n_bootstrap_replicates)} random-entry replicates, ±${txt(meta.random_entry_window_days)}d entry window</dd>
        <dt>Position sizing</dt><dd>${txt(meta.position_sizing)}</dd>
        <dt>Transaction costs</dt><dd>${txt(meta.transaction_costs)}</dd>
        <dt>No-lookahead</dt><dd>${txt(meta.no_lookahead)}</dd>
        ${meta.multiple_comparisons_correction ? html`<dt>Multiple comparisons</dt><dd>${meta.multiple_comparisons_correction}</dd>` : ""}
        ${meta.seven_strategy_expansion ? html`<dt>7-strategy expansion</dt><dd>${meta.seven_strategy_expansion}</dd>` : ""}
      </dl>`;
  }

  function renderHorizonSweep(key, ha) {
    if (!ha || !ha.cells || !ha.cells[key]) return html``;
    const cells = ha.cells[key];
    const horizons = Array.isArray(ha.sweep_horizons_days) ? ha.sweep_horizons_days : [1, 3, 5, 10];
    const fam = num(ha.bonferroni_family_size);
    const overall = (ha.overall_verdict || {})[key];
    const humanized = overall ? String(overall).replace(new RegExp("\\b" + key + "\\b", "g"), DISPLAY_NAME[key] || key) : null;
    const rows = horizons.map(h => {
      const c = cells[String(h)];
      if (!c) return html``;
      const isPrimary = h === PRIMARY_HORIZON_FALLBACK;
      let sig = "no", cls = "sig-none";
      if (c.changepoint_p_raw === null || c.changepoint_p_raw === undefined) { sig = DASH; }
      else if (c.changepoint_significant_corrected) { sig = "YES"; cls = "sig-corrected"; }
      else if (c.changepoint_significant_raw) { sig = "no (raw only)"; cls = "sig-raw-only"; }
      return html`<tr class="${isPrimary ? "horizon-primary" : ""}">
        <td>${String(h)}d${isPrimary ? html` <span class="dimnote">(default view)</span>` : ""}</td>
        <td>${txt(c.n_trades)}</td><td>${txt(c.verdict)}</td>
        <td>${fmtP(c.changepoint_p_raw)}</td><td>${fmtP(c.changepoint_p_corrected)}</td>
        <td class="${cls}">${sig}</td>
        <td>${fmtPct(c.fraction_outside_band)}${c.n_scored_windows ? html` <span class="dimnote">(${txt(c.n_outside_band)}/${txt(c.n_scored_windows)})</span>` : ""}</td>
      </tr>`;
    });
    return html`<div class="sweep-panel"><h3>Holding-Period Sensitivity</h3>
      <div class="chart-note">Same isolate → rolling-edge-metric → CUSUM change-point → noise-band pipeline, re-run at each holding-period horizon.
        ${fam ? html` Raw p-values are Bonferroni-corrected across all ${String(fam)} archetype × horizon tests (p<sub>corrected</sub> = min(1, p<sub>raw</sub> × ${String(fam)})) to guard against the ~${(fam * 0.05).toFixed(1)} false positives expected by chance.` : ""}</div>
      ${humanized ? html`<div class="sweep-verdict">${humanized}</div>` : ""}
      <div class="table-scroll"><table><thead><tr><th>Horizon</th><th>Trades</th><th>Verdict</th><th>Raw p</th><th>Corrected p</th><th>Significant (corrected)</th><th>% windows outside noise band</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
  }

  function renderArchetype(key, data, ha) {
    const name = DISPLAY_NAME[key] || key;
    const v = data.verdict && typeof data.verdict === "object" ? data.verdict : { verdict: txt(data.verdict) };
    const isNew = NEW_KEYS.has(key), isBaseline = key === "BASELINE_RANDOM";
    const n = num(data.n_trades) || 0;
    const sub = isBaseline
      ? n + " computable trades — backtest-only control, never a live signal (random symbol + regime gate, no price-pattern logic)"
      : n + " computable historical trades, isolated (no composite blending)";
    const head = html`<div class="archetype-head"><h2>${name}</h2>
        <span class="verdict-badge ${verdictBadgeClass(v.verdict)}">${txt(v.verdict)}</span>
        ${isNew ? html`<span class="verdict-badge insufficient" style="text-transform:none;">${isBaseline ? "backtest-only control" : "added later — new live signal"}</span>` : ""}
      </div><div class="archetype-sub">${sub}</div>`;
    if (n < 10) return html`<section class="archetype-section">${head}<div class="verdict-reason">${txt(v.reason)}</div>${renderHorizonSweep(key, ha)}</section>`;
    const cp = data.changepoint;
    let hyp = html``;
    if (Array.isArray(data.hypotheses) && data.hypotheses.length) {
      const h = data.hypotheses[0] || {};
      const vc = h.axjo_volatility_context, lc = h.universe_liquidity_context;
      hyp = html`<div class="hyp-panel"><h4>Hypothesis: what might explain the ${txt(h.changepoint_date)} break?</h4>
        <div class="hyp-grid">
          ${vc ? html`<div class="hyp-item"><b>ASX 200 volatility</b>Annualized: ${fmtPct(vc.annualized_vol_before)} before → ${fmtPct(vc.annualized_vol_after)} after.<br>^AXJO return: ${fmtPct(vc.axjo_return_before_window)} before → ${fmtPct(vc.axjo_return_after_window)} after.</div>` : ""}
          ${lc ? html`<div class="hyp-item"><b>Traded universe liquidity</b>Avg daily volume ${num(lc.pct_change) >= 0 ? "+" : ""}${fmtPct(lc.pct_change)} after vs. before (n=${txt(lc.n_symbols)} symbols).</div>` : ""}
        </div>
        ${Array.isArray(h.nearby_pipeline_events) && h.nearby_pipeline_events.length ? html`<div class="hyp-item"><b>Nearby pipeline events (±14 days)</b>${h.nearby_pipeline_events.map(ev => html`<span class="pipeline-hit">${txt(ev.date)} (${num(ev.days_from_changepoint) >= 0 ? "+" : ""}${txt(ev.days_from_changepoint)}d): ${txt(ev.description)}</span>`)}</div>` : ""}
        <div class="hyp-limits">${txt(h.note)}</div></div>`;
    }
    return html`<section class="archetype-section">${head}
      <div class="kpiGrid">
        <div class="kpiBox"><div class="kpiLabel">Trades</div><div class="kpiValue">${String(n)}</div></div>
        <div class="kpiBox"><div class="kpiLabel">Change-point</div><div class="kpiValue">${cp && cp.changepoint_date ? cp.changepoint_date : "none found"}</div></div>
        <div class="kpiBox"><div class="kpiLabel">CUSUM p-value</div><div class="kpiValue">${cp ? fmtP(cp.p_value) : DASH}</div></div>
        <div class="kpiBox"><div class="kpiLabel">Mean R before / after</div><div class="kpiValue" style="font-size:1.1rem;">${cp ? fmtR(cp.mean_before) : DASH} → ${cp ? fmtR(cp.mean_after) : DASH}</div></div>
      </div>
      <div class="verdict-reason">${txt(v.reason)}</div>
      <div class="chart-panel"><h3>Equity Curve vs. Benchmark</h3>
        <div class="chart-note">Daily mean forward return, compounded (a growth multiple, not dollars) — isolated to ${name} signals only.</div>
        <canvas id="${"eq-" + key}"></canvas>
        <div class="legend"><span><i style="background:#1a95d8;"></i>${name}</span><span><i style="background:#c97a12;"></i>^AXJO (benchmark)</span></div></div>
      <div class="chart-panel"><h3>Rolling Edge Metric vs. Random-Entry Noise Band</h3>
        <div class="chart-note">Rolling mean R-multiple. Shaded band = 5th–95th percentile of random-entry replicates under the same risk/regime rules. Points outside the band (green = positive, red = negative) are distinguishable from luck; blue points are not.</div>
        <canvas id="${"edge-" + key}"></canvas>
        <div class="legend"><span><i style="background:#3b82f6;"></i>Real (inside noise band)</span><span><i style="background:#10b981;"></i>Outside band (positive)</span><span><i style="background:#ef4444;"></i>Outside band (negative)</span><span><i style="background:rgba(148,163,184,0.5);"></i>Noise band</span></div></div>
      ${hyp}
      ${renderHorizonSweep(key, ha)}
    </section>`;
  }

  function renderIntraday(data) {
    if (!data || typeof data !== "object") return html`<div class="empty-note">No intraday audit published.</div>`;
    if (data.error) return html`<div class="empty-note">Could not recover intraday history: ${txt(data.error)}</div>`;
    const f = data.feasibility || {};
    const dates = Array.isArray(f.distinct_calendar_dates_recovered) ? f.distinct_calendar_dates_recovered : [];
    const counts = f.signal_counts_by_strategy && typeof f.signal_counts_by_strategy === "object" ? f.signal_counts_by_strategy : {};
    const spot = data.descriptive_spot_check;
    const spotRows = spot && Array.isArray(spot.rows) ? spot.rows : [];
    return html`<div class="feasibility-verdict">${txt(data.verdict)}</div>
      <div class="kpiGrid">
        <div class="kpiBox"><div class="kpiLabel">Distinct dates recovered</div><div class="kpiValue">${txt(f.n_distinct_dates)}</div></div>
        <div class="kpiBox"><div class="kpiLabel">Date span</div><div class="kpiValue">${txt(f.date_span_days)}d</div></div>
        <div class="kpiBox"><div class="kpiLabel">Deduped signals</div><div class="kpiValue">${txt(f.total_deduped_signals)}</div></div>
        <div class="kpiBox"><div class="kpiLabel">Formal process</div><div class="kpiValue" style="font-size:1.1rem;color:#fbbf24;">${f.feasible_for_formal_process ? "feasible" : "not feasible"}</div></div>
      </div>
      <p class="muted" style="font-size:0.9rem;">${txt(f.feasibility_reasoning)}</p>
      <p class="dimnote">Recovered dates: ${dates.join(", ") || DASH} · by archetype: ${Object.keys(counts).map(k => (DISPLAY_NAME[k] || k) + "=" + counts[k]).join(", ") || DASH}</p>
      ${spot && num(spot.n) > 0 ? html`<h3 style="margin-top:28px;">Descriptive Spot-Check (${txt(spot.n)} signals)</h3>
        <p class="dimnote">${txt(spot.method)}</p>
        <div class="table-scroll"><table><thead><tr><th>Date</th><th>Symbol</th><th>Strategy</th><th>Fwd Return</th></tr></thead><tbody>
        ${spotRows.slice(0, 30).map(r => { const x = num(r.ret_Nd); return html`<tr><td>${txt(r.date)}</td><td class="mono">${txt(r.symbol)}</td><td>${DISPLAY_NAME[r.strategy] || txt(r.strategy)}</td><td class="${x !== null && x >= 0 ? "tag-up" : "tag-down"}">${x === null ? DASH : (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%"}</td></tr>`; })}
        </tbody></table></div>
        ${spotRows.length > 30 ? html`<p class="dimnote">Showing 30 of ${String(spotRows.length)} rows.</p>` : ""}` : ""}`;
  }

  function boot() {
    const $ = (id) => document.getElementById(id);
    const sectionError = (id, e, what) => ITL.setHtml($(id), html`<div class="empty-note">Could not render ${what}: ${e && e.message ? e.message : String(e)}</div>`);
    ITL.bootCommon();

    (async () => {
      let analysis = null;
      try { analysis = await ITL.fetchJSON(ANALYSIS_PATH); }
      catch (e) {
        ITL.setHtml($("methodPanel"), ITL.errorBox(e, "the strategy decay analysis"));
        ITL.setHtml($("asOf"), html`<span class="pill">As of <b>—</b></span>`);
      }
      if (analysis) {
        try {
          const a = asOfInfo(analysis);
          ITL.setHtml($("asOf"), html`<span class="pill">As of <b>${ITL.fmtDateTime(a.asOf)}</b> (${ITL.ago(a.asOf, ITL.now())})</span>
            <span class="pill ${a.policyIsExplicit ? "" : "pill--warn"}" title="Exit policy used by this audit">Exit policy <b>${a.policy}</b></span>`);
        } catch (e) { sectionError("asOf", e, "the as-of line"); }
        try { ITL.setHtml($("methodPanel"), renderMethodology(analysis.methodology)); } catch (e) { sectionError("methodPanel", e, "the methodology"); }
        const arch = analysis.archetypes && typeof analysis.archetypes === "object" ? analysis.archetypes : {};
        const keys = DISPLAY_ORDER.filter(k => arch[k]).concat(Object.keys(arch).filter(k => DISPLAY_ORDER.indexOf(k) < 0));
        const parts = keys.map(k => {
          try { return renderArchetype(k, arch[k] || {}, analysis.horizon_analysis); }
          catch (e) { return html`<section class="archetype-section"><div class="empty-note">Could not render ${k}: ${e.message}</div></section>`; }
        });
        ITL.setHtml($("archetypes"), parts.length ? html`${parts}` : html`<div class="empty-note">No archetypes in the analysis file.</div>`);
        keys.forEach(k => {
          const d = arch[k];
          if (!d || (num(d.n_trades) || 0) < 10) return;
          try {
            const eq = $("eq-" + k), ed = $("edge-" + k);
            if (eq && d.equity_curve) drawEquityChart(eq, d.equity_curve.strategy, d.equity_curve.benchmark);
            if (ed) drawEdgeChart(ed, d.noise_band, d.changepoint && d.changepoint.significant ? d.changepoint.changepoint_date : null);
          } catch (e) { if (typeof console !== "undefined") console.error(e); }
        });
      }
    })();

    (async () => {
      try { ITL.setHtml($("intradayContent"), renderIntraday(await ITL.fetchJSON(INTRADAY_PATH))); }
      catch (e) { ITL.setHtml($("intradayContent"), ITL.errorBox(e, "the intraday cross-check")); }
    })();
  }

  return { asOfInfo, renderMethodology, renderHorizonSweep, renderArchetype, renderIntraday, verdictBadgeClass, boot };
});
