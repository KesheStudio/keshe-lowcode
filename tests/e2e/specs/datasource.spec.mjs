import { test, expect } from '../support/fixtures.mjs';
import { api, createCollection } from '../support/api.mjs';
import { E2E_PORT } from '../support/config.mjs';

const SUCCESS_URL = 'http://127.0.0.1:' + E2E_PORT + '/api/health';
const FAIL_URL = 'http://127.0.0.1:9/e2e-unreachable';
const SECRET = 'e2e-secret-value-should-never-render';

test('数据源：新建接口、密钥遮蔽、连接成功/失败、集合字段映射', async ({ page, request, tempSite, artifacts }, testInfo) => {
  const { siteId } = tempSite;
  const collection = await createCollection(request, siteId, {
    id: 'e2e-col',
    name: 'E2E 集合',
    fields: [
      { id: 'title', name: '标题', type: 'text' },
      { id: 'slug', name: '别名', type: 'text' }
    ]
  });
  expect(collection.id).toBe('e2e-col');

  await page.goto('/data.html?site=' + encodeURIComponent(siteId));
  await expect(page.locator('[data-new-source]')).toBeVisible();
  await page.locator('[data-new-source]').click();
  await expect(page.locator('[data-source-editor]')).toBeVisible();

  await page.locator('[data-source-name]').fill('E2E 健康接口');
  await page.locator('[data-source-url]').fill(SUCCESS_URL);
  await page.locator('[data-source-method]').selectOption('GET');
  await page.locator('[data-source-description]').fill('端到端测试用临时接口');

  /* 请求头：值设为密钥后应变成密码框并且不再回显。 */
  await page.locator('[data-add-header]').click();
  const headerRow = page.locator('[data-header-list] .lc-data-entry').first();
  await headerRow.locator('[data-entry-key="name"]').fill('Authorization');
  await headerRow.locator('[data-entry-key="value"]').fill(SECRET);
  await headerRow.locator('[data-entry-key="secret"]').check();
  const savedHeader = page.locator('[data-header-list] .lc-data-entry').first();
  await expect(savedHeader.locator('[data-entry-key="value"]'), '标记密钥后应显示为密码框').toHaveAttribute('type', 'password');

  /* 集合映射：响应字段 → 集合字段。 */
  await page.locator('input[name="lc-source-target"][value="collection"]').check();
  await page.locator('[data-source-collection]').selectOption('e2e-col');
  await page.locator('[data-add-mapping]').click();
  const mapRow = page.locator('[data-mapping-list] .lc-data-entry').first();
  await mapRow.locator('[data-map-key="from"]').fill('status');
  await mapRow.locator('[data-map-key="to"]').fill('title');
  await page.locator('[data-add-mapping]').click();
  const mapRow2 = page.locator('[data-mapping-list] .lc-data-entry').nth(1);
  await mapRow2.locator('[data-map-key="from"]').fill('platform');
  await mapRow2.locator('[data-map-key="to"]').fill('slug');
  await page.locator('[data-source-rows-path]').fill('data');

  /* 连接测试成功。 */
  await page.locator('[data-source-test]').click();
  await expect(page.locator('[data-source-status]'), '同源健康接口应测试成功').toHaveText('连接成功', { timeout: 20000 });
  await expect(page.locator('[data-source-test-result]')).toContainText('200');

  /* 连接测试失败：端口不通。 */
  await page.locator('[data-source-url]').fill(FAIL_URL);
  await page.locator('[data-source-test]').click();
  await expect(page.locator('[data-source-status]'), '不可达地址应测试失败').toHaveText('连接失败', { timeout: 20000 });

  /* 还原地址并保存。 */
  await page.locator('[data-source-url]').fill(SUCCESS_URL);
  await page.locator('[data-source-save]').click();
  await expect(page.locator('[data-source-status]')).toHaveText('已保存', { timeout: 20000 });
  await expect(page.locator('[data-source-list]')).toContainText('E2E 健康接口');
  await expect(page.locator('[data-source-list]'), '列表应显示密钥数量而不是明文').toContainText('1 处密钥');
  await expect(page.locator('[data-source-list]')).not.toContainText(SECRET);

  /* 刷新后重新打开：密钥值不回显，映射仍在。 */
  await page.reload();
  await expect(page.locator('[data-select-source]')).toHaveCount(1);
  await page.locator('[data-select-source]').click();
  await expect(page.locator('[data-source-name]')).toHaveValue('E2E 健康接口');
  const reloadedHeader = page.locator('[data-header-list] .lc-data-entry').first();
  await expect(reloadedHeader.locator('[data-entry-key="secret"]')).toBeChecked();
  await expect(reloadedHeader.locator('[data-entry-key="value"]')).toHaveValue('');
  await expect(reloadedHeader.locator('[data-entry-key="value"]')).toHaveAttribute('placeholder', '已保存（不回显）');
  const mappingValues = page.locator('[data-mapping-list] [data-map-key]');
  await expect(mappingValues).toHaveCount(4);
  await expect(page.locator('[data-map-key="from"]').first()).toHaveValue('status');
  await expect(page.locator('[data-map-key="to"]').first()).toHaveValue('title');

  /* 后端存储同样不应出现明文。 */
  const sources = await api(request, 'GET', '/api/sites/' + encodeURIComponent(siteId) + '/data/sources');
  expect(sources.sources.length).toBe(1);
  const detail = sources.sources[0];
  const header = detail.request.headers.find((item) => item.name === 'Authorization');
  expect(header.secret, '请求头应标记为密钥').toBe(true);
  expect(header.hasSecret, '磁盘上应存在该密钥').toBe(true);
  expect(header.value, '接口不应回显密钥明文').toBeUndefined();
  expect(JSON.stringify(detail), '接口响应不应包含密钥明文').not.toContain(SECRET);
  expect(detail.mapping.target).toBe('collection');
  expect(detail.mapping.collectionId).toBe('e2e-col');
  expect(detail.mapping.fields.length).toBe(2);

  expect(artifacts.unexpectedConsoleErrors(), '数据源页面不应报控制台错误').toEqual([]);
});
