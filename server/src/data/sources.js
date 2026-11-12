/* 数据源 · 自定义接口
 *
 * 只做配置归一化与外部请求执行；密钥值不在这里落盘。
 * 红线：拒绝数据库/缓存常见端口，任何密钥值不进 sources.json、不进日志、不回显。 */
import { DATA_LIMITS, fail } from './model.js';

export const SOURCE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const SOURCE_TARGETS = ['collection', 'component'];

/* 本机数据库/缓存实例的常见端口：一律不探测（项目红线）。 */
const DB_PORTS = new Set([1433, 1521, 3306, 3307, 5432, 6379, 6380, 27017, 33060, 33061]);

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function normalizeSource(input, options = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const existing = options.existing || null;
  const name = String(src.name == null ? '' : src.name).trim().slice(0, DATA_LIMITS.nameLength);
  if (!name) throw fail(400, 'LC_E_SOURCE_VALIDATION', '接口名称不能为空');

  const rawId = String(src.id == null ? '' : src.id).trim().toLowerCase() || (existing ? existing.id : '');
  const preferredId = rawId || ('api-' + Math.random().toString(36).slice(2, 10));
  if (!ID_RE.test(preferredId)) throw fail(400, 'LC_E_SOURCE_VALIDATION', '接口 ID 只能用小写字母、数字、下划线和短横线');

  const request = src.request && typeof src.request === 'object' ? src.request : {};
  const method = String(request.method || 'GET').toUpperCase();
  if (!SOURCE_METHODS.includes(method)) throw fail(400, 'LC_E_SOURCE_VALIDATION', '不支持的请求方法：' + method);

  const url = String(request.url == null ? '' : request.url).trim();
  if (!url) throw fail(400, 'LC_E_SOURCE_VALIDATION', '接口地址不能为空');
  const parsed = assertAllowedUrl(url);

  const timeoutMs = clampInt(request.timeoutMs, DATA_LIMITS.requestTimeoutMs,
    DATA_LIMITS.requestTimeoutMinMs, DATA_LIMITS.requestTimeoutMaxMs);
  const maxResponseBytes = clampInt(request.maxResponseBytes, DATA_LIMITS.responseBytes,
    DATA_LIMITS.responseBytesMin, DATA_LIMITS.responseBytesMax);

  const headers = normalizeEntries(request.headers, 'header', options.allowSecretValues);
  const query = normalizeEntries(request.query, 'query', options.allowSecretValues);

  const body = typeof request.body === 'string' ? request.body : '';
  if (body && method === 'GET') throw fail(400, 'LC_E_SOURCE_VALIDATION', 'GET 请求不能带请求体模板');

  const mappingInput = src.mapping && typeof src.mapping === 'object' ? src.mapping : {};
  const target = SOURCE_TARGETS.includes(mappingInput.target) ? mappingInput.target : 'collection';
  const mapping = {
    target,
    collectionId: String(mappingInput.collectionId || '').trim(),
    component: String(mappingInput.component || '').trim().slice(0, 64),
    rowsPath: normalizeRowsPath(mappingInput.rowsPath),
    fields: normalizeFieldMapping(mappingInput.fields)
  };
  if (!options.relaxed) {
    if (target === 'collection' && !mapping.collectionId) {
      throw fail(400, 'LC_E_SOURCE_VALIDATION', '映射到集合时必须选择集合');
    }
    if (target === 'component' && !mapping.component) {
      throw fail(400, 'LC_E_SOURCE_VALIDATION', '映射到组件时必须填写组件标识');
    }
  }

  return {
    schemaVersion: 1,
    id: preferredId,
    name,
    type: 'http',
    description: String(src.description == null ? '' : src.description).trim().slice(0, DATA_LIMITS.descriptionLength),
    request: {
      method,
      url: parsed.toString(),
      headers,
      query,
      body,
      contentType: String(request.contentType || '').trim().slice(0, 128),
      timeoutMs,
      maxResponseBytes
    },
    mapping,
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeRowsPath(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (!/^[A-Za-z0-9_$.[\]-]+$/.test(raw)) {
    throw fail(400, 'LC_E_SOURCE_VALIDATION', '响应路径只能包含字母、数字、下划线、点和方括号');
  }
  return raw.slice(0, 200);
}

function normalizeFieldMapping(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw fail(400, 'LC_E_SOURCE_VALIDATION', 'fields 必须是数组');
  return input.slice(0, 128).map((item) => {
    const src = item && typeof item === 'object' ? item : {};
    const from = String(src.from == null ? '' : src.from).trim();
    const to = String(src.to == null ? '' : src.to).trim();
    if (!from) throw fail(400, 'LC_E_SOURCE_VALIDATION', '响应字段映射缺少 from');
    if (!to) throw fail(400, 'LC_E_SOURCE_VALIDATION', '响应字段映射缺少 to');
    return { from: from.slice(0, 128), to: to.slice(0, 64) };
  });
}

function normalizeEntries(input, scope, allowSecretValues) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw fail(400, 'LC_E_SOURCE_VALIDATION', scope + ' 必须是数组');
  const seen = new Set();
  return input.slice(0, 64).map((item) => {
    const src = item && typeof item === 'object' ? item : {};
    const name = String(src.name == null ? '' : src.name).trim();
    if (!name) throw fail(400, 'LC_E_SOURCE_VALIDATION', scope + ' 名称不能为空');
    if (!HEADER_NAME_RE.test(name)) throw fail(400, 'LC_E_SOURCE_VALIDATION', '非法的 ' + scope + ' 名称：' + name);
    const key = name.toLowerCase();
    if (seen.has(key)) throw fail(400, 'LC_E_SOURCE_VALIDATION', '重复的 ' + scope + '：' + name);
    seen.add(key);
    const secret = src.secret === true;
    const entry = { name, secret };
    if (!secret) {
      entry.value = String(src.value == null ? '' : src.value).slice(0, 2048);
    } else if (allowSecretValues) {
      const value = String(src.value == null ? '' : src.value);
      if (value) entry.value = value.slice(0, 4096);
    }
    return entry;
  });
}

export function assertAllowedUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw fail(400, 'LC_E_SOURCE_URL', '接口地址不是合法的 URL：' + String(rawUrl).slice(0, 200));
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw fail(400, 'LC_E_SOURCE_URL', '只支持 http / https 协议，收到：' + parsed.protocol);
  }
  if (parsed.username || parsed.password) {
    throw fail(400, 'LC_E_SOURCE_URL', '账号密码不能写在 URL 里，请改用请求头并标记为密钥');
  }
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (DB_PORTS.has(port)) {
    throw fail(422, 'LC_E_SOURCE_BLOCKED',
      '端口 ' + port + ' 是本机数据库/缓存服务的常见端口，项目红线禁止探测。' +
      '如果要调用数据库，请使用平台自身的导出配置，不要用接口测试。');
  }
  return parsed;
}

