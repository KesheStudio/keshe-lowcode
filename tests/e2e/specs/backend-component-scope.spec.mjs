import { test, expect } from '../support/fixtures.mjs';
import { createTempSite, cleanupTempSite } from '../support/api.mjs';

/* 在「组件库」面板里用表单新建一个后端组件。 */
async function createComponent(page, { id, name, scope }) {
  const panel = page.locator('[data-panel="components"]');
  await panel.getByPlaceholder('order-total').fill(id);
  await panel.locator('.lc-field', { hasText: '名称' }).locator('input').fill(name);
  await panel.locator('.lc-field', { hasText: '作用域' }).locator('select').selectOption(scope);
  await panel.getByRole('button', { name: '保存组件' }).click();
  await expect(page.locator('.lc-toast', { hasText: '组件已保存：' + id }).first()).toBeVisible();
  await expect(panel.locator('.lc-bf-component-card', { hasText: id })).toBeVisible();
}

async function openComponentsTab(page, siteId) {
  await page.locator('[data-site-select]').selectOption(siteId);
  await expect(page.locator('[data-status-text]')).toHaveText(/已加载流程草稿|还没有流程/);
  await page.locator('[data-tab="components"]').click();
  await expect(page.locator('[data-panel="components"]')).toContainText('后端组件库');
}

test('后端组件作用域：仅本项目不外泄，保存为全局后其他项目可见', async ({ page, request }) => {
  test.setTimeout(120_000);
  const siteA = await createTempSite(request, 'E2E 组件作用域 A', { type: 'backend', backendLanguage: 'node' });
  const siteB = await createTempSite(request, 'E2E 组件作用域 B', { type: 'backend', backendLanguage: 'node' });
  /* 新站点载入的是默认草稿（未保存），切站点会提示丢弃修改。 */
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto('/backend-flow.html?site=' + encodeURIComponent(siteA.siteId));
    await expect(page.locator('[data-status-text]')).toHaveText(/已加载流程草稿|还没有流程/);
    await page.locator('[data-tab="components"]').click();
    const panel = page.locator('[data-panel="components"]');
    await expect(panel).toContainText('后端组件库');

    /* A 里建「仅本项目」组件：只出现在 A。 */
    await createComponent(page, { id: 'e2e-project-only', name: '项目内组件', scope: 'project' });
    const projectCard = panel.locator('.lc-bf-component-card', { hasText: 'e2e-project-only' });
    await expect(projectCard.locator('.lc-bf-lang').first()).toHaveText('项目');

    await openComponentsTab(page, siteB.siteId);
    await expect.poll(
      async () => page.locator('[data-panel="components"] .lc-bf-component-card', { hasText: 'e2e-project-only' }).count(),
      { message: '仅本项目组件不应出现在其他项目', timeout: 15_000 }
    ).toBe(0);

    /* B 里建「保存为全局」组件：A、B 都能看到。 */
    await createComponent(page, { id: 'e2e-global-shared', name: '跨项目组件', scope: 'global' });
    const globalCardInB = panel.locator('.lc-bf-component-card', { hasText: 'e2e-global-shared' });
    await expect(globalCardInB.locator('.lc-bf-lang').first()).toHaveText('全局');

    await openComponentsTab(page, siteA.siteId);
    const globalCardInA = panel.locator('.lc-bf-component-card', { hasText: 'e2e-global-shared' });
    await expect(globalCardInA.locator('.lc-bf-lang').first()).toHaveText('全局');
    await expect(panel.locator('.lc-bf-component-card', { hasText: 'e2e-project-only' }), 'A 自己的项目组件仍然在').toBeVisible();

    /* 全局组件可插入当前流程，节点引用的是组件 id。 */
    await globalCardInA.getByRole('button', { name: '插入流程' }).click();
    await expect(page.locator('[data-tab="node"]')).toHaveClass(/is-active/);
    await expect(page.locator('.lc-inspector-body[data-panel="node"]')).toContainText('e2e-global-shared');
  } finally {
    await cleanupTempSite(request, siteA.siteId);
    await cleanupTempSite(request, siteB.siteId);
  }
});
