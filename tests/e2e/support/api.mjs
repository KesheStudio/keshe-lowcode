import { TEMP_SITE_PREFIX } from './config.mjs';

let cachedToken = '';

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

const TEMP_SITE_ID_RE = /^lc-e2e-[a-z0-9][a-z0-9-]{3,59}$/;

export function isTempSiteId(siteId) {
  return TEMP_SITE_ID_RE.test(String(siteId || ''));
}

export function makeTempSiteId() {
  return TEMP_SITE_PREFIX + Date.now().toString(36) + '-' + randomSuffix();
}

export async function getToken(request) {
  if (cachedToken) return cachedToken;
  const response = await request.get('/builder.html');
  if (!response.ok()) throw new Error('取不到工作台页面：HTTP ' + response.status());
  const html = await response.text();
  const match = html.match(/name="lc-token" content="([^"]+)"/);
  if (!match) throw new Error('工作台页面里没有找到访问令牌（lc-token）');
  cachedToken = match[1];
  return cachedToken;
}

export async function apiResponse(request, method, url, body) {
  const token = await getToken(request);
  const options = {
    method,
    headers: { 'x-lc-token': token }
  };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.data = body;
  }
  return request.fetch(url, options);
}

export async function api(request, method, url, body) {
  const response = await apiResponse(request, method, url, body);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(method + ' ' + url + ' 返回的不是 JSON：' + text.slice(0, 120));
  }
  if (!response.ok() || payload.ok === false) {
    const message = (payload.error && payload.error.message) || ('HTTP ' + response.status());
    const error = new Error(method + ' ' + url + ' 失败：' + message);
    error.code = payload.error && payload.error.code;
    throw error;
  }
  return payload.data;
}

export async function createTempSite(request, name, options) {
  const siteId = makeTempSiteId();
  const body = {
    /* 站点名会被导出向导用作桌面应用名默认值，不能带 \ / : * ? " < > | 这些字符。 */
    name: name || ('E2E 临时站点 ' + Date.now().toString(36)),
    siteId
  };
  /* 不传 type 时服务端默认建纯静态站点；后端功能页需要 type=backend 才进编辑态。 */
  if (options && options.type) body.type = options.type;
  if (options && options.backendLanguage) body.backendLanguage = options.backendLanguage;
  const data = await api(request, 'POST', '/api/sites', body);
  return { siteId: data.siteId, name: data.name, type: data.type, backendLanguage: data.backendLanguage };
}

/**
 * 删除用例自己创建的临时站点。
 * 测试服务跑在隔离的临时数据目录里，站点删掉后整个临时目录会在服务退出时移除，
 * 因此这里只调用官方删除接口，不会碰 data/sites 下的任何已有站点。
 */
export async function cleanupTempSite(request, siteId) {
  if (!isTempSiteId(siteId)) return;
  try {
    await api(request, 'DELETE', '/api/sites/' + encodeURIComponent(siteId));
  } catch (error) {
    // 用例可能已经删过；隔离目录随后整体删除，这里不阻断
  }
}

export async function getPage(request, siteId, pageId) {
  return api(request, 'GET', '/api/sites/' + encodeURIComponent(siteId) +
    '/builder/page?pageId=' + encodeURIComponent(pageId));
}

export async function importResource(request, siteId, kind, filename, content) {
  return api(request, 'POST', '/api/sites/' + encodeURIComponent(siteId) + '/builder/import', {
    kind,
    filename,
    content
  });
}

export async function renderPage(request, siteId, page, themeId, mode, uiEnd) {
  const body = { page, themeId, mode };
  if (uiEnd === 'mobile' || uiEnd === 'desktop') body.uiEnd = uiEnd;
  return api(request, 'POST', '/api/sites/' + encodeURIComponent(siteId) + '/builder/render', body);
}

/** 直接写站点文件：用于准备文章元数据、集合等用例数据（仍只作用于临时站点）。 */
export async function writeSiteFile(request, siteId, relPath, content) {
  return api(request, 'PUT', '/api/sites/' + encodeURIComponent(siteId) +
    '/file?path=' + encodeURIComponent(relPath), { content });
}

export async function createCollection(request, siteId, collection) {
  return api(request, 'POST', '/api/sites/' + encodeURIComponent(siteId) + '/data/collections', collection);
}

/** 删除站点内的单个文件：用于把临时站点清成真正的空态（仍只作用于临时站点）。 */
export async function deleteSiteFile(request, siteId, relPath) {
  return api(request, 'DELETE', '/api/sites/' + encodeURIComponent(siteId) +
    '/file?path=' + encodeURIComponent(relPath));
}
