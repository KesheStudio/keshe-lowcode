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
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-tmpl-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: '模板库测试', host: '127.0.0.1', port: 9790 },
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
    token: 'template-test-token',
    port: 9790,
    startedAt: new Date().toISOString(),
    version: '0.0.0',
    contractsVersion: '2.0.0',
    configWarnings: [],
    bootError: null
  };
  return { dataDir, context, app: await createServer(context) };
}

const auth = { 'x-lc-token': 'template-test-token' };

async function writeJson(app, base, relPath, value) {
  const response = await app.inject({
    method: 'PUT',
    url: `${base}/file?path=${encodeURIComponent(relPath)}`,
    headers: auth,
    payload: { content: JSON.stringify(value, null, 2) }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response;
}

async function readJson(app, base, relPath) {
  const response = await app.inject({
    method: 'GET',
    url: `${base}/file?path=${encodeURIComponent(relPath)}`,
    headers: auth
  });
  assert.equal(response.statusCode, 200, response.body);
  return JSON.parse(response.json().data.content);
}

test('模板库：页面/站点模板、套用覆盖、导入导出、回收站与敏感内容隔离', async () => {
  const { dataDir, app } = await makeContext();
  const { siteId, siteDir } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: '模板站点' });
  const base = `/api/sites/${siteId}`;

  try {
    const meta = await app.inject({ method: 'GET', url: `${base}/templates/meta`, headers: auth });
    assert.equal(meta.statusCode, 200, meta.body);
    assert.equal(meta.json().data.kinds.some((item) => item.value === 'site'), true);
    assert.equal(meta.json().data.categories.some((item) => item.value === 'landing'), true);
    assert.equal(meta.json().data.trashCount, 0);

    /* 准备一页带自定义组件的内容，供页面模板快照。 */
    const component = await app.inject({
      method: 'POST',
      url: `${base}/components`,
      headers: auth,
      payload: {
        id: 'promo-card',
        name: '促销卡片',
        category: 'content',
        fields: [{ id: 'title', label: '标题', type: 'text', required: true, defaultValue: '限时活动' }],
        template: '<div class="promo-card">{{title}}</div>',
        css: '.promo-card { border: 1px solid var(--lc-color-line); }',
        js: ''
      }
    });
    assert.equal(component.statusCode, 201, component.body);

    await writeJson(app, base, 'pages/home.json', {
      schemaVersion: 2,
      id: 'home',
      title: '首页',
      slug: 'home',
      path: 'index.html',
      nav: true,
      layout: { mode: 'flow' },
      blocks: [
        { type: 'hero', title: '欢迎' },
        { type: 'component', componentId: 'promo-card' }
      ]
    });

    /* 1. 把页面存成模板：名称、分类、标签、用途说明。 */
    const created = await app.inject({
      method: 'POST',
      url: `${base}/templates`,
      headers: auth,
      payload: {
        kind: 'page',
        pageId: 'home',
        name: '营销首页',
        category: 'landing',
        tags: '营销,首页',
        description: '带英雄区与促销卡片的首屏'
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const pageTemplate = created.json().data.template;
    assert.equal(pageTemplate.kind, 'page');
    assert.equal(pageTemplate.page.id, 'home');
    assert.equal(pageTemplate.page.blocks.length, 2);
    assert.equal(pageTemplate.tags.length, 2);
    assert.equal(pageTemplate.components.length, 1);
    assert.equal(pageTemplate.components[0].id, 'promo-card');
    assert.equal(pageTemplate.source.pageId, 'home');
    assert.equal(created.json().data.info.blockCount, 2);

    /* 名称重复要拦住。 */
    const clash = await app.inject({
      method: 'POST',
      url: `${base}/templates`,
      headers: auth,
      payload: { kind: 'page', pageId: 'home', name: '营销首页' }
    });
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().error.code, 'LC_E_TEMPLATE_NAME');

    const missingPage = await app.inject({
      method: 'POST',
      url: `${base}/templates`,
      headers: auth,
      payload: { kind: 'page', pageId: 'nope', name: '不存在页面' }
    });
    assert.equal(missingPage.statusCode, 404);

    /* 2. 列表与详情、导出信封。 */
    const list = await app.inject({ method: 'GET', url: `${base}/templates`, headers: auth });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().data.items.length, 1);
    assert.equal(list.json().data.items[0].name, '营销首页');
    assert.equal(list.json().data.items[0].pageCount, 1);
    assert.ok(list.json().data.tags.includes('营销'));

    const detail = await app.inject({ method: 'GET', url: `${base}/templates/${pageTemplate.id}`, headers: auth });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().data.template.page.blocks[0].type, 'hero');

    const exported = await app.inject({ method: 'GET', url: `${base}/templates/${pageTemplate.id}/export`, headers: auth });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.json().format, 'lowcode-template');
    assert.equal(exported.json().template.id, pageTemplate.id);

    /* 不合法导入要拒绝。 */
    const badImport = await app.inject({
      method: 'POST',
      url: `${base}/templates/import`,
      headers: auth,
      payload: { content: JSON.stringify({ hello: 'world' }) }
    });
    assert.equal(badImport.statusCode, 422);
    assert.equal(badImport.json().error.code, 'LC_E_TEMPLATE_FORMAT');

    /* 导入合法模板：ID/名称冲突时自动改名。 */
    const imported = await app.inject({
      method: 'POST',
      url: `${base}/templates/import`,
      headers: auth,
      payload: { filename: 'marketing.template.json', content: JSON.stringify(exported.json()) }
    });
    assert.equal(imported.statusCode, 201, imported.body);
    assert.notEqual(imported.json().data.template.id, pageTemplate.id);
    assert.ok(imported.json().data.notices.length > 0);

    /* 3. 套用为新页面：路径与标题可覆盖，组件缺失时自动补齐。 */
    const deleted = await app.inject({
      method: 'DELETE',
      url: `${base}/components/promo-card?confirm=1`,
      headers: auth
    });
    assert.equal(deleted.statusCode, 200, deleted.body);

    const applied = await app.inject({
      method: 'POST',
      url: `${base}/templates/${pageTemplate.id}/apply`,
      headers: auth,
      payload: { mode: 'new', title: '活动页', slug: 'promo', path: 'promo.html' }
    });
    assert.equal(applied.statusCode, 201, applied.body);
    assert.equal(applied.json().data.pages.length, 1);
    const promo = applied.json().data.pages[0];
    assert.equal(promo.id, 'promo');
    assert.equal(promo.title, '活动页');
    assert.equal(promo.path, 'promo.html');
    assert.equal(promo.blocks.length, 2);
    assert.deepEqual(applied.json().data.installedComponents, ['promo-card']);

    const promoFile = await readJson(app, base, 'pages/promo.json');
    assert.equal(promoFile.blocks[1].componentId, 'promo-card');

    /* 4. 覆盖现有页面必须二次确认，确认后先备份。 */
    const noConfirm = await app.inject({
      method: 'POST',
      url: `${base}/templates/${pageTemplate.id}/apply`,
      headers: auth,
      payload: { mode: 'overwrite', pageId: 'promo' }
    });
    assert.equal(noConfirm.statusCode, 409);
    assert.equal(noConfirm.json().error.code, 'LC_E_TEMPLATE_OVERWRITE');
    assert.equal(noConfirm.json().error.detail.page.id, 'promo');

    await writeJson(app, base, 'pages/promo.json', {
      schemaVersion: 2,
      id: 'promo',
      title: '活动页',
      slug: 'promo',
      path: 'promo.html',
      nav: true,
      blocks: [{ type: 'text', text: '被覆盖前的内容' }]
    });

    const confirmed = await app.inject({
      method: 'POST',
      url: `${base}/templates/${pageTemplate.id}/apply?confirm=1`,
      headers: auth,
      payload: { mode: 'overwrite', pageId: 'promo' }
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().data.overwritten.id, 'promo');
    assert.equal(confirmed.json().data.pages[0].title, '活动页');
    assert.equal(confirmed.json().data.pages[0].blocks[0].type, 'hero');

    const backupEntries = await fs.readdir(path.join(siteDir, 'backups')).catch(() => []);
    assert.ok(backupEntries.length > 0, '覆盖前应生成备份');

    /* 5. 整站模板：只带走内容层，敏感文件不得进入模板。 */
    await writeJson(app, base, 'data/sources.json', { note: 'super-secret-value' });
    const siteTemplateResponse = await app.inject({
      method: 'POST',
      url: `${base}/templates`,
      headers: auth,
      payload: { kind: 'site', name: '整站模板', category: 'content', tags: ['整站'], description: '两页站点' }
    });
    assert.equal(siteTemplateResponse.statusCode, 201, siteTemplateResponse.body);
    const siteTemplate = siteTemplateResponse.json().data.template;
    assert.equal(siteTemplate.kind, 'site');
    assert.ok(siteTemplate.pages.length >= 2);
    assert.equal(siteTemplate.config.navigation.items.length >= 1, true);

    const rawTemplateText = await fs.readFile(path.join(siteDir, 'templates', siteTemplate.id + '.json'), 'utf8');
    assert.equal(rawTemplateText.includes('super-secret-value'), false, '站点模板不能包含数据源内容');
    assert.equal(rawTemplateText.includes('backend'), false, '站点模板不能包含后端配置');

    /* 站点模板套用：全部页面复制，导航映射到新页面。 */
    const beforeNav = await readJson(app, base, 'project.json');
    assert.equal(beforeNav.navigation.items[0].pageId, 'home');

    const siteApplied = await app.inject({
      method: 'POST',
      url: `${base}/templates/${siteTemplate.id}/apply`,
      headers: auth,
      payload: { mode: 'new', applyConfig: true }
    });
    assert.equal(siteApplied.statusCode, 201, siteApplied.body);
    const createdPages = siteApplied.json().data.pages;
    assert.equal(createdPages.length, siteTemplate.pages.length);
    assert.equal(siteApplied.json().data.configApplied, true);

    const afterProject = await readJson(app, base, 'project.json');
    const createdIds = new Set(createdPages.map((page) => page.id));
    assert.equal(createdIds.has(afterProject.navigation.items[0].pageId), true, '导航应指向新建页面');

    /* 覆盖模式对站点模板无意义，要明确拒绝。 */
    const siteOverwrite = await app.inject({
      method: 'POST',
      url: `${base}/templates/${siteTemplate.id}/apply`,
      headers: auth,
      payload: { mode: 'overwrite', pageId: 'home', confirm: true }
    });
    assert.equal(siteOverwrite.statusCode, 422);

    /* 6. 删除进回收站并可恢复。 */
    const removed = await app.inject({ method: 'DELETE', url: `${base}/templates/${pageTemplate.id}`, headers: auth });
    assert.equal(removed.statusCode, 200, removed.body);
    const afterDelete = await app.inject({ method: 'GET', url: `${base}/templates`, headers: auth });
    assert.equal(afterDelete.json().data.items.some((item) => item.id === pageTemplate.id), false);

    const trash = await app.inject({ method: 'GET', url: `${base}/templates/trash`, headers: auth });
    assert.equal(trash.statusCode, 200, trash.body);
    assert.ok(trash.json().data.items.length >= 1);
    const trashId = trash.json().data.items.find((item) => item.template.id === pageTemplate.id).trashId;

    const restored = await app.inject({
      method: 'POST',
      url: `${base}/templates/trash/${trashId}/restore`,
      headers: auth
    });
    assert.equal(restored.statusCode, 200, restored.body);
    const afterRestore = await app.inject({ method: 'GET', url: `${base}/templates`, headers: auth });
    assert.equal(afterRestore.json().data.items.some((item) => item.name === '营销首页'), true);

    /* 损坏的模板文件不应拖垮列表。 */
    await fs.writeFile(path.join(siteDir, 'templates', 'broken.json'), '{not json', 'utf8');
    const stillList = await app.inject({ method: 'GET', url: `${base}/templates`, headers: auth });
    assert.equal(stillList.statusCode, 200, stillList.body);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
