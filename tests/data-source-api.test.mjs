import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/http.js';
import { createSite } from '../server/src/sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function makeContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-scr-'));
  const paths = { dataDir, lockStaleMs: 60000, exportsDir: path.join(dataDir, 'exports'), logsDir: path.join(dataDir, 'logs') };
  const config = {
    platform: { name: '接口测试', host: '127.0.0.1', port: 9781 },
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
    token: 'source-test-token',
    port: 9781,
    startedAt: new Date().toISOString(),
    version: '0.0.0',
    contractsVersion: '2.0.0',
    configWarnings: [],
    bootError: null
  };
  return { dataDir, context, app: await createServer(context) };
}

const auth = { 'x-lc-token': 'source-test-token' };

/* 本地一次性夹具服务：只监听 127.0.0.1 的临时端口，不触碰任何数据库端口。 */
async function startFixture() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/ok') {
      return send(200, 'application/json', JSON.stringify({
        data: [
          { id: 'a1', title: '标题一', price: 12, secretNote: 'ok' },
          { id: 'a2', title: '标题二', price: 20 }
        ]
      }));
    }
    if (pathname === '/auth') return send(401, 'application/json', '{"error":"unauthorized"}');
    if (pathname === '/plain') return send(200, 'text/plain', 'not json at all');
    if (pathname === '/echo-auth') {
      if (req.headers.authorization === 'Bearer secret-123') return send(200, 'application/json', '{"data":[]}');
      return send(401, 'application/json', '{"error":"missing token"}');
    }
    if (pathname === '/slow') {
      const timer = setTimeout(() => {
        if (!res.writableEnded) send(200, 'application/json', '{"data":[]}');
      }, 3000);
      res.on('close', () => clearTimeout(timer));
      return undefined;
    }
    if (pathname === '/big') {
      return send(200, 'application/json', JSON.stringify({ data: [{ note: 'x'.repeat(5000) }] }));
    }
    return send(404, 'application/json', '{"error":"not found"}');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    })
  };
}

function sourcePayload(base, overrides) {
  return Object.assign({
    name: '商品接口',
    request: {
      method: 'GET',
      url: base + '/ok',
      headers: [
        { name: 'Authorization', secret: true, value: 'Bearer secret-123' },
        { name: 'X-Trace', value: 'demo' }
      ],
      query: [
        { name: 'page', value: '1' },
        { name: 'key', secret: true, value: 'query-secret-999' }
      ],
      timeoutMs: 5000,
      maxResponseBytes: 1024 * 1024
    },
    mapping: {
      target: 'component',
      component: 'table',
      rowsPath: 'data',
      fields: [
        { from: 'id', to: 'id' },
        { from: 'title', to: 'title' },
        { from: 'price', to: 'price' }
      ]
    }
  }, overrides || {});
}

