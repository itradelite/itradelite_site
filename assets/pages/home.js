/* Home page: pending-exits banner and live headline numbers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../itl.js"));
  else root.ITL_HOME = factory(root.ITL);
})(typeof self !== "undefined" ? self : this, function (ITL) {
  "use strict";
  const { html, num, fmtInt, fmtPct, fmtRate, fmtDateTime, ago, DASH } = ITL;
  const MAX_AGE_DAYS = 4;

  /** Banner for simulated positions pending action. All fields escaped;
   *  as_of / generated_at_utc checked so an old file is labelled as old. */
  function pendingExitsBanner(pe, now) {
    if (!pe || typeof pe !== "object") return html``;
    const pending = (Array.isArray(pe.pending_exits) ? pe.pending_exits : []).filter(p => p && typeof p === "object");
    const closed = (Array.isArray(pe.recent_auto_closes) ? pe.recent_auto_closes : []).filter(p => p && typeof p === "object");
    if (!pending.length && !closed.length) return html``;
    const asOf = ITL.parseIso(pe.generated_at_utc) || ITL.parseIso(pe.as_of);
    const ageDays = asOf ? ((now || new Date()).getTime() - asOf.getTime()) / 86400000 : null;
    const old = ageDays === null || ageDays > MAX_AGE_DAYS;
    const exits = pending.filter(p => p.category === "exit");
    const takes = pending.filter(p => p.category === "profit_take");
    const other = pending.filter(p => p.category !== "exit" && p.category !== "profit_take");
    const item = (p) => html`<b>${p.symbol || DASH}</b> (${p.action || "?"}, ${num(p.streak_days) !== null ? fmtInt(p.streak_days) + " d" : "?"}${num(p["pnl_%"]) !== null ? ", " + fmtPct(p["pnl_%"], { dp: 1, sign: true }) : ""}${p.status === "AUTO_CLOSE_IMMINENT" ? " — auto-close imminent" : ""})`;
    const list = (arr) => arr.map((p, i) => html`${i ? ", " : ""}${item(p)}`);
    const body = html`
      ${exits.length ? html`<div>Exit flagged: ${list(exits)}</div>` : ""}
      ${takes.length ? html`<div>Profit-taking pending: ${list(takes)}</div>` : ""}
      ${other.length ? html`<div>Other: ${list(other)}</div>` : ""}
      ${closed.length ? html`<div>Recently auto-closed: ${closed.map((a, i) => html`${i ? ", " : ""}<b>${a.symbol || DASH}</b> on ${a.closed_date || "?"} (${fmtPct(a.pnl_pct, { dp: 1, sign: true })})`)}</div>` : ""}
      <div class="small" style="margin-top:4px;">Simulated positions opened from published signals (portfolio monitor), not a brokerage account. As of ${asOf ? fmtDateTime(asOf) + " (" + ago(asOf, now) + ")" : "unknown time"}${old ? " — this file is old and may no longer be accurate." : "."}</div>`;
    return ITL.banner(old ? "stale" : "error", (pending.length ? pending.length + " simulated position(s) need action" : "Recent auto-closes") + (old ? " (old data)" : ""), body, old ? "OLD" : "ACTION");
  }

  function statsTiles(m) {
    if (!m || !ITL.schemaInfo(m, "metrics").ok) return null;
    const pol = (Array.isArray(m.policies) ? m.policies : []).find(p => p && p.id === m.default_policy_id);
    const p = m.portfolio || {};
    const tr = num(p.total_return), br = num(p.benchmark_total_return);
    return {
      verdict: typeof m.verdict === "string" ? m.verdict : null,
      tiles: [
        { k: "Trades simulated", v: pol && pol.stats ? fmtInt(pol.stats.n) : DASH },
        { k: "System return", v: fmtPct(tr, { fraction: true, sign: true }) },
        { k: (p.benchmark && p.benchmark.symbol ? p.benchmark.symbol : "ETF") + " return", v: fmtPct(br, { fraction: true, sign: true }) },
        { k: "Win rate", v: pol && pol.stats ? fmtRate(pol.stats.winrate) : DASH },
      ],
      asOf: m.generated_at_utc,
    };
  }

  function boot() {
    const $ = (id) => document.getElementById(id);
    ITL.bootCommon();
    (async () => {
      const r = await ITL.tryFetchJSON("/public/pending_exits.json");
      if (r.data) ITL.setHtml($("pendingExits"), pendingExitsBanner(r.data, ITL.now()));
    })();
    (async () => {
      const r = await ITL.tryFetchJSON("/track-record/metrics.json");
      const s = statsTiles(r.data);
      if (!s) return; // no v2 metrics yet: show nothing rather than made-up numbers
      ITL.setHtml($("stats"), html`
        ${s.verdict ? html`<div class="verdict verdict--info" style="font-size:15px;">${s.verdict}</div>` : ""}
        <div class="kpiGrid">${s.tiles.map(t => html`<div class="kpiBox"><div class="kpiLabel">${t.k}</div><div class="kpiValue">${t.v}</div></div>`)}</div>
        <div class="small">From the <a href="/track-record/">track record</a>, as of ${fmtDateTime(s.asOf)}.</div>`);
    })();
  }

  return { pendingExitsBanner, statsTiles, boot };
});
