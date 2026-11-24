// Unit tests for the site's shared module and page logic (no browser needed).
//   node dev/test_site.mjs
// Loads assets/itl.js and assets/pages/*.js as CommonJS (they are UMD) and
// renders against dev/fixtures/*.json, frozen v1 samples (dev/fixtures/v1/,
// taken from git history before production switched to v2) and the current
// public/ files.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ITL = require(path.join(ROOT, "assets/itl.js"));
const TODAY = require(path.join(ROOT, "assets/pages/today.js"));
const LIVE = require(path.join(ROOT, "assets/pages/live.js"));
const INTRA = require(path.join(ROOT, "assets/pages/intraday.js"));
const TRACK = require(path.join(ROOT, "assets/pages/track.js"));
const HOME = require(path.join(ROOT, "assets/pages/home.js"));
const DECAY = require(path.join(ROOT, "assets/pages/decay.js"));
const PRE = require(path.join(ROOT, "assets/pages/preclose.js"));
const J = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) { if (cond) pass++; else { fail++; failures.push(name); } }
function eq(a, b, name) { const s = JSON.stringify(a) === JSON.stringify(b); if (!s) name += ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`; ok(s, name); }
function section(n) { console.log("\u2022 " + n); }
const S = (safe) => String(safe); // SafeHtml -> string
// The default fixtures carry the contract v2.3 (ranking) fields since
// dev/make_fixtures_v23.py; older-path tests strip them (pre-v2.2 / v2.2 files).
const ROW_KEYS_V22 = ["fund_v2", "fund_v2_pillars", "fund_v2_label", "fund_v2_coverage", "sector"];
const ROW_KEYS_V23 = ["composite_v1_legacy", "fund_v2_percentile", "fund_filter", "tiebreak_note"];
function stripFields(d, rowKeys, runKeys) {
  const out = Object.assign({}, d);
  (runKeys || []).forEach(k => { delete out[k]; });
  ["recommended_orders", "setups", "watchlist_full", "withheld_orders"].forEach(k => {
    if (Array.isArray(out[k])) out[k] = out[k].map(r => { const x = Object.assign({}, r); rowKeys.forEach(c => { delete x[c]; }); return x; });
  });
  return out;
}
const RUN_KEYS_V23 = ["ranking_version", "ranking", "ranking_degraded"];
const pre23 = (d) => stripFields(d, ROW_KEYS_V23, RUN_KEYS_V23);
const pre22 = (d) => stripFields(d, ROW_KEYS_V22.concat(ROW_KEYS_V23), RUN_KEYS_V23);

// Reference Sydney offset (hours): AEDT from 02:00 AEST on the first Sunday
// of October until 03:00 AEDT on the first Sunday of April (both = 16:00 UTC
// on the preceding Saturday).
function firstSunday(y, m) { const d = new Date(Date.UTC(y, m, 1)); return 1 + ((7 - d.getUTCDay()) % 7); }
function sydOffset(t) {
  const y = new Date(t).getUTCFullYear();
  const start = Date.UTC(y, 9, firstSunday(y, 9) - 1, 16);  // Sat 16:00 UTC before 1st Sun Oct
  const end = Date.UTC(y, 3, firstSunday(y, 3) - 1, 16);    // Sat 16:00 UTC before 1st Sun Apr
  return (t >= start || t < end) ? 11 : 10;
}
const ymdUTC = (t) => new Date(t).toISOString().slice(0, 10);
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── 1. Dates, time zones, DST ─────────────────────────────────────────────
section("dates: Sydney session date / Brisbane display across days 1-31 and DST");
{
  let mism = [];
  for (const y of [2026, 2027]) for (let m = 0; m < 12; m++) for (let d = 1; d <= 31; d++) {
    for (const h of [0, 3, 12, 13, 14, 15, 16, 17, 23]) for (const mi of [0, 59]) {
      const t = Date.UTC(y, m, d, h, mi);
      if (new Date(t).getUTCMonth() !== m) continue;
      const date = new Date(t);
      const want = ymdUTC(t + sydOffset(t) * 3600e3);
      const got = ITL.sydneyDate(date);
      if (got !== want) mism.push(`${date.toISOString()} syd ${got} != ${want}`);
      const zp = ITL.zonedParts(date, ITL.TZ_BNE);
      const bt = new Date(t + 10 * 3600e3);
      if (zp.day !== bt.getUTCDate() || zp.month !== bt.getUTCMonth() + 1 || zp.weekday !== WD[bt.getUTCDay()] || zp.hour !== bt.getUTCHours()) mism.push(`${date.toISOString()} bne parts`);
      const sp = ITL.zonedParts(date, ITL.TZ_SYD);
      if (sp.offsetMin !== sydOffset(t) * 60) mism.push(`${date.toISOString()} syd offset ${sp.offsetMin}`);
    }
  }
  eq(mism.slice(0, 5), [], "sydneyDate/zonedParts match reference for every day 1-31 incl. DST edges");
  // the old bug: dd/mm parsed as mm/dd -> invalid for 13-31, swapped weekday for 1-12
  eq(ITL.fmtDateTime("2026-11-23T09:12:00Z"), "Mon 23 Nov, 19:12 AEST", "fmtDateTime day 23 (old bug: Invalid Date)");
  eq(ITL.fmtDateTime("2026-12-04T23:30:00Z"), "Sat 5 Dec, 09:30 AEST", "fmtDateTime day 5 (old bug: swapped month/day)");
  eq(ITL.fmtDateTime("2026-12-04T23:30:00Z", { tz: ITL.TZ_SYD }), "Sat 5 Dec, 10:30 AEDT", "Sydney display uses AEDT in summer");
  eq(ITL.fmtDateTime("2026-06-04T23:30:00Z", { tz: ITL.TZ_SYD }), "Fri 5 Jun, 09:30 AEST", "Sydney display uses AEST in winter");
  eq(ITL.fmtTime("2026-04-04T15:59:00Z", { tz: ITL.TZ_SYD }), "02:59 AEDT", "just before DST ends");
  eq(ITL.fmtTime("2026-04-04T16:00:00Z", { tz: ITL.TZ_SYD }), "02:00 AEST", "DST ended (02:00 AEST)");
  eq(ITL.sydneyDate(new Date("2026-10-03T13:59:00Z")), "2026-10-03", "23:59 AEST Sat before DST start");
  eq(ITL.sydneyDate(new Date("2026-10-03T14:00:00Z")), "2026-10-04", "midnight Sydney");
  eq(ITL.sydneyDate(new Date("2026-11-23T13:00:00Z")), "2026-11-24", "00:00 AEDT is the next day while Brisbane is still 23:00");
  let badWd = 0;
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= 31; d++) {
    const s = `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const p = ITL.parseYmd(s);
    const real = new Date(Date.UTC(2026, m - 1, d));
    if (real.getUTCMonth() !== m - 1) { if (p !== null) badWd++; continue; }
    if (!p || ITL.fmtDate(s) !== `${WD[real.getUTCDay()]} ${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]} 2026`) badWd++;
  }
  eq(badWd, 0, "fmtDate weekday correct for every calendar day; invalid dates (e.g. 30 Feb) rejected");
  eq(ITL.parseIso("2026-11-21 04:00:06 AEST").toISOString(), "2026-11-20T18:00:06.000Z", "v1 'AEST' timestamp parsed");
  eq(ITL.parseIso("2026-11-21 04:00:06 AEDT").toISOString(), "2026-11-20T17:00:06.000Z", "v1 'AEDT' timestamp parsed");
  eq(ITL.parseIso("2026-11-20T17:59:58Z").toISOString(), "2026-11-20T17:59:58.000Z", "ISO Z");
  eq(ITL.parseIso("2026-11-23T19:12:00+10:00").toISOString(), "2026-11-23T09:12:00.000Z", "ISO with offset");
  eq(ITL.parseIso("23/11/2026, 7:12:00 pm"), null, "locale strings are rejected, never guessed");
  eq(ITL.parseIso(null), null, "null");
  eq(ITL.fmtDateTime(undefined), "\u2014", "missing time renders dash");
  eq(ITL.ago("2026-11-23T09:00:00Z", new Date("2026-11-23T09:30:00Z")), "30 min ago", "ago minutes");
  eq(ITL.ago("2026-11-20T09:00:00Z", new Date("2026-11-23T09:30:00Z")), "3 d ago", "ago days");
}

section("market phase comes from market_state");
{
  eq(ITL.marketPhase({ phase: "pre_open" }).preOpen, true, "pre_open");
  eq(ITL.marketPhase({ phase: "Pre-Open" }).key, "pre_open", "normalised case/dash");
  eq(ITL.marketPhase({ phase: "open" }).open, true, "open");
  eq(ITL.marketPhase({ state: "post_close" }).label, "After close", "state alias");
  eq(ITL.marketPhase({ is_open: false }).key, "closed", "is_open fallback");
  eq(ITL.marketPhase(null).label, "\u2014", "missing market_state");
  eq(ITL.marketPhase({ phase: "lunch_auction" }).label, "lunch_auction", "unknown phase shown raw");
  eq(ITL.sessionDateOf({ session_date: "2026-11-24" }), "2026-11-24", "session date");
}

// ── 2. Numbers ────────────────────────────────────────────────────────────
section("number formats");
{
  eq(ITL.fmtPrice(1.995), "1.995", "<A$2 => 3dp");
  eq(ITL.fmtPrice(1.8932), "1.893", "<A$2 => 3dp rounding");
  eq(ITL.fmtPrice(187.76), "187.76", ">=A$2 => 2dp");
  eq(ITL.fmtPrice(2), "2.00", "exactly 2 => 2dp");
  eq(ITL.fmtPrice(44.8, { price_decimals: 3 }), "44.800", "price_decimals overrides");
  eq(ITL.fmtPrice(1234.5), "1,234.50", "thousands separator");
  eq(ITL.fmtPrice(null), "\u2014", "null => dash");
  eq(ITL.fmtPrice("abc"), "\u2014", "junk => dash");
  eq(ITL.fmtPrice(true), "\u2014", "boolean => dash");
  eq(ITL.num(null), null, "num(null) is null, not 0");
  eq(ITL.fmtAud(1234.5), "A$1,235", "A$ >=1000 no cents");
  eq(ITL.fmtAud(995.52), "A$995.52", "A$ <1000 cents");
  eq(ITL.fmtAud(-50), "-A$50.00", "negative A$");
  eq(ITL.fmtPct(0.0414, { fraction: true, sign: true }), "+4.1%", "fraction pct");
  eq(ITL.fmtPct(-1.75, { dp: 2, sign: true }), "-1.75%", "percent units");
  eq(ITL.fmtRate(0.46), "46%", "rate as fraction");
  eq(ITL.fmtRate(46), "46%", "rate as percent");
  eq(ITL.fmtR(0.04), "+0.04R", "R positive");
  eq(ITL.fmtR(-1), "-1.00R", "R negative");
}

