import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/http.js';
import { createSite } from '../server/src/sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function makeContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-comp-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: '组件库测试', host: '127.0.0.1', port: 9791 },
    server: { bodyLimitBytes: 8 * 1024 * 1024, requestTimeoutMs: 30000 },
    logging: { level: 'silent' },
    paths,
    migration: { enabled: true },
    draftCache: { enabled: false }
  };
  const context = {
    platformRoot: ROOT,
    config,
    paths,
    runtime: { readOnly: false, readOnlyReason: '' },
    token: 'component-test-token',
    port: 9791,
    startedAt: new Date().toISOString(),
    version: '0.0.0',
    contractsVersion: '2.0.0',
    configWarnings: [],
    bootError: null
  };
  return { dataDir, context, app: await createServer(context) };
}

const auth = { 'x-lc-token': 'component-test-token' };

function componentPayload(overrides) {
  const base = {
    name: '商品卡片',
    category: 'content',
    icon: 'box',
    tags: ['卡片', '商品'],
    description: '用于展示商品摘要',
    fields: [
      { id: 'title', label: '标题', type: 'text', required: true, defaultValue: '默认标题' },
      { id: 'summary', label: '摘要', type: 'textarea', required: false, defaultValue: '' },
      { id: 'price', label: '价格', type: 'number', required: true, defaultValue: 99 },
      { id: 'featured', label: '推荐', type: 'boolean', required: false, defaultValue: true },
      { id: 'tone', label: '色调', type: 'color', required: false, defaultValue: '#3e6a56' },
      { id: 'badge', label: '徽标', type: 'enum', required: false, options: ['新品', '热卖'], defaultValue: '新品' },
      { id: 'source', label: '数据源', type: 'datasource', required: false, defaultValue: 'products' },
      { id: 'cover', label: '封面', type: 'image', required: false, defaultValue: '' }
    ],
    template: [
      '<article class="product-card">',
      '  <h3>{{title}}</h3>',
      '  <p>{{summary}}</p>',
      '  <strong>{{price}}</strong>',
      '  <span>{{badge}}</span>',
      '  <img src="{{cover}}" alt="{{title}}">',
      '</article>'
    ].join('\n'),
    css: '.product-card { padding: var(--lc-space-4); border: 1px solid var(--lc-color-line); }',
    js: "root.addEventListener('click', function () { root.classList.toggle('is-open'); });"
  };
  return Object.assign(base, overrides || {});
}

function pageFixture(componentId) {
  return {
    id: 'home',
    title: '首页',
    path: 'index.html',
    blocks: [
      { type: 'component', componentId },
      { type: 'component', componentId },
      { type: 'section', blocks: [{ type: 'component', componentId }] }
    ]
  };
}

