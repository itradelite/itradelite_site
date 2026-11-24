/* iTradeLite shared site module (plain script, no build step).
 *
 * Loaded on every page as <script src="/assets/itl.js"></script>; exposes
 * window.ITL. Also loadable from Node (module.exports) so dev/test_site.mjs
 * can unit-test the pure helpers without a browser.
 *
 * Rules this module enforces for every page:
 *  - All data interpolated into HTML goes through html`` (auto-escaping
 *    tagged template) and is written with ITL.setHtml(), which refuses
 *    anything that is not a SafeHtml produced by html``.
 *  - Times are DISPLAYED in Brisbane time. Market phase comes from the
 *    JSON's market_state; the browser never recomputes market hours. The
 *    only calendar maths done here is "what is today's date in Sydney",
 *    via Intl.DateTimeFormat(...).formatToParts — never by re-parsing a
 *    toLocaleString() output (that was the old en-AU dd/mm vs mm/dd bug).
 *  - Fetches are no-store + cache-busted and check res.ok.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ITL = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TZ_BNE = "Australia/Brisbane";
  const TZ_SYD = "Australia/Sydney";
  const WORKER_URL = "https://itradelite-intraday-refresh.itradelite-refresh-worker.workers.dev";
  const DASH = "—";

  // ── Escaping ────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/`/g, "&#96;");
  }

  function SafeHtml(s) { this.__html = String(s); }
  SafeHtml.prototype.toString = function () { return this.__html; };

  function interp(v) {
    if (v === null || v === undefined || v === false) return "";
    if (v instanceof SafeHtml) return v.__html;
    if (Array.isArray(v)) return v.map(interp).join("");
    return escapeHtml(v);
  }

  /** Auto-escaping tagged template: every ${value} is escaped unless it is
   *  itself a SafeHtml (from a nested html``) or an array of those. */
  function html(strings) {
    let out = strings[0];
    for (let i = 1; i < strings.length; i++) out += interp(arguments[i]) + strings[i];
    return new SafeHtml(out);
  }

  /** Join SafeHtml fragments with a (literal, trusted) separator. */
  function join(parts, sep) {
    return new SafeHtml((parts || []).map(interp).join(sep === undefined ? "" : escapeHtml(sep)));
  }

  function setHtml(el, safe) {
    if (!el) return;
    if (!(safe instanceof SafeHtml)) throw new Error("setHtml requires html`` output");
    el.innerHTML = safe.__html;
  }

  // ── Numbers ─────────────────────────────────────────────────────────────
  function num(x) {
    if (x === null || x === undefined || x === "" || typeof x === "boolean") return null;
    const n = typeof x === "number" ? x : Number(String(x).trim());
    return Number.isFinite(n) ? n : null;
  }

  function priceDecimals(x, row) {
    const pd = row ? row.price_decimals : undefined;
    if (Number.isInteger(pd) && pd >= 0 && pd <= 6) return pd;
    const v = num(x);
    return v !== null && Math.abs(v) < 2 ? 3 : 2;
  }

  function groupInt(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fixed(n, dp) {
    // toFixed + thousands separators, locale-independent (deterministic tests)
    const neg = n < 0;
    const s = Math.abs(n).toFixed(dp);
    const [i, f] = s.split(".");
    return (neg && Number(s) !== 0 ? "-" : "") + groupInt(i) + (f ? "." + f : "");
  }

  function fmtPrice(x, row) {
    const v = num(x);
    if (v === null) return DASH;
    return fixed(v, priceDecimals(v, row));
  }

  function fmtNum(x, dp) {
    const v = num(x);
    if (v === null) return DASH;
    return fixed(v, dp === undefined ? 2 : dp);
  }

  function fmtInt(x) {
    const v = num(x);
    if (v === null) return DASH;
    return fixed(Math.round(v), 0);
  }

  function fmtAud(x, dp) {
    const v = num(x);
    if (v === null) return DASH;
    const d = dp === undefined ? (Math.abs(v) >= 1000 ? 0 : 2) : dp;
    return (v < 0 ? "-" : "") + "A$" + fixed(Math.abs(v), d);
  }

  /** Percent formatter. opts.fraction=true means x is a fraction (0.05 = 5%).
   *  opts.sign adds a leading + for positives. */
  function fmtPct(x, opts) {
    const o = opts || {};
    let v = num(x);
    if (v === null) return DASH;
    if (o.fraction) v *= 100;
    const dp = o.dp === undefined ? 1 : o.dp;
    return (o.sign && v > 0 ? "+" : "") + fixed(v, dp) + "%";
  }

  /** Win rates may be published as a fraction (0.56) or percent (56). A
   *  win rate can never exceed 1 as a fraction, so >1 means percent units. */
  function fmtRate(x, dp) {
    const v = num(x);
    if (v === null) return DASH;
    return fmtPct(v > 1 ? v : v * 100, { dp: dp === undefined ? 0 : dp });
  }

  function fmtR(x, dp) {
    const v = num(x);
    if (v === null) return DASH;
    return (v > 0 ? "+" : "") + fixed(v, dp === undefined ? 2 : dp) + "R";
  }

  /** Parse a user-typed money amount. Accepts "100000", "A$100,000",
   *  "100k", "1.2m", "1e6", "250 000". Returns {ok, value} or {ok:false, error}.
   *  Never clamps silently: out-of-range input is rejected with a message. */
  function readMoneyLike(s, opts) {
    const o = opts || {};
    const min = o.min === undefined ? 100 : o.min;
    const max = o.max === undefined ? 1e9 : o.max;
    let t = String(s === null || s === undefined ? "" : s).trim().toLowerCase();
    if (!t) return { ok: false, error: "Enter an amount, e.g. 100000 or 100k" };
    t = t.replace(/^a\$|^\$|^aud\s*/, "").replace(/[,\s_]/g, "");
    const m = t.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)([km]|mn|bn|b)?$/);
    if (!m) return { ok: false, error: "Not a number: “" + String(s).trim() + "” (try 100000, 100k or 1.2m)" };
    let v = Number(m[1]);
    const suf = m[2];
    if (suf === "k") v *= 1e3;
    else if (suf === "m" || suf === "mn") v *= 1e6;
    else if (suf === "b" || suf === "bn") v *= 1e9;
    if (!Number.isFinite(v)) return { ok: false, error: "Not a finite number" };
    if (v < min) return { ok: false, error: "Too small: minimum is " + fmtAud(min, 0) };
    if (v > max) return { ok: false, error: "Too large: maximum is " + fmtAud(max, 0) };
    return { ok: true, value: Math.round(v * 100) / 100 };
  }

  /** Position sizing — the only "trading" maths in the browser.
   *  qty = min( floor(risk_budget / |entry-stop|),
   *             floor(portfolio * maxPos% / entry),
   *             floor(portfolio / entry) ) */
  function computeSize(p) {
    const entry = num(p.entry);
    const stop = num(p.stop);
    const portfolio = num(p.portfolio);
    const riskPct = num(p.riskPct);
    const maxPosPct = num(p.maxPosPct);
    if (entry === null || !(entry > 0)) return { ok: false, reason: "no_entry", message: "No entry price published (entry_ref missing or 0), so no size can be computed." };
    if (stop === null || !(stop > 0)) return { ok: false, reason: "no_stop", message: "No stop published, so risk per share is unknown." };
    if (!(portfolio > 0) || !(riskPct > 0) || !(maxPosPct > 0)) return { ok: false, reason: "bad_inputs", message: "Check Portfolio / Risk % / Max position % inputs." };
    const rps = Math.abs(entry - stop);
    if (!(rps > 0)) return { ok: false, reason: "zero_risk", message: "Entry equals stop: risk per share is zero." };
    if (!(entry > stop)) return { ok: false, reason: "stop_not_below_entry", message: "Stop is above the entry: not a valid long setup, no size." };
    const EPS = 1e-9;
    const riskBudget = portfolio * riskPct / 100;
    const riskQty = Math.floor(riskBudget / rps + EPS);
    const posQty = Math.floor(portfolio * maxPosPct / 100 / entry + EPS);
    const cashQty = Math.floor(portfolio / entry + EPS);
    const qty = Math.max(0, Math.min(riskQty, posQty, cashQty));
    let binding = "risk";
    if (qty < riskQty) binding = qty === posQty ? "max_position" : "cash";
    const capped = qty < riskQty;
    return {
      ok: true, qty, riskQty, posQty, cashQty, capped, binding,
      riskPerShare: rps, riskBudget,
      actualRisk: Math.round(qty * rps * 100) / 100, notional: Math.round(qty * entry * 100) / 100, entry, stop,
      message: qty === 0 ? "Position rounds to 0 shares at these inputs." : "",
    };
  }

  function sizeTooltip(s, row) {
    if (!s || !s.ok) return s ? s.message : "";
    const lines = [
      "Risk budget " + fmtAud(s.riskBudget) + " / risk per share " + fmtPrice(s.riskPerShare, { price_decimals: 4 }) + " = " + fmtInt(s.riskQty) + " sh",
      "Max position cap = " + fmtInt(s.posQty) + " sh; cash cap = " + fmtInt(s.cashQty) + " sh",
    ];
    if (s.capped) {
      lines.push("CAPPED by " + (s.binding === "max_position" ? "Max position %" : "portfolio cash") +
        ": " + fmtInt(s.qty) + " x " + fmtPrice(s.entry, row) + " = " + fmtAud(s.notional) +
        "; actual risk " + fmtAud(s.actualRisk) + " (below your Risk %)");
    } else {
      lines.push("Notional " + fmtAud(s.notional) + ", risk " + fmtAud(s.actualRisk));
    }
    return lines.join("\n");
  }

  // ── Time ────────────────────────────────────────────────────────────────
  /** Parse an ISO timestamp (with offset or Z). Also accepts the v1 style
   *  "2026-11-21 04:00:06 AEST" / "... AEDT". Returns Date or null. */
  function parseIso(s) {
    if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
    if (s === null || s === undefined || s === "") return null;
    const str = String(s).trim();
    const legacy = str.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(AEST|AEDT)$/i);
    if (legacy) {
      const off = legacy[3].toUpperCase() === "AEDT" ? "+11:00" : "+10:00";
      const t = legacy[2].length === 5 ? legacy[2] + ":00" : legacy[2];
      return parseIso(legacy[1] + "T" + t + off);
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) return null;
    // No offset given -> treat as UTC (the contract always sends one).
    const withTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(str) ? str : str + "Z";
    const d = new Date(withTz);
    return isNaN(d.getTime()) ? null : d;
  }

  const _dtfCache = {};
  function _dtf(tz) {
    if (!_dtfCache[tz]) {
      _dtfCache[tz] = new Intl.DateTimeFormat("en-AU", {
        timeZone: tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
      });
    }
    return _dtfCache[tz];
  }

  /** Wall-clock parts of `date` in `tz`, from formatToParts (never from
   *  re-parsing a locale string). */
  function zonedParts(date, tz) {
    const d = parseIso(date);
    if (!d) return null;
    const o = {};
    for (const p of _dtf(tz).formatToParts(d)) o[p.type] = p.value;
    const hour = Number(o.hour) % 24;
    const res = {
      year: Number(o.year), month: Number(o.month), day: Number(o.day),
      hour, minute: Number(o.minute), second: Number(o.second), weekday: o.weekday,
    };
    const asUtc = Date.UTC(res.year, res.month - 1, res.day, res.hour, res.minute, res.second);
    res.offsetMin = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
    return res;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function ymd(p) { return p.year + "-" + pad2(p.month) + "-" + pad2(p.day); }

  /** Today's calendar date in Sydney (the ASX session date), "YYYY-MM-DD". */
  function sydneyDate(now) {
    const p = zonedParts(now || new Date(), TZ_SYD);
    return p ? ymd(p) : null;
  }

  function tzAbbrev(p, tz) {
    if (tz === TZ_BNE) return "AEST";
    if (tz === TZ_SYD) return p.offsetMin === 660 ? "AEDT" : "AEST";
    return "";
  }

  /** "Tue 24 Nov, 09:21 AEST" (Brisbane by default). */
  function fmtDateTime(x, opts) {
    const o = opts || {};
    const tz = o.tz || TZ_BNE;
    const p = zonedParts(x, tz);
    if (!p) return DASH;
    const date = p.weekday + " " + p.day + " " + MONTHS[p.month - 1] + (o.year ? " " + p.year : "");
    return date + ", " + pad2(p.hour) + ":" + pad2(p.minute) + (o.noTz ? "" : " " + tzAbbrev(p, tz));
  }

  function fmtTime(x, opts) {
    const o = opts || {};
    const tz = o.tz || TZ_BNE;
    const p = zonedParts(x, tz);
    if (!p) return DASH;
    return pad2(p.hour) + ":" + pad2(p.minute) + (o.noTz ? "" : " " + tzAbbrev(p, tz));
  }

  /** Parse a calendar date "YYYY-MM-DD" (no timezone involved). */
  function parseYmd(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return { year: y, month: mo, day: d, weekday: WDAYS[t.getUTCDay()] };
  }

  /** "Tue 24 Nov 2026" for a calendar date string; falls back to the raw text. */
  function fmtDate(s, opts) {
    const o = opts || {};
    const p = parseYmd(s);
    if (!p) return s ? String(s) : DASH;
    return p.weekday + " " + p.day + " " + MONTHS[p.month - 1] + (o.noYear ? "" : " " + p.year);
  }

  function ago(x, now) {
    const d = parseIso(x);
    if (!d) return DASH;
    const mins = Math.round(((now || new Date()).getTime() - d.getTime()) / 60000);
    if (mins < 0) return "in " + (-mins) + " min";
    if (mins < 90) return mins + " min ago";
    if (mins < 48 * 60) return (mins / 60).toFixed(1) + " h ago";
    return Math.round(mins / 1440) + " d ago";
  }

  // ── Envelope / market state / staleness ─────────────────────────────────
  const PHASE_LABELS = {
    pre_open: "Pre-open", pre_market: "Pre-open", preopen: "Pre-open",
    open: "Market open", continuous: "Market open",
    closing_auction: "Closing auction",
    post_close: "After close", after_close: "After close", closed: "Closed",
    weekend: "Weekend", holiday: "Holiday", non_trading_day: "Non-trading day",
  };

  /** Market phase as published in market_state (never recomputed here). */
  function marketPhase(ms) {
    if (!ms || typeof ms !== "object") return { key: null, label: DASH, open: false, known: false };
    let raw = ms.phase || ms.state || ms.market_phase || ms.session_phase || null;
    if (!raw && typeof ms.is_open === "boolean") raw = ms.is_open ? "open" : "closed";
    if (!raw) return { key: null, label: DASH, open: false, known: false };
    const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
    return {
      key, label: PHASE_LABELS[key] || String(raw), known: !!PHASE_LABELS[key],
      open: key === "open" || key === "continuous" || key === "closing_auction",
      preOpen: key === "pre_open" || key === "pre_market" || key === "preopen",
    };
  }

  function sessionDateOf(ms) {
    if (!ms || typeof ms !== "object") return null;
    return ms.session_date || ms.trading_day || ms.session || ms.date || null;
  }

  /** {ok, version, schema, name} — ok means this is the v2+ shape we render. */
  function schemaInfo(data, name) {
    const schema = data && typeof data.schema === "string" ? data.schema : null;
    const m = schema ? schema.match(/^itl\.([a-z0-9_]+)\.v(\d+)$/i) : null;
    const version = m ? Number(m[2]) : (schema ? null : 1);
    const nameOk = !m || !name || m[1].toLowerCase() === name.toLowerCase();
    return { ok: !!m && version >= 2 && nameOk, version, schema, nameOk };
  }

  /** stale: true/false, or null when the file has no stale_after_utc. */
  function staleness(env, now) {
    const after = parseIso(env && env.stale_after_utc);
    if (!after) return { stale: null, staleAfter: null };
    return { stale: (now || new Date()).getTime() > after.getTime(), staleAfter: after };
  }

  /** Live page: are the re-checked picks for the current Sydney session? */
  function picksStale(live, now) {
    const today = sydneyDate(now || new Date());
    const vf = live && live.picks_valid_for ? String(live.picks_valid_for) : null;
    // Picks for a FUTURE session (e.g. an evening check after tonight's scan)
    // are not stale: they are upcoming and simply cannot be live-checked yet.
    const upcoming = !!vf && vf > today;
    return { stale: !vf || (vf !== today && !upcoming), upcoming, validFor: vf, today };
  }

  /** Stale jobs from status.json. */
  function healthIssues(status, now) {
    const out = [];
    if (!status || typeof status !== "object") return out;
    const jobs = status.jobs && typeof status.jobs === "object" ? status.jobs : {};
    for (const name of Object.keys(jobs)) {
      const j = jobs[name] || {};
      // routine, harmless outcomes (button outside session, index bar not
      // updated yet -> retry, older data refused) are not failures; real
      // staleness is still caught by j.stale
      const failed = j.last_status && !/^(ok|success|succeeded|skipped|not_in_session|stale_data|refused_older)$/i.test(String(j.last_status));
      if (j.stale === true || failed) {
        out.push({ job: name, stale: j.stale === true, failed: !!failed, last_success_utc: j.last_success_utc || null,
          last_attempt_utc: j.last_attempt_utc || null, last_status: j.last_status || null, expected_every: j.expected_every || null });
      }
    }
    const st = staleness(status, now);
    if (st.stale === true) out.push({ job: "status.json", stale: true, self: true, last_success_utc: status.generated_at_utc || null, expected_every: null });
    return out;
  }

  // ── Fixtures / environment ──────────────────────────────────────────────
  function _search() {
    try { return typeof location !== "undefined" ? location.search : ""; } catch (_) { return ""; }
  }
  function param(name, search) {
    const m = String(search === undefined ? _search() : search).match(new RegExp("[?&]" + name + "=([^&#]*)"));
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
  }

  /** null (production), "v2" (dev/fixtures/*.json) or "v1" (the real
   *  /public files, which today are still v1). */
  function fixturesMode(search) {
    const f = param("fixtures", search);
    if (!f || f === "0") return null;
    return f === "v1" ? "v1" : "v2";
  }

  const FIXTURE_MAP = {
    "/public/today.json": "/dev/fixtures/today.json",
    "/public/live.json": "/dev/fixtures/live.json",
    "/public/intraday.json": "/dev/fixtures/intraday.json",
    "/public/status.json": "/dev/fixtures/status.json",
    "/public/pending_exits.json": "/dev/fixtures/pending_exits.json",
    "/public/preclose.json": "/dev/fixtures/preclose.json",
    "/track-record/metrics.json": "/dev/fixtures/metrics.json",
  };

  // Fixture sets (?fixtures=1&set=NAME) override only the files listed.
  const FIXTURE_SETS = {
    preopen: ["live", "intraday", "status"],
    edge: ["today", "live", "intraday", "status", "pending_exits", "metrics", "preclose"],
    pcstale: ["preclose"],   // pre-close picks from an older session
    pcunpub: ["preclose"],   // pre-close scan ran but published=false
    real: ["metrics", "today"], // real engine outputs (metrics: simulator; today: v2.3 night scan as of 20 Nov)
  };

  function resolvePath(path, search) {
    const mode = fixturesMode(search);
    if (mode === "v2" && FIXTURE_MAP[path]) {
      const f = FIXTURE_MAP[path];
      const set = param("set", search);
      const base = f.replace(/^.*\//, "").replace(/\.json$/, "");
      if (set && FIXTURE_SETS[set] && FIXTURE_SETS[set].indexOf(base) >= 0) return f.replace("/dev/fixtures/", "/dev/fixtures/" + set + "/");
      return f;
    }
    return path;
  }

  /** Current time; in fixtures mode ?now=ISO overrides it (deterministic
   *  screenshots/tests). Ignored in production. */
  function now(search) {
    if (fixturesMode(search)) {
      const n = parseIso(param("now", search));
      if (n) return n;
    }
    return new Date();
  }

  // ── Fetch ───────────────────────────────────────────────────────────────
  function FetchError(message, kind, status, url) {
    const e = new Error(message);
    e.name = "FetchError"; e.kind = kind; e.status = status || null; e.url = url;
    return e;
  }

  async function fetchJSON(path, opts) {
    const o = opts || {};
    const f = o.fetch || (typeof fetch !== "undefined" ? fetch : null);
    const resolved = resolvePath(path);
    const url = resolved + (resolved.indexOf("?") >= 0 ? "&" : "?") + "v=" + Date.now();
    let res;
    try {
      res = await f(url, { cache: "no-store" });
    } catch (e) {
      throw FetchError("Network error loading " + resolved + " (" + (e && e.message ? e.message : e) + ")", "network", null, resolved);
    }
    if (!res.ok) throw FetchError("HTTP " + res.status + " loading " + resolved, res.status === 404 ? "missing" : "http", res.status, resolved);
    let text;
    try { text = await res.text(); } catch (e) { throw FetchError("Could not read " + resolved, "network", res.status, resolved); }
    let data;
    try { data = JSON.parse(text); } catch (e) { throw FetchError("Invalid JSON in " + resolved, "parse", res.status, resolved); }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      try { Object.defineProperty(data, "_lastModified", { value: res.headers && res.headers.get ? res.headers.get("last-modified") : null, enumerable: false }); } catch (_) {}
    }
    return data;
  }

  /** fetchJSON that never throws: {data} or {error}. */
  async function tryFetchJSON(path, opts) {
    try { return { data: await fetchJSON(path, opts), error: null }; }
    catch (e) { return { data: null, error: e }; }
  }

  // ── Storage (always try/catch: private mode / disabled storage) ─────────
  const memStore = {};
  const store = {
    get(k) {
      try { const v = localStorage.getItem(k); return v === null ? null : JSON.parse(v); }
      catch (_) { return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { memStore[k] = v; }
    },
    del(k) {
      try { localStorage.removeItem(k); } catch (_) {}
      delete memStore[k];
    },
  };

  // ── Shared UI fragments ─────────────────────────────────────────────────
  function banner(kind, title, body, tag) {
    return html`<div class="banner banner--${kind}" role="${kind === "info" ? "status" : "alert"}">
      <div class="banner__body"><div class="banner__title">${title}</div>${body ? html`<div class="banner__text">${body}</div>` : ""}</div>
      ${tag ? html`<span class="banner__tag">${tag}</span>` : ""}
    </div>`;
  }

  function staleBanner(env, now, what) {
    const st = staleness(env, now);
    if (st.stale !== true) return html``;
    return banner("stale", "STALE: " + what + " is out of date",
      html`Generated ${fmtDateTime(env.generated_at_utc)} (${ago(env.generated_at_utc, now)}). It was due to be replaced by ${fmtDateTime(st.staleAfter)}. Do not act on it until the next run publishes; check the pipeline health notice above, if one is showing.`,
      "STALE");
  }

  function outdatedBanner(file, info) {
    return banner("warn", "Data format outdated: " + file,
      html`Expected schema v2, got ${info && info.schema ? info.schema : "v1 (no schema field)"}. Showing what can be read from the old format; some fields will be missing (—).`,
      "OLD FORMAT");
  }

  function errorBox(err, what) {
    const msg = err && err.message ? err.message : String(err);
    const hint = err && err.kind === "missing" ? "The file has not been published yet." :
      err && err.kind === "parse" ? "The file exists but is not valid JSON; the pipeline may be mid-write. Reload in a minute." :
      err && err.kind === "network" ? "Check your connection and reload." : "";
    return html`<div class="errorBox" role="alert"><b>Could not load ${what}.</b> ${msg}${hint ? html`<div class="small">${hint}</div>` : ""}</div>`;
  }

  function yahooLink(sym) {
    if (!sym) return html``;
    const href = "https://finance.yahoo.com/quote/" + encodeURIComponent(String(sym));
    return html`<a class="ext-link" href="${href}" target="_blank" rel="noopener noreferrer" title="${"View " + sym + " on Yahoo Finance"}" aria-label="${"View " + sym + " on Yahoo Finance"}">↗</a>`;
  }

  function symbolCell(sym, names) {
    const name = names && sym ? names[sym] : null;
    return html`<div class="symbol-line"><span class="sym">${sym || DASH}</span>${yahooLink(sym)}</div>${name ? html`<span class="company-name" title="${name}">${name}</span>` : ""}`;
  }

  function healthBanner(issues, now) {
    if (!issues || !issues.length) return html``;
    const items = issues.map(i => html`<li><b>${i.job}</b>: ${i.self ? "status file itself is stale" : (i.failed && !i.stale ? "last run " + i.last_status : "stale")}${i.last_success_utc ? html` · last success ${fmtDateTime(i.last_success_utc)} (${ago(i.last_success_utc, now)})` : " · no recorded success"}${i.expected_every ? html` · expected ${i.expected_every}` : ""}</li>`);
    return banner("health", "Pipeline health: " + issues.length + " job(s) need attention", html`<ul class="health-list">${items}</ul>`, "HEALTH");
  }

  // ── Exit policies (contract v2.1: three tracked policies) ───────────────
  const TRACKED_POLICIES = ["fixed_5d", "trail_2atr", "trail_1pct"];
  const DEFAULT_POLICY = "fixed_5d";
  const POLICY_NAMES = { fixed_5d: "Fixed 5 days", trail_2atr: "Trail 2×ATR", trail_1pct: "Trail 1%" };

  /** Short human name for a policy id ("trail_2atr" -> "Trail 2×ATR"). */
  function policyName(id) {
    if (!id) return DASH;
    const s = String(id);
    if (POLICY_NAMES[s]) return POLICY_NAMES[s];
    let m = s.match(/^fixed_(\d+)d$/);
    if (m) return "Fixed " + m[1] + " days";
    m = s.match(/^trail_(\d+(?:\.\d+)?)(pct|atr)(_after_(\d+(?:\.\d+)?)r)?$/);
    if (m) return "Trail " + m[1] + (m[2] === "pct" ? "%" : "×ATR") + (m[3] ? " after +" + m[4] + "R" : "");
    return s;
  }

  /** The row's exit plans: exit_plans[] (v2.1) or the single exit_plan. */
  function exitPlansOf(row) {
    if (!row || typeof row !== "object") return [];
    if (Array.isArray(row.exit_plans)) {
      const list = row.exit_plans.filter(p => p && typeof p === "object");
      if (list.length) return list;
    }
    return row.exit_plan && typeof row.exit_plan === "object" ? [row.exit_plan] : [];
  }

  function planKind(plan) {
    if (!plan || typeof plan !== "object") return null;
    if (plan.kind === "time" || plan.kind === "trail_pct" || plan.kind === "trail_atr") return plan.kind;
    if (num(plan.trail_pct) !== null) return "trail_pct";
    if (num(plan.trail_atr_aud) !== null || num(plan.atr_mult) !== null || num(plan.trail_atr_mult) !== null) return "trail_atr";
    if (/^fixed_\d+d$/.test(String(plan.policy_id || "")) || num(plan.days) !== null) return "time";
    return null;
  }

  /** Plain-words exit rule, e.g. "Sell at close of day 5 (by Mon 30 Nov)",
   *  "Trail 2×ATR = A$0.17 below the highest price since entry". */
  function exitPlanPhrase(plan, row) {
    const kind = planKind(plan);
    if (!kind) return plan && plan.label ? String(plan.label) : DASH;
    const days = num(plan.time_stop_days);
    if (kind === "time") {
      const m = String(plan.policy_id || "").match(/^fixed_(\d+)d$/);
      const n = num(plan.days) !== null ? num(plan.days) : m ? Number(m[1]) : days;
      const by = parseYmd(plan.exit_by_date) ? " (by " + fmtDate(plan.exit_by_date, { noYear: true }) + ")" : "";
      return n !== null ? "Sell at close of day " + fmtInt(n) + by : "Time exit" + by;
    }
    let trail;
    if (kind === "trail_pct") {
      const pct = num(plan.trail_pct);
      trail = "trail " + (pct !== null ? fmtNum(pct, pct % 1 ? 1 : 0) + "%" : DASH + "%") + " below the highest price since entry";
    } else {
      const mult = num(plan.atr_mult) !== null ? num(plan.atr_mult) : num(plan.trail_atr_mult);
      const aud = num(plan.trail_atr_aud);
      const ref = row && typeof row === "object" ? (num(row.entry_ref) !== null ? row.entry_ref : row.last_close) : null;
      const dp = priceDecimals(ref, row);
      trail = "trail " + (mult !== null ? fmtNum(mult, mult % 1 ? 1 : 0) + "×ATR" : "ATR") +
        (aud !== null ? " = A$" + fixed(aud, dp) : "") + " below the highest price since entry";
    }
    const act = num(plan.activate_after_r);
    let s = act !== null && act > 0 ? "Once up +" + fmtNum(act, act % 1 ? 1 : 0) + "R, " + trail : trail.charAt(0).toUpperCase() + trail.slice(1);
    if (days !== null) s += " (max " + fmtInt(days) + " days)";
    return s;
  }

  /** The default plan's id: the row's exit_plan, else the first exit plan
   *  (the contract puts the default first). */
  function defaultPolicyOf(row, fallback) {
    if (row && row.exit_plan && typeof row.exit_plan === "object" && row.exit_plan.policy_id) return String(row.exit_plan.policy_id);
    const plans = exitPlansOf(row);
    if (plans.length && plans[0].policy_id) return String(plans[0].policy_id);
    return fallback || DEFAULT_POLICY;
  }

  /** Compact list of every tracked exit plan, default marked. */
  function exitPlansHtml(row, opts) {
    const o = opts || {};
    const plans = exitPlansOf(row);
    if (!plans.length) return html`<div class="xplans"><b>Exit plan:</b> ${DASH} <span class="small">(not published)</span></div>`;
    const defId = o.defaultId || defaultPolicyOf(row);
    const def = plans.find(p => p.policy_id === defId) || plans[0];
    const stop = num(def.initial_stop) !== null ? def.initial_stop : (row ? row.stop : null);
    const items = plans.map(p => {
      const isDef = p === def;
      const name = p.policy_id ? policyName(p.policy_id) : (p.label || DASH);
      return html`<li class="${isDef ? "is-default" : ""}" title="${name + (p.label ? " — " + p.label : "")}"><span class="xp-rule">${exitPlanPhrase(p, row)}</span>${isDef ? html` <span class="chip chip--info xp-def" title="The official policy: the live verdict and the track-record headline follow it">default</span>` : ""}</li>`;
    });
    return html`<div class="xplans"><div class="xplans__head"><b>Exit plans</b>${num(stop) !== null ? html` · initial stop <span class="mono neg">${fmtPrice(stop, row)}</span> for all` : ""}${plans.length > 1 ? html` · <span class="small">all ${String(plans.length)} tracked, default first</span>` : ""}</div><ul>${items}</ul></div>`;
  }

  // ── Pre-close stream timing ─────────────────────────────────────────────
  /** Sydney wall-clock time on a calendar date -> Date (DST-aware). */
  function sydneyWallToDate(dateStr, hhmm) {
    const d = parseYmd(dateStr);
    const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!d || !m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    const wall = Date.UTC(d.year, d.month - 1, d.day, h, mi);
    let t = wall - 600 * 60000;
    for (let i = 0; i < 2; i++) {
      const p = zonedParts(new Date(t), TZ_SYD);
      if (!p) return null;
      t = wall - p.offsetMin * 60000;
    }
    return new Date(t);
  }

  /** Trade-by deadline of a pre-close file: trade_by_utc, else
   *  signal_session + trade_by_syd (Sydney), else market_state close - 1 min. */
  function precloseDeadline(pc) {
    if (!pc || typeof pc !== "object") return null;
    const direct = parseIso(pc.trade_by_utc);
    if (direct) return direct;
    const ms = pc.market_state && typeof pc.market_state === "object" ? pc.market_state : {};
    const session = pc.signal_session || sessionDateOf(ms);
    const viaSyd = sydneyWallToDate(session, pc.trade_by_syd);
    if (viaSyd) return viaSyd;
    const close = parseIso(ms.close_syd || ms.close_utc || ms.close);
    return close ? new Date(close.getTime() - 60000) : null;
  }

  /** "15:59 Sydney (14:59 Brisbane)" */
  function tradeByText(deadline) {
    if (!deadline) return DASH;
    return fmtTime(deadline, { tz: TZ_SYD, noTz: true }) + " Sydney (" + fmtTime(deadline, { noTz: true }) + " Brisbane)";
  }

  /** "15:15 Sydney (14:15 Brisbane)" for any instant. */
  function sydBneTime(x) {
    const d = parseIso(x);
    return d ? tradeByText(d) : DASH;
  }

  function countdown(deadline, now) {
    const d = parseIso(deadline);
    if (!d) return { known: false, passed: false, text: DASH, ms: null };
    const ms = d.getTime() - (now || new Date()).getTime();
    if (ms <= 0) return { known: true, passed: true, text: "trade-by time passed", ms };
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const text = h > 0 ? h + " h " + pad2(m) + " min left" : m >= 10 ? m + " min left" : m + ":" + pad2(sec) + " left";
    return { known: true, passed: false, text, ms };
  }

  /** Should Today / Live show the pre-close banner? Only for a file about
   *  TODAY's Sydney session, from 59 min before the trade-by time (15:00 on a
   *  normal day) until the end of the closing auction (+11 min). */
  function precloseWindow(pc, now) {
    const n = now || new Date();
    if (!pc || typeof pc !== "object" || !pc.signal_session) return { show: false };
    if (String(pc.signal_session) !== sydneyDate(n)) return { show: false, reason: "other_session" };
    const dl = precloseDeadline(pc);
    if (!dl) return { show: false, reason: "no_deadline" };
    const t = n.getTime();
    if (t < dl.getTime() - 59 * 60000 || t > dl.getTime() + 11 * 60000) return { show: false, reason: "outside_window", deadline: dl };
    return { show: true, deadline: dl, published: pc.published !== false };
  }

  /** Link that keeps ?fixtures=… in fixtures mode. */
  function siteHref(path) {
    return path + (fixturesMode() ? _search() : "");
  }

  function precloseBanner(pc, now) {
    const w = precloseWindow(pc, now);
    if (!w.show) return html``;
    const cd = countdown(w.deadline, now);
    const recs = Array.isArray(pc.recommended_orders) ? pc.recommended_orders.filter(r => r && typeof r === "object") : [];
    const href = siteHref("/preclose/");
    if (!w.published) {
      return banner("info", "Pre-close scan ran: no picks published today",
        html`${pc.reason ? "Reason: " + pc.reason + ". " : ""}Details on <a href="${href}">Pre-close picks</a>.`, "PRE-CLOSE");
    }
    const syms = recs.map(r => r.symbol || DASH).join(", ");
    return banner("violet", "Pre-close picks are out: " + recs.length + " order(s)" + (syms ? " — " + syms : ""),
      html`Buy in the closing auction / at market before the close. Trade by <b>${tradeByText(w.deadline)}</b> · <b>${cd.text}</b>. <a href="${href}">Open pre-close picks →</a>`, "PRE-CLOSE");
  }

  // ── Worker refresh + poll ───────────────────────────────────────────────
  function isUnknownWorkflow(body) {
    if (!body || typeof body !== "object") return false;
    if (body.status === "unknown_workflow" || body.error === "unknown_workflow" || body.code === "unknown_workflow") return true;
    return /unknown[_\s-]?workflow/i.test(String(body.error || body.message || ""));
  }

  /**
   * On-demand refresh: POST the worker, then poll the data file until its
   * generated_at_utc advances. Dependencies are injectable for tests.
   * opts: {workflows: ['live_check','before_close'] (null entry = POST with
   *        no body), dataPath, getBaseline(), onData(d), onStatus(text, state),
   *        setDisabled(bool, label), key, cooldownMs, pollMs, maxMs,
   *        fetch, fetchJSON, setTimeout, clearTimeout, now, storage, fixtures}
   */
  function createRefresher(opts) {
    const o = Object.assign({ cooldownMs: 5 * 60e3, pollMs: 20e3, maxMs: 6 * 60e3 }, opts);
    const st = o.storage || store;
    const _setTimeout = o.setTimeout || ((f, ms) => setTimeout(f, ms));
    const _clearTimeout = o.clearTimeout || ((h) => clearTimeout(h));
    const _now = o.now || (() => Date.now());
    const _fetch = o.fetch || ((u, init) => fetch(u, init));
    const _fetchJSON = o.fetchJSON || fetchJSON;
    const cdKey = "itl_refresh_cooldown_" + o.key;
    const pendKey = "itl_refresh_pending_" + o.key;
    let token = 0, timer = null, tick = null, running = false;

    function status(text, state) { if (o.onStatus) o.onStatus(text, state || "info"); }
    function cooldownLeft() {
      const until = Number(st.get(cdKey)) || 0;
      return Math.max(0, until - _now());
    }
    function updateButton() {
      const left = cooldownLeft();
      if (running) { o.setDisabled && o.setDisabled(true, "Checking…"); return; }
      if (left > 0) {
        const s = Math.ceil(left / 1000);
        o.setDisabled && o.setDisabled(true, "Wait " + Math.floor(s / 60) + ":" + pad2(s % 60));
      } else {
        o.setDisabled && o.setDisabled(false, null);
      }
    }
    function startTicker() {
      if (tick || typeof setInterval === "undefined" || o.noTicker) return;
      tick = setInterval(() => {
        updateButton();
        if (!running && cooldownLeft() <= 0) { clearInterval(tick); tick = null; }
      }, 1000);
    }

    async function post(workflow) {
      const init = { method: "POST" };
      if (workflow) { init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify({ workflow }); }
      const resp = await _fetch(WORKER_URL, init);
      let body = {};
      try { body = await resp.json(); } catch (_) { body = {}; }
      return { resp, body };
    }

    function isNewer(d, baseline) {
      const g = parseIso(d && d.generated_at_utc);
      if (!g) return false;
      const b = parseIso(baseline);
      return !b || g.getTime() > b.getTime();
    }

    function poll(myToken, baseline, startedAt) {
      if (myToken !== token) return;
      if (_now() - startedAt > o.maxMs) {
        running = false; st.del(pendKey); updateButton();
        status("Still running — check back in a few minutes (or press Reload).", "warn");
        return;
      }
      timer = _setTimeout(async () => {
        if (myToken !== token) return;
        let d = null;
        try { d = await _fetchJSON(o.dataPath); } catch (_) { d = null; }
        if (myToken !== token) return;
        if (d && isNewer(d, baseline)) {
          running = false; st.del(pendKey); updateButton();
          try { o.onData && o.onData(d); } catch (e) { if (typeof console !== "undefined") console.error(e); }
          status("Updated " + fmtTime(d.generated_at_utc), "ok");
          return;
        }
        const waited = Math.round((_now() - startedAt) / 1000);
        status("Waiting for new data… " + Math.floor(waited / 60) + "m " + pad2(waited % 60) + "s (checks every " + Math.round(o.pollMs / 1000) + " s)", "info");
        poll(myToken, baseline, startedAt);
      }, o.pollMs);
    }

    async function start() {
      if (running || cooldownLeft() > 0) { updateButton(); return { started: false, reason: running ? "running" : "cooldown" }; }
      if (o.fixtures) {
        status("Fixtures mode: refresh is disabled (no request sent).", "warn");
        return { started: false, reason: "fixtures" };
      }
      running = true; updateButton();
      status("Requesting a run…", "info");
      const baseline = o.getBaseline ? o.getBaseline() : null;
      const workflows = o.workflows && o.workflows.length ? o.workflows : [null];
      let result = null;
      for (let i = 0; i < workflows.length; i++) {
        try { result = await post(workflows[i]); }
        catch (e) {
          running = false; updateButton();
          status("Could not reach the refresh service — try again shortly.", "error");
          return { started: false, reason: "network" };
        }
        if (isUnknownWorkflow(result.body) && i < workflows.length - 1) continue;
        break;
      }
      const { resp, body } = result;
      if (body.status === "rate_limited" || resp.status === 429) {
        running = false; updateButton();
        status("A run was triggered recently (rate limited) — try again in a few minutes.", "warn");
        return { started: false, reason: "rate_limited" };
      }
      if (isUnknownWorkflow(body)) {
        running = false; updateButton();
        status("The refresh service does not know this job yet (unknown_workflow).", "error");
        return { started: false, reason: "unknown_workflow" };
      }
      if (!resp.ok) {
        running = false; updateButton();
        status("Refresh service error (HTTP " + resp.status + ").", "error");
        return { started: false, reason: "http" };
      }
      if (body.status !== "triggered") {
        running = false; updateButton();
        status("Unexpected reply from the refresh service" + (body.status ? " (" + body.status + ")" : "") + ".", "error");
        return { started: false, reason: "unexpected" };
      }
      const startedAt = _now();
      st.set(cdKey, startedAt + o.cooldownMs);
      st.set(pendKey, { baseline, startedAt });
      token++;
      status("Run started — waiting for new data (checks every " + Math.round(o.pollMs / 1000) + " s, up to ~" + Math.round(o.maxMs / 60000) + " min).", "info");
      startTicker();
      poll(token, baseline, startedAt);
      return { started: true };
    }

    /** Stop any pending poll (e.g. the user pressed Reload). Cooldown stays. */
    function cancel(reason) {
      const wasRunning = running;
      token++;
      if (timer !== null) { _clearTimeout(timer); timer = null; }
      running = false; st.del(pendKey); updateButton();
      if (wasRunning && reason) status(reason, "info");
      return wasRunning;
    }

    /** On page load: re-apply cooldown and resume a poll that a reload interrupted. */
    function restore() {
      const pend = st.get(pendKey);
      if (pend && typeof pend === "object" && _now() - Number(pend.startedAt) < o.maxMs) {
        running = true; token++;
        status("Resuming check for new data…", "info");
        poll(token, pend.baseline, Number(pend.startedAt));
      } else if (pend) {
        st.del(pendKey);
      }
      updateButton();
      startTicker();
    }

    return { start, cancel, restore, cooldownLeft, isRunning: () => running, _isNewer: isNewer };
  }

  // ── Page chrome ─────────────────────────────────────────────────────────
  function initNav() {
    if (typeof document === "undefined") return;
    const btn = document.getElementById("hamburgerBtn");
    const nav = document.getElementById("mainNav");
    const path = location.pathname.replace(/index\.html$/, "");
    if (nav) {
      nav.querySelectorAll("a").forEach(a => {
        const href = a.getAttribute("href");
        if (href === path || (href !== "/" && path.indexOf(href) === 0)) a.setAttribute("aria-current", "page");
        if (fixturesMode()) a.setAttribute("href", href + location.search);
      });
    }
    if (!btn || !nav) return;
    const close = () => { nav.classList.remove("active"); btn.setAttribute("aria-expanded", "false"); btn.textContent = "☰"; };
    btn.addEventListener("click", () => {
      const open = nav.classList.toggle("active");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "✕" : "☰";
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".topbar")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  /** Common to every page: nav, fixtures badge, pipeline health banner. */
  async function bootCommon() {
    if (typeof document === "undefined") return;
    initNav();
    const mode = fixturesMode();
    if (mode) {
      const b = document.createElement("div");
      b.className = "fixtures-badge";
      b.textContent = "FIXTURES MODE (" + mode + ")" + (param("now") ? " · now=" + param("now") : "");
      document.body.insertBefore(b, document.body.firstChild);
    }
    const el = document.getElementById("itl-health");
    if (!el) return;
    const r = await tryFetchJSON("/public/status.json");
    if (r.data) setHtml(el, healthBanner(healthIssues(r.data, now()), now()));
  }

  let _names = null;
  async function loadNames() {
    if (_names) return _names;
    const r = await tryFetchJSON("/public/ticker_names.json");
    _names = r.data && typeof r.data === "object" ? r.data : {};
    return _names;
  }

  /** Strategy Decay verdicts, keyed by strategy (best-effort). */
  async function loadEdgeVerdicts() {
    const r = await tryFetchJSON("/public/strategy_decay_analysis.json");
    const out = {};
    const a = r.data && r.data.archetypes;
    if (a && typeof a === "object") {
      for (const k of Object.keys(a)) {
        const v = a[k] && a[k].verdict;
        out[k] = { verdict: v && typeof v === "object" ? v.verdict : v, reason: v && v.reason, n: a[k].n_trades };
      }
    }
    return out;
  }

  function edgeBadge(strategy, verdicts) {
    const info = verdicts && verdicts[String(strategy || "").trim()];
    if (!info || !info.verdict) return html``;
    const v = String(info.verdict);
    let cls = "chip--muted", label = v;
    if (/no edge/i.test(v)) { cls = "chip--neg"; label = "No confirmed edge"; }
    else if (/insufficient/i.test(v)) { cls = "chip--muted"; label = "Edge unproven (few trades)"; }
    else if (/decayed/i.test(v)) { cls = "chip--warn"; label = "Edge decayed"; }
    else if (/persists/i.test(v)) { cls = "chip--pos"; label = "Edge holds (audit)"; }
    const title = "Strategy Decay audit: " + v + (info.reason ? " — " + info.reason : "");
    return html`<a class="chip ${cls}" href="/strategy-decay/" title="${title}">${label} →</a>`;
  }

  const STRATEGY_LABELS = {
    TREND_PULLBACK: "Trend pullback", MOMENTUM: "Momentum breakout", MEAN_REVERSION: "Mean reversion",
    PEAD: "Post-earnings drift", HIGH52W_MOMENTUM: "52-week-high momentum",
    GAP_FADE_CONTINUATION: "Gap fade / continuation", BASELINE_RANDOM: "Baseline (random entry)",
  };
  const ALL_STRATEGIES = ["TREND_PULLBACK", "MOMENTUM", "MEAN_REVERSION", "PEAD", "HIGH52W_MOMENTUM", "GAP_FADE_CONTINUATION"];
  function strategyLabel(s) { return STRATEGY_LABELS[s] || (s ? String(s) : DASH); }

  return {
    TZ_BNE, TZ_SYD, WORKER_URL, DASH,
    escapeHtml, html, join, setHtml, SafeHtml,
    num, priceDecimals, fmtPrice, fmtNum, fmtInt, fmtAud, fmtPct, fmtRate, fmtR,
    readMoneyLike, computeSize, sizeTooltip,
    parseIso, zonedParts, sydneyDate, fmtDateTime, fmtTime, parseYmd, fmtDate, ago,
    marketPhase, sessionDateOf, schemaInfo, staleness, picksStale, healthIssues,
    param, fixturesMode, resolvePath, now, fetchJSON, tryFetchJSON, store,
    banner, staleBanner, outdatedBanner, errorBox, symbolCell, yahooLink, healthBanner,
    isUnknownWorkflow, createRefresher,
    TRACKED_POLICIES, DEFAULT_POLICY, POLICY_NAMES, policyName, exitPlansOf, planKind, exitPlanPhrase, defaultPolicyOf, exitPlansHtml,
    sydneyWallToDate, precloseDeadline, tradeByText, sydBneTime, countdown, precloseWindow, precloseBanner, siteHref,
    initNav, bootCommon, loadNames, loadEdgeVerdicts, edgeBadge,
    STRATEGY_LABELS, ALL_STRATEGIES, strategyLabel,
  };
});
