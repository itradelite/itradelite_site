// Needs playwright-core and Chrome. Run: PW_CORE=/path/to/node_modules/playwright-core/index.mjs node dev/browser_interact.mjs http://localhost:8765 
// (serve the worktree first: python3 -m http.server 8765)
const { chromium } = await import(process.env.PW_CORE || 'playwright-core');
const base = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/googletagmanager|fonts\.g/, r => r.abort());
let workerHits = 0;
const workerBodies = [];
await ctx.route(/workers\.dev/, r => { workerHits++; workerBodies.push(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"triggered"}' }); });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const res = [];
const check = (c, n) => { res.push((c ? 'ok   ' : 'FAIL ') + n); };
const q = '?fixtures=1&now=2026-11-24T00:00:00Z';
await page.goto(base + '/today/' + q); await page.waitForTimeout(800);
// saved strategy filter bug
await page.selectOption('#strategyFilter', 'MOMENTUM'); await page.waitForTimeout(200);
await page.reload(); await page.waitForTimeout(900);
check(await page.$eval('#strategyFilter', s => s.value) === 'MOMENTUM', 'saved strategy shown in dropdown after reload');
check((await page.$$eval('#tables tbody tr.row-main', r => r.length)) >= 1 && !(await page.textContent('#tables')).includes('AMP.AX\u2197AMP'), 'filter applied matches dropdown');
const recText = await page.textContent('#tables');
check(recText.includes('WTC.AX'), 'momentum row visible');
await page.selectOption('#strategyFilter', 'all');
// portfolio input
await page.fill('#portfolio', '1.2m'); await page.waitForTimeout(200);
check((await page.textContent('#portfolioHint')).includes('A$1,200,000'), '1.2m accepted');
await page.fill('#portfolio', 'abc'); await page.waitForTimeout(200);
const hint = await page.textContent('#portfolioHint');
check(/Not a number/.test(hint) && /A\$1,200,000/.test(hint) && await page.$eval('#portfolio', e => e.classList.contains('invalid')), 'bad input rejected visibly, last good value kept');
await page.fill('#portfolio', '100k'); await page.waitForTimeout(200);
await page.fill('#maxPos', '10'); await page.waitForTimeout(200);
const firstCard = await page.textContent('.order');
check(/Buy\s+5,012\s+sh/.test(firstCard.replace(/\s+/g,' ')) || /\(cap\)/.test(firstCard), 'max position 10% caps AMP order: ' + firstCard.replace(/\s+/g,' ').match(/Buy[^·]*/)?.[0]);
await page.fill('#maxPos', '500'); await page.waitForTimeout(200);
check(/Enter 1/.test(await page.textContent('#maxPosHint')), 'max position out of range rejected');
await page.fill('#maxPos', '25');
// compact rows: click expands detail; watchlist collapsed and remembered
check(await page.$$eval('#tables tr.row-detail', r => r.length > 0 && r.every(x => x.hidden)), 'setup details collapsed by default');
await page.click('#tables tr.row-compact >> nth=0'); await page.waitForTimeout(150);
check(await page.$eval('#tables tr.row-compact', tr => !tr.nextElementSibling.hidden && tr.getAttribute('aria-expanded') === 'true'), 'clicking a row expands its details');
await page.click('#tables tr.row-compact >> nth=0 >> .row-toggle'); await page.waitForTimeout(150);
check(await page.$eval('#tables tr.row-compact', tr => tr.nextElementSibling.hidden), 'toggle collapses it again');
check(await page.$eval('#watchDetails', d => !d.open && !d.querySelector('table')), 'full watchlist collapsed by default');
await page.click('#watchDetails > summary'); await page.waitForTimeout(300);
check(await page.$eval('#watchDetails', d => d.open && !!d.querySelector('table')), 'watchlist expands on click');
await page.reload(); await page.waitForTimeout(900);
check(await page.$eval('#watchDetails', d => d.open), 'watchlist open state remembered after reload');
await page.click('#watchDetails > summary'); await page.waitForTimeout(300);
const h = await page.evaluate(() => document.documentElement.scrollHeight);
check(h < 2600, 'Today page height at 1280 with fixtures: ' + h + 'px');
// Today: three exit plans on each recommended card, default marked
check(await page.$$eval('.order', cs => cs.length === 2 && cs.every(c => c.querySelectorAll('.xplans li').length === 3 && c.querySelectorAll('.xp-def').length === 1)), 'Today: each card lists 3 exit plans, one default');
// Today in the pre-close window shows the banner linking to /preclose/
await page.goto(base + '/today/?fixtures=1&now=2026-11-24T04:30:00Z'); await page.waitForTimeout(900);
check(/Pre-close picks are out/.test(await page.textContent('#banners')) && (await page.$eval('#banners a[href^="/preclose/"]', a => a.getAttribute('href'))).includes('fixtures=1'), 'Today: pre-close banner in the 15:00-16:00 window (fixtures param kept)');
const h2 = await page.evaluate(() => document.documentElement.scrollHeight);
check(h2 < 2750, 'Today page height with pre-close banner: ' + h2 + 'px');
// Pre-close page (fixtures): countdown ticks, refresh disabled
await page.goto(base + '/preclose/?fixtures=1&now=2026-11-24T04:30:00Z'); await page.waitForTimeout(900);
check((await page.textContent('#countdown')) === '29 min left', 'preclose countdown from fixtures now');
await page.click('#refreshBtn'); await page.waitForTimeout(300);
check(/Fixtures mode/.test(await page.textContent('#refreshStatus')) && workerHits === 0, 'preclose fixtures mode: refresh sends nothing');
await page.click('#tables tr.row-compact >> nth=0'); await page.waitForTimeout(150);
check(await page.$eval('#tables tr.row-compact', tr => !tr.nextElementSibling.hidden && tr.nextElementSibling.querySelectorAll('.xplans li').length === 3), 'preclose setup row expands with exit plans');
await page.fill('#portfolio', '50k'); await page.waitForTimeout(200);
check(/Buy\s+10,000\s+sh/.test((await page.textContent('.order')).replace(/\s+/g, ' ')), 'preclose sizing follows the portfolio input (50k => 10,000 LTR)');
await page.goto(base + '/today/' + q); await page.waitForTimeout(800);
check((await page.inputValue('#portfolio')) === '50000', 'sizing prefs shared with Today');
await page.fill('#portfolio', '100k'); await page.waitForTimeout(200);
// Track record: matrix click switches KPIs + chart; all-setups toggle
await page.goto(base + '/track-record/' + q); await page.waitForTimeout(900);
check(/Night picks · Fixed 5 days/.test(await page.textContent('#stakeChartTitle')) && !!(await page.$('#stakeChartHost svg path')), 'stake chart drawn for night/default');
await page.click('button.mcell[data-stream="preclose_proxy"][data-policy="trail_2atr"]'); await page.waitForTimeout(250);
check(/Pre-close · historical estimate · Trail 2×ATR/.test(await page.textContent('#stakeChartTitle')) && await page.$eval('button.mcell[data-stream="preclose_proxy"][data-policy="trail_2atr"]', b => b.getAttribute('aria-pressed') === 'true') && (await page.$$('button.mcell[aria-pressed="true"]')).length === 1, 'matrix click switches the chart and selection');
await page.click('button.mcell[data-stream="preclose_live"][data-policy="fixed_5d"]'); await page.waitForTimeout(250);
check(/collecting data since Wed 25 Nov 2026/.test(await page.textContent('#stakeChartHost')), 'n=0 live stream: chart says collecting data');
await page.click('#stakeToggle button[data-all="1"]'); await page.waitForTimeout(250);
check(/every setup/.test(await page.textContent('#stakeMethod')) && /all setups/.test(await page.textContent('#stakeChartTitle')), 'all-setups toggle');
await page.reload(); await page.waitForTimeout(900);
check(/all setups/.test(await page.textContent('#stakeChartTitle')), 'matrix selection remembered after reload');
await page.click('#stakeToggle button[data-all="0"]'); await page.click('button.mcell[data-stream="night"][data-policy="fixed_5d"]');
// live refresh: fixtures mode => no worker call
await page.goto(base + '/live/' + q); await page.waitForTimeout(800);
await page.click('#refreshBtn'); await page.waitForTimeout(300);
check(/Fixtures mode/.test(await page.textContent('#refreshStatus')) && workerHits === 0, 'fixtures mode: refresh sends nothing');
// production mode live page with mocked worker + mocked live.json
let liveCalls = 0;
await ctx.route(/\/public\/live\.json/, async r => { liveCalls++; const body = await (await fetch(base + '/dev/fixtures/live.json')).json(); if (liveCalls >= 3) body.generated_at_utc = '2099-01-01T00:00:00+00:00'; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); });
await page.addInitScript(() => { const _st = window.setTimeout; window.setTimeout = (f, ms, ...a) => _st(f, ms >= 20000 ? 50 : ms, ...a); });
await page.goto(base + '/live/'); await page.waitForTimeout(800);
await page.click('#refreshBtn'); await page.waitForTimeout(1500);
const st = await page.textContent('#refreshStatus');
check(workerHits === 1 && /^Updated \d\d:\d\d AEST$/.test(st), 'worker POST then poll until generated_at advances: "' + st + '"');
check(await page.$eval('#refreshBtn', b => b.disabled && /Wait/.test(b.textContent)), 'cooldown shown on button');
await page.reload(); await page.waitForTimeout(800);
check(await page.$eval('#refreshBtn', b => b.disabled), 'cooldown survives reload');
// pre-close page in production mode: worker POST {workflow:'preclose_scan'} then poll preclose.json until generated_at_utc advances
let pcCalls = 0;
await ctx.route(/\/public\/preclose\.json/, async r => {
  pcCalls++;
  if (pcCalls === 1) return r.fulfill({ status: 404, body: 'not found' });
  const body = await (await fetch(base + '/dev/fixtures/preclose.json')).json();
  if (pcCalls < 4) body.generated_at_utc = '2000-01-01T00:00:00+00:00'; else body.generated_at_utc = '2099-01-01T00:00:00+00:00';
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
const hitsBefore = workerHits;
await page.goto(base + '/preclose/'); await page.waitForTimeout(800);
check(/No pre-close scan published yet/.test(await page.textContent('#loadError')), 'preclose 404 => friendly empty state');
await page.click('#reloadBtn'); await page.waitForTimeout(600); // fetch 2: an older file becomes the baseline
check((await page.$$('.order')).length === 2, 'reload shows the (old) published file');
await page.click('#refreshBtn'); await page.waitForTimeout(2000);
const pst = await page.textContent('#refreshStatus');
check(workerHits === hitsBefore + 1 && JSON.parse(workerBodies[workerBodies.length - 1]).workflow === 'preclose_scan', 'preclose button POSTs {workflow:"preclose_scan"}');
check(/^Updated \d\d:\d\d AEST$/.test(pst) && pcCalls >= 4, 'preclose polls until generated_at_utc advances: "' + pst + '" after ' + pcCalls + ' fetches');
check(pcCalls >= 4 && (await page.$$('.order')).length === 2 && (await page.textContent('#loadError')).trim() === '' && /Thu 1 Jan/.test(await page.textContent('#deadline')), 'new pre-close picks rendered after the poll (generated 1 Jan 2099)');
check(await page.$eval('#refreshBtn', b => b.disabled && /Wait/.test(b.textContent)), 'preclose cooldown shown on button');
// mobile nav
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(base + '/intraday/' + q); await page.waitForTimeout(600);
await page.click('#hamburgerBtn'); await page.waitForTimeout(400);
check(await page.$eval('#mainNav', n => n.classList.contains('active')), 'hamburger opens nav');
check(await page.$eval('#mainNav a[href^="/intraday/"]', a => a.getAttribute('aria-current') === 'page' && a.getAttribute('href').includes('fixtures=1')), 'current nav item marked; fixtures param carried');
await page.setViewportSize({ width: 1280, height: 900 });
await page.selectOption('#intervalFilter', '30m'); await page.waitForTimeout(200);
check((await page.textContent('#tables')).includes('matched on 30m'), 'intraday 30m filter includes other_signals rows');
// before-close redirect
await page.goto(base + '/before-close/'); await page.waitForTimeout(800);
check(page.url().endsWith('/live/'), 'before-close redirects to /live/');
console.log(res.join('\n')); console.log(errs.length ? 'PAGE ERRORS: ' + errs.join('; ') : 'no page errors');
await browser.close();
