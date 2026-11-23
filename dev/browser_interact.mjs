// Needs playwright-core and Chrome. Run: PW_CORE=/path/to/node_modules/playwright-core/index.mjs node dev/browser_interact.mjs http://localhost:8765 
// (serve the worktree first: python3 -m http.server 8765)
const { chromium } = await import(process.env.PW_CORE || 'playwright-core');
const base = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/googletagmanager|fonts\.g/, r => r.abort());
let workerHits = 0;
await ctx.route(/workers\.dev/, r => { workerHits++; r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"triggered"}' }); });
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
check(h < 2500, 'Today page height at 1280 with fixtures: ' + h + 'px');
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
