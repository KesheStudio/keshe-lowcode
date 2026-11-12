import { test, expect } from '../support/fixtures.mjs';
import { prepareArticleSite } from '../support/site-data.mjs';
import {
  chooseBackend,
  chooseTarget,
  exportAndDownload,
  nextStep,
  openExportWizard,
  openLocalPage,
  unzipArtifact
} from '../support/export.mjs';
import { startStaticServer } from '../support/static-server.mjs';

test('导出产物通过本地静态服务打开：样式与运行时仍然生效；file:// 下显示 http 提示', async ({ page, request, tempSite, artifacts }, testInfo) => {
  await prepareArticleSite(request, tempSite.siteId);

  await openExportWizard(page, tempSite.siteId);
  await chooseTarget(page, 'web-static');
  await nextStep(page, 2);
  await nextStep(page, 3);
  await chooseBackend(page, 'none');
  const zip = await exportAndDownload(page, testInfo, 'offline.zip');
  const outDir = testInfo.outputPath('offline-site');
  const files = await unzipArtifact(zip, outDir);
  expect(files).toContain('web/index.html');
  expect(files).toContain('web/assets/css/site.css');
  expect(files).toContain('web/assets/js/site.js');
  expect(files).toContain('README.txt');

  const server = await startStaticServer(outDir);
  try {
    /* ---------- 首页：http（真实部署方式） ---------- */
    await page.goto(server.base + '/web/index.html', { waitUntil: 'load' });
  await expect(page).toHaveTitle(/首页/);
  await expect(page.locator('.lc-page')).toBeVisible();
  await expect(page.locator('#home-heading')).toContainText('离线首页');

  const pageStyle = await page.locator('.lc-page').evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      fontFamily: style.fontFamily,
      stylesheets: document.styleSheets.length
    };
  });
  expect(pageStyle.background, 'http 下主题背景应生效').not.toBe('rgba(0, 0, 0, 0)');
  expect(pageStyle.fontFamily, 'http 下字体应生效').not.toBe('');
  expect(pageStyle.stylesheets, 'http 下本地样式表应加载').toBeGreaterThan(0);

  const externals = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('script[src], link[href], img[src], iframe[src]'));
    return nodes.map((el) => el.src || el.href).filter((url) => /^(https?:|wss?:)/i.test(url || ''));
  });
  expect(
    externals.filter((url) => !url.startsWith(server.base)),
    '首页不应引用任何外部网络资源'
  ).toEqual([]);

  /* 交互：外观切换在当前页面实时生效。 */
  const modeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-lc-mode'));
  await page.locator('.lc-rt-theme-btn').click();
  await expect(page.locator('.lc-rt-theme-panel')).toBeVisible();
  await page.locator('[data-lc-mode-value="dark"]').click();
  await expect.poll(
    async () => page.evaluate(() => document.documentElement.getAttribute('data-lc-mode')),
    { message: '切到暗色后 html[data-lc-mode] 应更新' }
  ).toBe('dark');
  const bgAfter = await page.locator('.lc-page').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgAfter, '切到暗色后背景色应变化').not.toBe(pageStyle.background);
  expect(modeBefore).toBeTruthy();

  /* 交互：离线页面里的表单组件仍可输入。 */
  const homeInput = page.locator('[data-lc-block="home-field"] [data-lc-textfield-input]');
  await homeInput.fill('offline@example.com');
  await expect(homeInput).toHaveValue('offline@example.com');

  /* 交互：首页文章列表链接能直接跳转。 */
  await expect(page.locator('a[href="article-one.html"]'), '首页应列出文章链接').toBeVisible();
  await page.locator('a[href="article-one.html"]').first().click();
  await expect(page).toHaveTitle(/第一篇/);
  await expect(page.locator('#s1')).toContainText('安装与运行');

  /* ---------- 文章页：http ---------- */
  await expect(page.locator('.lc-article-aside'), '文章页右侧目录应生效').toBeVisible();
  await expect(page.locator('.lc-article-toc-list a[href^="#"]')).toHaveCount(3);
  await expect(page.locator('.lc-rt-search input[placeholder="在正文中检索"]')).toBeVisible();

  const articleExternals = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('script[src], link[href], img[src], iframe[src]'));
    return nodes.map((el) => el.src || el.href).filter((url) => /^(https?:|wss?:)/i.test(url || ''));
  });
  expect(
    articleExternals.filter((url) => !url.startsWith(server.base)),
    '文章页不应引用任何外部网络资源'
  ).toEqual([]);

  /* ---------- 图表页：http ---------- */
  await page.goto(server.base + '/web/chart.html', { waitUntil: 'load' });
  await expect(page).toHaveTitle(/图表页/);
  const chart = page.locator('[data-lc-block="chart-bar"]');
  await expect(chart, '图表区块应渲染出来').toBeVisible();
  await expect(chart.locator('svg.lc-ui-chart-svg'), '柱状图应输出 SVG').toHaveCount(1);
  await expect(chart).toContainText('季度访问量');
  const barRects = await chart.locator('svg.lc-ui-chart-svg rect').count();
  expect(barRects, '四组数据应画出柱形').toBeGreaterThanOrEqual(4);

    expect(artifacts.unexpectedConsoleErrors(), 'http 首页、文章页与图表页不应报控制台错误').toEqual([]);
  } finally {
    await server.close();
  }

  /* Web 产物不再承诺 file:// 双击可用；双击时至少能看到明确提示。 */
  await openLocalPage(page, outDir, 'web/index.html');
  await expect(page.locator('#lc-http-required')).toBeVisible();
  await expect(page.locator('#lc-http-required')).toContainText('这个包需要通过 http 访问');
});
