import fs from 'node:fs/promises';
import { test, expect } from '../support/fixtures.mjs';
import { getPage, renderPage, writeSiteFile } from '../support/api.mjs';
import {
  exportAndDownload,
  openExportWizard,
  openLocalPage,
  readExtracted,
  unzipArtifact
} from '../support/export.mjs';

const OVERRIDE_PAGE = {
  schemaVersion: 2,
  id: 'ui-override',
  slug: 'ui-override',
  path: 'ui-override.html',
  title: '内置组件实例覆盖',
  layout: { mode: 'flow' },
  blocks: [
    { id: 'ov-block', type: 'ui-slider', props: { label: '覆盖实例', min: 0, max: 100, step: 1, value: 30 } },
    { id: 'plain-block', type: 'ui-slider', props: { label: '默认实例', min: 0, max: 100, step: 1, value: 20 } }
  ]
};

const SOURCE_PAGE = {
  schemaVersion: 2,
  id: 'ui-slider-source',
  slug: 'ui-slider-source',
  path: 'ui-slider-source.html',
  title: '滑块数据源',
  layout: { mode: 'flow' },
  blocks: [
    {
      id: 'sl-range', type: 'ui-slider',
      props: {
        label: '区间取值', datasource: 'demo-range', sourceMode: 'range', value: 40,
        sourceUnconfiguredText: '区间源未注册'
      }
    },
    {
      id: 'sl-stops', type: 'ui-slider',
      props: {
        label: '档位取值', datasource: 'demo-stops', sourceMode: 'stops', value: 30,
        sourceEmptyText: '档位源为空'
      }
    },
    {
      id: 'sl-fail', type: 'ui-slider',
      props: { label: '失败数据源', datasource: 'demo-fail', sourceMode: 'range', value: 20 }
    },
    {
      id: 'sl-missing', type: 'ui-slider',
      props: { label: '未注册数据源', datasource: 'demo-missing', sourceMode: 'range', value: 20 }
    },
    {
      id: 'sl-dual', type: 'ui-slider',
      props: {
        label: '双值区间', datasource: 'demo-range', sourceMode: 'range', range: true, value: [30, 60]
      }
    }
  ]
};

/* 数据源注册必须在组件包执行之前完成；initScript 先于页面脚本运行，
   这里只占用 LC.Render.dataSources，组件包里的 datasource.js 会沿用同一个对象。 */
const SOURCE_SEED = `
  window.LC = window.LC || {};
  window.LC.Render = window.LC.Render || {};
  window.LC.Render.dataSources = {
    'demo-range': {
      range: function () { return Promise.resolve({ min: 10, max: 90, step: 5 }); }
    },
    'demo-stops': {
      stops: function () {
        return Promise.resolve([
          { value: 10, label: '低' },
          { value: 30, label: '中' },
          { value: 60, label: '高' },
          { value: 90, label: '极高' }
        ]);
      }
    },
    'demo-fail': {
      range: function () { return Promise.reject(new Error('e2e 数据源不可用')); }
    }
  };
`;

function slider(page, blockId) {
  return page.locator('[data-lc-block="' + blockId + '"] [data-lc-ui="ui-slider"]');
}

