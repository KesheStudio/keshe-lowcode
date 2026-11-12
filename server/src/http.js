import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerRuntimeRoutes } from './routes/runtime.js';
import { registerSiteRoutes } from './routes/sites.js';
import { registerBackupRoutes } from './routes/backups.js';
import { registerFileRoutes } from './routes/files.js';
import { registerBatchRoutes } from './routes/batch.js';
import { registerVersionRoutes } from './routes/versions.js';
import { registerThemeRoutes } from './routes/themes.js';
import { registerExportRoutes } from './routes/export.js';
import { registerExportConfigRoutes } from './routes/export-config.js';
import { registerBuilderRoutes } from './routes/builder.js';
import { registerDataRoutes } from './routes/data.js';
import { registerComponentRoutes } from './routes/components.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerCodeRoutes } from './routes/code.js';
import { registerMiddlewareConfigRoutes } from './routes/middleware-config.js';
import { registerBackendFlowRoutes } from './routes/backend-flow.js';
import { StorageError } from '../../src/storage/errors.js';

const MIME_BY_EXT = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

/**
 * 本地服务只监听 127.0.0.1：
 * - /api/* 需要 token（/api/health 除外），并校验 Origin（存在时）。
 * - 静态资源只暴露平台根的白名单目录，data/、logs/、exports/ 一律不可访问。
 */
