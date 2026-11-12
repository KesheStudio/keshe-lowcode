import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:9780';
const SITE = 'walkthrough-static-1108';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('console', (m) => console.log('[console]', m.type(), m.text()));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('response', (r) => { if (r.url().includes('/builder/')) console.log('[net]', r.status(), r.url()); });

await p.goto(BASE + '/builder.html?site=' + SITE);
await p.waitForSelector('[data-site-select]');
await p.waitForTimeout(800);
await p.click('[data-new-page]');
await p.waitForSelector('[data-new-page-title]');
await p.fill('[data-new-page-title]', '验收新页');
await p.click('[data-new-page-create]');
await p.waitForTimeout(2500);
const info = await p.evaluate(() => ({
  active: Array.from(document.querySelectorAll('.lc-builder-page-item.is-active')).map((el) => el.textContent.trim()),
  all: Array.from(document.querySelectorAll('[data-page-id]')).map((el) => ({ id: el.getAttribute('data-page-id'), text: el.textContent.trim(), active: el.classList.contains('is-active') })),
  status: (document.querySelector('[data-status]') || {}).textContent
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
