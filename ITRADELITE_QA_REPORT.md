# iTradeLite Site QA Report — Mobile-First Pass

Follow-up to `ITRADELITE_REMEDIATION_REPORT.md` and `ITRADELITE_FOLLOWUP_REPORT.md`
(engine repo). This is a QA pass on the live static site, not a code-archaeology
session — no strategy logic touched.

## Method

**Headless browser: Playwright + the sandbox's pre-installed Chromium**
(`/opt/pw-browsers/chromium_headless_shell-1194`), driven from a small Node
script. Not a fallback to static analysis — every finding below was observed
in an actual rendered page, and every fix was re-verified the same way after
applying it, not just assumed to have worked from reading the diff.

Setup:
- A minimal Node static file server served the site repo root at
  `http://localhost:8931` (root-relative fetches like `/public/pending_exits.json`
  need to resolve exactly as they do in production, so the site was tested from
  its own root, not opened as a bare file).
- `playwright@1.48`, launched with `executablePath` pointed at the pre-installed
  browser (the default Playwright-bundled Chromium version didn't match; the
  matching pre-installed `chromium_headless_shell` binary was used instead of
  downloading a new one).
- Every one of the 7 public pages (home, About, How-it-Works, Today, Intraday,
  Before-Close, Track Record) was loaded at 375px, 390px, 768px, and 1280px —
  28 page/viewport combinations — with automated checks for: horizontal
  overflow (`document.documentElement.scrollWidth` vs. `clientWidth`), any
  individual element wider than its viewport, touch-target sizing (`<a>`/
  `<button>` under ~40x40px, checked only at ≤768px), computed font sizes,
  broken `<img>` elements, nav visibility/collapse behavior, console errors,
  and failed network requests. This ran once as a baseline, then again after
  every fix to confirm the fix actually worked rather than assuming it from
  the diff.
- A handful of targeted follow-up scripts drilled into specific findings
  (DOM-tree `scrollWidth` walks to find the exact overflowing element;
  clicking the hamburger button and checking the nav actually opened, not
  just that the CSS declares it should).

**No fallback to static-analysis-only was needed** — the pre-installed browser
worked for the entire pass.

---

## Issues Found and Fixed

| # | Issue | Pages | Severity | Fix | Commit |
|---|---|---|---|---|---|
| 1 | Page-level horizontal scroll from an 800px decorative glow (`.hero::before`, animated, no `overflow:hidden` on its container) | Home | Medium — visible sideways scroll/wiggle during the pulse animation at ≤768px | Added `overflow:hidden` to `.hero` | `b2d9bc5` |
| 2 | **Zero working mobile navigation** — `.nav { display:none }` below 540px, no hamburger, no other way to reach any other page | Today (the site's primary/highest-traffic page) | **High** — mobile visitors had no way to navigate off this page except editing the URL | Added a self-contained hamburger + dropdown nav (page has no shared stylesheet, so this was ported locally, matching the pattern already working on Home/About/How-it-Works/Track Record) | `dfc7b36` |
| 3 | Page-level horizontal overflow — the 6-link nav rendered as one non-wrapping row wider than the viewport at ≤768px, with no collapse mechanism at all | Intraday, Before-Close | **High** — same root problem as #2, worse (actual layout breakage, not just a hidden nav) | Same hamburger + dropdown pattern as #2 | `359a927` |
| 4 | Touch targets under ~44px — all `.btn` buttons (Refresh Data, Live Signals, Copy data link, Refresh, Refresh Signals, Check Before-Close Signals) were ~31-36px tall; hamburger was 38x44 (width short) | All pages | Low-Medium | `min-height:44px` on `.btn`, `min-height`+`min-width:44px` on `.hamburger`, scoped to the ≤768px media query so desktop sizing is untouched | `4065243` |

Each fix was re-verified with the same Playwright method after applying it —
not assumed from the diff. See `qa_screenshots/` for before/after evidence on
issues #1-3 (home/today/intraday/before-close at 375px) plus a full post-fix
set (375px + 1280px) for all 7 pages.

### Root-cause note on issues #2 and #3

`today/index.html`, `intraday/index.html`, and `before-close/index.html` are
each **fully self-contained pages with their own local `<style>` block** —
none of them link `assets/site.css`, unlike `index.html`/`about.html`/
`how-it-works.html`/`track-record/index.html`, which share it and already had
a working hamburger nav. These three pages simply never received that
upgrade when it shipped to the others — a genuine, findable inconsistency
(confirmed by `grep -c hamburger`: 6 matches each on the working pages, 0 on
these three, before this pass).

---

## Checked and Confirmed OK (no fix needed)

- **Tables** (Today's watchlist, Intraday's signal list, Track Record's
  strategy/signal tables): all wrapped in `.tableWrap { overflow-x: auto }`
  containers. Confirmed via Playwright — the tables themselves measure
  480-880px wide at 375px viewports, but `document.documentElement.scrollWidth`
  stays at exactly the viewport width on every page that has one (Today,
  Track Record). This is the mission's explicitly-acceptable pattern
  (horizontal scroll contained within a bounded element, not the whole page
  scrolling sideways) — no change made.
- **`.stats-bar`'s decorative shimmer** (Home page): also has an oversized
  `::before` similar to the hero glow, but it already had `overflow:hidden`
  declared, so — unlike the hero — it was never contributing to page-level
  overflow. Confirmed by direct measurement before touching anything; left
  as-is.
- **Font sizes**: computed (not just declared) body font-size is 16px on the
  pages checked; no illegibly-small text found at any checked width.
- **Desktop (1280px) regression check**: re-ran the full audit at 1280px
  after all fixes — zero overflow, nav renders normally (not collapsed),
  hamburger correctly hidden, on all 7 pages. No regression from any fix in
  this pass.
- **No fixed-pixel desktop-only `min-width` values** found anywhere in the
  site's CSS wider than 375px (grepped `assets/site.css` and every page's
  inline styles).