section("readMoneyLike accepts shorthand, rejects visibly (never clamps)");
{
  const v = (s) => { const r = ITL.readMoneyLike(s); return r.ok ? r.value : "ERR"; };
  eq(v("100000"), 100000, "plain");
  eq(v("100k"), 100000, "100k");
  eq(v("1.2m"), 1200000, "1.2m");
  eq(v("1e6"), 1000000, "1e6");
  eq(v("A$100,000"), 100000, "A$ and commas");
  eq(v("$250 000"), 250000, "$ and spaces");
  eq(v("2.5K"), 2500, "upper-case K");
  eq(v("abc"), "ERR", "letters rejected");
  eq(v("-5000"), "ERR", "negative rejected");
  eq(v("50"), "ERR", "below minimum rejected (not clamped to A$1,000)");
  eq(v("1e12"), "ERR", "too large rejected");
  eq(v(""), "ERR", "empty rejected");
  ok(/minimum/.test(ITL.readMoneyLike("50").error), "error message explains minimum");
}

// ── 3. Sizing ─────────────────────────────────────────────────────────────
section("position sizing caps");
{
  const sz = (entry, stop, portfolio = 100000, riskPct = 1, maxPosPct = 25) => ITL.computeSize({ entry, stop, portfolio, riskPct, maxPosPct });
  let s = sz(10, 9.8);
  eq([s.qty, s.riskQty, s.posQty, s.capped, s.binding, s.actualRisk], [2500, 5000, 2500, true, "max_position", 500], "max position cap binds (how-it-works example)");
  s = sz(10, 9.0);
  eq([s.qty, s.capped, s.binding, s.actualRisk], [1000, false, "risk", 1000], "risk budget binds");
  s = sz(10, 9.8, 100000, 3, 150);
  eq([s.qty, s.binding, s.cashQty], [10000, "cash", 10000], "cash cap binds when max position > 100%");
  s = sz(1.995, 1.895);
  eq([s.qty, s.capped], [10000, false], "AMP-like low price row");
  s = sz(100, 99.9, 100000, 0.3, 100);
  eq(s.riskQty, 3000, "floating-point: 300/0.1 = 3000, not 2999");
  eq(sz(null, 9).reason, "no_entry", "entry_ref null => no size");
  eq(sz(0, 9).reason, "no_entry", "entry_ref 0 => no size");
  eq(sz(10, null).reason, "no_stop", "no stop => no size");
  eq(sz(10, 10).reason, "zero_risk", "entry == stop");
  s = sz(5000, 4000, 1000, 1, 25);
  eq([s.ok, s.qty], [true, 0], "rounds to zero shares");
  ok(/0 shares/.test(s.message), "zero-share message");
  ok(/CAPPED by Max position/.test(ITL.sizeTooltip(sz(10, 9.8))), "tooltip explains cap");
}

// ── 4. Staleness / schema / health ───────────────────────────────────────
section("staleness, picks session, schema, health");
{
  const env = { stale_after_utc: "2026-11-24T10:30:00+00:00" };
  eq(ITL.staleness(env, new Date("2026-11-24T10:29:00Z")).stale, false, "before stale_after");
  eq(ITL.staleness(env, new Date("2026-11-24T10:31:00Z")).stale, true, "after stale_after");
  eq(ITL.staleness({}, new Date()).stale, null, "no stale_after => unknown");
  eq(ITL.picksStale({ picks_valid_for: "2026-11-24" }, new Date("2026-11-23T23:30:00Z")).stale, false, "picks for today (Sydney)");
  eq(ITL.picksStale({ picks_valid_for: "2026-11-24" }, new Date("2026-11-24T13:30:00Z")).stale, true, "picks for yesterday (Sydney midnight passed)");
  eq(ITL.picksStale({}, new Date()).stale, true, "missing picks_valid_for is stale");
  { const ps = ITL.picksStale({ picks_valid_for: "2026-11-24" }, new Date("2026-11-23T12:30:00Z"));
    eq([ps.stale, ps.upcoming], [false, true], "evening check with tomorrow's picks => upcoming, not stale"); }
  { const z = ITL.computeSize({ entry: 10, stop: 10.5, portfolio: 100000, riskPct: 1, maxPosPct: 25 });
    eq([z.ok, z.reason], [false, "stop_not_below_entry"], "stop above entry => no size"); }
  eq(ITL.healthIssues({ jobs: { live_check: { last_status: "not_in_session" }, night_scan: { last_status: "stale_data" }, metrics: { last_status: "refused_older" } } }, new Date()), [], "routine statuses are not health failures");
  eq(ITL.healthIssues({ jobs: { night_scan: { last_status: "failure" } } }, new Date()).length, 1, "real failure still flagged");
  eq(ITL.schemaInfo({ schema: "itl.today.v2" }, "today").ok, true, "v2 schema");
  eq(ITL.schemaInfo({ schema: "itl.today.v3" }, "today").ok, true, "newer schema accepted");
  eq(ITL.schemaInfo({}, "today").ok, false, "v1 (no schema) flagged");
  eq(ITL.schemaInfo({ schema: "itl.live.v2" }, "today").ok, false, "wrong file flagged");
  const st = J("dev/fixtures/status.json");
  const iss = ITL.healthIssues(st, new Date("2026-11-24T00:30:00Z"));
  eq(iss.map(i => i.job), ["intraday_scan"], "stale/failed job detected");
  eq(ITL.healthIssues(J("dev/fixtures/preopen/status.json"), new Date("2026-11-23T22:45:00Z")), [], "healthy status => no banner");
  ok(ITL.healthIssues(st, new Date("2026-11-30T00:00:00Z")).some(i => i.self), "stale status.json itself reported");
  ok(/intraday_scan/.test(S(ITL.healthBanner(iss, new Date()))), "health banner names the job");
}