/* 把存储里标记 secret 的条目补上 hasSecret 标记；任何情况下都不回显值。 */
export function sanitizeSource(source, secrets) {
  const map = secrets || {};
  const cleanEntries = (entries, scope) => (entries || []).map((entry) => {
    const out = { name: entry.name, secret: entry.secret === true };
    if (entry.secret) {
      out.hasSecret = Boolean(map[scope + ':' + entry.name]);
    } else {
      out.value = entry.value || '';
    }
    return out;
  });
  return Object.assign({}, source, {
    request: Object.assign({}, source.request, {
      headers: cleanEntries(source.request && source.request.headers, 'header'),
      query: cleanEntries(source.request && source.request.query, 'query')
    })
  });
}

/* 从原始输入收集密钥值，仅用于写入 .lowcode/data-secrets.json。 */
export function collectSecretValues(rawSource) {
  const source = rawSource && typeof rawSource === 'object' ? rawSource : {};
  const request = source.request && typeof source.request === 'object' ? source.request : {};
  const out = {};
  for (const item of Array.isArray(request.headers) ? request.headers : []) {
    if (item && item.secret === true && item.value) out['header:' + String(item.name).trim()] = String(item.value);
  }
  for (const item of Array.isArray(request.query) ? request.query : []) {
    if (item && item.secret === true && item.value) out['query:' + String(item.name).trim()] = String(item.value);
  }
  return out;
}

