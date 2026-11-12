import { test, expect, readFixture } from '../support/fixtures.mjs';
import { getPage, importResource } from '../support/api.mjs';
import { dragLayerRow } from '../support/drag.mjs';

test('画布三档尺寸切换、图层树选中与拖拽排序', async ({ page, request, tempSite, artifacts }) => {
  await importResource(request, tempSite.siteId, 'page', 'page.json', await readFixture('page.json'));

  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) + '&page=e2e-canvas');
  await expect(page.locator('[data-page-title]')).toHaveValue('E2E 画布页');
  await expect(page.locator('[data-layer-tree] .lc-tree-item')).toHaveCount(2);

  const stage = page.locator('[data-canvas-stage]');
  const stageWidth = () => stage.evaluate((element) => element.getBoundingClientRect().width);

  await page.locator('button[data-viewport="tablet"]').click();
  await expect(stage).toHaveAttribute('data-viewport', 'tablet');
  await expect(page.locator('button[data-viewport="tablet"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(stageWidth, { message: '平板画布宽度应收窄到 820 以内' }).toBeLessThanOrEqual(821);

  await page.locator('button[data-viewport="phone"]').click();
  await expect(stage).toHaveAttribute('data-viewport', 'phone');
  await expect(page.locator('button[data-viewport="phone"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(stageWidth, { message: '手机画布宽度应收窄到 420 以内' }).toBeLessThanOrEqual(421);
  const phoneWidth = await stageWidth();

  await page.locator('button[data-viewport="desktop"]').click();
  await expect(stage).toHaveAttribute('data-viewport', 'desktop');
  await expect.poll(stageWidth, { message: '回到桌面档后画布变宽' }).toBeGreaterThan(phoneWidth + 100);

  // 图层选中 → 画布里对应区块高亮
  await page.locator('[data-layer-tree] .lc-tree-item[data-path="0"]').click();
  await expect(page.locator('[data-inspector-title]')).toHaveText('标题');
  const canvas = page.frameLocator('[data-canvas]');
  await expect(canvas.locator('.lc-block[data-lc-selected="true"]')).toHaveCount(1);
  await expect(canvas.locator('.lc-block[data-lc-selected="true"]')).toContainText('画布测试标题');

  // 图层拖拽排序：把第 2 个区块拖到第 1 个区块前面
  const initial = await getPage(request, tempSite.siteId, 'e2e-canvas');
  expect(initial.page.blocks.map((item) => item.type)).toEqual(['heading', 'paragraph']);

  await dragLayerRow(page, '1', '0', 'before');

  await expect
    .poll(async () => {
      const saved = await getPage(request, tempSite.siteId, 'e2e-canvas');
      return saved.page.blocks.map((item) => item.type);
    }, { timeout: 20_000, message: '拖拽排序后应自动保存' })
    .toEqual(['paragraph', 'heading']);

  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await expect(page.locator('[data-layer-tree] .lc-tree-item[data-path="0"]')).toContainText('段落');

  expect(artifacts.unexpectedConsoleErrors(), '画布操作不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '画布操作不应有未捕获异常').toEqual([]);
});
