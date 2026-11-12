import { test, expect, fixturePath } from '../support/fixtures.mjs';
import { getPage } from '../support/api.mjs';

test('新建站点、新建页面、插入区块、改字段、自动保存、重载后内容仍在', async ({
  page,
  request,
  tempSite,
  artifacts
}) => {
  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId));
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await expect(page.locator('[data-page-list] [data-page-id="home"]')).toBeVisible();

  // 新建页面：v2 工作台没有独立「新建页面」按钮，页面由模板套用或页面文件导入创建。
  await page.locator('[data-panel-tab="templates"]').click();
  await page.locator('[data-file-input="template"]').setInputFiles(fixturePath('template.json'));
  await expect(page.locator('[data-import-summary="template"]')).toContainText('成功 1 个');
  await page.locator('[data-apply-template="e2e-template"]').click();
  await page.locator('[data-panel-tab="pages"]').click();

  await expect(page.locator('[data-page-list] [data-page-id="e2e-template"]')).toBeVisible();
  await expect(page.locator('[data-page-title]')).toHaveValue('E2E 模板页');

  // 插入区块：先导入一个组件，再从组件库插入到当前页
  await page.locator('[data-panel-tab="components"]').click();
  await page.locator('[data-file-input="component"]').setInputFiles(fixturePath('component.json'));
  await expect(page.locator('[data-import-summary="component"]')).toContainText('成功 1 个');
  await page.locator('[data-insert-component="e2e-callout"]').click();

  await expect(page.locator('[data-inspector-title]')).toHaveText('E2E 提示条');

  // 改字段 → 自动保存
  const titleInput = page.locator('[data-inspector] [data-field-path="title"]');
  await expect(titleInput).toHaveValue('');
  await titleInput.fill('自动保存验证标题');
  await titleInput.blur();

  await expect
    .poll(async () => {
      const saved = await getPage(request, tempSite.siteId, 'e2e-template');
      const block = saved.page.blocks.find((item) => item.type === 'component');
      return block && block.fields ? block.fields.title : '';
    }, { timeout: 20_000, message: '字段修改后应自动保存到服务端' })
    .toBe('自动保存验证标题');

  await expect(page.locator('[data-save-state]')).toHaveText('已保存');

  // 重新加载后内容仍在
  await page.reload();
  await expect(page.locator('[data-page-title]')).toHaveValue('E2E 模板页');
  await expect(page.locator('[data-layer-tree] .lc-tree-item')).toHaveCount(3);

  await page.locator('[data-layer-tree] .lc-tree-item', { hasText: '自动保存验证标题' }).click();
  await expect(page.locator('[data-inspector] [data-field-path="title"]')).toHaveValue('自动保存验证标题');

  expect(artifacts.unexpectedConsoleErrors(), '主流程不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '主流程不应有未捕获异常').toEqual([]);
});