test('数据源接口：密钥保护、URL 红线、连接测试分类', async () => {
  const { dataDir, app } = await makeContext();
  const fixture = await startFixture();
  const { siteId, siteDir } = await createSite({ dataDir, lockStaleMs: 60000 }, { name: '接口站点' });

  try {
    const empty = await app.inject({ method: 'GET', url: `/api/sites/${siteId}/data/sources`, headers: auth });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json().data.sources, []);
    assert.deepEqual(empty.json().data.methods.includes('PATCH'), true);
    assert.deepEqual(empty.json().data.targets, ['collection', 'component']);

    /* 创建：密钥不回显，且不落进 sources.json */
    const created = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources`,
      headers: auth,
      payload: sourcePayload(fixture.base)
    });
    assert.equal(created.statusCode, 201, created.body);
    const source = created.json().data;
    assert.equal(source.request.headers.find((item) => item.name === 'Authorization').hasSecret, true);
    assert.equal(source.request.headers.find((item) => item.name === 'Authorization').value, undefined);
    assert.equal(source.request.query.find((item) => item.name === 'key').hasSecret, true);
    assert.equal(created.body.includes('secret-123'), false, '返回体不能带密钥明文');
    assert.equal(created.body.includes('query-secret-999'), false, '返回体不能带密钥明文');
    assert.equal(source.request.headers.find((item) => item.name === 'X-Trace').value, 'demo');

    const sourcesText = await fs.readFile(path.join(siteDir, 'data', 'sources.json'), 'utf8');
    assert.equal(sourcesText.includes('secret-123'), false, 'sources.json 不能存密钥明文');
    assert.equal(sourcesText.includes('query-secret-999'), false, 'sources.json 不能存密钥明文');
    const secretText = await fs.readFile(path.join(siteDir, '.lowcode', 'data-secrets.json'), 'utf8');
    const secrets = JSON.parse(secretText);
    assert.equal(secrets['header:Authorization'], 'Bearer secret-123');
    assert.equal(secrets['query:key'], 'query-secret-999');

    /* 名称冲突 */
    const clash = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources`,
      headers: auth,
      payload: sourcePayload(fixture.base, { id: 'api-second', name: '商品接口' })
    });
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().error.code, 'LC_E_SOURCE_NAME');

    /* URL 内含账号密码：拒绝 */
    const inUrl = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources`,
      headers: auth,
      payload: sourcePayload(fixture.base, { id: 'api-bad-url', name: '带账号地址', request: { method: 'GET', url: 'http://user:pass@127.0.0.1:1/x' } })
    });
    assert.equal(inUrl.statusCode, 400);
    assert.equal(inUrl.json().error.code, 'LC_E_SOURCE_URL');

    /* 数据库常见端口：红线拒绝，且不会发起连接 */
    const dbPort = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources`,
      headers: auth,
      payload: sourcePayload(fixture.base, { id: 'api-db', name: '数据库端口', request: { method: 'GET', url: 'http://127.0.0.1:3306/query' } })
    });
    assert.equal(dbPort.statusCode, 422);
    assert.equal(dbPort.json().error.code, 'LC_E_SOURCE_BLOCKED');

    /* 连接测试成功：状态码、耗时、字段结构、映射 */
    const okTest = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources/test`,
      headers: auth,
      payload: { source: sourcePayload(fixture.base) }
    });
    assert.equal(okTest.statusCode, 200, okTest.body);
    const ok = okTest.json().data;
    assert.equal(ok.success, true, ok.message);
    assert.equal(ok.category, 'ok');
    assert.equal(ok.status, 200);
    assert.equal(typeof ok.elapsedMs, 'number');
    assert.equal(ok.rows, 2);
    assert.equal(ok.structure.kind, 'object');
    assert.ok(Array.isArray(ok.mapped));
    assert.deepEqual(ok.mapped[0].title, '标题一');
    assert.ok(ok.unmapped.includes('secretNote'));
    assert.equal(okTest.body.includes('secret-123'), false);
    assert.equal(okTest.body.includes('query-secret-999'), false);
    assert.equal(ok.request.url.includes('***'), true, '打码后的地址应显示 ***');
    assert.equal(ok.request.headers.find((item) => item.name === 'Authorization').present, true);

    /* 认证失败分类 */
    const authTest = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources/test`,
      headers: auth,
      payload: { source: sourcePayload(fixture.base, { request: { method: 'GET', url: fixture.base + '/auth' } }) }
    });
    const authResult = authTest.json().data;
    assert.equal(authResult.success, false);
    assert.equal(authResult.category, 'auth');
    assert.equal(authResult.status, 401);
    assert.ok(authResult.message.includes('认证失败'));

    /* 格式失败分类 */
    const formatTest = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources/test`,
      headers: auth,
      payload: { source: sourcePayload(fixture.base, { request: { method: 'GET', url: fixture.base + '/plain' } }) }
    });
    const formatResult = formatTest.json().data;
    assert.equal(formatResult.success, false);
    assert.equal(formatResult.category, 'format');
    assert.ok(formatResult.message.includes('JSON'));

    /* 响应体积上限 */
    const bigTest = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources/test`,
      headers: auth,
      payload: {
        source: sourcePayload(fixture.base, {
          request: { method: 'GET', url: fixture.base + '/big', maxResponseBytes: 1024 }
        })
      }
    });
    const bigResult = bigTest.json().data;
    assert.equal(bigResult.success, false);
    assert.equal(bigResult.category, 'too-large');
    assert.ok(bigResult.message.includes('1024'));

    /* 超时分类 */
    const slowTest = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources/test`,
      headers: auth,
      payload: {
        source: sourcePayload(fixture.base, {
          request: { method: 'GET', url: fixture.base + '/slow', timeoutMs: 1000 }
        })
      }
    });
    const slowResult = slowTest.json().data;
    assert.equal(slowResult.success, false);
    assert.equal(slowResult.category, 'timeout');
    assert.ok(slowResult.message.includes('1000'));

    /* 已保存的接口：不重填密钥也能测试，说明密钥被复用 */
    const savedTest = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources/test`,
      headers: auth,
      payload: { sourceId: source.id }
    });
    const savedResult = savedTest.json().data;
    assert.equal(savedResult.success, true, savedResult.message);
    assert.equal(savedResult.request.headers.find((item) => item.name === 'Authorization').present, true);

    /* 未重填密钥保存：原文保留 */
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/sites/${siteId}/data/sources/${source.id}`,
      headers: auth,
      payload: {
        name: '商品接口（改名）',
        request: {
          method: 'GET',
          url: fixture.base + '/echo-auth',
          headers: [{ name: 'Authorization', secret: true }],
          timeoutMs: 5000,
          maxResponseBytes: 1024 * 1024
        },
        mapping: { target: 'component', component: 'table' }
      }
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().data.request.headers[0].hasSecret, true);
    const reuseTest = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources/test`,
      headers: auth,
      payload: { sourceId: source.id }
    });
    assert.equal(reuseTest.json().data.success, true, reuseTest.body);

    /* 删除后密钥被清理 */
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/sites/${siteId}/data/sources/${source.id}`,
      headers: auth
    });
    assert.equal(removed.statusCode, 200, removed.body);
    const secretAfter = JSON.parse(await fs.readFile(path.join(siteDir, '.lowcode', 'data-secrets.json'), 'utf8'));
    assert.equal(secretAfter['header:Authorization'], undefined);
    const missing = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/data/sources/test`,
      headers: auth,
      payload: { sourceId: source.id }
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await fixture.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
