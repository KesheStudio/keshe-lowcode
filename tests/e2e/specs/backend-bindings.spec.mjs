import { test, expect } from '../support/fixtures.mjs';
import { getPage, renderPage, writeSiteFile } from '../support/api.mjs';

const PAGE = {
  schemaVersion: 2,
  id: 'binding-e2e',
  slug: 'binding-e2e',
  path: 'binding-e2e.html',
  title: '事件绑定',
  layout: { mode: 'flow' },
  blocks: [
    {
      id: 'btn-load', type: 'heading', level: 2, text: '点击加载',
      bindings: [{ event: 'click', method: 'GET', route: '/api/items', handler: 'auto', target: 'tbl' }]
    },
    {
      id: 'tbl', type: 'ui-table', pageSize: 0,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: '名称' }],
      rows: []
    },
    {
      id: 'btn-custom', type: 'heading', level: 3, text: '自定义处理',
      bindings: [{
        event: 'click',
        method: 'POST',
        route: '/api/summary',
        handler: 'custom',
        target: '',
        script: "document.querySelector('[data-lc-block=\"custom-out\"]').textContent = 'total=' + data.total; window.__bindingPayload = payload;"
      }]
    },
    { id: 'custom-out', type: 'heading', level: 4, text: '等待' }
  ]
};

const FETCH_STUB = `
  window.__fetchCalls = [];
  window.fetch = function (url, init) {
    window.__fetchCalls.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body });
    var body = String(url).indexOf('/api/summary') !== -1
      ? { data: { total: 7 } }
      : { items: [{ id: 'r1', name: '甲' }, { id: 'r2', name: '乙' }], total: 2 };
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
  };
`;

test('前端事件绑定：自动回填表格 / 自定义脚本处理 / Builder 面板保存绑定', async ({ page, request, tempSite, artifacts }) => {
  test.setTimeout(180_000);
  await writeSiteFile(request, tempSite.siteId, 'pages/binding-e2e.json', JSON.stringify(PAGE));

  const rendered = await renderPage(request, tempSite.siteId, PAGE, 'ink-green', 'light');
  expect(rendered.document).toContain('data-lc-bindings');
  expect(rendered.document).toContain('lc-binding-runtime-style');

  await page.setContent(rendered.document.replace('<head>', '<head>\n<script>' + FETCH_STUB + '</script>'), {
    waitUntil: 'load'
  });

  /* 自动回填：点击 → GET /api/items → 表格出现两行。 */
  await page.locator('[data-lc-block="btn-load"]').click();
  await expect(page.locator('[data-lc-block="tbl"] tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-lc-block="tbl"] tbody tr').first()).toContainText('甲');
  await expect(page.locator('[data-lc-block="btn-load"]')).toHaveAttribute('data-lc-binding-state', 'ready');
  const firstCall = await page.evaluate(() => window.__fetchCalls[0]);
  expect(firstCall.method).toBe('GET');
  expect(firstCall.url).toContain('/api/items');
  expect(firstCall.url).toContain('event=click');

  /* 自行处理：custom 脚本拿到解包后的 data 与原始 payload。 */
  await page.locator('[data-lc-block="btn-custom"]').click();
  await expect(page.locator('[data-lc-block="custom-out"]')).toContainText('total=7');
  const customCall = await page.evaluate(() => window.__fetchCalls[window.__fetchCalls.length - 1]);
  expect(customCall.method).toBe('POST');
  const posted = JSON.parse(customCall.body || '{}');
  expect(posted.event).toBe('click');

  /* Builder：面板能看到已有绑定，并能再添加一条。 */
  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) + '&page=binding-e2e');
  await expect(page.locator('[data-page-title]')).toHaveValue('事件绑定');
  await page.locator('[data-layer-tree] .lc-tree-item[data-path="0"]').click();
  const inspector = page.locator('[data-inspector]');
  await expect(inspector).toContainText('事件绑定');
  await expect(inspector).toContainText('已绑定 1 个事件');
  await expect(inspector).toContainText('CLICK → GET /api/items → tbl · 自动写入');

  await inspector.locator('[data-binding-draft="method"]').selectOption('POST');
  await inspector.locator('[data-binding-draft="route"]').fill('/api/audit');
  await inspector.locator('[data-binding-draft="handler"]').selectOption('custom');
  await inspector.locator('[data-binding-draft="script"]').fill('window.__audit = data;');
  await inspector.locator('[data-binding-add]').click();

  await expect(inspector).toContainText('已绑定 2 个事件');
  await expect
    .poll(async () => {
      const saved = await getPage(request, tempSite.siteId, 'binding-e2e');
      return saved.page.blocks[0].bindings;
    }, { timeout: 20_000, message: '新增绑定应随页面 JSON 保存' })
    .toHaveLength(2);
  const saved = await getPage(request, tempSite.siteId, 'binding-e2e');
  expect(saved.page.blocks[0].bindings[1]).toMatchObject({
    event: 'click',
    method: 'POST',
    route: '/api/audit',
    handler: 'custom',
    script: 'window.__audit = data;'
  });

  expect(artifacts.unexpectedConsoleErrors(), '事件绑定不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '事件绑定不应有未捕获异常').toEqual([]);
});
