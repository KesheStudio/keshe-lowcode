import { test, expect } from '../support/fixtures.mjs';
import { api } from '../support/api.mjs';

function flowDoc(siteId) {
  return {
    schemaVersion: 1,
    siteId,
    language: 'node',
    flow: {
      id: 'main',
      name: '语言可见性',
      treeVersion: 0,
      root: {
        id: 'root',
        type: 'flow.root',
        name: '流程根',
        enabled: true,
        params: {},
        children: [
          { id: 'entry', type: 'entry.request', name: 'GET /api/lang', enabled: true, params: { method: 'GET', path: '/api/lang', params: [] } },
          {
            id: 'http_1', type: 'http.request', name: '外部 HTTP', enabled: true,
            params: { method: 'GET', url: 'https://example.com/api', headers: '{}', body: '', timeoutMs: 8000, output: 'response' }
          },
          { id: 'res', type: 'response.json', name: '返回 JSON', enabled: true, params: { status: 200, body: '{"ok": true}', headers: '{}' } }
        ]
      }
    },
    settings: { configCenter: { definitions: [], values: {} } }
  };
}

test('节点库与属性面板显示语言支持：切到 Rust 提前指出不支持项与替代积木', async ({ page, request, tempBackendSite }) => {
  const siteId = tempBackendSite.siteId;
  await api(request, 'PUT', '/api/sites/' + encodeURIComponent(siteId) + '/backend-flow?language=node', {
    language: 'node',
    doc: flowDoc(siteId)
  });

  await page.goto('/backend-flow.html?site=' + encodeURIComponent(siteId));

  const library = page.locator('[data-node-library]');
  const item = library.locator('[data-type="http.request"]');
  await expect(item).toBeVisible();
  await expect(item.locator('.lc-bf-lang')).toHaveCount(3);
  await expect(item.locator('.lc-bf-lang.is-ok')).toContainText(['Node', 'Go']);
  await expect(item.locator('.lc-bf-lang.is-missing')).toHaveText('Rust');

  await page.locator('[data-target]').selectOption('rust');
  await expect(item).toContainText('不支持 Rust');
  const issues = page.locator('[data-issues]');
  await expect(issues).toContainText('积木「外部 HTTP」不支持 Rust 目标');
  await expect(issues).toContainText(/可换成：|没有可直接替换/);

  await page.locator('[data-node-id="http_1"]').click();
  const inspector = page.locator('.lc-inspector-body[data-panel="node"]');
  await expect(inspector).toContainText('语言支持');
  await expect(inspector).toContainText('当前目标 Rust 不支持这个积木');
  await expect(inspector.locator('.lc-bf-lang')).toHaveCount(3);
});