test('内置组件单实例代码覆盖：只影响该实例，随导出保留，可一键恢复', async ({ page, request, tempSite, artifacts }, testInfo) => {
  test.setTimeout(240_000);
  await writeSiteFile(request, tempSite.siteId, 'pages/ui-override.json', JSON.stringify(OVERRIDE_PAGE));

  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) + '&page=ui-override');
  await expect(page.locator('[data-page-title]')).toHaveValue('内置组件实例覆盖');
  await expect(page.locator('[data-layer-tree] .lc-tree-item')).toHaveCount(2);

  await page.locator('[data-layer-tree] .lc-tree-item[data-path="0"]').click();
  await expect(page.locator('[data-inspector-title]')).toHaveText('滑块');
  await expect(page.locator('[data-instance-code-editor]')).toBeVisible();
  await expect(page.locator('[data-instance-badge]')).toBeHidden();
  await expect(page.locator('[data-instance-reset]')).toBeHidden();

  await page.locator('[data-instance-code-editor] textarea').fill('<div class="e2e-inst-override">覆盖后的 HTML</div>');
  await page.locator('[data-code-tab="css"]').click();
  await page.locator('[data-instance-code-editor] textarea').fill('.e2e-inst-override { color: rgb(179, 38, 30); }');
  await page.locator('[data-code-tab="js"]').click();
  await page.locator('[data-instance-code-editor] textarea').fill('window.__e2eOverrideJs = true;');

  await expect(page.locator('[data-instance-badge]')).toBeVisible();
  await expect(page.locator('[data-instance-reset]')).toBeVisible();
  await expect
    .poll(async () => {
      const saved = await getPage(request, tempSite.siteId, 'ui-override');
      return saved.page.blocks[0].overrides || null;
    }, { timeout: 20_000, message: '实例覆盖应自动保存到页面 JSON' })
    .toMatchObject({
      html: '<div class="e2e-inst-override">覆盖后的 HTML</div>',
      js: 'window.__e2eOverrideJs = true;'
    });

  const frame = page.frameLocator('[data-canvas]');
  await expect(frame.locator('[data-lc-block="ov-block"] .e2e-inst-override')).toHaveCount(1);
  await expect(frame.locator('[data-lc-block="plain-block"] .e2e-inst-override')).toHaveCount(0);
  await expect(frame.locator('[data-lc-block="plain-block"] .lc-ui-slider-track')).toHaveCount(1);

  /* 同类型的另一个实例不受影响：没有「已覆盖」标记，编辑器为空。 */
  await page.locator('[data-layer-tree] .lc-tree-item[data-path="1"]').click();
  await expect(page.locator('[data-inspector-title]')).toHaveText('滑块');
  await expect(page.locator('[data-instance-badge]')).toBeHidden();
  await expect(page.locator('[data-instance-code-editor] textarea')).toHaveValue('');

  const savedPage = await getPage(request, tempSite.siteId, 'ui-override');
  const rendered = await renderPage(request, tempSite.siteId, savedPage.page, 'ink-green', 'light');
  expect(rendered.document).toContain('data-lc-instance="ov-block"');
  expect(rendered.document).not.toContain('data-lc-instance="plain-block"');
  expect((rendered.document.match(/data-lc-overridden="true"/g) || []).length).toBe(1);

  await openExportWizard(page, tempSite.siteId);
  const zipPath = await exportAndDownload(page, testInfo, 'builtin-override.zip');
  const destDir = testInfo.outputPath('unzipped');
  await unzipArtifact(zipPath, destDir);
  const exportedHtml = await readExtracted(destDir, 'web/ui-override.html');
  const exportedCss = await readExtracted(destDir, 'web/assets/css/site.css');
  expect(exportedHtml).toContain('data-lc-instance="ov-block"');
  expect(exportedHtml).toContain('e2e-inst-override');
  expect(exportedHtml).not.toContain('data-lc-instance="plain-block"');
  expect(exportedCss).toContain('[data-lc-instance="ov-block"] .e2e-inst-override');
  expect(exportedHtml).toContain('__e2eOverrideJs');
  expect(exportedHtml).toContain('enhanceBuiltins');

  await openLocalPage(page, destDir, 'web/ui-override.html');
  await expect(page.locator('[data-lc-block="ov-block"] .e2e-inst-override')).toHaveText('覆盖后的 HTML');
  await expect(page.locator('[data-lc-block="plain-block"] .lc-ui-slider-track')).toHaveCount(1);
  expect(await page.evaluate(() => window.__e2eOverrideJs === true)).toBe(true);

  /* 一键恢复：覆盖字段清空，画布回到默认结构，其它实例不受影响。 */
  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) + '&page=ui-override');
  await page.locator('[data-layer-tree] .lc-tree-item[data-path="0"]').click();
  await expect(page.locator('[data-instance-badge]')).toBeVisible();
  await page.locator('[data-instance-reset]').click();
  await expect(page.locator('[data-instance-badge]')).toBeHidden();
  await expect(page.locator('[data-instance-reset]')).toBeHidden();
  await expect
    .poll(async () => {
      const saved = await getPage(request, tempSite.siteId, 'ui-override');
      return saved.page.blocks[0].overrides;
    }, { timeout: 20_000, message: '恢复默认后页面 JSON 不应保留覆盖' })
    .toBeUndefined();
  await expect(page.frameLocator('[data-canvas]').locator('[data-lc-block="ov-block"] .lc-ui-slider-track')).toHaveCount(1);

  expect(artifacts.unexpectedConsoleErrors(), '实例覆盖操作不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '实例覆盖操作不应有未捕获异常').toEqual([]);
});

