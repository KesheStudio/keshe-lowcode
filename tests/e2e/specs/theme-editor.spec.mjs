import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { test, expect, readFixture } from '../support/fixtures.mjs';
import { api, apiResponse, importResource } from '../support/api.mjs';

const ACCENT_LIGHT = '#be123c';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, label + ' 不应出现横向溢出').toBeLessThanOrEqual(1);
}

test('主题编辑器读写站点主题，builder 与导出产物同步，两档宽度可用', async ({ page, request, tempSite, artifacts }, testInfo) => {
  const siteId = tempSite.siteId;
  await importResource(request, siteId, 'page', 'page.json', await readFixture('page.json'));

  // ---------- 1. 编辑器打开不再是 404，能改站点令牌并保存 ----------
  await page.setViewportSize(DESKTOP);
  const editorResponse = await page.goto('/theme/editor.html?site=' + encodeURIComponent(siteId));
  expect(editorResponse && editorResponse.status(), '主题编辑器应正常返回').toBe(200);
  await expect(page.locator('#teSiteBadge')).toContainText(tempSite.name);
  await expect(page.locator('#teSiteModeLabel')).toBeVisible();
  await expect(page.locator('#teThemeList')).toContainText('内置主题');
  await expect(page.locator('[data-save-label]')).toHaveText('保存到站点');
  await expect(page.locator('#teBackHome')).toHaveAttribute('href', '../home.html');

  const accentInput = page.locator('#teSeeds input[type="color"][data-seed="accent"]');
  await accentInput.evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, ACCENT_LIGHT);
  await page.locator('#teSiteMode').selectOption('dark');
  await page.locator('[data-save]').click();
  await expect(page.locator('#teToast')).toContainText('已保存到站点');

  const themeDetail = await api(request, 'GET', '/api/sites/' + encodeURIComponent(siteId) + '/theme');
  expect(themeDetail.themeJson.modes.light.seeds.accent.toLowerCase()).toBe(ACCENT_LIGHT);
  const savedThemes = await api(request, 'GET', '/api/sites/' + encodeURIComponent(siteId) + '/themes');
  expect(savedThemes.themes.some((theme) => theme.id === themeDetail.themeJson.id), '站点应落盘主题文件').toBe(true);

  const siteInfo = await api(request, 'GET', '/api/sites/' + encodeURIComponent(siteId));
  expect(siteInfo.project.theme.activeId).toBe(themeDetail.themeJson.id);
  expect(siteInfo.project.theme.mode).toBe('dark');
  const darkAccent = themeDetail.theme.dark['--lc-color-accent'];

  await assertNoHorizontalOverflow(page, '1280 编辑器');
  await testInfo.attach('theme-editor-1280.png', {
    body: await page.screenshot(),
    contentType: 'image/png'
  });

  await page.setViewportSize(MOBILE);
  await expect(page.locator('[data-save]')).toBeVisible();
  await assertNoHorizontalOverflow(page, '390 编辑器');
  await testInfo.attach('theme-editor-390.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  });

  // ---------- 2. builder 刷新即读到同一份站点主题 ----------
  await page.setViewportSize(DESKTOP);
  await page.goto('/builder.html?site=' + encodeURIComponent(siteId) + '&page=e2e-canvas');
  await expect(page.locator('[data-page-title]')).toHaveValue('E2E 画布页');
  await expect(page.locator('a[data-theme-editor-entry]')).toHaveCount(1);
  /* 宽屏时入口直接显示；窄屏才收进「更多」菜单，这里按实际可见性走。 */
  const moreToggle = page.locator('[data-more-toggle]');
  if (await moreToggle.isVisible().catch(() => false)) {
    await moreToggle.click();
    await expect(page.locator('[data-more-menu] a[data-mirror="[data-theme-editor-entry]"]')).toBeVisible();
    await moreToggle.click();
  } else {
    await expect(page.locator('a[data-theme-editor-entry]')).toBeVisible();
  }
  const canvas = page.frameLocator('[data-canvas]');
  await expect(canvas.locator('.lc-page')).toBeVisible();

  await expect
    .poll(async () => canvas.locator('html').getAttribute('data-lc-mode'), { message: 'builder 画布应跟随站点默认暗色' })
    .toBe('dark');

  await expect
    .poll(async () => {
      return canvas.locator('.lc-page').evaluate((themed) => getComputedStyle(themed).getPropertyValue('--lc-color-accent').trim());
    }, { message: 'builder 画布应读到编辑器保存的暗色强调色' })
    .toBe(darkAccent);

  await page.setViewportSize(MOBILE);
  if (await moreToggle.isVisible().catch(() => false)) {
    await moreToggle.click();
    await expect(page.locator('[data-more-menu] a[data-mirror="[data-theme-editor-entry]"]')).toBeVisible();
    await moreToggle.click();
  }

  // ---------- 3. 首页入口可见 ----------
  await page.setViewportSize(DESKTOP);
  await page.goto('/home.html');
  await expect(page.locator('a[href^="theme/editor.html"]')).toBeVisible();

  // ---------- 4. 导出产物读同一份站点主题，暗色为默认 ----------
  const build = await api(request, 'POST', '/api/sites/' + encodeURIComponent(siteId) + '/export', { target: 'web-static' });
  const zipResponse = await apiResponse(request, 'GET', build.downloadUrl);
  const zip = await JSZip.loadAsync(await zipResponse.body());

  const css = await zip.file('web/assets/css/site.css').async('string');
  expect(css.toLowerCase(), '导出 CSS 应包含编辑器保存的亮色强调色').toContain(ACCENT_LIGHT);
  const runtimeJs = await zip.file('web/assets/js/site.js').async('string');
  expect(runtimeJs).toContain('var fallbackMode = "dark";');

  const htmlEntries = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.html$/i.test(name)) continue;
    htmlEntries.push({ name, html: await entry.async('string') });
  }
  const targetPage = htmlEntries.find((entry) => entry.html.includes('画布测试标题'));
  expect(targetPage, '导出产物应包含测试页面').toBeTruthy();
  expect(targetPage.html).toContain('data-lc-theme="' + themeDetail.themeJson.id + '"');
  expect(targetPage.html).toContain('?pref:"dark";');

  const exportDir = testInfo.outputPath('exported');
  await fs.mkdir(exportDir, { recursive: true });
  for (const [name, entry] of Object.entries(zip.files)) {
    const target = path.join(exportDir, name);
    if (entry.dir) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(await entry.async('nodebuffer')));
  }

  const exportUrl = pathToFileURL(path.join(exportDir, targetPage.name)).href;
  await page.setViewportSize(DESKTOP);
  await page.goto(exportUrl);
  await expect(page.locator('body')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-lc-mode'))).toBe('dark');
  const exportAccent = await page.evaluate(() => {
    const themed = document.querySelector('.lc-page');
    return themed ? getComputedStyle(themed).getPropertyValue('--lc-color-accent').trim() : '';
  });
  expect(exportAccent).toBe(darkAccent);
  await assertNoHorizontalOverflow(page, '1280 导出产物');
  await testInfo.attach('export-1280.png', {
    body: await page.screenshot(),
    contentType: 'image/png'
  });

  /* 产物里的亮暗切换应直接换成对应令牌，而不是仅改一个属性。 */
  const lightAccent = themeDetail.theme.light['--lc-color-accent'];
  await page.locator('.lc-rt-theme-btn').click();
  await page.locator('.lc-rt-modes button', { hasText: '亮' }).evaluate((element) => element.click());
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-lc-mode'))).toBe('light');
  const exportLightAccent = await page.evaluate(() => {
    const themed = document.querySelector('.lc-page');
    return themed ? getComputedStyle(themed).getPropertyValue('--lc-color-accent').trim() : '';
  });
  expect(exportLightAccent).toBe(lightAccent);

  await page.setViewportSize(MOBILE);
  await assertNoHorizontalOverflow(page, '390 导出产物');
  await testInfo.attach('export-390.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  });

  expect(artifacts.unexpectedConsoleErrors(), '主题编辑器流程不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '主题编辑器流程不应有未捕获异常').toEqual([]);
});