export function secretKeysOf(source) {
  const keys = [];
  const request = source.request || {};
  for (const item of request.headers || []) {
    if (item.secret) keys.push('header:' + item.name);
  }
  for (const item of request.query || []) {
    if (item.secret) keys.push('query:' + item.name);
  }
  return keys;
}

/* 落盘前剥掉密钥明文：secret 条目只留名字与标记。 */
export function stripSecretValues(source) {
  const clone = JSON.parse(JSON.stringify(source));
  const request = clone.request || {};
  for (const entry of request.headers || []) {
    if (entry.secret === true) delete entry.value;
  }
  for (const entry of request.query || []) {
    if (entry.secret === true) delete entry.value;
  }
  return clone;
}

/* ---------------- 请求执行 ---------------- */

function getPath(value, pathText) {
  if (!pathText) return value;
  const tokens = [];
  const textValue = String(pathText);
  let index = 0;
  while (index < textValue.length) {
    const ch = textValue[index];
    if (ch === '.') {
      index += 1;
      continue;
    }
    if (ch === '[') {
      const close = textValue.indexOf(']', index);
      if (close === -1) return undefined;
      const raw = textValue.slice(index + 1, close).replace(/^['"]|['"]$/g, '');
      tokens.push(raw);
      index = close + 1;
      continue;
    }
    let end = index;
    while (end < textValue.length && textValue[end] !== '.' && textValue[end] !== '[') end += 1;
    if (end > index) tokens.push(textValue.slice(index, end));
    index = end;
  }
  let current = value;
  for (const token of tokens) {
    if (current == null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(token)) current = current[Number(token)];
    else if (typeof current === 'object') current = current[token];
    else return undefined;
  }
  return current;
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function sampleText(value) {
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).slice(0, 120);
    } catch {
      return '[object]';
    }
  }
  return String(value).slice(0, 120);
}

export function describeStructure(value, depth) {
  const level = depth || 0;
  if (level > 2) return { kind: 'deep' };
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: value.length,
      item: value.length ? describeStructure(value[0], level + 1) : null
    };
  }
  if (value && typeof value === 'object') {
    return {
      kind: 'object',
      fields: Object.keys(value).slice(0, 40).map((key) => ({
        name: key,
        type: typeName(value[key]),
        sample: sampleText(value[key])
      }))
    };
  }
  return { kind: typeName(value), sample: sampleText(value) };
}

function maskUrl(url, queryEntries, secretValues) {
  const copy = new URL(url);
  for (const [name, entry] of queryEntries) {
    if (entry.secret) copy.searchParams.set(name, secretValues['query:' + name] ? '***' : '');
  }
  return copy.toString();
}

function extractRows(payload, rowsPath) {
  if (rowsPath) {
    const found = getPath(payload, rowsPath);
    if (found === undefined) {
      throw fail(422, 'LC_E_SOURCE_MAPPING', '响应里找不到路径「' + rowsPath + '」对应的数据');
    }
    if (Array.isArray(found)) return found;
    if (found && typeof found === 'object') return [found];
    throw fail(422, 'LC_E_SOURCE_MAPPING', '路径「' + rowsPath + '」不是数组或对象');
  }
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['data', 'rows', 'items', 'list', 'results', 'records']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [payload];
  }
  throw fail(422, 'LC_E_SOURCE_MAPPING', '响应不是对象或数组，无法映射');
}

function applyMapping(rows, mapping, collection) {
  const fieldMap = new Map((mapping.fields || []).map((item) => [item.from, item.to]));
  const collectionFields = collection
    ? new Map(collection.fields.map((field) => [field.id, field.id]))
    : null;
  const collectionByName = collection
    ? new Map(collection.fields.map((field) => [String(field.name).toLowerCase(), field.id]))
    : null;

  const mapped = [];
  const unmapped = new Set();
  for (const row of rows.slice(0, 3)) {
    if (!row || typeof row !== 'object') {
      mapped.push({ value: row });
      continue;
    }
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      let target = fieldMap.get(key);
      if (!target && collection) {
        target = collectionFields.get(key) || collectionByName.get(String(key).toLowerCase()) || '';
      }
      if (!target) {
        unmapped.add(key);
        continue;
      }
      out[target] = value;
    }
    mapped.push(out);
  }
  return { sample: mapped, unmapped: Array.from(unmapped) };
}