test('滑块数据源：区间取值、档位取值、失败与未注册，预览和导出都生效', async ({ page, request, tempSite, artifacts }, testInfo) => {
  test.setTimeout(240_000);
  await writeSiteFile(request, tempSite.siteId, 'pages/ui-slider-source.json', JSON.stringify(SOURCE_PAGE));

  /* 面板必须能直接配置数据源名称与取值方式（schema 驱动的真实字段）。 */
  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) + '&page=ui-slider-source');
  await page.locator('[data-layer-tree] .lc-tree-item[data-path="0"]').click();
  await expect(page.locator('[data-inspector-title]')).toHaveText('滑块');
  await expect(page.locator('[data-field-path="datasource"]')).toHaveValue('demo-range');
  await expect(page.locator('[data-field-path="sourceMode"]')).toHaveValue('range');

  const rendered = await renderPage(request, tempSite.siteId, SOURCE_PAGE, 'ink-green', 'light');
  /* setContent 不触发导航，initScript 不会执行；把注册脚本直接插到 head 里，
     保证它先于内置组件包运行。 */
  await page.setContent(rendered.document.replace('<head>', '<head>\n<script>' + SOURCE_SEED + '</script>'), {
    waitUntil: 'load'
  });

  /* 区间取值：min/max/step 来自数据源，读数与拖动同步。 */
  await expect(slider(page, 'sl-range')).toHaveAttribute('data-lc-state', 'ready');
  const rangeInput = slider(page, 'sl-range').locator('input[data-lc-slider-range]');
  await expect(rangeInput).toHaveAttribute('min', '10');
  await expect(rangeInput).toHaveAttribute('max', '90');
  await expect(rangeInput).toHaveAttribute('step', '5');
  await expect(slider(page, 'sl-range').locator('[data-lc-slider-value]')).toHaveText('40');
  await expect(slider(page, 'sl-range').locator('[data-lc-slider-source-note]')).toBeHidden();
  const changed = await slider(page, 'sl-range').evaluate((node) => new Promise((resolve) => {
    document.addEventListener('lc:slider-change', (event) => resolve(event.detail), { once: true });
    const input = node.querySelector('input[data-lc-slider-range]');
    input.value = '55';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  expect(changed.value).toBe(55);
  await expect(slider(page, 'sl-range').locator('[data-lc-slider-value]')).toHaveText('55');

  /* 档位取值：内部下标映射到候选值，刻度与读数使用 label，数字输入吸附到档位。 */
  await expect(slider(page, 'sl-stops')).toHaveAttribute('data-lc-state', 'ready');
  const stopsInput = slider(page, 'sl-stops').locator('input[data-lc-slider-range]');
  await expect(stopsInput).toHaveAttribute('min', '0');
  await expect(stopsInput).toHaveAttribute('max', '3');
  await expect(stopsInput).toHaveAttribute('step', '1');
  await expect(slider(page, 'sl-stops').locator('.lc-ui-slider-mark')).toHaveCount(4);
  await expect(slider(page, 'sl-stops').locator('.lc-ui-slider-mark').nth(1)).toHaveText('中');
  await expect(slider(page, 'sl-stops').locator('[data-lc-slider-value]')).toHaveText('中');
  const number = slider(page, 'sl-stops').locator('input[data-lc-slider-number="0"]');
  await expect(number).toHaveValue('30');
  await number.fill('50');
  await expect(number).toHaveValue('60');
  await expect(slider(page, 'sl-stops').locator('[data-lc-slider-value]')).toHaveText('高');
  const stopChange = await slider(page, 'sl-stops').evaluate((node) => new Promise((resolve) => {
    document.addEventListener('lc:slider-change', (event) => resolve(event.detail), { once: true });
    const input = node.querySelector('input[data-lc-slider-range]');
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  expect(stopChange.value).toBe(10);

  /* 失败与未注册：给可读提示，静态取值仍可用。 */
  await expect(slider(page, 'sl-fail')).toHaveAttribute('data-lc-state', 'error');
  await expect(slider(page, 'sl-fail').locator('[data-lc-slider-source-note]')).toBeVisible();
  await expect(slider(page, 'sl-fail').locator('[data-lc-slider-source-note]')).toHaveText('数据源请求失败，请重试');
  await expect(slider(page, 'sl-fail').locator('[data-lc-slider-source-note]')).toHaveAttribute('data-kind', 'error');
  await expect(slider(page, 'sl-missing')).toHaveAttribute('data-lc-state', 'ready');
  await expect(slider(page, 'sl-missing').locator('[data-lc-slider-source-note]')).toHaveText('数据源尚未注册，已使用静态取值');
  await expect(slider(page, 'sl-missing').locator('input[data-lc-slider-range]')).toHaveAttribute('max', '100');

  /* 双值：边界来自同一个数据源，手柄不交叉。 */
  await expect(slider(page, 'sl-dual').locator('input[data-lc-slider-range]').first()).toHaveAttribute('min', '10');
  await expect(slider(page, 'sl-dual').locator('input[data-lc-slider-range]').first()).toHaveAttribute('max', '90');
  await slider(page, 'sl-dual').evaluate((node) => {
    const inputs = node.querySelectorAll('input[data-lc-slider-range]');
    inputs[0].value = '85';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = '40';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  const pair = await slider(page, 'sl-dual').evaluate((node) => {
    const inputs = node.querySelectorAll('input[data-lc-slider-range]');
    return [Number(inputs[0].value), Number(inputs[1].value)];
  });
  expect(pair[0]).toBeLessThanOrEqual(pair[1]);
  await expect(slider(page, 'sl-dual')).toHaveAttribute('data-lc-enhanced', 'true');

  /* 导出产物同样执行内置组件 enhance，数据源在页面脚本执行前注册即可生效。 */
  await openExportWizard(page, tempSite.siteId);
  const zipPath = await exportAndDownload(page, testInfo, 'slider-source.zip');
  const destDir = testInfo.outputPath('unzipped');
  await unzipArtifact(zipPath, destDir);
  const exportedPage = await readExtracted(destDir, 'web/ui-slider-source.html');
  expect(exportedPage).toContain('data-datasource="demo-range"');
  expect(exportedPage).toContain('data-source-mode="stops"');
  expect(exportedPage).toContain('enhanceBuiltins');

  /* file:// 页面是真实导航，initScript 会先于站点脚本执行。 */
  await page.addInitScript(SOURCE_SEED);
  await openLocalPage(page, destDir, 'web/ui-slider-source.html');
  await expect(slider(page, 'sl-range')).toHaveAttribute('data-lc-state', 'ready');
  await expect(slider(page, 'sl-range').locator('input[data-lc-slider-range]')).toHaveAttribute('min', '10');
  await expect(slider(page, 'sl-stops').locator('.lc-ui-slider-mark')).toHaveCount(4);
  await expect(slider(page, 'sl-stops').locator('[data-lc-slider-value]')).toHaveText('中');

  expect(artifacts.unexpectedConsoleErrors(), '滑块数据源用例不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '滑块数据源用例不应有未捕获异常').toEqual([]);
});
