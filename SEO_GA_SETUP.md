# SEO + Analytics — what changed and what to do with it

Baseline before this pass: no meta descriptions, no canonical tags, no
Open Graph/Twitter cards, no structured data anywhere on the site.
`before-close/` and `intraday/` already correctly had `noindex,nofollow`
(good call — they're time-sensitive snapshots, not content worth indexing).
Analytics: Google Analytics 4 was hardcoded directly into `/today/`'s
`<head>` only (property `G-N8VCNFYX3B`) — every other page, including the
homepage, had zero tracking.

## What this pass did

**On-page SEO**, added to every page: a real `<meta name="description">`,
a `<link rel="canonical">`, Open Graph tags (`og:title`, `og:description`,
`og:url`, `og:image` — reusing the existing `/assets/og.png`), and matching
Twitter Card tags. `index.html` also got a `WebSite`/`Organization`
JSON-LD block. `noindex,nofollow` on `before-close/` and `intraday/` was
left untouched — they still shouldn't be indexed, but they now have
descriptions/OG tags too, purely for link-preview purposes when shared.

**Sitemap**: added `/track-record/` and `/strategy-decay/`, which were
missing even though they're real, indexable content. `before-close/` and
`intraday/` are deliberately still excluded, matching their `noindex`.

**Analytics, centralized**: `assets/analytics-config.js` now holds the
single `window.ITL_GA_MEASUREMENT_ID` value (currently the same
`G-N8VCNFYX3B` that was already live on `/today/`), and `assets/analytics.js`
loads GA4 from that value. Every page loads both files, so the whole site
is now measured consistently instead of just one page. `/today/`'s old
inline hardcoded snippet was replaced with the shared loader.

To point the site at a different (or new) GA4 property, or to turn
tracking off entirely, edit **one line** in `assets/analytics-config.js` —
nothing else needs to change. `analytics.js` no-ops completely (no script
tag, no cookies, no request to Google) unless that value looks like a real
`G-XXXXXXXXXX` ID.

## What this pass did NOT do (needs your Google account)

- **Google Search Console verification.** Nobody but you can do this — it
  needs your Google account. Recommended method for a custom domain: add a
  TXT record to `itradelite.com`'s DNS (Search Console gives you the exact
  value), which verifies the whole domain in one shot rather than doing it
  per-subdomain. Once verified, submit `https://www.itradelite.com/sitemap.xml`
  in Search Console so Google actually crawls the pages listed in it.
- **Confirming `G-N8VCNFYX3B` is a property you still want.** It was
  already live on `/today/` before this pass touched anything, so it's
  been carried forward rather than replaced — but if you don't recognize
  it, don't have access to its GA4 dashboard, or want a fresh property for
  the whole site, create a new one and swap the ID in
  `assets/analytics-config.js`.
- **A cookie-consent banner.** GA4 sets cookies once a real measurement ID
  is active (it already was, on `/today/`, before this pass). Australian
  Privacy Act doesn't mandate a banner for this kind of low-risk analytics
  use, but if you get traffic from the EU/UK and care about GDPR-strength
  compliance, that's a separate, deliberate addition — not something to
  bolt on silently.
