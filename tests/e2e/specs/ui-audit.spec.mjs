import { test, expect } from '../support/fixtures.mjs';
import { deleteSiteFile } from '../support/api.mjs';
import { runUiAudit, testTitle, uiPages } from '../support/ui-audit.mjs';

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 }
];

/* builder / 导出向导需要“站点没有任何页面”的空态，先删临时站点的默认页面。
   其余页面在空站点或默认状态下都能看到自己的空态提示。 */
const NEEDS_EMPTY_SITE = new Set(['builder', 'export', 'page-import']);

for (const pageDef of uiPages) {
  for (const viewport of VIEWPORTS) {
    test(testTitle(pageDef, viewport), async ({ page, request, tempSite, tempBackendSite }, testInfo) => {
      /* 逐页穷举会串联空态、布局、输入框、弹窗四路径与返回入口，
         比单点用例长，给足超时避免被 90s 截断。 */
      testInfo.setTimeout(150_000);
      /* 后端功能页要先有带后端的站点，否则会被纯静态门禁挡住。 */
      const site = pageDef.backendSite ? tempBackendSite : tempSite;
      if (NEEDS_EMPTY_SITE.has(pageDef.key)) {
        await deleteSiteFile(request, site.siteId, 'pages/home.json');
      }
      await runUiAudit({
        page,
        siteId: site.siteId,
        pageDef,
        viewport,
        testInfo
      });
    });
  }
}

/* ---------- 项目类型开关：纯静态项目不该露出后端入口 ---------- */

/* 临时站点默认就是纯静态（backend.language=none），正好用来验证入口收敛。 */
const BACKEND_ENTRIES = [
  ['[data-code-entry]', '后端代码'],
  ['[data-middleware-entry]', '中间件'],
  ['[data-config-entry]', '配置中心']
];

for (const viewport of VIEWPORTS) {
  test('[静态项目] builder 不显示后端入口 ' + viewport.width, async ({ page, tempSite }) => {
    await page.setViewportSize(viewport);
    await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId), { waitUntil: 'domcontentloaded' });
    await page.locator('[data-canvas-wrap]').waitFor({ state: 'visible', timeout: 20_000 });
    /* 项目信息是异步拉取的，后端入口由 applySiteInfo 按项目类型隐藏；
       先等收敛再做断言，避免信息还没到、或窄屏下被 CSS 收起时误判。 */
    try {
      await expect.poll(
        async () => page.locator('[data-code-entry]').first().evaluate((el) => el.hidden),
        { timeout: 20_000, message: '纯静态项目的后端入口应在项目信息加载后隐藏' }
      ).toBe(true);
    } catch (error) {
      throw new Error('[产品缺陷] 纯静态项目 20 秒内仍未按项目类型隐藏后端入口（[data-code-entry]）');
    }

    for (const [selector, label] of BACKEND_ENTRIES) {
      const entry = page.locator(selector).first();
      if (await entry.isVisible().catch(() => false)) {
        throw new Error('[产品缺陷] 纯静态项目顶栏仍显示「' + label + '」入口（' + selector + '）');
      }
    }

    /* ≤900 时顶栏次要入口收进「更多」菜单，镜像按钮也要跟着隐藏。 */
    if (viewport.width <= 900) {
      await page.locator('[data-more-toggle]').first().click({ timeout: 8_000 });
      await page.waitForTimeout(200);
      const mirror = page.locator('[data-mirror="[data-code-entry]"]').first();
      if (await mirror.isVisible().catch(() => false)) {
        throw new Error('[产品缺陷] 纯静态项目「更多」菜单里仍显示「后端代码」镜像入口');
      }
    }
  });
}

/* ---------- 直接访问后端功能页：纯静态项目要给出口提示 ---------- */

const BACKEND_ONLY_PAGES = [
  { path: 'middleware.html', label: '中间件' },
  { path: 'config-center.html', label: '配置中心' }
];

for (const target of BACKEND_ONLY_PAGES) {
  for (const viewport of VIEWPORTS) {
    test('[静态项目] 直接访问' + target.label + '的出口提示 ' + viewport.width, async ({ page, tempSite }) => {
      await page.setViewportSize(viewport);
      const response = await page.goto('/' + target.path + '?site=' + encodeURIComponent(tempSite.siteId),
        { waitUntil: 'domcontentloaded' });
      if (!response || !response.ok()) throw new Error('[测试脚本] 页面打开失败：HTTP ' + (response ? response.status() : '无响应'));

      await page.locator('[data-gate]:not([hidden])').first().waitFor({ state: 'visible', timeout: 20_000 });
      /* 门禁文案会随版本调整（当前是「先选择一个项目」这类），只断言语义：说清要选项目，
         并给出非空说明；不绑定具体措辞。 */
      const title = String(await page.locator('[data-gate-title]').first().textContent() || '').trim();
      if (!title) throw new Error('[产品缺陷] 纯静态项目直接访问' + target.label + '时，门禁没有标题');
      if (!/选择|纯静态|项目/.test(title)) {
        throw new Error('[产品缺陷] ' + target.label + '的门禁标题没有说清要选择项目或项目类型：' + title);
      }
      const hint = String(await page.locator('[data-gate-hint]').first().textContent() || '').trim();
      if (!hint) throw new Error('[产品缺陷] ' + target.label + '的出口提示是空白文本');

      const back = page.locator('a[href="home.html"]').first();
      if (!(await back.isVisible().catch(() => false))) throw new Error('[产品缺陷] ' + target.label + '缺回工作台出口');
      await back.click({ timeout: 8_000 });
      await page.waitForURL('**/home.html', { timeout: 10_000 }).catch(() => {
        throw new Error('[产品缺陷] 点击回工作台入口没有离开' + target.label);
      });
    });
  }
}