test('组件库：字段定义、三件套、拦截、预览、使用扫描、回收站与内置只读', async (t) => {
  const { dataDir, app } = await makeContext();
  const { siteId } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: '组件站点' });
  const base = `/api/sites/${siteId}`;

  try {
    const meta = await app.inject({ method: 'GET', url: `${base}/components/meta`, headers: auth });
    assert.equal(meta.statusCode, 200, meta.body);
    const metaData = meta.json().data;
    assert.equal(metaData.fieldTypes.some((item) => item.value === 'datasource'), true);
    assert.ok(metaData.builtinCount > 0);
    assert.ok(metaData.scopeExample.cssPrefix.includes('data-lc-comp'));

    const initial = await app.inject({ method: 'GET', url: `${base}/components`, headers: auth });
    assert.equal(initial.statusCode, 200, initial.body);
    const builtins = initial.json().data.items.filter((item) => item.builtin);
    assert.ok(builtins.length > 0);
    assert.equal(builtins[0].readOnly, true);

    const created = await app.inject({
      method: 'POST',
      url: `${base}/components`,
      headers: auth,
      payload: componentPayload({ id: 'product-card' })
    });
    assert.equal(created.statusCode, 201, created.body);
    const component = created.json().data;
    assert.equal(component.id, 'product-card');
    assert.equal(component.fields.length, 8);
    assert.equal(component.fields.find((field) => field.id === 'title').required, true);
    assert.equal(component.fields.find((field) => field.id === 'price').defaultValue, 99);
    assert.equal(component.fields.find((field) => field.id === 'badge').options.length, 2);

    const detail = await app.inject({ method: 'GET', url: `${base}/components/product-card`, headers: auth });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().data.template.includes('{{title}}'), true);
    assert.equal(detail.json().data.usageCount, 0);

    /* 危险 JS：document.write 与 innerHTML 拼接都要拦下。 */
    const docWrite = await app.inject({
      method: 'POST',
      url: `${base}/components`,
      headers: auth,
      payload: componentPayload({ id: 'bad-write', name: '危险写入', js: "document.write('<h1>hi</h1>');" })
    });
    assert.equal(docWrite.statusCode, 422, docWrite.body);
    assert.equal(docWrite.json().error.code, 'LC_E_COMPONENT_JS_FORBIDDEN');
    assert.equal(docWrite.json().error.detail.rule, 'LC_E_JS_DOCUMENT_WRITE');
    assert.ok(docWrite.json().error.detail.line >= 1);

    const innerConcat = await app.inject({
      method: 'POST',
      url: `${base}/components`,
      headers: auth,
      payload: componentPayload({
        id: 'bad-inner',
        name: '危险内联',
        js: "var user = root.dataset.user; root.innerHTML = '<b>' + user + '</b>';"
      })
    });
    assert.equal(innerConcat.statusCode, 422, innerConcat.body);
    assert.equal(innerConcat.json().error.detail.rule, 'LC_E_JS_INNER_HTML_CONCAT');

    /* 清空 innerHTML、以及在注释里提到 document.write，不算危险写法。 */
    const safeJs = await app.inject({
      method: 'POST',
      url: `${base}/components`,
      headers: auth,
      payload: componentPayload({
        id: 'safe-js',
        name: '安全脚本',
        js: "// 这里只是说明，不会调用 document.write\nvar rootNode = root;\nrootNode.innerHTML = '';"
      })
    });
    assert.equal(safeJs.statusCode, 201, safeJs.body);

    /* 预览：占位符转义 + CSS 作用域前缀。 */
    const preview = await app.inject({
      method: 'POST',
      url: `${base}/components/preview`,
      headers: auth,
      payload: {
        component: {
          id: 'preview-card',
          fields: [{ id: 'title', label: '标题', type: 'text', required: true, defaultValue: '' }],
          template: '<div class="card">{{title}}</div>',
          css: '.card { color: #333; }',
          js: ''
        },
        sample: { title: '<script>alert(1)</script>' }
      }
    });
    assert.equal(preview.statusCode, 200, preview.body);
    const previewData = preview.json().data;
    assert.equal(previewData.html.includes('&lt;script&gt;'), true);
    assert.equal(previewData.html.includes('<script>alert'), false);
    assert.ok(previewData.css.includes('[data-lc-comp="preview-card"] .card'));

    /* 页面引用后：列表带使用次数，字段改动与删除都先返回 409 + 影响页面。 */
    await app.inject({
      method: 'PUT',
      url: `${base}/file?path=${encodeURIComponent('pages/home.json')}`,
      headers: auth,
      payload: { content: JSON.stringify(pageFixture('product-card')) }
    });

    const listed = await app.inject({ method: 'GET', url: `${base}/components`, headers: auth });
    assert.equal(listed.statusCode, 200, listed.body);
    const listedItem = listed.json().data.items.find((item) => item.id === 'product-card');
    assert.equal(listedItem.usageCount, 3);
    assert.equal(listedItem.usagePages.length, 1);
    assert.equal(listedItem.usagePages[0].pageTitle, '首页');

    const withoutSummary = componentPayload({
      id: 'product-card',
      fields: componentPayload().fields.filter((field) => field.id !== 'summary')
    });
    const blockedFields = await app.inject({
      method: 'PUT',
      url: `${base}/components/product-card`,
      headers: auth,
      payload: withoutSummary
    });
    assert.equal(blockedFields.statusCode, 409, blockedFields.body);
    assert.equal(blockedFields.json().error.code, 'LC_E_COMPONENT_FIELDS');
    assert.equal(blockedFields.json().error.detail.usage.length, 1);
    assert.equal(blockedFields.json().error.detail.breaking.length, 1);

    const confirmedFields = await app.inject({
      method: 'PUT',
      url: `${base}/components/product-card?confirm=1`,
      headers: auth,
      payload: withoutSummary
    });
    assert.equal(confirmedFields.statusCode, 200, confirmedFields.body);
    assert.equal(confirmedFields.json().data.fields.some((field) => field.id === 'summary'), false);

    const duplicate = await app.inject({
      method: 'POST',
      url: `${base}/components/product-card/duplicate`,
      headers: auth
    });
    assert.equal(duplicate.statusCode, 201, duplicate.body);
    assert.notEqual(duplicate.json().data.id, 'product-card');
    assert.ok(duplicate.json().data.name.includes('副本'));

    /* 导出、导入：单个 JSON 往返。 */
    const exported = await app.inject({
      method: 'GET',
      url: `${base}/components/product-card/export`,
      headers: auth
    });
    assert.equal(exported.statusCode, 200, exported.body);
    assert.equal(exported.json().format, 'lowcode-component');
    assert.equal(exported.json().component.id, 'product-card');

    const imported = await app.inject({
      method: 'POST',
      url: `${base}/components/import`,
      headers: auth,
      payload: { filename: 'product-card.component.json', content: exported.body }
    });
    assert.equal(imported.statusCode, 201, imported.body);
    assert.notEqual(imported.json().data.id, 'product-card');
    assert.ok(imported.json().data.notices.length >= 1);

    /* 内置组件只读；可复制为自定义组件。 */
    const builtin = await app.inject({ method: 'GET', url: `${base}/components/builtin:ui-table`, headers: auth });
    assert.equal(builtin.statusCode, 200, builtin.body);
    assert.equal(builtin.json().data.readOnly, true);

    const builtinUpdate = await app.inject({
      method: 'PUT',
      url: `${base}/components/builtin:ui-table`,
      headers: auth,
      payload: { name: '改名' }
    });
    assert.equal(builtinUpdate.statusCode, 403, builtinUpdate.body);
    assert.equal(builtinUpdate.json().error.code, 'LC_E_COMPONENT_READONLY');

    const builtinDelete = await app.inject({
      method: 'DELETE',
      url: `${base}/components/builtin:ui-table`,
      headers: auth
    });
    assert.equal(builtinDelete.statusCode, 403, builtinDelete.body);

    const builtinCopy = await app.inject({
      method: 'POST',
      url: `${base}/components/builtin:ui-table/duplicate`,
      headers: auth
    });
    assert.equal(builtinCopy.statusCode, 201, builtinCopy.body);
    assert.equal(builtinCopy.json().data.builtin, false);
    assert.equal(builtinCopy.json().data.builtinId, undefined);

    /* 删除：先 409 列页面，确认后进回收站；可恢复。 */
    const blockedDelete = await app.inject({
      method: 'DELETE',
      url: `${base}/components/product-card`,
      headers: auth
    });
    assert.equal(blockedDelete.statusCode, 409, blockedDelete.body);
    assert.equal(blockedDelete.json().error.code, 'LC_E_COMPONENT_IN_USE');
    assert.equal(blockedDelete.json().error.detail.usage.length, 1);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `${base}/components/product-card?confirm=1`,
      headers: auth
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.ok(deleted.json().data.trashId);

    const trashList = await app.inject({ method: 'GET', url: `${base}/components/trash`, headers: auth });
    assert.equal(trashList.statusCode, 200, trashList.body);
    assert.equal(trashList.json().data.items.some((item) => item.originalId === 'product-card'), true);

    const trashId = deleted.json().data.trashId;
    const restored = await app.inject({
      method: 'POST',
      url: `${base}/components/trash/${encodeURIComponent(trashId)}/restore`,
      headers: auth
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().data.id, 'product-card');

    const trashAfter = await app.inject({ method: 'GET', url: `${base}/components/trash`, headers: auth });
    assert.equal(trashAfter.json().data.items.some((item) => item.trashId === trashId), false);

    const restoredDetail = await app.inject({ method: 'GET', url: `${base}/components/product-card`, headers: auth });
    assert.equal(restoredDetail.statusCode, 200, restoredDetail.body);
    assert.equal(restoredDetail.json().data.usageCount, 3);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
