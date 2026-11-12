/* 站点公开地址：域名与路径前缀归一化。
 *
 * 平台侧（导出配置保存 / 导出管线）共用这一份口径，避免 UI 校验与产物生成各说各话：
 *   - 空域名：回退 localhost，仅本机可用；
 *   - 缺协议：按主机类型补 http（localhost / IP）或 https（域名）；
 *   - 末尾斜杠：去掉；
 *   - 带路径 / 查询串 / 锚点 / 用户名密码 / 空白：非法，直接报错。
 * 路径前缀单独放在 basePath：必须以 / 开头，去掉末尾斜杠，拒绝 .. 与连续斜杠。
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV6_RE = /^\[[0-9a-f:.]+\]$/i;

export function siteAddressError(message) {
  const error = new Error(message);
  error.code = 'LC_E_SITE_DOMAIN_INVALID';
  error.statusCode = 422;
  return error;
}

function looksLikeIp(text) {
  return IPV4_RE.test(String(text || '').replace(/^\[|\]$/g, ''));
}

export function normalizeBasePath(input) {
  let text = String(input == null ? '' : input).trim();
  if (!text) return '/';
  if (/[?#\s]/.test(text)) throw siteAddressError('路径前缀不能包含空白、查询串或锚点');
  if (!text.startsWith('/')) text = '/' + text;
  text = text.replace(/\/+$/, '');
  if (!text) return '/';
  if (text.includes('//')) throw siteAddressError('路径前缀不能包含连续斜杠');
  const segments = text.split('/');
  if (segments.some((item) => item === '.' || item === '..')) {
    throw siteAddressError('路径前缀不能包含 . 或 ..');
  }
  if (!/^\/[A-Za-z0-9._~\-/]+$/.test(text)) throw siteAddressError('路径前缀包含非法字符');
  return text;
}

/**
 * @param {{domain?: string, basePath?: string}} input
 * @returns {{
 *   domain: string, host: string, scheme: string, port: string, origin: string,
 *   basePath: string, publicBaseUrl: string, serverNames: string,
 *   configured: boolean, local: boolean, normalized: boolean,
 *   corsOrigins: string[]
 * }}
 */
export function normalizeSiteAddress(input) {
  const opts = input || {};
  const basePath = normalizeBasePath(opts.basePath);
  const rawDomain = String(opts.domain == null ? '' : opts.domain).trim();

  if (!rawDomain) {
    const publicBaseUrl = 'http://localhost' + (basePath === '/' ? '' : basePath);
    return {
      domain: '',
      host: 'localhost',
      scheme: 'http',
      port: '',
      origin: 'http://localhost',
      basePath,
      publicBaseUrl,
      serverNames: 'localhost 127.0.0.1',
      configured: false,
      local: true,
      normalized: false,
      corsOrigins: ['http://localhost', 'http://127.0.0.1']
    };
  }

  if (/\s/.test(rawDomain)) throw siteAddressError('域名不能包含空白字符');

  let text = rawDomain;
  let addedScheme = false;
  let explicitScheme = '';
  const schemeMatch = text.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (schemeMatch) {
    explicitScheme = schemeMatch[1].toLowerCase();
    if (explicitScheme !== 'http' && explicitScheme !== 'https') {
      throw siteAddressError('域名协议只支持 http:// 或 https://');
    }
  } else {
    const hostOnly = text.replace(/\/+$/, '').split('/')[0].replace(/:\d+$/, '');
    const lower = hostOnly.toLowerCase();
    const scheme = LOOPBACK_HOSTS.has(lower) || looksLikeIp(lower) ? 'http' : 'https';
    text = scheme + '://' + text;
    addedScheme = true;
  }

  /* 只有在没有路径时才允许去掉末尾斜杠；带路径的值会在下面按非法报错。 */
  text = text.replace(/\/+$/, '');

  let url;
  try {
    url = new URL(text);
  } catch {
    throw siteAddressError('域名格式不正确：' + rawDomain);
  }
  if (url.username || url.password) throw siteAddressError('域名不能包含用户名或密码');
  if (/[?#]/.test(text)) throw siteAddressError('域名不能包含查询串或锚点，路径前缀请写到 basePath');
  if (url.pathname !== '/') throw siteAddressError('域名不能包含路径，路径前缀请写到 basePath');

  const host = url.hostname;
  if (!(HOSTNAME_RE.test(host) || looksLikeIp(host) || IPV6_RE.test(host))) {
    throw siteAddressError('域名主机名不合法：' + host);
  }
  /* URL 会把中文/空格之类的字符转成百分号编码，这里显式拒绝，避免生成坏配置。 */
  if (!/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/i.test(host)) {
    throw siteAddressError('域名只能包含字母、数字、点与连字符');
  }

  const origin = url.origin;
  const publicBaseUrl = origin + (basePath === '/' ? '' : basePath);
  const local = LOOPBACK_HOSTS.has(host.toLowerCase()) || looksLikeIp(host);
  const serverNames = LOOPBACK_HOSTS.has(host.toLowerCase()) ? 'localhost 127.0.0.1' : host;

  return {
    domain: host,
    host,
    scheme: url.protocol.replace(':', ''),
    port: url.port,
    origin,
    basePath,
    publicBaseUrl,
    serverNames,
    configured: true,
    local,
    normalized: addedScheme || rawDomain.endsWith('/') || rawDomain !== origin,
    corsOrigins: [origin]
  };
}
