import { test, expect, readFixture } from '../support/fixtures.mjs';
import { api, getPage, importResource, renderPage } from '../support/api.mjs';

test('切换主题与亮暗，画布渲染无报错', async ({ page, request, tempSite, artifacts }) => {
  await importResource(request, tempSite.siteId, 'page', 'page.json', await readFixture('page.json'));
  const saved = await getPage(request, tempSite.siteId, 'e2e-canvas');
  const pageData = saved.page;

  const builtin = await api(request, 'GET', '/api/themes');
  expect(builtin.themes.length, '至少要有 2 套内置主题').toBeGreaterThan(1);

  const siteInfo = await api(request, 'GET', '/api/sites/' + encodeURIComponent(tempSite.siteId) + '/builder/site');
  expect(siteInfo.themes.length, '新建站点应带一套默认主题').toBeGreaterThan(0);
  const primaryId = siteInfo.themes[0].id;

  // 新建站点默认只装了一套主题；通过站点文件接口再装一套内置主题，模拟「换主题」。
  const alt = builtin.themes.find((item) => item.id !== primaryId);
  expect(alt, '应能找到与默认主题不同的内置主题').toBeTruthy();
  const altDetail = await api(request, 'GET', '/api/sites/' + encodeURIComponent(tempSite.siteId) + '/theme/' + encodeURIComponent(alt.id));
  await api(request, 'PUT', '/api/sites/' + encodeURIComponent(tempSite.siteId) + '/file?path=themes/' + encodeURIComponent(alt.id) + '.json', {
    content: JSON.stringify(altDetail.themeJson, null, 2)
  });

  const picked = [primaryId, alt.id];
  for (const themeId of picked) {
    const detail = await api(request, 'GET', '/api/sites/' + encodeURIComponent(tempSite.siteId) + '/theme/' + encodeURIComponent(themeId));
    expect(detail.theme.variables['--lc-color-accent'], themeId + ' 应有强调色变量').toBeTruthy();
    expect(detail.theme.dark['--lc-color-accent'], themeId + ' 应有暗色强调色变量').toBeTruthy();
    expect(detail.theme.light['--lc-color-bg'], themeId + ' 应有亮色背景变量').toBeTruthy();
    expect(detail.theme.dark['--lc-color-bg'], themeId + ' 应有暗色背景变量').toBeTruthy();
  }

  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) + '&page=e2e-canvas');
  await expect(page.locator('[data-page-title]')).toHaveValue('E2E 画布页');

  const canvasFrame = page.locator('[data-canvas]');
  const canvas = page.frameLocator('[data-canvas]');

  const applyDocument = async (document) => {
    await page.evaluate((html) => {
      const frame = document.querySelector('[data-canvas]');
      frame.srcdoc = html;
    }, document);
    await expect(canvas.locator('body')).toBeVisible();
  };

  const lightAccents = new Map();

  for (const themeId of picked) {
    for (const mode of ['light', 'dark']) {
      const rendered = await renderPage(request, tempSite.siteId, pageData, themeId, mode);
      expect(rendered.document, themeId + ' / ' + mode + ' 应有渲染结果').toContain('画布测试标题');
      expect(rendered.document).toContain('data-lc-mode="' + mode + '"');
      expect(rendered.document, '渲染结果不应引用外链资源').not.toMatch(/<(?:script|link|img|iframe)[^>]+(?:src|href)="https?:\/\//i);

      await applyDocument(rendered.document);

      await expect
        .poll(async () => {
          return canvas.locator('html').getAttribute('data-lc-mode');
        }, { message: themeId + ' / ' + mode + ' 画布应切换明暗' })
        .toBe(mode);

      await expect
        .poll(async () => {
          return canvas.locator('.lc-page').evaluate((themed) => {
            return getComputedStyle(themed).getPropertyValue('--lc-color-accent').trim();
          });
        }, { message: themeId + ' / ' + mode + ' 画布应拿到主题强调色' })
        .toMatch(/^#|^rgb/);

      if (mode === 'light') {
        const accent = await canvas.locator('.lc-page').evaluate((themed) => {
          return getComputedStyle(themed).getPropertyValue('--lc-color-accent').trim();
        });
        lightAccents.set(themeId, accent);
      }

      const blockCount = await canvas.locator('.lc-block').count();
      expect(blockCount, '切换主题后内容仍在').toBeGreaterThan(0);
    }
  }

  expect(new Set(lightAccents.values()).size, '换主题后强调色应真的不同').toBe(lightAccents.size);

  expect(artifacts.unexpectedConsoleErrors(), '主题切换不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '主题切换不应有未捕获异常').toEqual([]);
});