// ── 5. Escaping ───────────────────────────────────────────────────────────
section("escaping");
{
  eq(ITL.escapeHtml(`<a href="x" onclick='y'>&\``), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;", "escapeHtml");
  const evil = "<img src=x onerror=alert(1)>";
  eq(S(ITL.html`<b>${evil}</b>`), "<b>&lt;img src=x onerror=alert(1)&gt;</b>", "html`` escapes values");
  eq(S(ITL.html`<i>${ITL.html`<b>${evil}</b>`}</i>`), "<i><b>&lt;img src=x onerror=alert(1)&gt;</b></i>", "nested html`` not double-escaped");
  eq(S(ITL.html`${[evil, ITL.html`<br>`]}`), "&lt;img src=x onerror=alert(1)&gt;<br>", "arrays");
  eq(S(ITL.html`${null}${undefined}${false}${0}`), "0", "null/undefined/false render empty");
  let threw = false; try { ITL.setHtml({}, "<b>raw</b>"); } catch (_) { threw = true; }
  ok(threw, "setHtml refuses raw strings");
  const re = /<img src=x|<script>alert|<b>BAD<\/b>|<b>QAN<\/b>|<i>gate<\/i>/;
  const prefs = TODAY.normalizePrefs({});
  const td = J("dev/fixtures/today.json");
  const out = S(TODAY.renderSections(td, TODAY.normalizeData(td), prefs, { names: {}, edges: {}, now: new Date(), showAllWatch: true, watchOpen: true }));
  ok(!re.test(out) && out.includes("&lt;img src=x"), "today: data markup rendered as text");
  const ints = J("dev/fixtures/intraday.json");
  const io = S(INTRA.renderTable(ints.signals, { names: {}, total: ints.signals.length, interval: "all" }));
  ok(!re.test(io) && io.includes("&lt;b&gt;BAD&lt;/b&gt;"), "intraday: data markup rendered as text");
  const ho = S(HOME.pendingExitsBanner(J("dev/fixtures/pending_exits.json"), new Date("2026-11-24T00:00:00Z")));
  ok(!re.test(ho) && ho.includes("&lt;b&gt;QAN&lt;/b&gt;"), "home: pending exits escaped");
  ok(S(ITL.symbolCell('X" onmouseover="a', { 'X" onmouseover="a': "<n>" })).indexOf('onmouseover="a') < 0, "attributes escaped");
}

// ── 6. Today page ─────────────────────────────────────────────────────────
section("today page logic");
{
  eq(TODAY.normalizePrefs({ portfolio: "abc", riskPct: 9, maxPosPct: 0, view: "valid", sort: "x" }),
    { view: "setups", strat: "all", q: "", sort: "status_score", portfolio: 100000, riskPct: 1, maxPosPct: 25, watchOpen: false }, "corrupt prefs normalised");
  const opts = TODAY.strategyOptions([{ strategy: "MEAN_REVERSION" }], "MOMENTUM");
  eq(opts.map(o => o.value), ["all", "MEAN_REVERSION", "MOMENTUM"], "saved strategy kept as an option even with no rows");
  ok(/none today/.test(opts[2].label), "missing saved strategy labelled");
  const v1row = TODAY.normalizeRow({ symbol: "A.AX", entry: null, entry_text: "trigger=41.245 limit=41.33", stop: 40 }, true);
  eq([v1row.order_type, v1row.trigger, v1row.limit, v1row.entry_ref], ["STOP_LIMIT", 41.245, 41.33, 41.33], "v1 STOP-LIMIT parsed; sizes from limit");
  eq(TODAY.normalizeRow({ entry_text: "SKIP gap" }, true).entry_ref, null, "v1 SKIP => no entry");
  eq(TODAY.exitPlanText({ initial_stop: 1.895, policy_id: "trail_2pct", trail_pct: 2, time_stop_days: 20 }, {}),
    "Initial stop 1.895. Trail 2% below highest price since entry, max 20 days.", "exit plan (trail pct)");
  eq(TODAY.exitPlanText({ initial_stop: 43.62, trail_pct: 2, activate_after_r: 1, time_stop_days: 20 }, {}),
    "Initial stop 43.62. Once up +1R, trail 2% below highest price since entry, max 20 days.", "exit plan (after 1R)");
  eq(TODAY.exitPlanText({ initial_stop: 10, trail_atr_aud: 0.25, atr_mult: 1, time_stop_days: 20 }, {}),
    "Initial stop 10.00. Trail A$0.250 (1.0\u00d7ATR) below highest price since entry, max 20 days.", "exit plan (ATR)");
  eq(TODAY.exitPlanText({ initial_stop: 10, policy_id: "fixed_5d" }, {}), "Initial stop 10.00. Exit at the close of trading day 5.", "exit plan (fixed)");
  eq(TODAY.exitPlanText(null, {}), "\u2014", "missing exit plan");
  const chips = TODAY.sentimentChips({ sentiment: { score: null, components: { news: { status: "failed", label: "429" }, insider: { status: "no_data" }, trends: { status: "ok", score: 70 } } } }).map(S).join(" ");
  ok(/News: failed/.test(chips) && /Insider: no data/.test(chips) && /Trends 70/.test(chips) && /Sentiment \u2014/.test(chips), "failed/no_data shown as such, not neutral");
  ok(/unknown/.test(S(TODAY.earningsChip({ days_to: null, status: "unknown" }))), "earnings unknown flagged");
  ok(/suppressed/.test(S(TODAY.earningsChip({ days_to: 3, suppress: true, status: "ok" }))), "earnings suppress flagged");
  const td = J("dev/fixtures/today.json"), nd = TODAY.normalizeData(td);
  eq([nd.legacy, nd.rec.length], [false, 2], "fixture recognised as v2");
  eq(new Set(nd.rec.map(r => r.symbol)).size, nd.rec.length, "recommended orders: unique symbols");
  const f = TODAY.applyFilters(nd.setups, Object.assign(TODAY.normalizePrefs({}), { strat: "MOMENTUM" }));
  eq(f.map(r => r.symbol), ["WTC.AX"], "strategy filter");
  const sorted = TODAY.applyFilters(nd.watch, Object.assign(TODAY.normalizePrefs({}), { sort: "risk_desc" }));
  ok(sorted.length === nd.watch.length, "risk sort keeps unsized rows");
  const ctx0 = { names: {}, edges: {}, now: new Date(), validFor: td.valid_for };
  const closed = S(TODAY.renderSections(td, nd, TODAY.normalizePrefs({}), ctx0));
  ok(/<details class="card card--fold" id="watchDetails">/.test(closed) && !closed.includes("XSS.AX"), "full watchlist collapsed by default (rows not rendered)");
  const nDetail = (closed.match(/class="row-detail" hidden/g) || []).length;
  eq(nDetail, nd.setups.length, "every setup's detail row collapsed by default");
  ok(!/class="row-note"/.test(closed) && (closed.match(/class="row-main row-compact"/g) || []).length === nd.setups.length, "one compact line per setup row");
  const openKey = "Setups|" + nd.setups[0].symbol + "|" + nd.setups[0].strategy;
  const one = S(TODAY.renderSections(td, nd, TODAY.normalizePrefs({}), Object.assign({}, ctx0, { open: new Set([openKey]) })));
  eq((one.match(/class="row-detail" hidden/g) || []).length, nd.setups.length - 1, "remembered open row stays expanded across re-render");
  ok(/id="watchDetails" open/.test(S(TODAY.renderSections(td, nd, TODAY.normalizePrefs({ watchOpen: true }), Object.assign({}, ctx0, { watchOpen: true })))), "watchlist open state honoured");
  ok(/id="watchDetails" open/.test(S(TODAY.renderSections(td, nd, TODAY.normalizePrefs({ view: "watch" }), ctx0))), "watchlist view forces it open");
  ok(/class="order"/.test(closed) && /<b>Exit plans<\/b>/.test(closed) && /Sell at close of day 5 \(by Mon 30 Nov\)/.test(closed), "recommended cards stay fully expanded (with all exit plans)");
  const now = new Date("2026-11-24T00:00:00Z");
  for (const [name, data] of [["v2", td], ["edge", J("dev/fixtures/edge/today.json")], ["v1", J("dev/fixtures/v1/today.json")], ["empty", {}]]) {
    let err = null, html = "";
    try {
      const n2 = TODAY.normalizeData(data);
      html = S(TODAY.renderSections(data, n2, TODAY.normalizePrefs({}), { names: {}, edges: {}, now, validFor: data.valid_for }))
        + TODAY.renderBanners(data, n2, now).map(S).join("") + S(TODAY.renderMeta(data, n2, now));
    } catch (e) { err = e; }
    ok(!err, `today renders ${name} without throwing ${err ? err.stack : ""}`);
    ok(!/NaN|undefined|\[object Object\]/.test(html), `today ${name}: no NaN/undefined/[object Object] in output`);
    if (name === "v1") ok(/Data format outdated/.test(html), "v1 today shows outdated notice");
    if (name === "edge") ok(/Not published/.test(html) && /Low data coverage/.test(html), "edge: withheld + coverage banners");
  }
  ok(/STALE/.test(TODAY.renderBanners(td, TODAY.normalizeData(td), new Date("2026-11-26T00:00:00Z")).map(S).join("")), "stale banner after stale_after_utc");
}

// ── 7. Live page ──────────────────────────────────────────────────────────
section("live page logic");
{
  const lv = J("dev/fixtures/live.json");
  const now = new Date("2026-11-24T00:00:00Z");
  const out = S(LIVE.renderItems(lv.items, { names: {} })) + LIVE.renderBanners(lv, now, null).map(S).join("");
  ok(/HOLD/.test(out) && /WAIT/.test(out) && /184.65/.test(out), "verdicts and trail rendered");
  ok(!/STALE/.test(out), "fresh check: no stale banner");
  const stale = LIVE.renderBanners(lv, new Date("2026-11-25T00:00:00Z"), J("dev/fixtures/today.json")).map(S).join("");
  ok(/STALE PICKS/.test(stale), "picks for another session => STALE PICKS");
  const pre = LIVE.renderBanners(J("dev/fixtures/preopen/live.json"), new Date("2026-11-23T22:45:00Z"), null).map(S).join("");
  ok(/Market not open yet/.test(pre), "pre-open state");
  const edge = J("dev/fixtures/edge/live.json");
  const eo = S(LIVE.renderItems(edge.items, { names: {} }));
  ok(/SKIP/.test(eo) && /EXIT/.test(eo) && !/NaN|undefined/.test(eo), "edge verdicts render");
  const leg = LIVE.adaptLegacy(J("public/before_close.json"));
  ok(leg.items.length > 0 && leg._legacy, "before_close.json adapted");
  const lo = S(LIVE.renderItems(leg.items, { names: {} })) + LIVE.renderBanners(leg, now, null).map(S).join("");
  ok(/Data format outdated/.test(lo) && !/NaN|undefined/.test(lo), "legacy live renders with notice");
  eq(LIVE.verdictCounts(lv.items), { WAIT: 1, HOLD: 1 }, "verdict counts");
}

// ── 8. Intraday page ──────────────────────────────────────────────────────
section("intraday interval filter and session state");
{
  const d = J("dev/fixtures/intraday.json");
  eq(INTRA.intervalsOf(d), ["15m", "30m", "1h"], "intervals from rows + other_signals, sorted by length");
  const p = (iv) => Object.assign(INTRA.normalizePrefs({}), { interval: iv });
  const boq = d.signals.find(s => s.symbol === "BOQ.AX");
  ok(INTRA.matchesInterval(boq, "30m") && INTRA.matchesInterval(boq, "15m") && INTRA.matchesInterval(boq, "1h"), "BOQ (1h primary) matches its other_signals intervals");
  const n30 = INTRA.applyFilters(d.signals, p("30m"));
  const primary30 = d.signals.filter(s => s.interval === "30m").length;
  ok(n30.length > primary30, `30m filter includes other_signals (${n30.length} > ${primary30} primary)`);
  ok(INTRA.applyFilters(d.signals, Object.assign(p("all"), { dir: "short" })).every(s => s.direction === "short"), "direction filter");
  const out = S(INTRA.renderTable(n30, { names: {}, total: d.signals.length, interval: "30m" }));
  ok(/matched on 30m/.test(out), "row tagged when matched via other_signals");
  ok(/forming/.test(S(INTRA.renderTable(d.signals, { names: {}, total: 1, interval: "all" }))), "bar completeness shown");
  const pre = J("dev/fixtures/preopen/intraday.json");
  eq(INTRA.sessionState(pre).closed, true, "session_closed");
  eq(INTRA.lastSessionDate(pre), "2026-11-23", "closed session labelled with the session the bars came from");
  ok(/Session closed/.test(INTRA.renderBanners(pre, new Date("2026-11-23T22:45:00Z")).map(S).join("")), "session closed banner");
  const v1 = J("dev/fixtures/v1/intraday.json");
  const vb = INTRA.renderBanners(v1, new Date()).map(S).join("") + S(INTRA.renderTable(v1.signals, { names: {}, total: v1.signals.length, interval: "all" }));
  ok(/Data format outdated/.test(vb) && !/NaN|undefined/.test(vb), "v1 intraday renders with notice");
}

// ── 9. Track record ───────────────────────────────────────────────────────
section("track record chart + tables");
{
  const finite = (m) => !/NaN|Infinity/.test(JSON.stringify(m.lines.map(l => l.d)) + JSON.stringify(m.yTicks));
  const pts = (arr) => TRACK.cleanSeries(arr.map(([date, equity]) => ({ date, equity })));
  ok(TRACK.chartModel([], 800, 300).empty, "no series => empty");
  let m = TRACK.chartModel([{ key: "a", points: pts([["2026-11-20", 100000]]) }], 800, 300);
  ok(!m.empty && finite(m) && m.lines[0].single, "1-point series: finite, drawn as a dot");
  m = TRACK.chartModel([{ key: "a", points: pts([["2026-11-20", 100000], ["2026-11-21", 100000]]) }], 800, 300);
  ok(finite(m) && m.yTicks.length >= 2, "flat series: no divide-by-zero");
  const met = J("dev/fixtures/metrics.json");
  const sys = TRACK.toAud(TRACK.cleanSeries(met.portfolio.equity), met.portfolio.start_aud);
  eq(sys.rebased, false, "A$ series not rebased");
  const mult = TRACK.toAud(pts([["2026-01-02", 1.0], ["2026-01-03", 1.05]]), 100000);
  eq([mult.rebased, Math.round(mult.series[1].v)], [true, 105000], "multiple rebased to A$");
  m = TRACK.chartModel([{ key: "s", points: sys.series }], 1100, 320);
  ok(finite(m) && m.xTicks.length >= 5 && m.xTicks.every(t => /^[A-Z][a-z]{2}/.test(t.label)), "x-axis has month (date) labels");
  const labels = m.yTicks.map(t => TRACK.fmtAudTick(t.v, m.step));
  eq(new Set(labels).size, labels.length, "y labels distinct: " + labels.join(","));
  ok(labels.every(l => /^A\$/.test(l)), "y labels in A$");
  ok(/<path d="M/.test(S(TRACK.chartSvg(m, { endLabels: true }))), "svg path");
  const pt = S(TRACK.policyTable(met));
  ok(/default/.test(pt) && /your 1% trail/.test(pt) && /row-highlight/.test(pt), "policy table marks default and trail_1pct");
  ok(/No trades yet/.test(S(TRACK.strategyTable(met, {}))), "strategies without trades listed");
  eq(TRACK.verdictLine(met).cls, "ok", "verdict class from totals");
  eq(TRACK.verdictLine({ portfolio: { total_return: -0.02, benchmark_total_return: 0.05 } }).text.slice(0, 15), "Underperforming", "computed verdict when missing");
  const edge = J("dev/fixtures/edge/metrics.json");
  let err = null, html = "";
  try { html = [TRACK.policyTable(edge), TRACK.strategyTable(edge, {}), TRACK.tradesTable(edge, {}), TRACK.notesBlock(edge), TRACK.universeBlock(edge), TRACK.kpis(edge)].map(S).join(""); } catch (e) { err = e; }
  ok(!err && !/NaN|undefined/.test(html), "edge metrics render " + (err ? err.stack : ""));
  const lv = S(TRACK.legacyView(J("dev/fixtures/v1/metrics.json")));
  ok(/Legacy proxy/.test(lv) && !/NaN|undefined/.test(lv), "v1 metrics legacy view");
  eq(Math.round(TRACK.maxDrawdown(pts([["2026-01-01", 100], ["2026-01-02", 120], ["2026-01-03", 90]])) * 100), -25, "max drawdown");
}

// ── 10. Home / decay ──────────────────────────────────────────────────────
section("home + decay");
{
  const pe = J("dev/fixtures/pending_exits.json");
  ok(/need action/.test(S(HOME.pendingExitsBanner(pe, new Date("2026-11-24T00:00:00Z")))), "pending exits banner");
  ok(/old/.test(S(HOME.pendingExitsBanner(J("dev/fixtures/edge/pending_exits.json"), new Date("2026-11-24T00:00:00Z")))), "old pending exits labelled old");
  eq(S(HOME.pendingExitsBanner({ schema: "itl.pending_exits.v2", pending_exits: [], recent_auto_closes: [] }, new Date())), "", "empty pending exits => no banner");
  eq(HOME.statsTiles(J("dev/fixtures/v1/metrics.json")), null, "home shows no stats from v1 metrics (no invented numbers)");
  eq(HOME.statsTiles(J("dev/fixtures/metrics.json")).tiles[0].v, "149", "home stats from v2 metrics");
  const an = J("public/strategy_decay_analysis.json");
  let err = null;
  try { Object.keys(an.archetypes).forEach(k => S(DECAY.renderArchetype(k, an.archetypes[k], an.horizon_analysis))); S(DECAY.renderMethodology(an.methodology)); S(DECAY.renderIntraday(J("public/strategy_decay_intraday.json"))); S(DECAY.renderIntraday({})); }
  catch (e) { err = e; }
  ok(!err, "decay renders all archetypes " + (err ? err.stack : ""));
  ok(/fixed 5-trading-day/.test(DECAY.asOfInfo(an).policy), "decay states the policy used");
  eq(DECAY.asOfInfo({ policy_id: "trail_2pct" }).policy, "trail_2pct", "explicit policy id used when published");
}

// ── 11. Worker refresh + poll ────────────────────────────────────────────
section("refresh: trigger, fallback, poll, timeout, cancel, cooldown");
{
  function harness(responses, dataSeq, opts = {}) {
    let clock = 1_000_000;
    const timers = [];
    const posts = [];
    const status = [];
    const got = [];
    const mem = {};
    const storage = opts.storage || { get: k => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = v; }, del: k => { delete mem[k]; } };
    let di = 0;
    const r = ITL.createRefresher(Object.assign({
      key: "t", workflows: ["live_check", "before_close"], dataPath: "/x.json", noTicker: true, storage,
      getBaseline: () => "2026-11-24T00:00:00Z",
      onData: d => got.push(d), onStatus: (t, s) => status.push([s, t]), setDisabled: () => {},
      now: () => clock,
      setTimeout: (f, ms) => { const h = { at: clock + ms, f }; timers.push(h); return h; },
      clearTimeout: h => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
      fetch: async (url, init) => { posts.push(init.body ? JSON.parse(init.body).workflow : null); const x = responses.shift(); return { ok: x.status < 400, status: x.status, json: async () => x.body }; },
      fetchJSON: async () => dataSeq[Math.min(di++, dataSeq.length - 1)],
    }, opts.extra || {}));
    async function advance(ms) {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift(); clock = t.at; t.f();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      clock = end;
    }
    return { r, posts, status, got, advance, storage, timers, get clock() { return clock; } };
  }
  const old = { generated_at_utc: "2026-11-24T00:00:00Z" }, fresh = { generated_at_utc: "2026-11-24T00:03:00Z" };

  let h = harness([{ status: 200, body: { status: "triggered" } }], [old, old, fresh]);
  let res = await h.r.start();
  eq(res.started, true, "triggered");
  eq(h.posts, ["live_check"], "POST body uses live_check");
  await h.advance(20000); eq(h.got.length, 0, "poll 1: same generated_at => keep waiting");
  await h.advance(20000); eq(h.got.length, 0, "poll 2: still old");
  await h.advance(20000); eq(h.got.length, 1, "poll 3: newer generated_at => onData");
  ok(/^Updated \d\d:\d\d AEST$/.test(h.status[h.status.length - 1][1]), "status says Updated HH:MM only after new data");
  eq(h.r.isRunning(), false, "stopped after update");
  ok(h.r.cooldownLeft() > 0, "cooldown set");
  eq((await h.r.start()).reason, "cooldown", "second click during cooldown refused");
  eq(typeof h.storage.get("itl_refresh_cooldown_t"), "number", "cooldown persisted (survives reload)");

  h = harness([{ status: 400, body: { status: "error", error: "unknown_workflow" } }, { status: 200, body: { status: "triggered" } }], [old]);
  res = await h.r.start();
  eq([res.started, h.posts], [true, ["live_check", "before_close"]], "unknown_workflow => falls back to before_close");

  h = harness([{ status: 400, body: { error: "unknown_workflow" } }, { status: 200, body: { status: "triggered" } }], [old], { extra: { workflows: ["intraday", null] } });
  await h.r.start();
  eq(h.posts, ["intraday", null], "intraday falls back to legacy no-body POST");

  h = harness([{ status: 429, body: { status: "rate_limited" } }], [old]);
  eq((await h.r.start()).reason, "rate_limited", "rate limited");
  h = harness([{ status: 500, body: {} }], [old]);
  eq((await h.r.start()).reason, "http", "HTTP error checked (resp.ok)");
  h = harness([{ status: 200, body: { status: "weird" } }], [old]);
  eq((await h.r.start()).reason, "unexpected", "unexpected reply");

  h = harness([{ status: 200, body: { status: "triggered" } }], [old]);
  await h.r.start();
  await h.advance(7 * 60000);
  ok(/Still running/.test(h.status[h.status.length - 1][1]), "timeout after ~6 min => 'Still running'");
  eq(h.got.length, 0, "no update on timeout");

  h = harness([{ status: 200, body: { status: "triggered" } }], [old, fresh]);
  await h.r.start();
  eq(h.r.cancel("stopped"), true, "cancel while polling");
  await h.advance(60000);
  eq(h.got.length, 0, "no onData after cancel (manual reload)");
  eq(h.timers.length, 0, "no timers left after cancel");

  h = harness([{ status: 200, body: { status: "triggered" } }], [old]);
  await h.r.start();
  const h3 = harness([], [fresh], { storage: h.storage });
  h3.r.restore();
  await h3.advance(20000);
  eq(h3.got.length, 1, "poll resumes after page reload (restore)");

  h = harness([], [old], { extra: { fixtures: true } });
  eq((await h.r.start()).reason, "fixtures", "fixtures mode never calls the worker");
  eq(h.posts, [], "no POST in fixtures mode");
}

section("fixtures / environment helpers");
{
  eq(ITL.fixturesMode("?fixtures=1"), "v2", "fixtures=1");
  eq(ITL.fixturesMode(""), null, "production");
  eq(ITL.resolvePath("/public/today.json", "?fixtures=1"), "/dev/fixtures/today.json", "fixture path");
  eq(ITL.resolvePath("/public/live.json", "?fixtures=1&set=preopen"), "/dev/fixtures/preopen/live.json", "fixture set override");
  eq(ITL.resolvePath("/public/today.json", "?fixtures=1&set=preopen"), "/dev/fixtures/today.json", "fixture set falls back to base");
  eq(ITL.resolvePath("/public/today.json", "?fixtures=1&set=../../x"), "/dev/fixtures/today.json", "unknown set ignored");
  eq(ITL.resolvePath("/public/today.json", ""), "/public/today.json", "production path");
  ok(Math.abs(ITL.now("?now=2026-01-01T00:00:00Z").getTime() - Date.now()) < 5000, "?now ignored outside fixtures mode");
  eq(ITL.now("?fixtures=1&now=2026-01-01T00:00:00Z").toISOString(), "2026-01-01T00:00:00.000Z", "?now honoured in fixtures mode");
  let calls = [];
  const fakeFetch = async (u) => { calls.push(u); return { ok: false, status: 404, text: async () => "" }; };
  let e = null; try { await ITL.fetchJSON("/public/x.json", { fetch: fakeFetch }); } catch (x) { e = x; }
  ok(e && e.kind === "missing" && /404/.test(e.message), "fetchJSON checks res.ok (404 => missing)");
  ok(/\?v=\d+/.test(calls[0]), "cache-buster appended");
  e = null; try { await ITL.fetchJSON("/p.json", { fetch: async () => ({ ok: true, status: 200, text: async () => "{bad" }) }); } catch (x) { e = x; }
  ok(e && e.kind === "parse", "invalid JSON => parse error");
}


// ── 12. Contract v2.1: exit plans, pre-close stream, fixed stake ─────────
section("v2.1 exit plans: wording, default marked, tolerant");
{
  const P = (plan, row) => ITL.exitPlanPhrase(plan, row || {});
  eq(P({ policy_id: "fixed_5d", kind: "time", days: 5, exit_by_date: "2026-11-30" }), "Sell at close of day 5 (by Mon 30 Nov)", "fixed with exit_by_date");
  eq(P({ policy_id: "fixed_5d", kind: "time", time_stop_days: 5 }), "Sell at close of day 5", "fixed without date (real v2 exit_plan shape: no 'days')");
  eq(P({ policy_id: "fixed_5d", exit_by_date: "bad" }), "Sell at close of day 5", "junk exit_by_date ignored");
  eq(P({ policy_id: "trail_2atr", kind: "trail_atr", atr_mult: 2, trail_atr_aud: 1.69 }, { entry_ref: 30.81 }), "Trail 2×ATR = A$1.69 below the highest price since entry", "ATR trail, 2dp stock");
  eq(P({ policy_id: "trail_2atr", kind: "trail_atr", atr_mult: 2, trail_atr_aud: 0.083, time_stop_days: 20 }, { entry_ref: 0.555 }), "Trail 2×ATR = A$0.083 below the highest price since entry (max 20 days)", "ATR trail, sub-A$2 stock uses 3dp");
  eq(P({ policy_id: "trail_2atr", kind: "trail_atr", trail_atr_mult: 2, trail_atr_aud: null }), "Trail 2×ATR below the highest price since entry", "ATR trail without A$ (real key trail_atr_mult)");
  eq(P({ policy_id: "trail_1pct", kind: "trail_pct", trail_pct: 1 }), "Trail 1% below the highest price since entry", "1% trail");
  eq(P({ trail_pct: 2, activate_after_r: 1 }), "Once up +1R, trail 2% below the highest price since entry", "after +1R, kind inferred");
  eq(P(null), "—", "missing plan => dash");
  eq(ITL.exitPlansOf({ exit_plans: "x", exit_plan: { policy_id: "fixed_5d" } }).length, 1, "non-list exit_plans falls back to exit_plan");
  eq(ITL.exitPlansOf({ exit_plans: [null, 3] }).length, 0, "junk entries dropped");
  eq([ITL.policyName("trail_2atr"), ITL.policyName("trail_2pct_after_1r"), ITL.policyName("fixed_3d"), ITL.policyName(null)], ["Trail 2×ATR", "Trail 2% after +1R", "Fixed 3 days", "—"], "policy names");
  const td = J("dev/fixtures/today.json");
  const card = S(TODAY.orderCard(td.recommended_orders[0], TODAY.normalizePrefs({}), { names: {}, edges: {}, defaultPolicy: "fixed_5d" }));
  eq((card.match(/<li /g) || []).length, 3, "recommended card lists all three exit plans");
  eq((card.match(/xp-def/g) || []).length, 1, "exactly one plan marked default");
  ok(/class="is-default"[^>]*><span class="xp-rule">Sell at close of day 5 \(by Mon 30 Nov\)/.test(card), "default (fixed_5d) marked and listed first");
  ok(/Trail 2×ATR = A\$0\.167 below the highest price since entry/.test(card) && /Trail 1% below the highest price since entry/.test(card), "trail plans worded");
  const nd = TODAY.normalizeData(td);
  const openAll = new Set(nd.setups.map(r => "Setups|" + r.symbol + "|" + r.strategy));
  const det = S(TODAY.renderSections(td, nd, TODAY.normalizePrefs({}), { names: {}, edges: {}, now: new Date(), validFor: td.valid_for, open: openAll }));
  ok((det.match(/Sell at close of day 5/g) || []).length >= nd.setups.length - 1, "row details show the exit plans too");
  ok(/Initial stop 43\.62\. Once up \+1R/.test(det) || /Once up \+1R, trail 2% below the highest price since entry/.test(det), "legacy single exit_plan row (WTC) still worded");
  ok(/not published/.test(S(ITL.exitPlansHtml({ symbol: "X" }))), "no exit plan => 'not published', no crash");
  const edge = J("dev/fixtures/edge/today.json"), en = TODAY.normalizeData(edge);
  const eo = S(TODAY.renderSections(edge, en, TODAY.normalizePrefs({}), { names: {}, edges: {}, now: new Date(), watchOpen: true, open: new Set(en.watch.map(r => "Full watchlist|" + r.symbol + "|" + r.strategy)) }));
  ok(!/NaN|undefined|\[object Object\]/.test(eo) && /Sell at close of day 5</.test(eo), "edge: exit plans without exit_by_date / A$ render cleanly");
}

section("v2.1 pre-close timing: trade-by in both DST offsets, countdown, banner window");
{
  const iso = (d) => d && d.toISOString();
  eq(iso(ITL.sydneyWallToDate("2026-11-24", "15:59")), "2026-11-24T04:59:00.000Z", "15:59 AEDT (summer) = 04:59Z");
  eq(iso(ITL.sydneyWallToDate("2026-06-10", "15:59")), "2026-06-10T05:59:00.000Z", "15:59 AEST (winter) = 05:59Z");
  eq(iso(ITL.sydneyWallToDate("2026-10-05", "15:59")), "2026-10-05T04:59:00.000Z", "first Monday after DST starts");
  eq(iso(ITL.sydneyWallToDate("2026-04-06", "15:59")), "2026-04-06T05:59:00.000Z", "first Monday after DST ends");
  eq(iso(ITL.sydneyWallToDate("2026-04-02", "15:59")), "2026-04-02T04:59:00.000Z", "last Thursday of DST");
  eq(ITL.sydneyWallToDate("2026-02-30", "15:59"), null, "invalid date => null");
  eq(ITL.sydneyWallToDate("2026-11-24", "25:00"), null, "invalid time => null");
  eq(ITL.tradeByText(ITL.sydneyWallToDate("2026-11-24", "15:59")), "15:59 Sydney (14:59 Brisbane)", "summer: Brisbane one hour behind");
  eq(ITL.tradeByText(ITL.sydneyWallToDate("2026-06-10", "15:59")), "15:59 Sydney (15:59 Brisbane)", "winter: same wall time");
  eq(ITL.tradeByText(null), "—", "no deadline => dash");
  const pc = J("dev/fixtures/preclose.json");
  eq(iso(ITL.precloseDeadline(pc)), "2026-11-24T04:59:00.000Z", "deadline from signal_session + trade_by_syd");
  eq(iso(ITL.precloseDeadline({ signal_session: "2026-12-24", trade_by_syd: "14:09" })), "2026-12-24T03:09:00.000Z", "early close (14:10) => trade by 14:09");
  eq(iso(ITL.precloseDeadline({ signal_session: "2026-06-10", market_state: { close_syd: "2026-06-10T16:00:00+10:00" } })), "2026-06-10T05:59:00.000Z", "fallback: market_state close - 1 min (winter)");
  eq(iso(ITL.precloseDeadline({ trade_by_utc: "2026-11-24T04:58:00Z", trade_by_syd: "15:59", signal_session: "2026-11-24" })), "2026-11-24T04:58:00.000Z", "explicit trade_by_utc wins");
  eq(ITL.precloseDeadline({ signal_session: "2026-11-24" }), null, "nothing to go on => null");
  const dl = ITL.precloseDeadline(pc);
  eq(ITL.countdown(dl, new Date("2026-11-24T04:30:00Z")).text, "29 min left", "countdown minutes");
  eq(ITL.countdown(dl, new Date("2026-11-24T04:54:55Z")).text, "4:05 left", "countdown m:ss under 10 min");
  eq(ITL.countdown(dl, new Date("2026-11-24T03:54:00Z")).text, "1 h 05 min left", "countdown hours");
  eq([ITL.countdown(dl, new Date("2026-11-24T05:00:00Z")).passed, ITL.countdown(dl, new Date("2026-11-24T05:00:00Z")).text], [true, "trade-by time passed"], "countdown passed");
  eq(ITL.countdown(null, new Date()).text, "—", "no deadline => dash");
  const w = (t, d) => ITL.precloseWindow(d || pc, new Date(t)).show;
  eq([w("2026-11-24T03:30:00Z"), w("2026-11-24T04:00:00Z"), w("2026-11-24T04:30:00Z"), w("2026-11-24T05:09:00Z"), w("2026-11-24T05:12:00Z")], [false, true, true, true, false], "banner window 15:00 Sydney .. end of closing auction (16:10)");
  eq(w("2026-11-24T04:30:00Z", J("dev/fixtures/pcstale/preclose.json")), false, "no banner for another session's file");
  const winter = { signal_session: "2026-06-10", trade_by_syd: "15:59", published: true, recommended_orders: [] };
  eq([w("2026-06-10T04:30:00Z", winter), w("2026-06-10T05:30:00Z", winter)], [false, true], "winter window: 15:30 AEST is 05:30Z");
  const b = S(ITL.precloseBanner(pc, new Date("2026-11-24T04:30:00Z")));
  ok(/Pre-close picks are out: 2 order\(s\) — LTR\.AX, BSL\.AX/.test(b) && /15:59 Sydney \(14:59 Brisbane\)/.test(b) && /29 min left/.test(b) && /href="\/preclose\/"/.test(b), "banner: orders, trade-by, countdown, link");
  ok(/no picks published today/.test(S(ITL.precloseBanner(J("dev/fixtures/pcunpub/preclose.json"), new Date("2026-11-24T04:30:00Z")))), "unpublished => info banner");
  eq(S(ITL.precloseBanner(pc, new Date("2026-11-24T00:00:00Z"))), "", "morning => no banner");
  eq(S(ITL.precloseBanner(null, new Date())), "", "missing preclose.json => no banner");
  const td = J("dev/fixtures/today.json");
  ok(/Pre-close picks are out/.test(TODAY.renderBanners(td, TODAY.normalizeData(td), new Date("2026-11-24T04:30:00Z"), pc).map(S).join("")), "Today shows the banner in the window");
  ok(!/Pre-close/.test(TODAY.renderBanners(td, TODAY.normalizeData(td), new Date("2026-11-24T00:00:00Z"), pc).map(S).join("")), "Today: no banner outside the window");
}

section("v2.1 pre-close page: published / stale / unpublished / passed / edge");
{
  const prefs = TODAY.normalizePrefs({});
  const render = (pc, now) => {
    const nd = PRE.normalize(pc);
    return PRE.renderBanners(pc, now).map(S).join("") + S(PRE.deadlineCard(pc, now, null)) + S(PRE.renderSections(pc, nd, prefs, { names: {}, edges: {}, now }));
  };
  const at = new Date("2026-11-24T04:30:00Z");
  const base = render(J("dev/fixtures/preclose.json"), at);
  ok(!/STALE|Not published|Trade-by time has passed/.test(base), "fresh, published, before trade-by: no warning banners");
  ok(/29 min left/.test(base) && /15:59 Sydney \(14:59 Brisbane\)/.test(base) && /15:15 Sydney \(14:15 Brisbane\)/.test(base), "deadline card: countdown, trade-by and price_as_of in both zones");
  ok(/MARKET @ CLOSE/.test(base) && /How to buy:<\/b> in the closing auction/.test(base) && /Entry ref \(live\)/.test(base), "MARKET_CLOSE orders explained");
  ok(/Pre-close orders/.test(base) && (base.match(/class="order"/g) || []).length === 2 && !/class="dimmed"/.test(base), "two order cards, not dimmed");
  ok(/Buy <b>20,000<\/b> sh/.test(base.replace(/\s+/g, " ")), "sizing uses the same formula as Today (LTR 100k/1%/25%)");
  ok((base.match(/Sell at close of day 5 \(by Tue 1 Dec\)/g) || []).length >= 2, "exit plans on pre-close cards");
  const stale = render(J("dev/fixtures/pcstale/preclose.json"), at);
  ok(/STALE: these pre-close picks were for Fri 20 Nov 2026/.test(stale) && /class="dimmed"/.test(stale) && /not today&#39;s session/.test(stale), "old session => STALE banner, dimmed, countdown says so");
  const un = render(J("dev/fixtures/pcunpub/preclose.json"), at);
  ok(/Not published/.test(un) && /live prices older than 20 min/.test(un) && /Withheld orders/.test(un) && /NOT published/.test(un) && /class="dimmed"/.test(un), "published=false => reason, withheld orders labelled, dimmed");
  ok(/No pre-close orders/.test(un), "no recommended orders when unpublished");
  const passed = render(J("dev/fixtures/preclose.json"), new Date("2026-11-24T05:20:00Z"));
  ok(/Trade-by time has passed/.test(passed) && /trade-by time passed/.test(passed) && /class="dimmed"/.test(passed), "after trade-by: closed state, dimmed");
  let err = null, eo = "";
  try { eo = render(J("dev/fixtures/edge/preclose.json"), at) + render({}, at); } catch (e) { err = e; }
  ok(!err, "edge / empty preclose renders without throwing " + (err ? err.stack : ""));
  ok(!/NaN|undefined|\[object Object\]/.test(eo) && !/<b>EVIL<\/b>|<img src=x/.test(eo) && /&lt;b&gt;EVIL/.test(eo), "edge: dashes, data escaped");
  ok(/Data format outdated/.test(render({ signal_session: "2026-11-24" }, at)), "no schema => outdated notice");
  ok(/No pre-close scan published yet/.test(S(PRE.emptyState({ kind: "missing" }))), "404 => friendly empty state, not an error");
  ok(/pill--bad/.test(S(PRE.jobPill(J("dev/fixtures/edge/status.json").jobs.preclose_scan, at))) && /pill--ok/.test(S(PRE.jobPill(J("dev/fixtures/status.json").jobs.preclose_scan, at))), "preclose_scan job pill ok / bad");
  ok(ITL.healthIssues(J("dev/fixtures/edge/status.json"), at).some(i => i.job === "preclose_scan"), "health banner includes a failing preclose_scan");
  eq(ITL.resolvePath("/public/preclose.json", "?fixtures=1&set=pcunpub"), "/dev/fixtures/pcunpub/preclose.json", "preclose fixture sets");
}

section("v2.1 live trails per policy");
{
  const lv = J("dev/fixtures/live.json");
  const out = S(LIVE.renderItems(lv.items, LIVE.liveCtx(lv, {})));
  eq((out.match(/class="trail /g) || []).length, 3, "three policy cells for the filled pick only");
  ok(/trail is-default"><div class="trail__head"><span class="trail__name">Fixed 5 days/.test(out), "default first and marked");
  ok(/sell at close Mon 30 Nov/.test(out) && /trail 184\.65 · peak 188\.42/.test(out) && /trail 186\.54/.test(out), "exit-by date and trail levels");
  ok(/badge--EXIT">EXIT/.test(out) && /per Fixed 5 days/.test(out) && /badge--HOLD" title/.test(out), "1% trail says EXIT while the main verdict (HOLD) follows the default");
  ok(/exit Mon 30 Nov/.test(out), "peak column shows the default exit date when the default has no trail");
  const edge = J("dev/fixtures/edge/live.json");
  let err = null, eo = "";
  try { eo = S(LIVE.renderItems(edge.items, LIVE.liveCtx(edge, {}))); } catch (e) { err = e; }
  ok(!err && !/NaN|undefined|\[object Object\]/.test(eo) && /Trail 9%/.test(eo) && /badge--NA">n\/a/.test(eo), "edge trails (partial / non-object / unknown policy) render");
}

section("v2.1 track record: fixed stake headline, matrix selection, n=0 stream");
{
  const m = J("dev/fixtures/metrics.json");
  let sel = TRACK.normalizeSel(m, null);
  eq(sel, { stream: "night", policy: "fixed_5d", all: false }, "default selection: night + default policy");
  eq(TRACK.normalizeSel(m, { stream: "bogus", policy: "trail_9pct", all: "x" }), sel, "corrupt saved selection ignored");
  const pressed = (h) => [...h.matchAll(/data-stream="([^"]+)" data-policy="([^"]+)" aria-pressed="true"/g)].map(x => x[1] + "/" + x[2]);
  let mx = S(TRACK.stakeMatrix(m, sel));
  eq(pressed(mx), ["night/fixed_5d"], "one cell pressed (the selection)");
  eq((mx.match(/<button type="button" class="mcell/g) || []).length, 9, "3 streams x 3 tracked policies");
  ok((mx.match(/collecting data since Wed 25 Nov 2026/g) || []).length === 3, "pre-close live n=0 => 'collecting data since 25 Nov 2026'");
  // fixture stake/streams are the REAL simulator blocks (dev/real_metrics_v21.json)
  const nb = m.stake.by.night.fixed_5d;
  let k = S(TRACK.stakeKpis(m, sel));
  ok(k.includes(">" + ITL.fmtInt(nb.n) + "<") && k.includes((nb.total_pnl_aud > 0 ? "+" : "") + ITL.fmtAud(nb.total_pnl_aud, 0)) && k.includes(ITL.fmtAud(nb.peak_capital_aud, 0)), "KPIs from stake.by.night.fixed_5d (n, total, peak capital)");
  ok(k.includes(ITL.fmtPct(nb.return_on_peak_capital, { fraction: true, sign: true })) && k.includes(ITL.fmtRate(nb.winrate)), "return on peak capital and win rate are fractions");
  ok(nb.n_open ? /open \(/.test(k) : true, "open positions disclosed beside the closed-trade total");
  sel = TRACK.normalizeSel(m, { stream: "preclose_proxy", policy: "trail_1pct", all: false });
  mx = S(TRACK.stakeMatrix(m, sel));
  eq(pressed(mx), ["preclose_proxy/trail_1pct"], "clicking a cell moves the selection");
  k = S(TRACK.stakeKpis(m, sel));
  ok(k.includes(">" + ITL.fmtInt(m.stake.by.preclose_proxy.trail_1pct.n) + "<") && k.includes(ITL.fmtAud(Math.abs(m.stake.by.preclose_proxy.trail_1pct.total_pnl_aud), 0)), "KPIs switch with the cell");
  eq(TRACK.stakeSeries(m.stake.by.preclose_proxy.trail_1pct).length, m.stake.by.preclose_proxy.trail_1pct.pnl_curve.length, "chart series from pnl_curve");
  const live0 = S(TRACK.stakeKpis(m, { stream: "preclose_live", policy: "fixed_5d", all: false }));
  ok(!/NaN|undefined/.test(live0) && /none yet/.test(live0) && !/A\$0\.00/.test(live0), "n=0 stream KPIs: dashes (no A$0 peak capital), no NaN");
  eq(TRACK.stakeSeries(m.stake.by.preclose_live.fixed_5d).length, 0, "n=0 => empty chart series");
  eq(TRACK.stakeSeries({ pnl_curve: null }).length, 0, "pnl_curve null (untracked policy) => empty series");
  const all = S(TRACK.stakeKpis(m, { stream: "night", policy: "fixed_5d", all: true }));
  ok(all.includes(">" + ITL.fmtInt(m.stake.all_setups.night.fixed_5d.n) + "<"), "all-setups toggle reads stake.all_setups (no .by level in the real shape)");
  ok(/every setup/.test(TRACK.stakeMethodText(m, { all: true })) && /no compounding/.test(TRACK.stakeMethodText(m, sel)), "method text explains the model");
  const real = J("dev/fixtures/real/metrics.json");
  const ci = TRACK.comparisonItems(real, { stream: "night", policy: "fixed_5d", all: false });
  const txt = (key) => (ci.find(i => i.key === key) || {}).text || "";
  ok(/^On the 143 signals both methods traded, buying at the signal day's close did worse than the next-day order by A\$154 per trade \(t = -3\.09, a consistent difference/.test(txt("paired")), "paired: worse by A$154/trade, t=-3.09: " + txt("paired"));
  ok(/missed 64 signals \(30%/.test(txt("per_signal")) && /better by A\$174 per signal seen \(t = 1\.97, marginal/.test(txt("per_signal")), "per signal seen: missed 64 (30%), better by A$174 (t=1.97, marginal)");
  ok(/gapped up overnight/.test(txt("missed")) && /\+A\$57,819/.test(txt("missed")), "why: missed signals gapped up; +A$57,819 bought at the close");
  ok(/Trail 2×ATR vs fixed 5 days \+A\$93\/trade/.test(txt("policies")), "tracked-policy pairwise within the stream");
  ok(/collecting data since Wed 25 Nov 2026/.test(txt("live")), "live archive n=0 => collecting data");
  const ca = TRACK.comparisonItems(real, { stream: "night", policy: "trail_1pct", all: true });
  ok(ca.some(i => i.key === "paired" && /345 signals/.test(i.text)), "all-setups toggle switches the comparison source");
  eq([TRACK.tWords(-3.09), TRACK.tWords(1.7), TRACK.tWords(0.4)].map(x => x.replace(/^t = [-\d.]+, /, "")), ["a consistent difference", "marginal", "could still be noise"], "t-stat wording");
  eq(TRACK.comparisonItems({}, { policy: "fixed_5d" }), [], "no comparison published => nothing (block says not published)");
  const realK = S(TRACK.stakeKpis(real, TRACK.normalizeSel(real, null)));
  ok(/\+A\$19,601/.test(realK) && /A\$200,000/.test(realK) && /\+9\.8%/.test(realK), "real file headline: +A$19,601, peak A$200,000, +9.8% on peak");
  // owner's funding model (margin block; fixture estimate until the simulator publishes it)
  const s0 = TRACK.normalizeSel(real, null);
  const mg = real.stake.by.night.fixed_5d.margin;
  const hero = S(TRACK.stakeHero(real, s0));
  ok(/Additive return \(your model\)/.test(hero) && hero.includes(ITL.fmtPct(mg.additive_pct_after_interest, { dp: 1, sign: true })) && hero.includes("before interest " + ITL.fmtPct(mg.additive_pct, { dp: 1, sign: true })) && hero.includes(ITL.fmtAud(mg.interest_aud, 0)), "hero: additive % after interest, before interest, interest A$");
  ok(hero.includes(ITL.fmtAud(mg.net_pnl_after_interest_aud, 0)) && /9% p\.a\./.test(hero), "hero: A$ P&L after interest beside it; margin rate stated");
  const rn = S(TRACK.riskNote(real, s0));
  ok(rn.includes("Peak borrowing would have been " + ITL.fmtPct(mg.peak_lvr, { fraction: true, dp: 0 }) + " of position value") && /above the ~70% most ASX margin lenders allow/.test(rn) && /margin-call territory/.test(rn) && /MARGIN CALL RISK/.test(rn), "risk note: daily peak LVR and drawdown flags stated factually");
  ok(mg.min_equity_aud === undefined || rn.includes("lowest equity " + ITL.fmtAud(mg.min_equity_aud, 0)), "drawdown shown with the lowest equity beside it");
  const allSel = { stream: "night", policy: "fixed_5d", all: true };
  const am = real.stake.all_setups.night.fixed_5d.margin;
  const ah = S(TRACK.stakeHero(real, allSel)) + S(TRACK.riskNote(real, allSel));
  ok(ah.includes(ITL.fmtPct(am.additive_pct_after_interest, { dp: 1, sign: true })) && (am.additive_pct_after_interest >= 0 || /hero-stat__v neg/.test(ah)), "all setups: negative additive return shown as negative");
  ok(am.min_equity_aud === undefined || am.min_equity_aud >= 0 || /equity went negative/.test(ah), "all setups: negative equity stated");
  const calm = JSON.parse(JSON.stringify(real));
  Object.assign(calm.stake.by.night.fixed_5d.margin, { lvr_warning: false, margin_call_risk: false, peak_lvr: 0.5, max_drawdown_pct_of_own_capital: -20 });
  const cn = S(TRACK.riskNote(calm, s0));
  ok(!/banner/.test(cn) && /50% of position value/.test(cn) && !/margin-call/.test(cn), "no flags => plain note, no warning banner");
  const mxr = S(TRACK.stakeMatrix(real, s0));
  ok(mxr.includes(ITL.fmtPct(mg.additive_pct_after_interest, { dp: 1, sign: true })) && /⚠/.test(mxr), "matrix shows additive % after interest and the warning mark");
  ok(/Peak LVR/.test(S(TRACK.marginKpis(real, s0))), "margin KPIs");
  const noM = JSON.parse(JSON.stringify(real));
  for (const st of Object.values(noM.stake.by)) for (const b of Object.values(st)) delete b.margin;
  const nh = S(TRACK.stakeHero(noM, s0)) + S(TRACK.riskNote(noM, s0)) + S(TRACK.marginKpis(noM, s0)) + S(TRACK.stakeMatrix(noM, s0));
  ok(/not published in this file yet/.test(nh) && /\+A\$19,601/.test(nh) && !/NaN|undefined/.test(nh), "older file without margin: A$ headline, no crash");
  const z = S(TRACK.stakeHero(real, { stream: "preclose_live", policy: "fixed_5d", all: false })) + S(TRACK.riskNote(real, { stream: "preclose_live", policy: "fixed_5d", all: false }));
  ok(!/NaN|undefined/.test(z) && /Additive return/.test(z), "n=0 stream with margin block: dashes");
  eq(TRACK.pctTick(50, 50), "+50%", "percent axis ticks");
  eq(TRACK.stakeBy(J("dev/fixtures/edge/metrics.json"), false), null, "metrics without stake => null (page says 'not published yet')");
  const partial = { stake: { stake_aud: 25000, by: { night: { fixed_5d: { n: 3 } } } } };
  const pm = S(TRACK.stakeMatrix(partial, TRACK.normalizeSel(partial, null))) + S(TRACK.stakeKpis(partial, TRACK.normalizeSel(partial, null)));
  ok(!/NaN|undefined|\[object Object\]/.test(pm) && /not published/.test(pm), "partial stake block renders dashes");
}

section("v2.2 fund_v2 next to the current fundamentals score (evaluation only)");
{
  const full = { symbol: "STO.AX", fund_score: 45, fund_label: "ROE=4.7% NM=14.7%", fund_v2: 62.4,
    fund_v2_pillars: { valuation: 71.2, cash: 58, quality: 66.4, balance: 40, growth: null },
    fund_v2_label: "vs Energy: cheap (growth n/a)", fund_v2_coverage: 0.8, sector: "Energy" };
  const h = S(TODAY.fundamentalsHtml(full));
  ok(h.includes("Fundamentals: 45 (current) \u00b7 ") && h.includes("v2: 62 \u2014 valuation 71, cash 58, quality 66, balance 40, growth \u2014"),
    "current + v2 + pillars, null pillar shown as a dash");
  ok(h.includes('title="v2 is being evaluated; it does not affect rankings yet"') && /sr-only/.test(h), "tooltip (and screen-reader text) says v2 does not rank");
  ok(h.includes("current: ROE=4.7% NM=14.7%") && h.includes("v2 vs Energy: cheap (growth n/a)"), "both labels shown");
  eq(TODAY.fundV2Text({ fund_v2: null, fund_v2_pillars: { valuation: null, cash: null, quality: null, balance: null, growth: null } }),
    "v2: \u2014 \u2014 valuation \u2014, cash \u2014, quality \u2014, balance \u2014, growth \u2014", "all-null pillars / null fund_v2");
  const etf = S(TODAY.fundamentalsHtml({ fund_score: 26, fund_label: "ETF | BS=6/20 Mkt=0/20", fund_v2: null,
    fund_v2_pillars: null, fund_v2_label: "not applicable (ETF/fund)", fund_v2_coverage: 0 }));
  ok(etf.includes("v2: \u2014 \u2014 valuation \u2014") && etf.includes("not applicable (ETF/fund)"), "ETF: v2 n/a, missing pillars object tolerated");
  const noV1 = S(TODAY.fundamentalsHtml({ fund_score: null, fund_label: null, fund_v2: 50, fund_v2_pillars: { valuation: 50 } }));
  ok(noV1.includes("Fundamentals: \u2014 (current)") && noV1.includes("valuation 50, cash \u2014") && !noV1.includes("current:"), "no current score: dash; absent pillar keys = dash");
  eq(S(TODAY.fundamentalsHtml({ fund_score: 45, fund_label: "ROE=1%" })), "Fundamentals 45/100: ROE=1%", "pre-v2.2 row: unchanged old line");
  eq(S(TODAY.fundamentalsHtml({ fund_score: null })), "", "no fundamentals at all: nothing");
  ok(!TODAY.hasFundV2({ fund_score: 1 }) && TODAY.hasFundV2({ fund_v2: null }), "hasFundV2 keys off the field, not its value");
  const xss = S(TODAY.fundamentalsHtml({ fund_score: 1, fund_v2: 2, fund_v2_label: "<img src=x onerror=1>", fund_v2_pillars: {} }));
  ok(!xss.includes("<img") && xss.includes("&lt;img"), "fund_v2_label escaped");
  // through the Today order cards / detail rows and the Pre-close page
  const addV2 = (r, i) => Object.assign({}, r, { fund_v2: 40 + i, fund_v2_pillars: { valuation: 70, cash: null, quality: 60, balance: 50, growth: i % 2 ? null : 30 },
    fund_v2_label: "vs peers: cheap", fund_v2_coverage: 0.8, sector: "Energy" });
  const td = pre22(J("dev/fixtures/today.json"));
  const td2 = Object.assign({}, td, { recommended_orders: (td.recommended_orders || []).map(addV2), setups: (td.setups || []).map(addV2), watchlist_full: (td.watchlist_full || []).map(addV2) });
  const nd2 = TODAY.normalizeData(td2);
  const keyOpen = "Setups|" + nd2.setups[0].symbol + "|" + nd2.setups[0].strategy;
  const page = S(TODAY.renderSections(td2, nd2, TODAY.normalizePrefs({}), { names: {}, edges: {}, now: new Date("2026-11-24T00:00:00Z"), validFor: td2.valid_for, open: new Set([keyOpen]) }));
  ok((page.match(/class="order"[\s\S]*?fund-line/g) || []).length >= 2 && /\(current\) \u00b7 <span class="fund-v2"/.test(page), "Today order cards show current + v2");
  ok((page.match(/<p class="small fund-line"/g) || []).length >= nd2.setups.length, "Today setup detail rows show current + v2");
  ok(!/NaN|undefined|\[object Object\]/.test(page), "Today with fund_v2: no NaN/undefined");
  const old = S(TODAY.renderSections(td, TODAY.normalizeData(td), TODAY.normalizePrefs({}), { names: {}, edges: {}, now: new Date("2026-11-24T00:00:00Z"), validFor: td.valid_for }));
  ok(!/fund-v2/.test(old), "Today without fund_v2 (pre-v2.2 file): no v2 text");
  const pc = pre22(J("dev/fixtures/preclose.json"));
  const pc2 = Object.assign({}, pc, { recommended_orders: (pc.recommended_orders || []).map(addV2), setups: (pc.setups || []).map(addV2) });
  const pnd = PRE.normalize(pc2);
  const ppage = S(PRE.renderSections(pc2, pnd, TODAY.normalizePrefs({}), { names: {}, edges: {}, now: new Date("2026-11-24T04:30:00Z") }));
  ok(/v2: 40 \u2014 valuation 70, cash \u2014, quality 60, balance 50, growth 30/.test(ppage) && ppage.includes("does not affect rankings yet"), "Pre-close cards show v2 with null pillars as dashes");
  ok(!/NaN|undefined|\[object Object\]/.test(ppage), "Pre-close with fund_v2: no NaN/undefined");
}

section("v2.3 ranking option1: version, fundamentals filter badge, tiebreak note, variants table");
{
  // fragments
  const ex = { symbol: "AMP.AX", fund_v2: 22, fund_filter: { eligible: false, reason: "fundamentals bottom 20% (v2 = 22.0, cutoff 38.22)", cutoff: 38.22 } };
  const exb = S(TODAY.filterBadge(ex, true));
  ok(exb.includes("excluded: fundamentals bottom 20%") && exb.includes('title="fundamentals bottom 20% (v2 = 22.0, cutoff 38.22) — not eligible for a recommended order"') && /chip--excluded/.test(exb), "excluded badge: muted, full reason in tooltip");
  ok(S(TODAY.filterBadge(ex, false)).includes("sr-only"), "excluded badge in details also has screen-reader reason");
  eq(S(TODAY.filterBadge({ fund_filter: { eligible: true, reason: null, cutoff: 38 } }, false)), "", "eligible row without reason: no badge");
  const nd0 = S(TODAY.filterBadge({ fund_filter: { eligible: true, reason: "fundamentals: no data", cutoff: 38 } }, false));
  ok(nd0.includes("fundamentals: no data") && S(TODAY.filterBadge({ fund_filter: { eligible: true, reason: "fundamentals: no data" } }, true)) === "", "no-data note in details only");
  eq(S(TODAY.filterBadge({ symbol: "X" }, false)), "", "older row (no fund_filter): nothing");
  ok(TODAY.isExcluded(ex) && !TODAY.isExcluded({}) && !TODAY.isExcluded({ fund_filter: { eligible: true } }), "isExcluded only on eligible=false");
  ok(S(TODAY.filterBadge({ fund_filter: { eligible: false, reason: "fundamentals bottom 15% (v2 = 9.0, cutoff 12.00)" } }, true)).includes("bottom 15%"), "badge follows the configured percentage");
  const tb = S(TODAY.tiebreakNoteHtml({ tiebreak_note: "tiebreak: growth 81 vs 22 for <b>WTC.AX</b>" }));
  ok(tb.includes("Tiebreak decided this order:") && tb.includes("&lt;b&gt;WTC.AX") && !tb.includes("<b>WTC"), "tiebreak note shown, escaped");
  eq(S(TODAY.tiebreakNoteHtml({ tiebreak_note: null })), "", "no tiebreak note: nothing");
  const pills = S(TODAY.rankingPills({ ranking_version: "option1_v1", ranking: { weights: { ta: 0.55, fund_v2: 0.25, sentiment: 0.2 }, fund_filter: { bottom_pct: 20 }, tiebreak: { window_points: 3 } }, ranking_degraded: { degraded: false } }));
  ok(pills.includes("Ranking <b>option1_v1</b>") && pills.includes("TA 55% · fundamentals v2 25% · sentiment 20%; bottom 20% fundamentals excluded") && !pills.includes("DEGRADED"), "ranking version pill with weights tooltip");
  const dpill = S(TODAY.rankingPills({ ranking_version: "option1_v1", ranking_degraded: { degraded: true, reason: "fund_v2 coverage 12% < 50%" } }));
  ok(dpill.includes("DEGRADED") && dpill.includes("fund_v2 coverage 12% &lt; 50%"), "degraded pill with reason");
  eq(S(TODAY.rankingPills({})), "", "older file: no ranking pill");
  ok(TODAY.rankingBanner({ ranking_degraded: { degraded: false } }) === null && TODAY.rankingBanner({}) === null, "no degraded banner normally");
  const bn = S(TODAY.rankingBanner({ ranking_degraded: { degraded: true, reason: "fund_v2 coverage 0% < 50% (0/117 scanned symbols scored)" } }));
  ok(bn.includes("Ranking degraded: fundamentals not used") && bn.includes("TA and sentiment only"), "degraded banner");
  const f23 = S(TODAY.fundamentalsHtml({ fund_score: 45, fund_label: "ROE=4.7%", fund_v2: 62.4, fund_v2_percentile: 73.1,
    fund_v2_pillars: { valuation: 71, cash: 58, quality: 66, balance: 40, growth: null }, fund_v2_label: "vs Energy: cheap", fund_filter: { eligible: true, reason: null } }));
  ok(f23.includes("v2: 62 — valuation 71") && f23.includes("percentile 73") && f23.includes("25% of the composite") && f23.includes("v1 (info only): 45 — ROE=4.7%"), "v2.3 fundamentals line: v2 ranks, v1 info only");
  ok(f23.includes(TODAY.FUND_V2_RANK_TIP) && !f23.includes("does not affect rankings yet"), "v2.3 tooltip says v2 ranks");
  ok(S(TODAY.fundamentalsHtml({ fund_score: 45, fund_v2: 50, fund_v2_pillars: {} })).includes("does not affect rankings yet"), "v2.2 row keeps the evaluation-only line");
  // Today page with the default (v2.3) fixture
  const td = J("dev/fixtures/today.json");
  const nd = TODAY.normalizeData(td);
  const ctx = { names: {}, edges: {}, now: new Date("2026-11-23T10:00:00Z"), validFor: td.valid_for };
  const page = S(TODAY.renderSections(td, nd, TODAY.normalizePrefs({}), ctx));
  ok(/BEN\.AX[\s\S]*?excluded: fundamentals bottom 20%/.test(page), "Today: excluded setup flagged in the compact row");
  ok((page.match(/excluded: fundamentals bottom 20%/g) || []).length >= 2, "Today: badge in row + details");
  ok(!/NaN|undefined|\[object Object\]/.test(page), "Today v2.3: no NaN/undefined");
  const meta = S(TODAY.renderMeta(td, nd, new Date("2026-11-23T10:00:00Z")));
  ok(meta.includes("Ranking <b>option1_v1</b>"), "Today meta: ranking version");
  // pick order kept for ranked files (default sort), TA sort for older files
  const swapped = Object.assign({}, td, { recommended_orders: [Object.assign({}, td.recommended_orders[1], { score: 10 }), td.recommended_orders[0]] });
  const pg2 = S(TODAY.renderOrders(TODAY.applyFilters(TODAY.normalizeData(swapped).rec, Object.assign({}, TODAY.normalizePrefs({}), { sort: "published" })), TODAY.normalizePrefs({}), ctx));
  const s2 = S(TODAY.renderSections(swapped, TODAY.normalizeData(swapped), TODAY.normalizePrefs({}), ctx));
  ok(s2.indexOf(swapped.recommended_orders[0].symbol + "</span>") < s2.indexOf(swapped.recommended_orders[1].symbol + "</span>") && pg2.length > 0, "Today: recommended orders keep the engine's pick order");
  const old = pre23(swapped);
  const s3 = S(TODAY.renderSections(old, TODAY.normalizeData(old), TODAY.normalizePrefs({}), ctx));
  ok(s3.indexOf(old.recommended_orders[1].symbol + "</span>") < s3.indexOf(old.recommended_orders[0].symbol + "</span>"), "older file: recommended orders by TA score as before");
  ok(!/excluded: fundamentals|Ranking <b>/.test(s3 + S(TODAY.renderMeta(old, TODAY.normalizeData(old), new Date()))), "older file: no ranking UI");
  // degraded run through the Today banners
  const deg = Object.assign({}, td, { ranking_degraded: { degraded: true, reason: "fund_v2 coverage 0% < 50%" } });
  ok(S(TODAY.renderBanners(deg, TODAY.normalizeData(deg), new Date("2026-11-23T10:00:00Z"))).includes("Ranking degraded"), "Today: degraded banner");
  // real v2.3 night scan output (20 Nov 2026 evening, full universe)
  const rt = J("dev/fixtures/real/today.json");
  const rnd = TODAY.normalizeData(rt);
  eq(rnd.rec.map(r => r.symbol), ["PME.AX", "ANZ.AX"], "real today: option1 picks");
  const rpage = S(TODAY.renderSections(rt, rnd, TODAY.normalizePrefs({}), Object.assign({}, ctx, { validFor: rt.valid_for })));
  ok(/AMP\.AX[\s\S]*?excluded: fundamentals bottom 20%/.test(rpage) && !/NaN|undefined|\[object Object\]/.test(rpage), "real today: AMP.AX excluded, clean render");
  ok(S(TODAY.orderCard(rnd.rec[0], TODAY.normalizePrefs({}), ctx)).includes("25% of the composite"), "real today: order card fundamentals line");
  // Pre-close (shares the renderers)
  const pc = J("dev/fixtures/preclose.json");
  const pnd = PRE.normalize(pc);
  const ppage = S(PRE.renderSections(pc, pnd, TODAY.normalizePrefs({}), { names: {}, edges: {}, now: new Date("2026-11-24T04:30:00Z") }));
  ok(ppage.includes("Tiebreak decided this order:") && ppage.includes("tiebreak: growth 81 vs 22 for WTC.AX"), "Pre-close: tiebreak note on the order that it decided");
  ok(ppage.includes("excluded: fundamentals bottom 20%") && !/NaN|undefined|\[object Object\]/.test(ppage), "Pre-close: excluded setup flagged, clean render");
  ok(S(PRE.deadlineCard(pc, new Date("2026-11-24T04:30:00Z"), null)).includes("Ranking <b>option1_v1</b>"), "Pre-close: ranking version pill");
  const pdeg = Object.assign({}, pc, { ranking_degraded: { degraded: true, reason: "no fund_v2 population" } });
  ok(PRE.renderBanners(pdeg, new Date("2026-11-24T04:30:00Z")).map(S).join("").includes("Ranking degraded"), "Pre-close: degraded banner");
  // Track record: ranking variants table
  const real = J("dev/fixtures/real/metrics.json");
  const rv = S(TRACK.rankingVariantsBlock(real));
  ["Option 1 (production)", "Legacy (v1 fund 25%)", "v2 fund 25%, no filter", "TA only", "TA + sentiment"].forEach(l => ok(rv.includes(l), "variants table lists " + l));
  ok(rv.includes("Night (next-day order)") && rv.includes("Pre-close (historical estimate)"), "variants: night and pre-close columns");
  ok(rv.includes("Backtest") && rv.includes("Live: collecting since Wed 25 Nov 2026") && rv.includes("n = 0 so far"), "variants: backtest table + live empty state");
  const bt = real.ranking_variants.periods.backtest.by;
  const o1 = bt.OPTION1.night.fixed_5d.total_pnl_aud;
  ok(rv.includes((o1 > 0 ? "+" : "") + ITL.fmtAud(o1, 0)), "variants: OPTION1 total A$ shown");
  ok(/vs Opt 1: [+-]?A\$[\d,]+\/session \(t -?\d/.test(rv) && rv.includes("reference"), "variants: paired vs OPTION1 with t");
  ok(rv.includes("after interest") && !/NaN|undefined|\[object Object\]/.test(rv), "variants: additive % after interest, clean");
  const live = JSON.parse(JSON.stringify(real));
  live.ranking_variants.periods.live = JSON.parse(JSON.stringify(live.ranking_variants.periods.backtest));
  const rvl = S(TRACK.rankingVariantsBlock(live));
  ok(!rvl.includes("collecting since") && (rvl.match(/<table class="rv stack"/g) || []).length === 2, "variants: live table when live n > 0");
  const zero = JSON.parse(JSON.stringify(live));
  zero.ranking_variants.periods.live.by.TA_ONLY.night.fixed_5d = { n: 0, n_picks: 0, total_pnl_aud: 0 };
  ok(S(TRACK.rankingVariantsBlock(zero)).includes("no trades yet"), "variants: n=0 cell in live");
  ok(S(TRACK.rankingVariantsBlock({})).includes("Not published yet"), "variants: block missing");
  ok(S(TRACK.rankingVariantsBlock({ ranking_variants: { error: "ValueError: <x>" } })).includes("ValueError: &lt;x&gt;"), "variants: soft error shown, escaped");
}

section("current production files still render (no v2.1 fields yet)");
{
  const now = new Date();
  let err = null, out = "";
  try {
    const td = J("public/today.json"), nd = TODAY.normalizeData(td);
    out += S(TODAY.renderSections(td, nd, TODAY.normalizePrefs({}), { names: {}, edges: {}, now, validFor: td.valid_for, defaultPolicy: TODAY.defaultPolicyId(td) }));
    const lv = J("public/live.json");
    out += S(LIVE.renderItems(lv.items || [], LIVE.liveCtx(lv, {})));
    const m = J("track-record/metrics.json");
    out += S(TRACK.stakeMatrix(m, TRACK.normalizeSel(m, null))) + S(TRACK.policyTable(m));
  } catch (e) { err = e; }
  ok(!err && !/NaN|\bundefined\b|\[object Object\]/.test(out), "production today/live/metrics render " + (err ? err.stack : ""));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
