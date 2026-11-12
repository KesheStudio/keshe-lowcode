import { test, expect } from '../support/fixtures.mjs';
import { api } from '../support/api.mjs';

function flowDoc(siteId) {
  return {
    schemaVersion: 1,
    siteId,
    language: 'node',
    flow: {
      id: 'main',
      name: '覆盖验证',
      treeVersion: 0,
      root: {
        id: 'root',
        type: 'flow.root',
        name: '流程根',
        enabled: true,
        params: {},
        children: [
          { id: 'entry', type: 'entry.request', name: 'GET /api/cover', enabled: true, params: { method: 'GET', path: '/api/cover', params: [] } },
          { id: 'code_1', type: 'code.node', name: '用户代码', enabled: true, params: { codeLanguage: 'node', output: 'code' } },
          { id: 'res', type: 'response.json', name: '返回 JSON', enabled: true, params: { status: 200, body: '{"ok": true}', headers: '{}' } }
        ]
      }
    },
    settings: { configCenter: { definitions: [], values: {} } }
  };
}

test('后端实例级代码覆盖：页面级/代码节点级用户区、已覆盖标记与恢复原样', async ({ page, request, tempBackendSite }) => {
  test.setTimeout(120_000);
  const siteId = tempBackendSite.siteId;
  await api(request, 'PUT', '/api/sites/' + encodeURIComponent(siteId) + '/backend-flow?language=node', {
    language: 'node',
    doc: flowDoc(siteId)
  });

  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/backend-flow.html?site=' + encodeURIComponent(siteId));

  const pageCard = page.locator('[data-page-override-card]');
  await expect(pageCard).toBeVisible();
  await expect(pageCard).toContainText('页面级代码覆盖');
  await expect(pageCard).toContainText('src/custom/flows/main.js');
  await expect(pageCard.locator('.lc-badge')).toHaveText('跟随生成');

  /* 页面级：创建并保存用户区入口。 */
  await pageCard.locator('[data-page-override-edit]').click();
  const dialog = page.locator('[data-code-dialog]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#lc-bf-code-title')).toHaveText('页面级用户代码');
  await expect(page.locator('[data-code-path]')).toHaveText('src/custom/flows/main.js');
  await expect.poll(async () => page.locator('[data-code-editor] textarea').inputValue())
    .toContain('export async function run');
  await expect(page.locator('[data-code-save]')).toBeEnabled();
  await page.locator('[data-code-save]').click();
  await expect(page.locator('[data-code-result]')).toContainText('已保存到用户区');

  await expect(pageCard.locator('.lc-badge')).toHaveText('已覆盖');
  await expect(pageCard.locator('[data-page-override-edit]')).toHaveText('编辑用户代码');
  await expect(pageCard.locator('[data-page-override-restore]')).toBeVisible();

  const saved = await api(request, 'GET', '/api/sites/' + encodeURIComponent(siteId) + '/code/backend?language=node');
  const file = (saved.files || []).find((item) => item.path === 'src/custom/flows/main.js');
  expect(file, '页面级用户区文件应存在').toBeTruthy();
  expect(file.saved).toBe(true);
  expect(file.code).toContain('export async function run');

  await page.locator('[data-code-close]').click();

  /* 代码节点级：同一个弹窗，保存后树节点出现「已覆盖」。 */
  await page.locator('[data-node-id="code_1"]').click();
  const inspector = page.locator('.lc-inspector-body[data-panel="node"]');
  await expect(inspector).toContainText('用户代码，不会被生成过程改写');
  await inspector.getByRole('button', { name: '编辑用户代码' }).click();
  await expect(page.locator('#lc-bf-code-title')).toHaveText('用户代码节点');
  await expect(page.locator('[data-code-path]')).toHaveText('src/custom/handlers/main.code_1.js');
  await expect(page.locator('[data-code-save]')).toBeEnabled();
  await page.locator('[data-code-save]').click();
  await expect(page.locator('[data-code-result]')).toContainText('已保存到用户区');
  await expect(page.locator('[data-node-id="code_1"]')).toContainText('已覆盖');
  await page.locator('[data-code-close]').click();

  /* 恢复原样：页面级与节点级都回到生成区。 */
  await pageCard.locator('[data-page-override-restore]').click();
  await expect(pageCard.locator('.lc-badge')).toHaveText('跟随生成');
  const restoredPage = await api(request, 'GET', '/api/sites/' + encodeURIComponent(siteId) + '/code/backend?language=node');
  expect((restoredPage.files || []).some((item) => item.path === 'src/custom/flows/main.js')).toBe(false);

  await page.locator('[data-node-id="code_1"]').click();
  await inspector.getByRole('button', { name: '编辑用户代码' }).click();
  await expect(page.locator('[data-code-restore]')).toBeVisible();
  await page.locator('[data-code-restore]').click();
  await expect(page.locator('[data-code-result]')).toContainText('已恢复原样');
  await page.locator('[data-code-close]').click();
  await expect(page.locator('[data-node-id="code_1"]')).toContainText('custom');
});