function classifyError(error, timedOut, timeoutMs) {
  if (timedOut || (error && error.name === 'TimeoutError')) {
    return { category: 'timeout', message: '请求超时：' + timeoutMs + ' 毫秒内没有响应' };
  }
  const cause = error && (error.cause || error);
  const code = cause && (cause.code || '');
  const detail = (cause && (cause.message || cause.code)) || (error && error.message) || '未知错误';
  if (/ENOTFOUND|EAI_AGAIN/.test(String(code))) {
    return { category: 'network', message: '域名解析失败（' + code + '）：请检查地址与网络' };
  }
  if (/ECONNREFUSED/.test(String(code))) {
    return { category: 'network', message: '连接被拒绝（ECONNREFUSED）：目标端口没有服务在监听' };
  }
  if (/ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(String(code))) {
    return { category: 'network', message: '网络不可达（' + code + '）：' + detail };
  }
  if (/certificate|SSL|TLS/i.test(String(detail))) {
    return { category: 'network', message: 'TLS / 证书校验失败：' + detail };
  }
  return { category: 'network', message: '网络请求失败：' + detail };
}

async function readLimitedBody(response, maxBytes) {
  if (!response.body) return { text: '', bytes: 0 };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw fail(422, 'LC_E_SOURCE_RESPONSE_TOO_LARGE',
          '响应体积超过上限 ' + maxBytes + ' 字节（已读取 ' + bytes + ' 字节）',
          { maxResponseBytes: maxBytes, readBytes: bytes });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes };
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/* 手动跟随重定向：每一跳都重新做协议/端口校验，避免跳转到本机 DB 端口绕过红线。 */
async function fetchWithSafeRedirects(initialUrl, options) {
  const baseHost = new URL(initialUrl).hostname.toLowerCase();
  const baseProtocol = new URL(initialUrl).protocol;
  let current = initialUrl;
  let method = options.method;
  let body = options.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      method,
      headers: options.headers,
      body,
      signal: options.signal,
      redirect: 'manual'
    });
    if (!REDIRECT_STATUS.has(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;

    let next;
    try {
      next = new URL(location, current);
    } catch {
      throw fail(422, 'LC_E_SOURCE_REDIRECT', '接口返回了无法解析的重定向地址');
    }
    assertAllowedUrl(next.toString());
    if (next.hostname.toLowerCase() !== baseHost) {
      throw fail(422, 'LC_E_SOURCE_REDIRECT', '接口发生了跨域重定向，已停止请求以避免密钥发送到其它主机');
    }
    if (baseProtocol === 'https:' && next.protocol === 'http:') {
      throw fail(422, 'LC_E_SOURCE_REDIRECT', '接口重定向把 HTTPS 降级为 HTTP，已停止请求');
    }
    if (hop === MAX_REDIRECTS) {
      throw fail(422, 'LC_E_SOURCE_REDIRECT', '重定向次数超过 ' + MAX_REDIRECTS + ' 次');
    }
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel().catch(() => {});
    }
    if (response.status === 303 ||
        ((response.status === 301 || response.status === 302) && !['GET', 'HEAD'].includes(method))) {
      method = 'GET';
      body = undefined;
    }
    current = next;
  }
  throw fail(422, 'LC_E_SOURCE_REDIRECT', '重定向次数超过 ' + MAX_REDIRECTS + ' 次');
}