- **No broken images** on any of the 28 page/viewport combinations checked.
- **Favicons and manifest**: `favicon.ico`, `favicon.svg`, `favicon-96x96.png`,
  `apple-touch-icon.png`, `site.webmanifest` all load (200) from the site root.
- **Pending-exits banner** (from the prior remediation session's guardrail
  work): confirmed genuinely rendering on the live homepage with real data
  (`WOW.AX`, `TAKE_PROFIT_3R`, 74 days, +28.63%) — this was fetched from
  `/public/pending_exits.json`, not a static/hardcoded mockup. At 375px it's
  335px wide, 214px tall (~26% of a 812px-tall viewport) — clearly visible
  without dominating the page or overlapping the hero content beneath it;
  text wraps properly. See `qa_screenshots/home_pending-exits-banner_375w.png`.
- **Track Record's equity chart** (`<canvas>`): resizes correctly — its width/
  height are set from the container's actual rendered size via
  `getBoundingClientRect()` with a `devicePixelRatio` multiplier, plus a
  `window.resize` listener that redraws it. Confirmed rendering legibly at
  375px in `qa_screenshots/track-record_375w_after.png`.
- **Full 2026-02-05 → present history**: the equity curve chart genuinely
  starts at 2026-02-05 (97 data points spanning the full range, confirmed by
  reading the live `metrics.json`) and the page's `Window: {since} — {until}`
  text genuinely displays `2026-02-05 — 2026-08-31`. **Not fixed, flagged
  separately below**: the page's "Recent Signal Log" table only shows the 50
  most recent signals (2026-06-22 onward) — early-2026 individual signal rows
  are not browsable in that table, only reflected in the aggregate chart and
  stats. See "Checked but not fixed" below.

---

## Checked but Not Fixed (flagged, not silently left)

- **Track Record's "Recent Signal Log" table has no pagination or date
  filter**, so it only ever shows the most recent 50 signals — Feb-May 2026
  data (now part of the full history since the prior session's backfill) is
  not individually browsable anywhere in the site's UI, even though it's
  correctly reflected in the aggregate chart and KPIs. This is a real,
  accurately-reported gap between "the full history is *live*" (true — the
  chart and stats prove it) and "the full history is *browsable row-by-row*"
  (not true for anything before ~late June). Not fixed in this pass: adding
  pagination or a date-range filter to that table is a feature addition, not
  a mobile-QA-scope bug fix, and doing it safely (without breaking the
  existing render logic) warrants its own pass rather than a rushed addition
  here.
- **Google Fonts and Google Tag Manager requests fail** on every page
  (`net::ERR_CONNECTION_RESET` / `ERR_TUNNEL_CONNECTION_FAILED`) — this is a
  **sandbox network-policy artifact, not a site bug**: this environment's
  outbound proxy doesn't allow `fonts.googleapis.com` or
  `googletagmanager.com`, so every page shows exactly one console error and
  one failed request for these, consistently, at every viewport. Real users
  in production are not behind this sandbox's proxy and will load both
  normally (the pages already have sensible system-font fallbacks, so layout
  isn't affected even when blocked). Confirmed this is the *only* source of
  every console error and failed request seen across all 28 checked
  page/viewport combinations. No action possible or needed from within this
  session.
- **Brand/logo link (28px tall) and inline text links** ("today's list",
  "← Back to Daily Briefing", "Daily Briefing" breadcrumb, 14-18px tall):
  flagged by the automated touch-target check but not resized. These are
  conventionally exempt from the ~44px baseline — WCAG 2.5.5's own exception
  covers links inline within a sentence/paragraph, and the logo link is an
  isolated target with no adjacent tap-target crowding (low mis-tap risk).
  Distinguished from the real fix in this pass (#4 above), which targeted the
  standalone action buttons that actually needed it.

---

## Screenshots

`qa_screenshots/` (21 files, ~13MB) — not the full 56-shot raw audit output,
a curated representative set:
- One 375px + one 1280px shot per page, post-fix (14 files).
- `*_375w_BEFORE.png` for the 4 pages with real bugs (home, today, intraday,
  before-close) — compare against the corresponding `*_375w_after.png`.
- `home_pending-exits-banner_375w.png` — the live banner with real data.
- `today_nav_closed_375w.png` / `today_nav_open_375w.png` — the new mobile
  nav in both states, confirming the hamburger actually opens it (not just
  that it's styled to look like it would).
