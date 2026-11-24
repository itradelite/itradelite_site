/* Track record page (metrics.json v2): system vs ASX200 ETF, exit-policy
 * comparison, per-strategy stats, universe disclosure and trade log. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../itl.js"));
  else root.ITL_TRACK = factory(root.ITL);
})(typeof self !== "undefined" ? self : this, function (ITL) {
  "use strict";
  const { html, num, fmtPrice, fmtNum, fmtInt, fmtAud, fmtPct, fmtRate, fmtR, fmtDate, fmtDateTime, ago, DASH } = ITL;

  const DATA_PATH = "/track-record/metrics.json";
  const OWNER_POLICY = "trail_1pct";
  const C_SYS = "#1a95d8", C_BM = "#c97a12"; // validated pair (dark surface)

  // ── Series helpers ──────────────────────────────────────────────────────
  function cleanSeries(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    arr.forEach(p => {
      if (!p || typeof p !== "object") return;
      const d = ITL.parseYmd(String(p.date || "").slice(0, 10));
      const v = num(p.equity);
      if (!d || v === null) return;
      out.push({ date: String(p.date).slice(0, 10), t: Date.UTC(d.year, d.month - 1, d.day), v });
    });
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  /** Rebase to start_aud when the series is clearly not already in A$
   *  around the start (e.g. a growth multiple or an index level). */
  function toAud(series, startAud) {
    const s0 = num(startAud);
    if (!series.length || s0 === null || !(s0 > 0)) return { series, rebased: false };
    const first = series[0].v;
    if (first > 0 && Math.abs(first / s0 - 1) <= 0.02) return { series, rebased: false };
    if (!(first > 0)) return { series, rebased: false };
    const k = s0 / first;
    return { series: series.map(p => ({ date: p.date, t: p.t, v: p.v * k })), rebased: true };
  }

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }

  /** Pure chart geometry. Handles empty, 1-point and flat series (no /0). */
  function chartModel(seriesList, w, h, opts) {
    const o = Object.assign({ padL: 64, padR: 16, padT: 14, padB: 30 }, opts || {});
    const pts = [].concat.apply([], seriesList.map(s => s.points));
    if (!pts.length) return { empty: true, w, h };
    let tMin = Math.min.apply(null, pts.map(p => p.t)), tMax = Math.max.apply(null, pts.map(p => p.t));
    let vMin = Math.min.apply(null, pts.map(p => p.v)), vMax = Math.max.apply(null, pts.map(p => p.v));
    if (tMax === tMin) { tMin -= 86400000 * 3; tMax += 86400000 * 3; }
    if (vMax === vMin) { const pad = Math.abs(vMin) * 0.01 || 1; vMin -= pad; vMax += pad; }
    const span = vMax - vMin;
    vMin -= span * 0.05; vMax += span * 0.05;
    const step = niceStep(vMax - vMin, h < 260 ? 4 : 5);
    const y0 = Math.floor(vMin / step) * step, y1 = Math.ceil(vMax / step) * step;
    const iw = Math.max(10, w - o.padL - o.padR), ih = Math.max(10, h - o.padT - o.padB);
    const x = t => o.padL + (t - tMin) / (tMax - tMin) * iw;
    const y = v => o.padT + (1 - (v - y0) / (y1 - y0)) * ih;
    const yTicks = [];
    for (let v = y0; v <= y1 + step / 2; v += step) yTicks.push({ v, y: y(v) });
    // monthly x ticks, thinned to fit
    const xTicks = [];
    const d0 = new Date(tMin);
    let m = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
    while (m <= tMax) { xTicks.push(m); const d = new Date(m); m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
    const maxTicks = Math.max(2, Math.floor(iw / 70));
    const every = Math.ceil(xTicks.length / maxTicks) || 1;
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const xt = xTicks.filter((_, i) => i % every === 0).map((t, i) => {
      const d = new Date(t);
      return { t, x: x(t), label: MON[d.getUTCMonth()] + (d.getUTCMonth() === 0 || i === 0 ? " " + String(d.getUTCFullYear()).slice(2) : "") };
    });
    if (!xt.length) xt.push({ t: tMin, x: x(tMin), label: ITL.fmtDate(new Date(tMin).toISOString().slice(0, 10), { noYear: true }) });
    const lines = seriesList.map(s => ({
      key: s.key, color: s.color, label: s.label,
      d: s.points.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" "),
      single: s.points.length === 1 ? { cx: x(s.points[0].t), cy: y(s.points[0].v) } : null,
      last: s.points.length ? { x: x(s.points[s.points.length - 1].t), y: y(s.points[s.points.length - 1].v), v: s.points[s.points.length - 1].v } : null,
    }));
    return { empty: false, step, w, h, o, x, y, tMin, tMax, y0, y1, yTicks, xTicks: xt, lines, ih, iw };
  }

  /** Axis label: decimals chosen from the tick step so labels stay distinct. */
  function fmtAudTick(v, step) {
    const a = Math.abs(v), sg = v < 0 ? "-" : "";
    if (a >= 1e6) return sg + "A$" + fmtNum(a / 1e6, step >= 1e6 ? 0 : step >= 1e5 ? 1 : 2) + "m";
    if (a >= 1e3) return sg + "A$" + fmtNum(a / 1e3, step >= 1e3 ? 0 : step >= 100 ? 1 : 2) + "k";
    return fmtAud(v, step >= 1 ? 0 : 2);
  }

  function fmtAudShort(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v < 0 ? "-" : "") + "A$" + fmtNum(a / 1e6, a >= 1e7 ? 1 : 2) + "m";
    if (a >= 1e3) return (v < 0 ? "-" : "") + "A$" + fmtNum(a / 1e3, Math.abs(a % 1000) < 1e-6 || a >= 1e5 ? 0 : 1) + "k";
    return fmtAud(v, 0);
  }

  function chartSvg(model, opts) {
    const o = opts || {};
    if (model.empty) return html`<div class="empty-state">${o.emptyText || "No equity data published yet."}</div>`;
    const { w, h, o: pad } = model;
    const endLabels = o.endLabels ? model.lines.filter(l => l.last).map(l => ({ l, y: l.last.y })) : [];
    // keep direct labels from colliding
    endLabels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < endLabels.length; i++) if (endLabels[i].y - endLabels[i - 1].y < 14) endLabels[i].y = endLabels[i - 1].y + 14;
    return html`<svg class="chart-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${o.ariaLabel || "Equity chart"}">
      ${model.yTicks.map(t => html`<line class="grid" x1="${pad.padL}" x2="${w - pad.padR}" y1="${t.y.toFixed(1)}" y2="${t.y.toFixed(1)}"></line>
        <text x="${pad.padL - 8}" y="${(t.y + 4).toFixed(1)}" text-anchor="end">${fmtAudTick(t.v, model.step)}</text>`)}
      <line class="base" x1="${pad.padL}" x2="${w - pad.padR}" y1="${h - pad.padB}" y2="${h - pad.padB}"></line>
      ${o.zeroLine && model.y0 < 0 && model.y1 > 0 ? html`<line class="base zero" x1="${pad.padL}" x2="${w - pad.padR}" y1="${model.y(0).toFixed(1)}" y2="${model.y(0).toFixed(1)}" stroke-dasharray="4 3"></line>` : ""}
      ${model.xTicks.map(t => html`<text x="${t.x.toFixed(1)}" y="${h - pad.padB + 18}" text-anchor="middle">${t.label}</text>`)}
      ${model.lines.map(l => l.single
        ? html`<circle cx="${l.single.cx.toFixed(1)}" cy="${l.single.cy.toFixed(1)}" r="4" fill="${l.color}" stroke="#1e293b" stroke-width="2"></circle>`
        : html`<path d="${l.d}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>`)}
      ${endLabels.map(e => html`<text x="${(e.l.last.x + 6).toFixed(1)}" y="${(e.y + 4).toFixed(1)}" style="fill:#cbd5e1">${e.l.label} ${fmtAudShort(e.l.last.v)}</text>`)}
      <line class="hover-line" x1="0" x2="0" y1="${pad.padT}" y2="${h - pad.padB}" stroke="rgba(255,255,255,0.35)" stroke-dasharray="3 3" style="display:none"></line>
      ${model.lines.map(l => html`<circle class="hover-dot" data-key="${l.key}" r="4" fill="${l.color}" stroke="#1e293b" stroke-width="2" style="display:none"></circle>`)}
      <rect class="hover-catch" x="${pad.padL}" y="${pad.padT}" width="${model.iw}" height="${model.ih}" fill="transparent"></rect>
    </svg>`;
  }

  /** Value of a series at (or last before) time t. */
  function valueAt(points, t) {
    let lo = 0, hi = points.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (points[mid].t <= t) { best = points[mid]; lo = mid + 1; } else hi = mid - 1; }
    return best;
  }

  function maxDrawdown(points) {
    let peak = -Infinity, mdd = 0;
    points.forEach(p => { peak = Math.max(peak, p.v); if (peak > 0) mdd = Math.min(mdd, p.v / peak - 1); });
    return points.length ? mdd : null;
  }

  // ── Sections ────────────────────────────────────────────────────────────
  function verdictLine(data) {
    const p = data.portfolio || {};
    const tr = num(p.total_return), br = num(p.benchmark_total_return);
    const bsym = p.benchmark && p.benchmark.symbol ? p.benchmark.symbol : "ASX200 ETF";
    let text = typeof data.verdict === "string" && data.verdict.trim() ? data.verdict.trim() : null;
    let cls = "info";
    if (tr !== null && br !== null) {
      const diff = (tr - br) * 100;
      if (!text) text = (diff >= 0 ? "Outperforming " : "Underperforming ") + bsym + " by " + fmtNum(Math.abs(diff), 1) + " pp (system " + fmtPct(tr, { fraction: true, sign: true }) + " vs " + fmtPct(br, { fraction: true, sign: true }) + ").";
      cls = diff >= 0 ? "ok" : "bad";
    }
    if (!text) text = "No verdict published yet.";
    return { text, cls };
  }

  function kpis(data) {
    const p = data.portfolio || {};
    const pol = policyById(data, data.default_policy_id);
    const tr = num(p.total_return), br = num(p.benchmark_total_return);
    const bsym = p.benchmark && p.benchmark.symbol ? p.benchmark.symbol : "ETF";
    const box = (label, val, cls, sub) => html`<div class="kpiBox"><div class="kpiLabel">${label}</div><div class="kpiValue ${cls || ""}">${val}</div>${sub ? html`<div class="kpiSub">${sub}</div>` : ""}</div>`;
    const sgn = v => v === null ? "" : v >= 0 ? "pos" : "neg";
    return html`
      ${box("System total return", fmtPct(tr, { fraction: true, sign: true }), sgn(tr), "after costs, default exit policy")}
      ${box(bsym + " total return", fmtPct(br, { fraction: true, sign: true }), sgn(br), "same dates, buy & hold")}
      ${box("Difference", tr !== null && br !== null ? (tr - br >= 0 ? "+" : "") + fmtNum((tr - br) * 100, 1) + " pp" : DASH, tr !== null && br !== null ? sgn(tr - br) : "", "system minus ETF")}
      ${box("CAGR", fmtPct(p.cagr, { fraction: true, sign: true }), sgn(num(p.cagr)))}
      ${box("Max drawdown", fmtPct(p.max_drawdown, { fraction: true }), "neg", "ETF " + fmtPct(p.benchmark_max_drawdown, { fraction: true }))}
      ${box("Trades (default policy)", pol && pol.stats ? fmtInt(pol.stats.n) : DASH, "", pol && pol.stats ? "win rate " + fmtRate(pol.stats.winrate) : "")}`;
  }

  function policyById(data, id) {
    return (Array.isArray(data.policies) ? data.policies : []).find(p => p && p.id === id) || null;
  }

  function paramsText(pol) {
    const pr = pol.params && typeof pol.params === "object" ? pol.params : {};
    const bits = [];
    if (num(pr.pct) !== null) bits.push(fmtNum(pr.pct, pr.pct % 1 ? 1 : 0) + "% trail");
    if (num(pr.atr_mult) !== null) bits.push(fmtNum(pr.atr_mult, 1) + "×ATR trail");
    if (num(pr.activate_after_r) !== null) bits.push("after +" + fmtNum(pr.activate_after_r, 1) + "R");
    if (num(pr.days) !== null) bits.push("exit day " + fmtInt(pr.days));
    if (num(pr.time_stop_days) !== null) bits.push("max " + fmtInt(pr.time_stop_days) + "d");
    return bits.join(", ");
  }

  function statCells(s) {
    s = s && typeof s === "object" ? s : {};
    const r = (x) => { const v = num(x); return html`<span class="${v === null ? "" : v >= 0 ? "pos" : "neg"}">${fmtR(v)}</span>`; };
    return html`
      <td data-label="Trades" class="mono right">${fmtInt(s.n)}</td>
      <td data-label="Win rate" class="mono right">${fmtRate(s.winrate)}</td>
      <td data-label="Avg R" class="mono right">${r(s.avg_r)}</td>
      <td data-label="Median R" class="mono right">${r(s.median_r)}</td>
      <td data-label="Avg return" class="mono right">${fmtPct(s.avg_ret_pct, { dp: 2, sign: true })}</td>
      <td data-label="Expectancy / trade" class="mono right">${fmtAud(s.expectancy_aud_per_trade, 0)}</td>
      <td data-label="Profit factor" class="mono right">${fmtNum(s.profit_factor, 2)}</td>
      <td data-label="Avg hold" class="mono right">${num(s.avg_hold_days) !== null ? fmtNum(s.avg_hold_days, 1) + " d" : DASH}</td>
      <td data-label="Avg win / loss" class="mono right nowrap">${fmtR(s.avg_win_r)} / ${fmtR(s.avg_loss_r)}</td>
      <td data-label="Min / max R" class="mono right nowrap">${fmtR(s.min_r)} / ${fmtR(s.max_r)}</td>`;
  }

  const STAT_HEAD = html`<th class="right">Trades</th><th class="right">Win rate</th><th class="right">Avg R</th><th class="right">Median R</th><th class="right">Avg return</th><th class="right">Exp. / trade</th><th class="right">PF</th><th class="right">Avg hold</th><th class="right">Avg win / loss</th><th class="right">Min / max R</th>`;

  function policyTable(data) {
    const pols = (Array.isArray(data.policies) ? data.policies : []).filter(p => p && typeof p === "object");
    if (!pols.length) return html`<div class="empty-state">No exit policies published.</div>`;
    let best = null;
    pols.forEach(p => { const v = num(p.stats && p.stats.avg_r); if (v !== null && (best === null || v > best.v)) best = { id: p.id, v }; });
    const rows = pols.map(p => {
      const isDef = p.id === data.default_policy_id, isOwner = p.id === OWNER_POLICY;
      return html`<tr class="row-main ${isDef ? "row-highlight" : ""}">
        <td data-label="Policy"><b>${p.label || p.id}</b><span class="lvl small mono">${p.id}${paramsText(p) ? " · " + paramsText(p) : ""}</span>
          <div class="chips">${isDef ? html`<span class="chip chip--info">default</span>` : ""}${isOwner ? html`<span class="chip chip--warn" title="The 1% trailing stop you asked to model">your 1% trail</span>` : ""}${best && best.id === p.id ? html`<span class="chip chip--pos">best avg R</span>` : ""}</div></td>
        ${statCells(p.stats)}
      </tr>`;
    });
    return html`<div class="tableWrap"><table class="stack"><thead><tr><th>Exit policy</th>${STAT_HEAD}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function strategyTable(data, edges) {
    const pol = policyById(data, data.default_policy_id);
    const by = pol && pol.by_strategy && typeof pol.by_strategy === "object" ? pol.by_strategy : {};
    const keys = ITL.ALL_STRATEGIES.concat(Object.keys(by).filter(k => ITL.ALL_STRATEGIES.indexOf(k) < 0));
    const rows = keys.map(k => html`<tr class="row-main">
      <td data-label="Strategy"><b>${ITL.strategyLabel(k)}</b><div class="chips">${ITL.edgeBadge(k, edges)}</div></td>
      ${by[k] ? statCells(by[k]) : html`<td colspan="10" class="small dim td-full">No trades yet under this policy.</td>`}
    </tr>`);
    return html`<div class="tableWrap"><table class="stack"><thead><tr><th>Strategy</th>${STAT_HEAD}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function universeBlock(data) {
    const u = data.universe && typeof data.universe === "object" ? data.universe : {};
    const ex = u.excluded && typeof u.excluded === "object" ? Object.keys(u.excluded).map(k => ({ k, n: u.excluded[k] })) : [];
    return html`<div class="meta" style="padding:0 0 8px;">
        <span class="pill">Signals <b>${fmtInt(u.n_signals)}</b></span>
        <span class="pill">After de-dup <b>${fmtInt(u.n_dedup)}</b></span>
        <span class="pill pill--ok">Filled <b>${fmtInt(u.n_filled)}</b></span>
        <span class="pill">Never filled <b>${fmtInt(u.n_unfilled)}</b></span>
      </div>
      ${ex.length ? html`<div class="small">Excluded: ${ex.map((e, i) => html`${i ? ", " : ""}<b>${String(e.k).replace(/_/g, " ")}</b> ${fmtInt(e.n)}`)}</div>` : html`<div class="small">No exclusions reported.</div>`}
      <p class="small">Every recommended order ever published is replayed; unfilled orders count as no trade (not as a loss or a win). Statistics above are for filled trades only.</p>`;
  }

  function costsText(c) {
    if (!c || typeof c !== "object") return DASH;
    const bits = [];
    if (num(c.brokerage_per_side_aud) !== null) bits.push("brokerage " + fmtAud(c.brokerage_per_side_aud, 2) + " per side");
    if (num(c.slippage_ticks) !== null) bits.push("slippage " + fmtInt(c.slippage_ticks) + " tick(s)");
    Object.keys(c).filter(k => ["brokerage_per_side_aud", "slippage_ticks"].indexOf(k) < 0).forEach(k => bits.push(k.replace(/_/g, " ") + " " + c[k]));
    return bits.join(", ") || DASH;
  }

  function anyText(v) {
    if (v === null || v === undefined || v === "") return DASH;
    if (typeof v === "object") return Object.keys(v).map(k => k.replace(/_/g, " ") + ": " + (typeof v[k] === "object" ? JSON.stringify(v[k]) : v[k])).join("; ");
    return String(v);
  }

  function notesBlock(data) {
    const p = data.portfolio || {};
    return html`<dl class="notes">
      <dt>Fill model</dt><dd>${anyText(data.fill_model)}</dd>
      <dt>Bar resolution</dt><dd>${anyText(data.bar_resolution)}</dd>
      <dt>Costs</dt><dd>${costsText(data.costs)}</dd>
      <dt>Portfolio simulation</dt><dd>Start ${fmtAud(p.start_aud, 0)}, risk ${fmtNum(p.risk_pct, 2)}% per trade, max position ${fmtNum(p.max_position_pct, 0)}%, max ${fmtInt(p.max_concurrent)} open positions, exit policy <span class="mono">${p.policy_id || data.default_policy_id || DASH}</span>. Same sizing formula as the Today page.</dd>
      <dt>Benchmark</dt><dd>${p.benchmark && p.benchmark.symbol ? p.benchmark.symbol : DASH} bought and held from the first date, dividends as published by the data source.</dd>
    </dl>`;
  }

  function fmtWhen(x) {
    if (!x) return DASH;
    const s = String(x);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s, { noYear: true });
    return fmtDateTime(s, { noTz: true });
  }

  function tradesTable(data, names) {
    const trades = (Array.isArray(data.trades) ? data.trades : []).filter(t => t && typeof t === "object");
    if (!trades.length) return html`<div class="empty-state">No trades published yet.</div>`;
    const sorted = trades.slice().sort((a, b) => String(b.exit_time || b.valid_for || "").localeCompare(String(a.exit_time || a.valid_for || "")));
    const rows = sorted.slice(0, 50).map(t => {
      const r = num(t.r);
      return html`<tr class="row-main">
        <td data-label="Valid for" class="mono small">${fmtDate(t.valid_for, { noYear: true })}</td>
        <td data-label="Symbol">${ITL.symbolCell(t.symbol, names)}</td>
        <td data-label="Strategy" class="small">${ITL.strategyLabel(t.strategy)}</td>
        <td data-label="Entry" class="mono right">${fmtPrice(t.entry_px)}<span class="lvl small">${fmtWhen(t.entry_time)}</span></td>
        <td data-label="Exit" class="mono right">${fmtPrice(t.exit_px)}<span class="lvl small">${fmtWhen(t.exit_time)}</span></td>
        <td data-label="Exit reason" class="small">${t.exit_reason || DASH}</td>
        <td data-label="R" class="mono right ${r === null ? "" : r >= 0 ? "pos" : "neg"}">${fmtR(r)}</td>
        <td data-label="Return" class="mono right">${fmtPct(t.ret_pct, { dp: 2, sign: true })}</td>
        <td data-label="Policy" class="mono small">${t.policy_id || DASH}</td>
      </tr>`;
    });
    return html`<div class="tableWrap"><table class="stack"><thead><tr><th>Valid for</th><th>Symbol</th><th>Strategy</th><th class="right">Entry</th><th class="right">Exit</th><th>Reason</th><th class="right">R</th><th class="right">Return</th><th>Policy</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${trades.length > 50 ? html`<p class="small">Showing the 50 most recent of ${trades.length}.</p>` : ""}`;
  }

  function legacyView(data) {
    const s = data.summary || {};
    const r5 = data.r_5d && data.r_5d.summary && data.r_5d.summary.stats ? data.r_5d.summary.stats : {};
    return html`<section class="card"><div class="card__head"><h2>Legacy proxy (v1)</h2><span class="count">${s.since || DASH} – ${s.until || DASH}</span></div>
      <div class="card__body">
        <p class="small">Old close-to-close 5-day proxy: no costs, no fills, no exit policies, no benchmark. Kept only until metrics.json v2 is published. Its equity figure was a dimensionless multiple, not dollars.</p>
        <div class="meta" style="padding:0;">
          <span class="pill">Signals with entry <b>${fmtInt(s.total_signals_with_entry)}</b></span>
          <span class="pill">Avg 5-day return <b>${fmtPct(s.avg_ret_5d, { fraction: true, dp: 2, sign: true })}</b></span>
          <span class="pill">5-day win rate <b>${fmtRate(s.winrate_5d)}</b></span>
          <span class="pill">R (5d, stop-first) n=<b>${fmtInt(r5.n)}</b> mean <b>${fmtR(r5.mean_r)}</b> win <b>${fmtRate(r5.winrate)}</b></span>
        </div>
      </div></section>`;
  }

  // ── Fixed-stake view (owner's headline model, metrics.stake) ────────────
  const STREAMS = [
    { id: "night", label: "Night picks", sub: "order for the next open (the existing method)" },
    { id: "preclose_proxy", label: "Pre-close · historical estimate", sub: "same night signals, bought at that day's close" },
    { id: "preclose_live", label: "Pre-close · forward tracking", sub: "real pre-close picks, filled at the close" },
  ];
  const LIVE_SINCE_DEFAULT = "2026-11-25";

  const STREAM_PROSE = { night: "the night order (next open)", preclose_proxy: "buying at the signal day's close", preclose_live: "the real pre-close picks" };
  function streamProse(id) { return STREAM_PROSE[id] || streamLabel(id); }
  function streamLabel(id) { const s = STREAMS.find(x => x.id === id); return s ? s.label : String(id || DASH); }

  function obj(x) { return x && typeof x === "object" && !Array.isArray(x) ? x : null; }

  /** {stream: {policy: block}} for recommended orders or (all=true) all setups. */
  function stakeBy(data, all) {
    const st = obj(data && data.stake);
    if (!st) return null;
    if (all) { const a = obj(st.all_setups); return a ? (obj(a.by) || a) : null; }
    return obj(st.by);
  }

  function stakeBlock(data, stream, policy, all) {
    const by = stakeBy(data, all);
    const s = by && obj(by[stream]);
    return s ? obj(s[policy]) : null;
  }

  function trackedPolicies(data) {
    if (data && Array.isArray(data.tracked_policy_ids) && data.tracked_policy_ids.length) return data.tracked_policy_ids.map(String);
    return ITL.TRACKED_POLICIES.slice();
  }

  function defaultPolicy(data) { return data && data.default_policy_id ? String(data.default_policy_id) : ITL.DEFAULT_POLICY; }

  function liveSince(data) {
    const sl = obj(data && data.streams) && obj(data.streams.preclose_live);
    const st = obj(data && data.stake);
    const since = (sl && sl.since) || (st && st.preclose_live_since) || LIVE_SINCE_DEFAULT;
    return ITL.parseYmd(since) ? since : LIVE_SINCE_DEFAULT;
  }

  function stakeAud(data) { const st = obj(data && data.stake); return st && num(st.stake_aud) !== null ? num(st.stake_aud) : null; }

  function signedAud(v) { const n = num(v); return n === null ? DASH : (n > 0 ? "+" : "") + fmtAud(n, 0); }
  function shortSigned(v) { const n = num(v); return n === null ? DASH : (n > 0 ? "+" : "") + fmtAudShort(n); }
  function sgnCls(v) { const n = num(v); return n === null || n === 0 ? "" : n > 0 ? "pos" : "neg"; }

  function stakeSeries(block) {
    const arr = block && Array.isArray(block.pnl_curve) ? block.pnl_curve : [];
    return cleanSeries(arr.map(p => p && typeof p === "object" ? { date: p.date, equity: p.cum_pnl_aud } : null));
  }

  function stakeKpis(data, sel) {
    const block = stakeBlock(data, sel.stream, sel.policy, sel.all) || {};
    const box = (label, val, cls, sub) => html`<div class="kpiBox"><div class="kpiLabel">${label}</div><div class="kpiValue ${cls || ""}">${val}</div>${sub ? html`<div class="kpiSub">${sub}</div>` : ""}</div>`;
    const n = num(block.n);
    const rpc = num(block.return_on_peak_capital);
    return html`
      ${box("Total P&L", signedAud(block.total_pnl_aud), sgnCls(block.total_pnl_aud), "added up, after costs")}
      ${box("Trades", fmtInt(block.n), "", n === 0 ? "none yet" : "every signal taken")}
      ${box("Avg per trade", signedAud(block.avg_pnl_aud), sgnCls(block.avg_pnl_aud), "per " + (stakeAud(data) !== null ? fmtAud(stakeAud(data), 0) : "fixed") + " stake")}
      ${box("Win rate", fmtRate(block.winrate), "", "")}
      ${box("Best / worst", html`<span class="${sgnCls(block.best_aud)}">${shortSigned(block.best_aud)}</span> <span class="dim">/</span> <span class="${sgnCls(block.worst_aud)}">${shortSigned(block.worst_aud)}</span>`, "kpiValue--split", "single trade")}
      ${box("Peak capital needed", fmtAud(block.peak_capital_aud, 0), "", "max open positions at once × stake")}
      ${box("Return on peak capital", fmtPct(rpc, { fraction: true, sign: true }), sgnCls(rpc), "total P&L ÷ peak capital")}`;
  }

  function stakeMatrix(data, sel) {
    const pols = trackedPolicies(data);
    const def = defaultPolicy(data);
    const since = liveSince(data);
    const head = html`<tr><th><span class="sr-only">Stream</span></th>${pols.map(p => html`<th>${ITL.policyName(p)}${p === def ? html` <span class="chip chip--info xp-def">default</span>` : ""}</th>`)}</tr>`;
    const rows = STREAMS.map(st => html`<tr><th class="rowh" scope="row">${st.label}<span class="small">${st.sub}</span></th>${pols.map(p => {
      const b = stakeBlock(data, st.id, p, sel.all);
      const n = b ? num(b.n) : null;
      const pressed = sel.stream === st.id && sel.policy === p;
      const empty = !b || n === 0 || n === null;
      const val = !b ? "not published" : n === 0 ? (st.id === "preclose_live" ? "collecting data since " + fmtDate(since) : "no trades") : signedAud(b.total_pnl_aud);
      return html`<td><button type="button" class="mcell ${empty ? "mcell--empty" : ""}" data-stream="${st.id}" data-policy="${p}" aria-pressed="${pressed ? "true" : "false"}" title="${"Show " + st.label + " · " + ITL.policyName(p)}"><span class="mcell__v ${empty ? "" : sgnCls(b.total_pnl_aud)}">${val}</span><span class="mcell__n">n = ${n === null ? DASH : fmtInt(n)}${b && n ? " · avg " + signedAud(b.avg_pnl_aud) : ""}</span></button></td>`;
    })}</tr>`);
    return html`<div class="tableWrap"><table class="matrix" aria-label="Total P&L by stream and exit policy"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  /** streams.comparison in plain words. Accepts {pair: {policy: stats}} or
   *  {pair: stats} (stats = {n, mean_diff_r, se, t, mean_diff_aud, better_share}). */
  function comparisonItems(data, sel) {
    const cmp = obj(obj(data && data.streams) && data.streams.comparison);
    if (!cmp) return [];
    const out = [];
    const def = defaultPolicy(data);
    Object.keys(cmp).forEach(pair => {
      const v = obj(cmp[pair]);
      if (!v) return;
      const m = pair.match(/^(.+)_vs_(.+)$/);
      const a = m ? m[1] : pair, b = m ? m[2] : "night";
      const isStats = num(v.n) !== null || v.mean_diff_r !== undefined;
      const entries = isStats ? [[v.policy_id || def, v]] : Object.keys(v).map(k => [k, obj(v[k])]).filter(e => e[1]);
      entries.forEach(([pid, st]) => {
        const n = num(st.n), d = num(st.mean_diff_r), t = num(st.t), aud = num(st.mean_diff_aud), share = num(st.better_share);
        let text;
        if (!n) text = a === "preclose_live" ? "no paired trades yet — forward tracking started " + fmtDate(liveSince(data)) + "." : "no paired trades.";
        else if (d === null) text = "n = " + fmtInt(n) + " paired signals; difference not published.";
        else {
          text = "on the same " + fmtInt(n) + " signals, " + streamProse(a) + " averaged " + fmtR(Math.abs(d)).replace("+", "") + " per trade " + (d >= 0 ? "better" : "worse") + " than " + streamProse(b) +
            (aud !== null ? " (≈ " + (aud >= 0 ? "+" : "-") + fmtAud(Math.abs(aud), 0) + " per trade at the fixed stake)" : "") + "." +
            (share !== null ? " It came out ahead on " + fmtRate(share) + " of signals." : "") +
            (t !== null ? (Math.abs(t) >= 2 ? " t = " + fmtNum(t, 2) + ": a consistent difference (|t| ≥ 2)." : " t = " + fmtNum(t, 2) + ": could still be noise (needs |t| ≥ 2 to count as evidence).") : "");
        }
        out.push({ pair, a, b, policy: pid, selected: pid === sel.policy, text });
      });
    });
    return out;
  }

  function comparisonBlock(data, sel) {
    const items = comparisonItems(data, sel);
    if (!items.length) return html`<p class="small">Paired night vs pre-close comparison not published yet.</p>`;
    return html`<ul class="cmp-list">${items.map(i => html`<li${i.selected ? html` style="color:var(--text-main)"` : ""}><b>${streamLabel(i.a)} vs ${streamLabel(i.b).toLowerCase()}, ${ITL.policyName(i.policy)}</b>: ${i.text}</li>`)}</ul>
      <p class="small">Paired = each signal compared with itself under both entry methods, so market luck cancels out. R = profit in units of the initial risk (entry − stop).</p>`;
  }

  function stakeMethodText(data, sel) {
    const st = obj(data && data.stake) || {};
    const stake = stakeAud(data);
    return (stake !== null ? fmtAud(stake, 0) : "A fixed stake") + " on every " + (sel.all ? "setup (valid and near-miss, not only the recommended orders)" : "recommended order") +
      ", capital assumed sufficient (no max-2 or position caps), P&L simply added up — no compounding" +
      (num(st.brokerage_per_side_aud) !== null ? "; brokerage " + fmtAud(st.brokerage_per_side_aud, 2) + " per side" : "") + ".";
  }

  function normalizeSel(data, saved) {
    const pols = trackedPolicies(data);
    const sel = { stream: "night", policy: pols.indexOf(defaultPolicy(data)) >= 0 ? defaultPolicy(data) : pols[0], all: false };
    if (saved && typeof saved === "object") {
      if (STREAMS.some(s => s.id === saved.stream)) sel.stream = saved.stream;
      if (pols.indexOf(saved.policy) >= 0) sel.policy = saved.policy;
      if (typeof saved.all === "boolean") sel.all = saved.all;
    }
    return sel;
  }

  // ── Browser boot ────────────────────────────────────────────────────────
  function boot() {
    const $ = (id) => document.getElementById(id);
    const SEL_KEY = "itradelite_track_stake_sel";
    const state = { data: null, sys: [], bm: [], rebased: false, edges: {}, names: {}, sel: null };

    /** Draw a line chart with crosshair + tooltip into host/tip/legend ids. */
    function drawLines(ids, list, opts) {
      const host = $(ids.host);
      if (!host) return;
      const w = Math.max(280, Math.floor(host.clientWidth || 800));
      const narrow = w < 560;
      const h = narrow ? 240 : (opts.height || 320);
      const model = chartModel(list.filter(s => s.points.length), w, h, { padL: narrow ? 58 : 66, padR: narrow ? 10 : (opts.padR || 140) });
      ITL.setHtml(host, chartSvg(model, { endLabels: !narrow && opts.endLabels !== false, ariaLabel: opts.ariaLabel, zeroLine: opts.zeroLine, emptyText: opts.emptyText }));
      if (ids.legend) ITL.setHtml($(ids.legend), opts.legend || html``);
      const svg = host.querySelector("svg");
      const tip = $(ids.tip);
      if (!svg || model.empty) return;
      const shown = list.filter(s => s.points.length);
      const catcher = svg.querySelector(".hover-catch");
      const vline = svg.querySelector(".hover-line");
      const move = (ev) => {
        const rect = svg.getBoundingClientRect();
        const px = (ev.clientX - rect.left) * (model.w / rect.width);
        const t = model.tMin + (px - model.o.padL) / model.iw * (model.tMax - model.tMin);
        const ref = shown[0].points;
        let near = ref[0];
        ref.forEach(pt => { if (Math.abs(pt.t - t) < Math.abs(near.t - t)) near = pt; });
        const xx = model.x(near.t);
        vline.setAttribute("x1", xx); vline.setAttribute("x2", xx); vline.style.display = "";
        const rowsH = shown.map(s => {
          const v = valueAt(s.points, near.t);
          const dot = svg.querySelector('.hover-dot[data-key="' + s.key + '"]');
          if (v && dot) { dot.setAttribute("cx", model.x(v.t)); dot.setAttribute("cy", model.y(v.v)); dot.style.display = ""; }
          return html`<div><i style="background:${s.color}"></i>${s.label} ${v ? (opts.fmt ? opts.fmt(v.v) : fmtAud(v.v, 0)) : DASH}</div>`;
        });
        ITL.setHtml(tip, html`<div><b>${fmtDate(near.date)}</b></div>${rowsH}`);
        tip.style.display = "block";
        const hostRect = host.getBoundingClientRect();
        const left = (xx / model.w) * rect.width + (rect.left - hostRect.left);
        tip.style.left = Math.min(Math.max(0, left + 12), hostRect.width - 190) + "px";
        tip.style.top = "40px";
      };
      const leave = () => { tip.style.display = "none"; vline.style.display = "none"; svg.querySelectorAll(".hover-dot").forEach(d => { d.style.display = "none"; }); };
      catcher.addEventListener("pointermove", move);
      catcher.addEventListener("pointerdown", move);
      catcher.addEventListener("pointerleave", leave);
    }

    function drawChart() {
      if (!state.data || !$("chartHost")) return;
      const p = state.data.portfolio || {};
      const bsym = p.benchmark && p.benchmark.symbol ? p.benchmark.symbol : "ETF";
      const list = [{ key: "sys", label: "System", color: C_SYS, points: state.sys }, { key: "bm", label: bsym, color: C_BM, points: state.bm }].filter(s => s.points.length);
      drawLines({ host: "chartHost", tip: "chartTip", legend: "chartLegend" }, list, {
        ariaLabel: "Portfolio equity in A$ vs " + bsym,
        legend: html`${list.map(s => html`<span><i style="background:${s.color}"></i>${s.label}${s.key === "bm" && state.bmRebased ? " (rebased to start)" : ""}${s.key === "sys" && state.sysRebased ? " (rebased to start)" : ""}</span>`)}`,
      });
    }

    function drawStakeChart() {
      if (!state.data || !$("stakeChartHost")) return;
      const sel = state.sel;
      const block = stakeBlock(state.data, sel.stream, sel.policy, sel.all);
      const pts = stakeSeries(block);
      const label = streamLabel(sel.stream) + " · " + ITL.policyName(sel.policy);
      const empty = block && num(block.n) === 0 && sel.stream === "preclose_live" ? "No trades yet: forward tracking is collecting data since " + fmtDate(liveSince(state.data)) + "." : "No P&L curve published for this stream / policy yet.";
      drawLines({ host: "stakeChartHost", tip: "stakeChartTip" }, [{ key: "pnl", label: "Cumulative P&L", color: C_SYS, points: pts }], {
        ariaLabel: "Cumulative P&L in A$ by date: " + label, zeroLine: true, emptyText: empty, padR: 16, endLabels: false,
        fmt: (v) => signedAud(v),
      });
      ITL.setHtml($("stakeChartTitle"), html`Cumulative P&L (A$) — ${label}${sel.all ? " · all setups" : ""}`);
      const first = pts[0], last = pts[pts.length - 1];
      ITL.setHtml($("stakeChartNote"), html`${first ? html`${fmtDate(first.date)} – ${fmtDate(last.date)}. ` : ""}Running total of every trade's A$ result on its exit date${sel.stream === "preclose_proxy" ? html` · <b>historical estimate</b>: the night signals as if bought at that day's close` : sel.stream === "preclose_live" ? html` · <b>forward tracking</b> of the real pre-close picks` : ""}.`);
      const months = {};
      pts.forEach(pt => { months[pt.date.slice(0, 7)] = pt; });
      ITL.setHtml($("stakeChartTable"), pts.length ? html`<table><thead><tr><th>Month end</th><th class="right">Cumulative P&L</th></tr></thead><tbody>${Object.keys(months).map(m => html`<tr><td class="mono">${months[m].date}</td><td class="mono right">${signedAud(months[m].v)}</td></tr>`)}</tbody></table>` : html`<p class="small">No data.</p>`);
    }

    function renderStake() {
      const d = state.data;
      const host = $("stake");
      if (!host) return;
      if (!stakeBy(d, false)) {
        ITL.setHtml(host, html`<section class="card"><div class="card__head"><h2>Fixed A$25k on every signal</h2></div><div class="empty-state"><div class="empty-state__title">Fixed-stake view not published yet</div>metrics.json has no <code>stake</code> block yet; it appears here once the simulator publishes it. The risk-sized A$100k account below is unaffected.</div></section>`);
        return;
      }
      const sel = state.sel;
      const stake = stakeAud(d);
      const hasAll = !!stakeBy(d, true);
      ITL.setHtml($("stakeTitle"), html`${stake !== null ? fmtAud(stake, 0) : "Fixed stake"} on every signal`);
      ITL.setHtml($("stakeToggle"), html`<button type="button" data-all="0" aria-pressed="${sel.all ? "false" : "true"}">Recommended orders</button><button type="button" data-all="1" aria-pressed="${sel.all ? "true" : "false"}"${hasAll ? "" : html` disabled title="stake.all_setups not published"`}>All setups</button>`);
      ITL.setHtml($("stakeMethod"), html`${stakeMethodText(d, sel)} Showing <b>${streamLabel(sel.stream)}</b> with exit <b>${ITL.policyName(sel.policy)}</b>${sel.policy === defaultPolicy(d) ? " (default)" : ""}; click another cell of the matrix to switch.`);
      ITL.setHtml($("stakeKpis"), stakeKpis(d, sel));
      ITL.setHtml($("stakeMatrix"), stakeMatrix(d, sel));
      ITL.setHtml($("stakeCmp"), comparisonBlock(d, sel));
      drawStakeChart();
    }

    function render() {
      const d = state.data, n = ITL.now();
      const info = ITL.schemaInfo(d, "metrics");
      const banners = [];
      if (!info.ok) banners.push(ITL.outdatedBanner("metrics.json", info));
      banners.push(ITL.staleBanner(d, n, "metrics.json"));
      ITL.setHtml($("banners"), html`${banners}`);
      if (!info.ok) {
        ITL.setHtml($("content"), legacyView(d));
        return;
      }
      $("content").hidden = true;
      $("v2").hidden = false;
      state.sel = normalizeSel(d, state.sel || ITL.store.get(SEL_KEY));
      renderStake();
      const v = verdictLine(d);
      ITL.setHtml($("verdict"), html`<div class="verdict verdict--${v.cls}">${v.text}</div>
        <div class="small">As of ${fmtDateTime(d.generated_at_utc)} (${ago(d.generated_at_utc, n)}) · default exit policy <span class="mono">${d.default_policy_id || DASH}</span></div>`);
      ITL.setHtml($("kpis"), kpis(d));
      const p = d.portfolio || {};
      const sys = toAud(cleanSeries(p.equity), p.start_aud);
      const bm = toAud(cleanSeries(p.benchmark && p.benchmark.equity), p.start_aud);
      state.sys = sys.series; state.bm = bm.series; state.sysRebased = sys.rebased; state.bmRebased = bm.rebased;
      const first = state.sys[0] || state.bm[0], last = state.sys[state.sys.length - 1] || state.bm[state.bm.length - 1];
      ITL.setHtml($("chartNote"), html`Portfolio value in A$ by date (${first ? fmtDate(first.date) : DASH} – ${last ? fmtDate(last.date) : DASH}), simulated from every recommended order with the default exit policy, after costs; ${p.benchmark && p.benchmark.symbol ? p.benchmark.symbol : "the ETF"} bought with the same starting A$. ${state.sys.length < 2 ? "Not enough history for a curve yet." : ""}`);
      drawChart();
      // monthly table view of the curve (accessibility / exact numbers)
      const months = {};
      state.sys.forEach(pt => { months[pt.date.slice(0, 7)] = pt; });
      ITL.setHtml($("chartTable"), html`<table><thead><tr><th>Month end</th><th class="right">System</th><th class="right">${p.benchmark && p.benchmark.symbol ? p.benchmark.symbol : "ETF"}</th></tr></thead><tbody>
        ${Object.keys(months).map(m => { const pt = months[m]; const b = valueAt(state.bm, pt.t); return html`<tr><td class="mono">${pt.date}</td><td class="mono right">${fmtAud(pt.v, 0)}</td><td class="mono right">${b ? fmtAud(b.v, 0) : DASH}</td></tr>`; })}
      </tbody></table>`);
      ITL.setHtml($("policies"), policyTable(d));
      ITL.setHtml($("strategies"), strategyTable(d, state.edges));
      ITL.setHtml($("universe"), universeBlock(d));
      ITL.setHtml($("trades"), tradesTable(d, state.names));
      ITL.setHtml($("notes"), notesBlock(d));
    }

    async function load() {
      try {
        const [d, edges, names] = await Promise.all([ITL.fetchJSON(DATA_PATH), ITL.loadEdgeVerdicts(), ITL.loadNames()]);
        state.data = d; state.edges = edges; state.names = names;
        render();
      } catch (e) {
        ITL.setHtml($("loadError"), ITL.errorBox(e, "the track record (metrics.json)"));
        if (typeof console !== "undefined") console.error(e);
      }
    }

    $("stake").addEventListener("click", (e) => {
      const cell = e.target.closest("button.mcell");
      const tog = e.target.closest("#stakeToggle button");
      if (!cell && !tog) return;
      if (cell) { state.sel.stream = cell.getAttribute("data-stream"); state.sel.policy = cell.getAttribute("data-policy"); }
      if (tog && !tog.disabled) state.sel.all = tog.getAttribute("data-all") === "1";
      ITL.store.set(SEL_KEY, state.sel);
      renderStake();
    });
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawChart(); drawStakeChart(); }, 150); });
    ITL.bootCommon();
    load();
  }

  return { STREAMS, stakeBy, stakeBlock, stakeSeries, stakeKpis, stakeMatrix, comparisonItems, comparisonBlock, stakeMethodText, normalizeSel, liveSince, trackedPolicies,
    DATA_PATH, fmtAudTick, cleanSeries, toAud, chartModel, chartSvg, valueAt, maxDrawdown, verdictLine, policyTable, strategyTable, tradesTable, notesBlock, universeBlock, legacyView, kpis, boot };
});
