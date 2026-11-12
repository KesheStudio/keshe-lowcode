import { test, expect, readFixture } from '../support/fixtures.mjs';
import { makeFilesTransfer } from '../support/drag.mjs';

async function dropFiles(page, kind, filename) {
  const content = await readFixture(filename);
  const zone = '[data-drop-zone="' + kind + '"]';
  const transfer = await makeFilesTransfer(page, [{ name: filename, content, type: 'application/json' }]);

  await page.dispatchEvent(zone, 'dragenter', { dataTransfer: transfer });
  await expect(page.locator(zone), '拖入时导入区应有高亮反馈').toHaveClass(/is-dragging/);
  await page.dispatchEvent(zone, 'dragover', { dataTransfer: transfer });
  await page.dispatchEvent(zone, 'drop', { dataTransfer: transfer });

  await expect(page.locator('[data-import-summary="' + kind + '"]')).toContainText('成功 1 个');
}

test('页面、组件、模板三个板块都能拖拽导入', async ({ page, tempSite, artifacts }) => {
  // 页面板块：Builder 侧栏只保留组件 / 模板导入，页面文件统一走批量导入页。
  await page.goto('/page-import.html?site=' + encodeURIComponent(tempSite.siteId));
  await expect(page.locator('[data-drop-zone]')).toBeVisible();
  const pageContent = await readFixture('page.json');
  const pageTransfer = await makeFilesTransfer(page, [{ name: 'page.json', content: pageContent, type: 'application/json' }]);
  await page.dispatchEvent('[data-drop-zone]', 'dragenter', { dataTransfer: pageTransfer });
  await expect(page.locator('[data-drop-zone]'), '拖入时导入区应有高亮反馈').toHaveClass(/is-dragging/);
  await page.dispatchEvent('[data-drop-zone]', 'dragover', { dataTransfer: pageTransfer });
  await page.dispatchEvent('[data-drop-zone]', 'drop', { dataTransfer: pageTransfer });
  await expect(page.locator('[data-import-summary]')).toContainText('成功 1 个');

  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId));
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await expect(page.locator('[data-panel="pages"]')).toBeVisible();
  await expect(page.locator('[data-page-list] [data-page-id="e2e-canvas"]')).toBeVisible();
  await expect(page.locator('[data-page-list] [data-page-id="e2e-canvas"]')).toContainText('E2E 画布页');

  // 组件板块
  await page.locator('[data-panel-tab="components"]').click();
  await dropFiles(page, 'component', 'component.json');
  await expect(page.locator('[data-component-list]')).toContainText('E2E 提示条');
  await expect(page.locator('[data-component-count]')).toHaveText('1');

  // 模板板块
  await page.locator('[data-panel-tab="templates"]').click();
  await dropFiles(page, 'template', 'template.json');
  await expect(page.locator('[data-template-list]')).toContainText('E2E 页面模板');
  await expect(page.locator('[data-template-count]')).toHaveText('1');

  // 模板能在同一套流程里继续套用成页面
  await page.locator('[data-apply-template="e2e-template"]').click();
  await page.locator('[data-panel-tab="pages"]').click();
  await expect(page.locator('[data-page-list] [data-page-id="e2e-template"]')).toBeVisible();

  expect(artifacts.unexpectedConsoleErrors(), '拖拽导入不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '拖拽导入不应有未捕获异常').toEqual([]);
});
