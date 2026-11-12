import { test, expect } from '../support/fixtures.mjs';

test('启动服务后打开工作台，健康检查通过', async ({ page, request, tempSite, artifacts }) => {
  const health = await request.get('/api/health');
  expect(health.ok(), '健康检查应返回 200').toBeTruthy();
  const body = await health.json();
  expect(body.ok).toBe(true);
  expect(body.data.status).toBe('running');
  expect(body.data.readOnly).toBe(false);

  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId));
  await expect(page).toHaveTitle('Builder · 低代码建站器');
  await expect(page.locator('[data-site-select]')).toHaveValue(tempSite.siteId);
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await expect(page.locator('[data-page-list] [data-page-id="home"]')).toBeVisible();

  expect(artifacts.unexpectedConsoleErrors(), '工作台不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '工作台不应有未捕获异常').toEqual([]);
  expect(artifacts.failedRequests(), '工作台不应有失败请求').toEqual([]);
});
