// Usage: node shoot.mjs <baseURL> <outDir> [page-filter]
// Needs playwright-core and Chrome. Run: PW_CORE=/path/to/node_modules/playwright-core/index.mjs node dev/browser_shots.mjs http://localhost:8765 /tmp/site-shots
// (serve the worktree first: python3 -m http.server 8765)
const { chromium } = await import(process.env.PW_CORE || 'playwright-core');
const [base, out, filter] = process.argv.slice(2);
const NOW = '2026-11-24T00:00:00Z';
const pages = [
  ['home', '/'], ['today', '/today/'], ['live', '/live/'], ['preclose', '/preclose/'], ['intraday', '/intraday/'],
  ['track', '/track-record/'], ['decay', '/strategy-decay/'], ['how', '/how-it-works.html'],
  ['about', '/about.html'], ['before-close', '/before-close/'],
];
const variants = [
  ['v2', `fixtures=1&now=${NOW}`],
  ['preopen', `fixtures=1&set=preopen&now=2026-11-23T22:45:00Z`],
  ['edge', `fixtures=1&set=edge&now=${NOW}`],
  ['stale', `fixtures=1&now=2026-11-26T03:00:00Z`],
  ['v1', `fixtures=v1&now=2026-11-23T11:00:00Z`],
  // pre-close window (15:30 Sydney): banner on Today / Live, countdown on /preclose/
  ['pcwindow', `fixtures=1&now=2026-11-24T04:30:00Z`, ['today', 'live', 'preclose']],
  ['pcstale', `fixtures=1&set=pcstale&now=2026-11-24T04:30:00Z`, ['preclose']],
  ['pcunpub', `fixtures=1&set=pcunpub&now=2026-11-24T04:30:00Z`, ['preclose']],
  ['pcpassed', `fixtures=1&now=2026-11-24T05:20:00Z`, ['preclose']],
  // the real v2.1 simulator output (dev/fixtures/real/metrics.json)
  ['real', `fixtures=1&set=real&now=2026-11-24T09:00:00Z`, ['track', 'home']],
  // the real v2.3 night scan (ranking option1) as of 20 Nov 2026 evening (dev/fixtures/real/today.json)
  ['realtoday', `fixtures=1&set=real&now=2026-11-20T11:30:00Z`, ['today']],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let failures = 0;
for (const [vname, qs, only] of variants) {
  for (const [name, path] of pages) {
    if (filter && !`${vname}:${name}`.includes(filter)) continue;
    if (only && !only.includes(name)) continue;
    for (const width of [1280, 390]) {
      if (vname !== 'v2' && width === 390 && !['today','live','track','preclose'].includes(name)) continue;
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/favicon|fonts\.g|googletagmanager|Failed to load resource: (the server responded with a status of 404|net::ERR_FAILED)/.test(m.text())) errors.push('console: ' + m.text()); });
      page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
      await page.route(/googletagmanager|google-analytics|fonts\.googleapis|fonts\.gstatic|workers\.dev/, r => r.abort());
      await page.goto(`${base}${path}?${qs}`, { waitUntil: 'load' });
      await page.waitForTimeout(900);
      const file = `${out}/${vname}_${name}_${width}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const xss = await page.evaluate(() => !!document.querySelector('img[src="x"], script:not([src]):not([data-ok])') && [...document.querySelectorAll('script:not([src])')].some(s => /alert/.test(s.textContent)));
      if (xss) errors.push('XSS: injected element found');
      console.log((errors.length ? 'FAIL ' : 'ok   ') + file + (errors.length ? '\n   ' + errors.join('\n   ') : ''));
      if (errors.length) failures++;
      await ctx.close();
    }
  }
}
await browser.close();
console.log(failures ? `${failures} page(s) with errors` : 'all pages clean');
process.exit(failures ? 1 : 0);
