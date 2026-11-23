// Unit tests for the site's shared module and page logic (no browser needed).
//   node dev/test_site.mjs
// Loads assets/itl.js and assets/pages/*.js as CommonJS (they are UMD) and
// renders against dev/fixtures/*.json and the current public/ (v1) files.
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
const J = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) { if (cond) pass++; else { fail++; failures.push(name); } }
function eq(a, b, name) { const s = JSON.stringify(a) === JSON.stringify(b); if (!s) name += ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`; ok(s, name); }
function section(n) { console.log("\u2022 " + n); }
const S = (safe) => String(safe); // SafeHtml -> string

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
  ok(/class="order"/.test(closed) && /Exit plan:<\/b> Initial stop/.test(closed), "recommended cards stay fully expanded");
  const now = new Date("2026-11-24T00:00:00Z");
  for (const [name, data] of [["v2", td], ["edge", J("dev/fixtures/edge/today.json")], ["v1", J("public/today.json")], ["empty", {}]]) {
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
  const v1 = J("public/intraday.json");
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
  const lv = S(TRACK.legacyView(J("track-record/metrics.json")));
  ok(/Legacy proxy/.test(lv) && !/NaN|undefined/.test(lv), "v1 metrics legacy view");
  eq(Math.round(TRACK.maxDrawdown(pts([["2026-01-01", 100], ["2026-01-02", 120], ["2026-01-03", 90]])) * 100), -25, "max drawdown");
}

// ── 10. Home / decay ──────────────────────────────────────────────────────
section("home + decay");
{
  const pe = J("dev/fixtures/pending_exits.json");
  ok(/need action/.test(S(HOME.pendingExitsBanner(pe, new Date("2026-11-24T00:00:00Z")))), "pending exits banner");
  ok(/old/.test(S(HOME.pendingExitsBanner(J("dev/fixtures/edge/pending_exits.json"), new Date("2026-11-24T00:00:00Z")))), "old pending exits labelled old");
  eq(S(HOME.pendingExitsBanner(J("public/pending_exits.json"), new Date())), "", "empty pending exits => no banner");
  eq(HOME.statsTiles(J("track-record/metrics.json")), null, "home shows no stats from v1 metrics (no invented numbers)");
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