export async function performSourceTest(source, secretValues, options = {}) {
  const request = source.request || {};
  const secretMap = secretValues || {};
  const started = Date.now();

  const url = new URL(request.url);
  const queryEntries = (request.query || []).map((entry) => [entry.name, entry]);
  for (const [name, entry] of queryEntries) {
    const value = entry.secret ? secretMap['query:' + name] : entry.value;
    if (value !== undefined) url.searchParams.set(name, value);
  }

  const headers = {};
  for (const entry of request.headers || []) {
    const value = entry.secret ? secretMap['header:' + entry.name] : entry.value;
    if (value !== undefined && value !== '') headers[entry.name] = value;
  }
  if (request.contentType && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = request.contentType;
  }

  const maskedUrl = maskUrl(request.url, queryEntries, secretMap);
  const timeoutMs = request.timeoutMs || DATA_LIMITS.requestTimeoutMs;
  const maxResponseBytes = request.maxResponseBytes || DATA_LIMITS.responseBytes;
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.body;

  let timedOut = false;
  let timer = null;
  const controller = new AbortController();
  timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchWithSafeRedirects(url, {
      method: request.method || 'GET',
      headers,
      body: hasBody ? request.body : undefined,
      signal: controller.signal
    });
    const elapsedMs = Date.now() - started;
    let body;
    try {
      body = await readLimitedBody(response, maxResponseBytes);
    } catch (error) {
      if (error && error.code === 'LC_E_SOURCE_RESPONSE_TOO_LARGE') {
        return {
          success: false,
          category: 'too-large',
          message: error.message,
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          request: describeRequest(request, maskedUrl, secretMap),
          structure: null,
          rows: 0,
          mapped: [],
          responseBytes: error.detail ? error.detail.readBytes : 0
        };
      }
      throw error;
    }

    const base = {
      status: response.status,
      statusText: response.statusText,
      elapsedMs,
      responseBytes: body.bytes,
      contentType: response.headers.get('content-type') || '',
      request: describeRequest(request, maskedUrl, secretMap)
    };

    if (response.status === 401 || response.status === 403) {
      return Object.assign(base, {
        success: false,
        category: 'auth',
        message: '认证失败：HTTP ' + response.status + ' ' + response.statusText +
          '。请检查请求头里的令牌 / API Key。',
        bodyPreview: body.text.slice(0, 200),
        structure: null,
        rows: 0,
        mapped: []
      });
    }
    if (!response.ok) {
      return Object.assign(base, {
        success: false,
        category: 'http',
        message: '服务返回 HTTP ' + response.status + ' ' + response.statusText,
        bodyPreview: body.text.slice(0, 200),
        structure: null,
        rows: 0,
        mapped: []
      });
    }

    let payload;
    try {
      payload = JSON.parse(body.text);
    } catch {
      return Object.assign(base, {
        success: false,
        category: 'format',
        message: '响应不是合法 JSON（Content-Type: ' + (response.headers.get('content-type') || '未声明') + '）',
        bodyPreview: body.text.slice(0, 200),
        structure: null,
        rows: 0,
        mapped: []
      });
    }

    const structure = describeStructure(payload);
    let rows;
    try {
      rows = extractRows(payload, source.mapping && source.mapping.rowsPath);
    } catch (error) {
      return Object.assign(base, {
        success: false,
        category: 'format',
        message: error.message,
        structure,
        rows: 0,
        mapped: []
      });
    }

    const mappedResult = applyMapping(rows, source.mapping || {}, options.collection || null);
    return Object.assign(base, {
      success: true,
      category: 'ok',
      message: '请求成功',
      structure,
      rows: rows.length,
      mapped: mappedResult.sample,
      unmapped: mappedResult.unmapped,
      rowsPath: source.mapping && source.mapping.rowsPath ? source.mapping.rowsPath : '',
      sample: rows.slice(0, 3)
    });
  } catch (error) {
    const elapsedMs = Date.now() - started;
    if (error && typeof error.code === 'string' && error.code.startsWith('LC_E_SOURCE_')) throw error;
    const classified = classifyError(error, timedOut, timeoutMs);
    return {
      success: false,
      category: classified.category,
      message: classified.message,
      status: null,
      statusText: '',
      elapsedMs,
      responseBytes: 0,
      request: describeRequest(request, maskedUrl, secretMap)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describeRequest(request, maskedUrl, secretMap) {
  return {
    method: request.method || 'GET',
    url: maskedUrl,
    timeoutMs: request.timeoutMs,
    maxResponseBytes: request.maxResponseBytes,
    headers: (request.headers || []).map((entry) => ({
      name: entry.name,
      secret: entry.secret === true,
      present: entry.secret ? Boolean(secretMap['header:' + entry.name]) : Boolean(entry.value)
    })),
    query: (request.query || []).map((entry) => ({
      name: entry.name,
      secret: entry.secret === true,
      present: entry.secret ? Boolean(secretMap['query:' + entry.name]) : Boolean(entry.value),
      value: entry.secret ? '***' : entry.value
    }))
  };
}