export async function createServer(context) {
  const { platformRoot, config, token } = context;
  const app = Fastify({
    logger: { level: config.logging.level || 'info' },
    bodyLimit: config.server.bodyLimitBytes,
    requestTimeout: config.server.requestTimeoutMs
  });

  const allowedOrigins = new Set([
    `http://127.0.0.1:${context.port}`,
    `http://localhost:${context.port}`,
    `http://[::1]:${context.port}`
  ]);

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    return payload;
  });

  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url || '';
    if (!url.startsWith('/api/')) return;
    if (url.startsWith('/api/health')) return;

    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return reply.code(403).send({ ok: false, error: { code: 'LC_E_ORIGIN', message: '来源不被允许' } });
    }
    const provided = request.headers['x-lc-token'] || (request.query && request.query.token);
    if (!provided || provided !== token) {
      return reply.code(403).send({ ok: false, error: { code: 'LC_E_AUTH', message: '缺少或无效的访问令牌' } });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const isApi = (request.raw.url || '').startsWith('/api/');
    const status = error.statusCode || error.status || 500;
    /* 文件系统错误统一转成业务话术，绝不把绝对路径 / ENOENT 原文抛给前端。 */
    const fsCodes = { ENOENT: 404, ENOTDIR: 404, EACCES: 403, EPERM: 403, EISDIR: 400 };
    if (error && fsCodes[error.code]) {
      const message = error.code === 'ENOENT' || error.code === 'ENOTDIR' ? '文件或目录不存在' : '没有权限访问该文件';
      if (isApi) {
        return reply.code(fsCodes[error.code]).send({ ok: false, error: { code: 'LC_E_FS', message } });
      }
      return reply
        .code(fsCodes[error.code])
        .type('text/html; charset=utf-8')
        .send(`<!doctype html><meta charset="utf-8"><title>请求失败</title><p>${escapeHtml(message)}</p>`);
    }
    if (error instanceof StorageError) {
      const body = { ok: false, error: { code: error.code, message: error.message, detail: error.detail } };
      return reply.code(error.statusCode || 400).send(body);
    }
    if (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(400).send({ ok: false, error: { code: 'LC_E_VALIDATION', message: '请求体不是合法 JSON' } });
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ ok: false, error: { code: 'LC_E_BODY_TOO_LARGE', message: '请求体超过大小上限' } });
    }
    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.code(415).send({ ok: false, error: { code: 'LC_E_MEDIA_TYPE', message: '请求内容类型不受支持，请使用 application/json' } });
    }
    if (error.validation) {
      return reply
        .code(400)
        .send({ ok: false, error: { code: 'LC_E_VALIDATION', message: error.message, detail: error.validation } });
    }
    if (!isApi) {
      if (status >= 500) {
        return reply
          .code(status)
          .type('text/html; charset=utf-8')
          .send('<!doctype html><meta charset="utf-8"><title>请求失败</title><p>服务内部错误，请稍后重试。</p>');
      }
      return reply
        .code(status)
        .type('text/html; charset=utf-8')
        .send(`<!doctype html><meta charset="utf-8"><title>请求失败</title><p>${escapeHtml(error.message)}</p>`);
    }
    const code = typeof error.code === 'string' && error.code.startsWith('LC_E_')
      ? error.code
      : 'LC_E_INTERNAL';
    const message = status >= 500 && code === 'LC_E_INTERNAL' ? '服务内部错误，请稍后重试。' : error.message;
    return reply
      .code(status)
      .send({ ok: false, error: { code, message, detail: status >= 500 ? undefined : error.detail } });
  });

  const noCacheStatic = {
    decorateReply: false,
    index: false,
    cacheControl: false,
    setHeaders: (res) => {
      if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache');
    }
  };

  await app.register(fastifyStatic, {
    root: path.join(platformRoot, 'assets'),
    prefix: '/assets/',
    ...noCacheStatic
  });

  await app.register(fastifyStatic, {
    root: path.join(platformRoot, 'vendor'),
    prefix: '/vendor/',
    ...noCacheStatic
  });

  // 平台与渲染层共用的纯函数模块（如 Mermaid 适配器），只读、无用户数据
  await app.register(fastifyStatic, {
    root: path.join(platformRoot, 'shared'),
    prefix: '/shared/',
    ...noCacheStatic
  });

  app.get('/', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'home.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/home.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'home.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/builds.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'builds.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/builder.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'builder.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/export.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'export.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/data.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'data.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/middleware.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'middleware.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/config-center.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'config-center.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/components.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'components.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/templates.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'templates.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/page-import.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'page-import.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/diagnostics.html', async (_request, reply) => {
    const html = await fs.readFile(path.join(platformRoot, 'diagnostics.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/backend-flow.html', async (_request, reply) => {
    const html = await readIndexHtml(platformRoot, token, 'backend-flow.html');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get('/favicon.ico', async (_request, reply) => {
    const svg = await fs.readFile(path.join(platformRoot, 'vendor', 'favicon.svg'), 'utf8').catch(() => null);
    if (!svg) return reply.code(404).send('favicon not found');
    return reply.type('image/svg+xml').send(svg);
  });

  registerRuntimeRoutes(app, context);
  registerSiteRoutes(app, context);
  registerBackupRoutes(app, context);
  registerFileRoutes(app, context);
  registerBatchRoutes(app, context);
  registerVersionRoutes(app, context);
  registerThemeRoutes(app, context);
  registerExportRoutes(app, context);
  registerExportConfigRoutes(app, context);
  registerBuilderRoutes(app, context);
  registerDataRoutes(app, context);
  registerComponentRoutes(app, context);
  registerTemplateRoutes(app, context);
  registerCodeRoutes(app, context);
  registerMiddlewareConfigRoutes(app, context);
  registerBackendFlowRoutes(app, context);

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url || '';
    if (url.startsWith('/api/')) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `接口不存在：${url}` } });
    }
    const ext = path.extname(url.split('?')[0]).toLowerCase();
    const type = MIME_BY_EXT.get(ext) || 'text/plain; charset=utf-8';
    return reply.code(404).type(type).send(`资源不存在：${url}`);
  });

  return app;
}

async function readIndexHtml(platformRoot, token, file = 'home.html') {
  const html = await fs.readFile(path.join(platformRoot, file), 'utf8');
  return html.replaceAll('__LC_TOKEN__', token);
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}
