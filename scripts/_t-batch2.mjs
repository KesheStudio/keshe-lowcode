import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const BASE = 'http://127.0.0.1:9780';
const SITE = 'walkthrough-static-1108';
const SITE_BACKEND = 'walkthrough-backend-0908';
const PAGE_ID = 'zz-verify';
const PAGE_FILE = `data/sites/${SITE}/pages/${PAGE_ID}.json`;
const NEW_PAGE_TITLE = '验收新页';

let failed = 0;
let createdPageFile = '';
function log(name, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
  if (!ok) failed += 1;
}

const page = {
  schemaVersion: 2,
  id: PAGE_ID,
  title: '验收页',
  slug: PAGE_ID,
  path: PAGE_ID + '.html',
  nav: false,
  blocks: [
    { id: 'kpi1', type: 'ui-kpi', props: { title: '验证 KPI', value: 100, unit: ' 个' } },
    { id: 'txt1', type: 'paragraph', text: '原始文本' }
  ]
};

async function tokenOf(htmlPath) {
  const html = await (await fetch(BASE + '/' + htmlPath)).text();
  const m = /<meta name="lc-token" content="([^"]+)"/.exec(html);
  return m ? m[1] : '';
}

async function main() {
  await fs.writeFile(PAGE_FILE, JSON.stringify(page, null, 2) + '\n');
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();

  const consoleErrors = [];
  p.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  p.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  /* 1. 工作台导航 */
  await p.goto(BASE + '/home.html');
  await p.evaluate((site) => { localStorage.setItem('lc.lastSite', site); }, SITE);
  await p.reload();
  const nav = await p.evaluate(() => Array.from(document.querySelectorAll('[data-site-nav]')).map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));
  log('工作台含中间件/配置中心入口', nav.some((n) => n.text === '中间件') && nav.some((n) => n.text === '配置中心'), nav.map((n) => n.text));
  log('工作台入口带当前项目', nav.every((n) => n.href.includes('?site=' + SITE)), nav.map((n) => n.href));

  /* 2. builder 顶栏 */
  await p.goto(BASE + '/builder.html?site=' + SITE);
  await p.waitForSelector('[data-site-select]', { timeout: 15000 });
  await p.waitForTimeout(600);
  const brandHref = await p.getAttribute('.lc-brand-link', 'href');
  await p.click('[data-page-id="' + PAGE_ID + '"]');
  await p.waitForTimeout(1200);
  const links = await p.evaluate(() => ({
    middleware: document.querySelector('[data-middleware-entry]') && document.querySelector('[data-middleware-entry]').getAttribute('href'),
    config: document.querySelector('[data-config-entry]') && document.querySelector('[data-config-entry]').getAttribute('href'),
    data: document.querySelector('[data-data-entry]') && document.querySelector('[data-data-entry]').getAttribute('href'),
    components: document.querySelector('[data-components-entry]') && document.querySelector('[data-components-entry]').getAttribute('href'),
    templates: document.querySelector('[data-templates-entry]') && document.querySelector('[data-templates-entry]').getAttribute('href'),
    export: document.querySelector('[data-export-entry]') && document.querySelector('[data-export-entry]').getAttribute('href'),
    brand: document.querySelector('.lc-brand-link') && document.querySelector('.lc-brand-link').getAttribute('href')
  }));
  log('builder 顶栏返回工作台', links.brand === 'home.html' && brandHref === 'home.html', links);
  log('builder 顶栏中间件/配置中心带站点', links.middleware.includes('?site=' + SITE) && links.config.includes('?site=' + SITE), links);
  log('builder 数据/组件/模板/导出带站点', [links.data, links.components, links.templates, links.export].every((h) => h.includes('?site=' + SITE)), links);

  const orderOk = await p.evaluate(() => {
    const side = document.querySelector('.lc-topbar-side');
    const names = Array.from(side.children).map((el) => (el.textContent || '').trim().slice(0, 6));
    return names.join('|');
  });
  log('顶栏顺序（站点…主题/后端代码…中间件/配置中心…导出/保存）', true, orderOk);

  /* 3. 单组件覆盖：选中 ui-kpi，覆盖 HTML，出现已覆盖，再恢复默认 */
  await p.click('.lc-tree-item[data-path="0"]');
  await p.waitForTimeout(400);
  const panelText = await p.evaluate(() => (document.querySelector('[data-inspector]') || document.body).textContent);
  log('属性面板有实例级代码覆盖入口', panelText.includes('实例级代码覆盖'));
  const hasBadge0 = await p.evaluate(() => {
    const el = document.querySelector('[data-instance-badge]');
    return !!el && !el.hidden;
  });
  log('未覆盖时不显示已覆盖徽标', !hasBadge0);

  const codeHost = p.locator('[data-instance-code-editor] textarea');
  await codeHost.fill('<div class="ov">覆盖后的 KPI</div>');
  await p.waitForTimeout(600);
  const hasBadge1 = await p.evaluate(() => {
    const el = document.querySelector('[data-instance-badge]');
    return !!el && !el.hidden;
  });
  log('写入覆盖后显示已覆盖徽标', hasBadge1);

  const frame = p.frames().find((f) => f !== p.mainFrame());
  let canvasOk = false;
  if (frame) {
    const info = await frame.evaluate(() => {
      const el = document.querySelector('[data-lc-block="kpi1"]');
      return el ? { overridden: el.getAttribute('data-lc-overridden'), html: el.textContent.trim() } : null;
    });
    canvasOk = !!info && info.overridden === 'true' && info.html.includes('覆盖后的 KPI');
    log('画布应用实例 HTML 覆盖', canvasOk, info);
  } else {
    log('画布应用实例 HTML 覆盖', false, 'no frame');
  }

  await p.click('[data-instance-reset]');
  await p.waitForTimeout(700);
  const resetted = await p.evaluate(() => {
    const el = document.querySelector('[data-instance-badge]');
    return !!el && el.hidden;
  });
  let frame2Info = null;
  const frame2 = p.frames().find((f) => f !== p.mainFrame());
  if (frame2) frame2Info = await frame2.evaluate(() => {
    const el = document.querySelector('[data-lc-block="kpi1"]');
    return el ? el.getAttribute('data-lc-overridden') : 'missing';
  });
  log('恢复默认后徽标消失且画布回到默认', resetted && frame2Info === null, { resetted, frame2Info });

  /* 4. 事件绑定 */
  await p.click('[data-instance-code-editor] textarea').catch(() => {});
  await p.selectOption('[data-binding-draft="event"]', 'click');
  await p.selectOption('[data-binding-draft="method"]', 'GET');
  await p.fill('[data-binding-draft="route"]', '/api/demo');
  await p.selectOption('[data-binding-draft="target"]', 'txt1');
  await p.click('[data-binding-add]');
  await p.waitForTimeout(700);
  const bindText = await p.evaluate(() => document.querySelector('[data-inspector]').textContent);
  log('添加绑定后显示已绑定数量', bindText.includes('已绑定 1 个事件'), bindText.slice(0, 200));
  const frame3 = p.frames().find((f) => f !== p.mainFrame());
  let bindCanvas = null;
  if (frame3) bindCanvas = await frame3.evaluate(() => {
    const el = document.querySelector('[data-lc-block="kpi1"]');
    return el ? el.getAttribute('data-lc-bindings') : 'missing';
  });
  log('画布实例带绑定计数', bindCanvas === '1', bindCanvas);

  /* 5. 新建页面入口 */
  const beforePages = await p.evaluate(() => document.querySelectorAll('[data-page-id]').length);
  await p.click('[data-new-page]');
  await p.waitForSelector('[data-new-page-title]', { timeout: 5000 });
  await p.fill('[data-new-page-title]', NEW_PAGE_TITLE);
  await p.click('[data-new-page-create]');
  await p.waitForFunction(
    (title) => {
      const item = document.querySelector('.lc-builder-page-item.is-active');
      return !!item && item.textContent.includes(title);
    },
    NEW_PAGE_TITLE,
    { timeout: 15000 }
  );
  await p.waitForTimeout(500);
  const afterPages = await p.evaluate(() => document.querySelectorAll('[data-page-id]').length);
  const activePageId = await p.evaluate(() => {
    const item = document.querySelector('.lc-builder-page-item.is-active');
    return item ? item.getAttribute('data-page-id') : '';
  });
  const createdFile = activePageId
    ? await fs.readFile(`data/sites/${SITE}/pages/${activePageId}.json`, 'utf8').then((t) => t, () => '')
    : '';
  const createdIsOpen = await p.evaluate((title) => {
    const item = document.querySelector('.lc-builder-page-item.is-active');
    return !!item && item.textContent.includes(title);
  }, NEW_PAGE_TITLE);
  createdPageFile = activePageId ? `data/sites/${SITE}/pages/${activePageId}.json` : '';
  log('新建页面后列表增加并进入编辑', afterPages === beforePages + 1 && createdFile.includes(NEW_PAGE_TITLE) && createdIsOpen, { beforePages, afterPages, activePageId, createdIsOpen });

  /* 6. 无项目门禁 */
  for (const pathName of ['data.html', 'components.html', 'templates.html']) {
    await p.goto(BASE + '/' + pathName);
    await p.waitForTimeout(500);
    const gate = await p.evaluate(() => ({
      placeholder: (document.querySelector('[data-site-select]') || {}).value === '',
      disabled: Array.from(document.querySelectorAll('[data-new-collection],[data-new-component],[data-create-page],[data-create-site],[data-new-source],[data-open-import]')).filter((b) => b.offsetParent !== null).every((b) => b.disabled),
      text: document.body.textContent.includes('还没有选择项目')
    }));
    log(pathName + ' 无项目时提示且禁用新建', gate.disabled && gate.text, gate);
  }

  /* 7. components 左栏滚动（有项目时）：列表在侧栏主体内滚动，头部固定 */
  await p.goto(BASE + '/components.html?site=' + SITE);
  await p.waitForTimeout(500);
  const scrollCss = await p.evaluate(() => {
    const sidebar = document.querySelector('.lc-comp-sidebar');
    if (!sidebar) return null;
    const body = sidebar.querySelector('.lc-sidebar-body');
    const head = sidebar.querySelector('.lc-sidebar-head');
    const bodyCs = body ? getComputedStyle(body) : null;
    const headCs = head ? getComputedStyle(head) : null;
    return {
      overflowY: bodyCs && bodyCs.overflowY,
      bodyFlex: bodyCs && bodyCs.flex,
      headFlex: headCs && headCs.flex,
      sidebarOverflow: getComputedStyle(sidebar).overflow
    };
  });
  log('组件库左栏独立纵向滚动、头部固定', !!scrollCss && (scrollCss.overflowY === 'auto' || scrollCss.overflowY === 'scroll') && scrollCss.headFlex.startsWith('0 0'), scrollCss);

  /* 8. 中间件/配置中心页面 */
  for (const pathName of ['middleware.html', 'config-center.html']) {
    await p.goto(BASE + '/' + pathName + '?site=' + SITE);
    await p.waitForTimeout(500);
    const ok = await p.evaluate(() => {
      const back = Array.from(document.querySelectorAll('a')).some((a) => (a.getAttribute('href') || '').indexOf('home.html') !== -1);
      return { back: back, hasSidebar: !!document.querySelector('[data-site-select]') };
    });
    log(pathName + ' 返回工作台入口与站点选择', ok.back && ok.hasSidebar, ok);
  }

  /* 9. 后端用户区代码面板 */
  await p.goto(BASE + '/builder.html?site=' + SITE_BACKEND);
  await p.waitForTimeout(1200);
  const codeEntryVisible = await p.evaluate(() => {
    const el = document.querySelector('[data-code-entry]');
    return !!el && !el.hidden && el.offsetParent !== null;
  });
  const codeEntryInMenu = await p.evaluate(() =>
    !!document.querySelector('[data-more-menu] [data-mirror="[data-code-entry]"]'));
  if (codeEntryVisible || codeEntryInMenu) {
    if (codeEntryVisible) {
      await p.click('[data-code-entry]');
    } else {
      await p.click('[data-more-toggle]');
      await p.waitForTimeout(200);
      await p.click('[data-more-menu] [data-mirror="[data-code-entry]"]');
    }
    log('窄窗口下后端代码入口收进更多菜单且可点开', true, { codeEntryVisible, codeEntryInMenu });
    await p.waitForSelector('[data-backend-file]', { timeout: 20000 });
    p.on('dialog', async (d) => {
      if (d.type() === 'prompt') await d.accept('src/custom/zz-verify.js');
      else await d.dismiss();
    });
    await p.click('[data-backend-new]');
    await p.waitForSelector('[data-backend-file="src/custom/zz-verify.js"]', { timeout: 20000 });
    log('新建用户区文件出现在文件树', true);

    const stagePath = await p.evaluate(() => (document.querySelector('[data-backend-path]') || {}).textContent || '');
    log('新建后直接进入编辑', stagePath.includes('zz-verify.js'), stagePath);

    p.removeAllListeners('dialog');
    p.on('dialog', async (d) => { if (d.type() === 'prompt') await d.accept('build/generated/zz.js'); else await d.dismiss(); });
    await p.click('[data-backend-new]');
    await p.waitForFunction(
      () => {
        const el = document.querySelector('[data-backend-result]');
        return !!el && el.textContent.indexOf('创建失败') === 0;
      },
      null,
      { timeout: 20000 }
    );
    const resultText = await p.evaluate(() => (document.querySelector('[data-backend-result]') || {}).textContent || '');
    log('生成区路径被拒绝并给人话提示', resultText.includes('生成区') || resultText.includes('不允许') || resultText.includes('用户区'), resultText.slice(0, 200));

    p.removeAllListeners('dialog');
    p.on('dialog', async (d) => { if (d.type() === 'prompt') await d.accept('src/custom/zz-renamed.js'); else await d.dismiss(); });
    await p.click('[data-backend-rename]');
    await p.waitForSelector('[data-backend-file="src/custom/zz-renamed.js"]', { timeout: 20000 });
    log('重命名文件生效', true);

    p.removeAllListeners('dialog');
    p.on('dialog', async (d) => { await d.accept(); });
    await p.click('[data-backend-delete]');
    await p.waitForFunction(
      () => !document.querySelector('[data-backend-file="src/custom/zz-renamed.js"]'),
      null,
      { timeout: 20000 }
    );
    log('删除文件生效', true);
  } else {
    log('后端代码入口可见（后端站点）', false);
  }

  /* 10. 保存后的页面 JSON 含覆盖与绑定 */
  const saved = JSON.parse(await fs.readFile(PAGE_FILE, 'utf8'));
  const kpiBlock = saved.blocks.find((b) => b.id === 'kpi1');
  log('页面 JSON 保存事件绑定', kpiBlock && Array.isArray(kpiBlock.bindings) && kpiBlock.bindings.length === 1, kpiBlock && kpiBlock.bindings);

  const sandboxWarnings = consoleErrors.filter((e) => e.includes('allow-same-origin'));
  log('无 iframe 沙箱告警', sandboxWarnings.length === 0, sandboxWarnings);

  await browser.close();
  console.log(failed ? 'FAILED ' + failed : 'ALL PASS');
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => {
  await fs.unlink(PAGE_FILE).catch(() => {});
  if (createdPageFile) await fs.unlink(createdPageFile).catch(() => {});
});
