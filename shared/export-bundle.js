/* 低代码平台 · 产物结构与清单生成（F3 第①步）
 *
 * 浏览器与 Node 共用同一份逻辑：产物目录约定、artifact-manifest v4、
 * README / 第三方许可证清单 / lowcode-project.json、离线与安全自检。
 *
 * 边界（CONTRACTS 第 15 节）：
 * - 本文件不读存储、不跑渲染、不写 zip；调用方把“已经渲染好的文件”和构建元信息传进来。
 * - 浏览器通过 <script> 加载后挂 window.LC.ExportBundle；Node 直接 require。
 * - 服务端导出与浏览器导出必须调用同一个 assemble()，不允许各自拼清单。
 *
 * 资源复制、压缩、模板装配分别在第②、③步接入，本文件只预留字段，不实现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('node:crypto'));
  } else {
    root.LC = root.LC || {};
    root.LC.ExportBundle = factory(null);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (nodeCrypto) {
  'use strict';

  var EXPORT_MANIFEST_VERSION = 4;
  var CONTRACTS_VERSION = '2.0.0';
  var EXPORT_WARN_BYTES = 4 * 1024 * 1024;

  var META_FILES = ['artifact-manifest.json', 'README.md', 'README.txt', 'THIRD-PARTY-NOTICES.md', 'lowcode-project.json'];

  /* 产物根目录约定（CONTRACTS 15.1 / 15.2）。目录按需存在，这里只定义归属。 */
  var TARGETS = {
    'web-static': {
      target: 'web-static',
      entry: 'web/index.html',
      runtime: 'static',
      dirs: ['web', 'server', 'deploy', 'data', 'vendor'],
      readmeDirs: ['web', 'server', 'deploy', 'data', 'vendor']
    },
    'tauri-desktop': {
      target: 'tauri-desktop',
      entry: 'web/index.html',
      runtime: 'tauri-desktop',
      dirs: ['desktop', 'web', 'server', 'deploy', 'vendor'],
      readmeDirs: ['desktop', 'web', 'server', 'deploy', 'vendor']
    }
  };

  var CATEGORY_ORDER = ['meta', 'web', 'desktop', 'server', 'deploy', 'data', 'vendor', 'other'];

  var TEXT_EXT = /\.(html?|css|js|mjs|cjs|svg|xml|json|txt|md|yaml|yml|toml|sh|rs|go)$/i;

  var RE_EXTERNAL_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i;
  var RE_LINK_TAG = /<link\b[^>]*>/gi;
  var RE_LINK_REL = /\brel\s*=\s*["']([^"']+)["']/i;
  var RE_LINK_HREF = /\bhref\s*=\s*["']([^"']+)["']/i;
  var RE_EXTERNAL_IMPORT = /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i;
  var RE_EXTERNAL_URL = /url\(\s*["']?(?:https?:)?\/\//i;
  var RE_HTML_SRC = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  var RE_HTML_LINK_HREF = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  var RE_CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  var RE_CSS_IMPORT = /@import\s+(?:url\(\s*)?["']([^"']+)["']/gi;

  var PRIVATE_KEY_RE = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;
  var PRIVATE_NAME_RE = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:key|p12|pfx|jks|keystore))$/i;

  /* 只按“完整键名或后缀”判定，避免误删设计令牌（tokens）等正常字段。 */
  var SECRET_KEY_WORDS = [
    'password', 'passwd', 'secret', 'secretkey', 'privatekey', 'privkey', 'token',
    'accesstoken', 'refreshtoken', 'authtoken', 'apikey', 'credential', 'credentials', 'certificatekey'
  ];

  function fail(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function hasTextEncoder() {
    return typeof TextEncoder !== 'undefined';
  }

  function toBytes(value) {
    if (typeof value === 'string') {
      if (hasTextEncoder()) return new TextEncoder().encode(value);
      return Buffer.from(value, 'utf8');
    }
    if (value && typeof value.byteLength === 'number') {
      return value instanceof Uint8Array ? value : new Uint8Array(value);
    }
    if (value == null) return new Uint8Array(0);
    return new Uint8Array(0);
  }

  function byteSize(value) {
    if (typeof value === 'string') {
      if (hasTextEncoder()) return new TextEncoder().encode(value).length;
      return Buffer.byteLength(value, 'utf8');
    }
    return value && typeof value.byteLength === 'number' ? value.byteLength : 0;
  }

  function toText(value) {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    var bytes = toBytes(value);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
    return '';
  }

  async function sha256(value) {
    var bytes = toBytes(value);
    if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
      return nodeCrypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    }
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      var digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.prototype.map.call(new Uint8Array(digest), function (n) {
        return ('0' + n.toString(16)).slice(-2);
      }).join('');
    }
    throw fail('LC_E_HASH_UNAVAILABLE', '当前环境无法计算 sha256');
  }

  function isTextPath(path) {
    return TEXT_EXT.test(path);
  }

  function layoutFor(target) {
    var name = String(target || 'web-static');
    if (!TARGETS[name]) {
      throw fail('LC_E_TARGET_INVALID', '不支持的导出目标：' + name);
    }
    return TARGETS[name];
  }

  function categoryOf(path) {
    if (META_FILES.indexOf(path) !== -1) return 'meta';
    var head = path.split('/')[0];
    if (head === 'web' || head === 'desktop' || head === 'server' || head === 'deploy' || head === 'data' || head === 'vendor') {
      return head;
    }
    return 'other';
  }

  /* 产物路径必须是 zip 根下的相对路径；越界、盘符、反斜杠、临时目录一律拒绝。 */
  function validatePath(path) {
    if (!path || typeof path !== 'string') return '路径为空';
    if (path.charAt(0) === '/') return '不允许以 / 开头的绝对路径';
    if (/^[A-Za-z]:/.test(path)) return '不允许盘符路径';
    if (path.indexOf('\\') !== -1) return '不允许反斜杠路径';
    var parts = path.split('/');
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (part === '') return '路径包含空段';
      if (part === '.' || part === '..') return '不允许 . 或 .. 段';
      if (part === '.lowcode') return '不允许运行时目录 .lowcode';
      if (/\.(tmp|corrupt)$/i.test(part)) return '不允许临时或损坏文件';
    }
    return '';
  }

  function entryList(files) {
    return Object.keys(files || {}).filter(function (path) {
      return path !== 'artifact-manifest.json';
    }).sort(function (a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  async function fileEntries(files) {
    var paths = entryList(files);
    var list = [];
    for (var i = 0; i < paths.length; i += 1) {
      var path = paths[i];
      list.push({
        path: path,
        size: byteSize(files[path]),
        sha256: await sha256(files[path])
      });
    }
    return list;
  }

  function isSecretKey(key) {
    var normalized = String(key == null ? '' : key).toLowerCase().replace(/[_-]/g, '');
    for (var i = 0; i < SECRET_KEY_WORDS.length; i += 1) {
      var word = SECRET_KEY_WORDS[i];
      if (normalized === word || (word.length > 6 && normalized.slice(-word.length) === word)) return true;
    }
    return false;
  }

  /* 上传目标配置随产物带走（用户明确要求），但仍剔除证书私钥类材料。 */
  function sanitizeUpload(value, depth) {
    if (depth > 12 || value == null) return value;
    if (Array.isArray(value)) {
      return value.map(function (item) { return sanitizeUpload(item, depth + 1); });
    }
    if (typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (key) {
        if (/^(?:private[_\-]?key|client[_\-]?key|cert[_\-]?key|priv[_\-]?key)$/i.test(key)) return;
        if (typeof value[key] === 'string' && PRIVATE_KEY_RE.test(value[key])) return;
        out[key] = sanitizeUpload(value[key], depth + 1);
      });
      return out;
    }
    return value;
  }

  function sanitizeValue(value, depth) {
    if (depth > 12 || value == null) return value;
    if (Array.isArray(value)) {
      return value.map(function (item) { return sanitizeValue(item, depth + 1); });
    }
    if (typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (key) {
        if (isSecretKey(key)) return;
        if (typeof value[key] === 'string' && PRIVATE_KEY_RE.test(value[key])) return;
        out[key] = key === 'upload' ? sanitizeUpload(value[key], depth + 1) : sanitizeValue(value[key], depth + 1);
      });
      return out;
    }
    return value;
  }

  function projectMeta(project) {
    var src = project || {};
    var meta = src.meta || src;
    return {
      id: String(meta.id || ''),
      name: String(meta.name || ''),
      configSchemaVersion: Number(meta.configSchemaVersion || 5),
      projectSchemaVersion: Number(meta.projectSchemaVersion || 2),
      storageLayoutVersion: Number(meta.storageLayoutVersion || 2)
    };
  }

  /* 导出包里只带可回灌的工程信息；密钥、密码、令牌等键一律剔除。 */
  function buildProjectSnapshot(input) {
    var opts = input || {};
    var project = opts.project || {};
    var config = project.config || project.configuration || project;
    var snapshot = {
      format: 'lowcode-project',
      formatVersion: 1,
      artifactId: String(opts.artifactId || ''),
      target: String(opts.target || 'web-static'),
      project: {
        id: String(project.id || ''),
        name: String(project.name || ''),
        configSchemaVersion: 5,
        projectSchemaVersion: 2,
        storageLayoutVersion: 2,
        config: sanitizeValue(config, 0)
      }
    };
    return snapshot;
  }

  function normalizeAsset(item) {
    var src = item || {};
    var pkg = String(src.package || '');
    var name = pkg;
    var version = '';
    var at = pkg.lastIndexOf('@');
    if (at > 0) {
      name = pkg.slice(0, at);
      version = pkg.slice(at + 1);
    }
    return {
      path: String(src.path || ''),
      package: pkg,
      name: name,
      version: version,
      license: String(src.license || ''),
      bytes: Number(src.bytes || 0)
    };
  }

  function normalizeLibraries(list) {
    return (list || []).map(function (item) {
      var src = item || {};
      return {
        name: String(src.name || ''),
        version: String(src.version || ''),
        license: String(src.license || ''),
        path: String(src.path || ''),
        sha256: String(src.sha256 || ''),
        inlined: !!src.inlined
      };
    }).sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  }

  function normalizeBundled(list) {
    var names = {};
    return (list || []).map(normalizeAsset).filter(function (item) {
      if (!item.path) return false;
      if (names[item.path]) return false;
      names[item.path] = true;
      return true;
    }).sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  }

  /* 数据库配置在站点里是对象（driver/name/url…），直接 String() 会写成 "[object Object]"。
     清单只需要一个可读引擎名，这里按 driver → type → engine → name 的顺序取。 */
  function databaseLabel(database, language) {
    if (language === 'none') return 'none';
    if (typeof database === 'string') return database;
    if (database && typeof database === 'object') {
      var label = database.driver || database.type || database.engine || database.name;
      if (label != null && String(label).trim()) return String(label).trim();
    }
    return language === 'none' ? 'none' : '';
  }

  function normalizeBackend(backend, target) {
    var src = backend || {};
    var language = String(src.language || (target === 'tauri-desktop' ? 'none' : 'none'));
    if (!language) language = 'none';
    return {
      language: language,
      maturity: String(src.maturity || (language === 'none' ? 'n/a' : '')),
      database: databaseLabel(src.database, language),
      middleware: Array.isArray(src.middleware) ? src.middleware.slice() : []
    };
  }

  function normalizeDeploy(deploy, target) {
    var src = deploy || {};
    var nginx = src.nginx || {};
    var tls = src.tls || {};
    var certs = src.certs || {};
    var site = src.site || {};
    return {
      site: {
        domain: String(site.domain || 'localhost'),
        configured: !!site.configured,
        origin: String(site.origin || ''),
        basePath: String(site.basePath || '/'),
        publicBaseUrl: String(site.publicBaseUrl || '')
      },
      nginx: {
        enabled: !!nginx.enabled,
        path: String(nginx.path || (nginx.enabled ? 'deploy/nginx/nginx.conf' : '')),
        customized: !!nginx.customized
      },
      tls: {
        enabled: !!tls.enabled,
        source: String(tls.source || (tls.enabled ? 'generated' : 'none')),
        domain: String(tls.domain || ''),
        privateKeyIncluded: false,
        status: String(tls.status || (tls.enabled ? 'configured' : 'disabled'))
      },
      certs: {
        domain: String(certs.domain || ''),
        expiresAt: String(certs.expiresAt || ''),
        fingerprint: String(certs.fingerprint || '')
      },
      backend: {
        configPath: String((src.backend && src.backend.configPath) || 'deploy/backend/config.yaml'),
        generatedPath: String((src.backend && src.backend.generatedPath) || 'deploy/backend/config.generated.yaml')
      }
    };
  }

  function normalizeSigning(signing, target) {
    var src = signing || {};
    if (target !== 'tauri-desktop' && !src.status) {
      return {
        status: 'unsigned',
        android: { status: 'none', certFingerprint: '' },
        desktop: { windows: { status: 'none' } }
      };
    }
    return {
      status: String(src.status || 'unsigned'),
      android: {
        status: String((src.android && src.android.status) || 'none'),
        certFingerprint: String((src.android && src.android.certFingerprint) || '')
      },
      desktop: {
        windows: { status: String((src.desktop && src.desktop.windows && src.desktop.windows.status) || 'none') }
      }
    };
  }

  function normalizeWarnings(list) {
    return (list || []).map(function (item) {
      if (typeof item === 'string') return { code: 'LC_W_BUILD', message: item };
      var warning = {
        code: String((item && item.code) || 'LC_W_BUILD'),
        message: String((item && item.message) || '')
      };
      if (item && item.componentId) warning.componentId = String(item.componentId);
      return warning;
    });
  }

  function check(id, status, message) {
    return { id: id, status: status, message: message || '' };
  }

  function isExternalRef(ref) {
    return /^(?:https?:)?\/\//i.test(ref) || /^data:/i.test(ref);
  }

  function localRefUsable(ref) {
    var text = String(ref || '').trim();
    if (!text) return false;
    if (text.charAt(0) === '#') return false;
    if (isExternalRef(text)) return false;
    if (/^(?:mailto|tel|javascript):/i.test(text)) return false;
    return true;
  }

  function cleanRef(ref) {
    return String(ref || '').split('#')[0].split('?')[0].trim();
  }

  function resolveRef(fromPath, ref) {
    var target = cleanRef(ref);
    if (!target) return '';
    var segments = fromPath.split('/');
    segments.pop();
    /* 兼容站点根相对写法：web/ 下的 /assets/x 解析为 web/assets/x，而不是产物根。 */
    if (target.charAt(0) === '/') {
      var siteDir = fromPath.split('/')[0];
      return (siteDir === 'web' || siteDir === 'desktop' ? siteDir : '') + target;
    }
    var parts = target.split('/');
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (!segments.length) return null;
        segments.pop();
      } else {
        segments.push(part);
      }
    }
    return segments.join('/');
  }

  function htmlRefs(text) {
    var refs = [];
    var match;
    var src = new RegExp(RE_HTML_SRC.source, 'gi');
    while ((match = src.exec(text))) refs.push(match[1]);
    var link = new RegExp(RE_HTML_LINK_HREF.source, 'gi');
    while ((match = link.exec(text))) refs.push(match[1]);
    return refs;
  }

  function cssRefs(text) {
    var refs = [];
    var match;
    var url = new RegExp(RE_CSS_URL.source, 'gi');
    while ((match = url.exec(text))) refs.push(match[1]);
    var imp = new RegExp(RE_CSS_IMPORT.source, 'gi');
    while ((match = imp.exec(text))) refs.push(match[1]);
    return refs;
  }

  function stripAllowedRefs(text, allowlist) {
    if (!allowlist || !allowlist.length) return text;
    var out = String(text);
    allowlist.forEach(function (ref) {
      if (ref) out = out.split(ref).join('');
    });
    return out;
  }

  function externalRefsIn(path, text, allowlist) {
    var hits = [];
    text = stripAllowedRefs(String(text == null ? '' : text), allowlist);
    if (/\.html?$/i.test(path)) {
      if (RE_EXTERNAL_SCRIPT.test(text)) hits.push('外链脚本');
      var tags = text.match(RE_LINK_TAG) || [];
      tags.forEach(function (tag) {
        var rel = (tag.match(RE_LINK_REL) || [])[1] || '';
        var href = (tag.match(RE_LINK_HREF) || [])[1] || '';
        if (!href || !isExternalRef(href) || /^data:/i.test(href)) return;
        if (/stylesheet|preload|prefetch|icon|manifest|font/i.test(rel)) hits.push('外链样式或资源');
      });
    }
    if (/\.css$/i.test(path)) {
      if (RE_EXTERNAL_IMPORT.test(text)) hits.push('外链 @import');
      if (RE_EXTERNAL_URL.test(text)) hits.push('外链 url()');
    }
    return hits;
  }

  function checkPathSafety(paths) {
    var bad = [];
    paths.forEach(function (path) {
      var reason = validatePath(path);
      if (reason) bad.push(path + '（' + reason + '）');
    });
    if (bad.length) return check('path-safety', 'fail', '越界或非法路径：' + bad.slice(0, 5).join('、'));
    return check('path-safety', 'pass', '全部路径相对产物根');
  }

  function checkEntry(files, layout) {
    if (files[layout.entry] == null) {
      return check('entry-exists', 'fail', '缺少入口文件：' + layout.entry);
    }
    return check('entry-exists', 'pass', '入口存在：' + layout.entry);
  }

  function checkOffline(paths, files, allowExternal) {
    var hits = [];
    var allowedHits = 0;
    paths.forEach(function (path) {
      if (!isTextPath(path)) return;
      var text = toText(files[path]);
      var found = externalRefsIn(path, text, allowExternal);
      var raw = externalRefsIn(path, text);
      found.forEach(function (kind) {
        if (hits.length < 5) hits.push(path + '（' + kind + '）');
      });
      if (!found.length && raw.length) allowedHits += 1;
    });
    if (hits.length) return check('offline-external', 'fail', '发现外链引用：' + hits.join('、'));
    if (allowedHits) {
      return check('offline-external', 'pass', '仅含已声明允许的外部图表库引用；断网时图表位置显示源码');
    }
    return check('offline-external', 'pass', '未发现外链脚本、样式或字体');
  }

  function checkSecrets(paths, files) {
    var hits = [];
    paths.forEach(function (path) {
      var name = path.split('/').pop() || '';
      if (PRIVATE_NAME_RE.test(name)) hits.push(path + '（私钥文件名）');
      if (!isTextPath(path)) return;
      var text = toText(files[path]);
      if (PRIVATE_KEY_RE.test(text)) hits.push(path + '（私钥内容）');
    });
    if (hits.length) {
      return check('secrets-scan', 'fail', 'LC_E_SECRET_LEAK：产物含私钥材料 ' + hits.slice(0, 5).join('、'));
    }
    return check('secrets-scan', 'pass', '未发现私钥材料');
  }

  function checkLockfiles(paths, files) {
    var manifests = paths.filter(function (path) {
      return /^server\/(?:[^/]+\/)*package\.json$/.test(path);
    });
    if (!manifests.length) return check('lockfile-present', 'skip', '未启用 Node 后端，不适用');
    var missing = manifests.filter(function (path) {
      return files[path.replace(/package\.json$/, 'package-lock.json')] == null;
    });
    if (missing.length) return check('lockfile-present', 'fail', '缺少锁文件：' + missing.join('、'));
    return check('lockfile-present', 'pass', 'Node 后端锁文件齐全');
  }

  function checkLocalRefs(paths, files) {
    var missing = [];
    perRef: for (var i = 0; i < paths.length; i += 1) {
      var path = paths[i];
      if (!/\.(html?|css)$/i.test(path)) continue;
      var refs = /\.html?$/i.test(path) ? htmlRefs(toText(files[path])) : cssRefs(toText(files[path]));
      for (var j = 0; j < refs.length; j += 1) {
        var ref = refs[j];
        if (!localRefUsable(ref)) continue;
        var target = resolveRef(path, ref);
        if (target === null) {
          missing.push(path + ' → ' + ref + '（越出产物根）');
        } else if (target && files[target] == null) {
          missing.push(path + ' → ' + ref);
        }
        if (missing.length >= 5) break perRef;
      }
    }
    if (missing.length) return check('vendor-sync', 'fail', '本地引用无法解析：' + missing.join('、'));
    return check('vendor-sync', 'pass', '本地脚本、样式与字体引用均可解析');
  }

  function checkBackendConfig(backend, deploy, files) {
    if (!backend || backend.language === 'none') return check('backend-config-valid', 'skip', '未启用后端');
    var path = (deploy && deploy.backend && deploy.backend.configPath) || 'deploy/backend/config.yaml';
    if (files[path] == null) return check('backend-config-valid', 'fail', '缺少后端配置：' + path);
    return check('backend-config-valid', 'pass', '后端配置存在：' + path);
  }

  function checkTemplateFiles(files, required) {
    if (!Array.isArray(required) || !required.length) {
      return check('template-integrity', 'skip', '未选择需要完整性校验的模板');
    }
    var missing = required.filter(function (path) { return files[path] == null; });
    if (missing.length) {
      return check('template-integrity', 'fail', '模板文件缺失：' + missing.slice(0, 6).join('、'));
    }
    return check('template-integrity', 'pass', '模板文件齐全（' + required.length + ' 项）');
  }

  function checkNginx(deploy, files) {
    if (!deploy || !deploy.nginx.enabled) return check('nginx-valid', 'skip', '未启用 nginx');
    var path = deploy.nginx.path;
    var text = files[path];
    if (text == null) return check('nginx-valid', 'fail', '缺少 nginx 配置：' + path);
    var body = toText(text);
    if (!/\bserver\b/.test(body) || !/\blocation\b/.test(body)) {
      return check('nginx-valid', 'fail', 'nginx 配置缺少 server/location 结构：' + path);
    }
    return check('nginx-valid', 'pass', 'nginx 配置结构可读：' + path);
  }

  function checkCertPair(deploy) {
    if (!deploy || !deploy.tls.enabled) return check('cert-pair', 'skip', '未启用 TLS');
    if (deploy.tls.privateKeyIncluded) return check('cert-pair', 'fail', 'LC_E_SECRET_LEAK：私钥被标记为随产物分发');
    return check('cert-pair', 'pass', '私钥未进入产物（由部署时生成或导入）');
  }

  function runChecks(input) {
    var opts = input || {};
    var files = opts.files || {};
    var paths = entryList(files);
    var layout = opts.layout || layoutFor(opts.target);
    var backend = opts.backend || { language: 'none' };
    var deploy = opts.deploy || {};
    return [
      checkPathSafety(paths),
      checkEntry(files, layout),
      checkOffline(paths, files, opts.allowExternal),
      checkSecrets(paths, files),
      checkLockfiles(paths, files),
      checkLocalRefs(paths, files),
      checkBackendConfig(backend, deploy, files),
      checkNginx(deploy, files),
      checkCertPair(deploy),
      checkTemplateFiles(files, opts.templateRequired),
      checkUserCodeSyntax(opts.syntax)
    ];
  }

  function checkUserCodeSyntax(syntax) {
    if (!syntax) return check('user-code-syntax', 'skip', '未执行用户代码语法检查');
    var failures = syntax.failures || [];
    if (syntax.status === 'skip') return check('user-code-syntax', 'skip', syntax.message || '未执行用户代码语法检查');
    if (failures.length) {
      var detail = failures.slice(0, 4).map(function (item) { return item.file + '：' + item.message; }).join('；');
      return check('user-code-syntax', 'fail', detail + (failures.length > 4 ? '（共 ' + failures.length + ' 处）' : ''));
    }
    return check('user-code-syntax', 'pass', syntax.message || '用户代码语法检查通过');
  }

  function describeDir(dir, target) {
    var table = {
      web: '静态站入口与页面',
      desktop: 'Tauri 2 工程（src-tauri、配置、图标）',
      server: '可选后端工程（按所选语言生成）',
      deploy: 'nginx 配置、后端配置底稿、证书脚本',
      data: '数据快照',
      vendor: '产物第三方依赖'
    };
    if (target === 'web-static' && dir === 'desktop') return '';
    return table[dir] || '';
  }

  function buildReadme(input) {
    var opts = input || {};
    var project = opts.project || {};
    var target = opts.target || 'web-static';
    var layout = layoutFor(target);
    var backend = opts.backend || { language: 'none' };
    var deploy = opts.deploy || { nginx: {}, tls: {} };
    var warnings = opts.warnings || [];
    var lines = [];
    lines.push('# ' + (project.name || '低代码产物'));
    lines.push('');
    lines.push('> 本文件由低代码工作台生成，用于说明产物结构与运行入口。');
    lines.push('');
    lines.push('- 产物 ID：' + (opts.artifactId || ''));
    lines.push('- 导出目标：`' + target + '`');
    lines.push('- 入口文件：`' + layout.entry + '`');
    lines.push('- 后端：`' + (backend.language || 'none') + '`');
    lines.push('- 反向代理：' + (deploy.nginx && deploy.nginx.enabled ? '已启用' : '未启用'));
    lines.push('- TLS：' + (deploy.tls && deploy.tls.enabled ? (deploy.tls.source || 'generated') + '（私钥不随产物）' : '未启用'));
    if (deploy.site) {
      lines.push('- 站点域名：`' + (deploy.site.domain || 'localhost') + '`' +
        (deploy.site.configured ? '' : '（域名未配置，仅本机可用）'));
      lines.push('- 公开基址：`' + (deploy.site.publicBaseUrl || 'http://localhost') + '`');
    }
    var toolchain = opts.toolchain || null;
    if (toolchain && Array.isArray(toolchain.requirements) && toolchain.requirements.length) {
      lines.push('');
      lines.push('## 环境要求');
      lines.push('');
      lines.push('本项目使用：' + (toolchain.describe || '当前选择') + '。需要安装：');
      lines.push('');
      toolchain.requirements.forEach(function (item) {
        lines.push('- ' + item.name + ' ≥ ' + item.version + '（' + item.purpose + '）');
      });
      lines.push('');
    }
    lines.push('## 目录结构');
    lines.push('');
    lines.push('| 目录 | 说明 |');
    lines.push('| --- | --- |');
    lines.push('| `artifact-manifest.json` | 产物清单与自检结果 |');
    lines.push('| `README.md` | 本说明 |');
    if (target === 'web-static') lines.push('| `README.txt` | 纯文本运行说明（双击即可阅读） |');
    lines.push('| `THIRD-PARTY-NOTICES.md` | 第三方组件与许可证 |');
    lines.push('| `lowcode-project.json` | 可回灌的工程配置快照 |');
    layout.readmeDirs.forEach(function (dir) {
      var text = describeDir(dir, target);
      if (text) lines.push('| `' + dir + '/` | ' + text + ' |');
    });
    lines.push('');
    if (target === 'web-static') {
      lines.push('## 运行方式（必须通过 http 访问）');
      lines.push('');
      lines.push('Web 产物不再支持直接双击 `web/index.html` 打开。`file://` 下浏览器会限制 `fetch`、模块脚本与部分 API，双击只能看到说明页，不是完整站点。');
      lines.push('');
      lines.push('本地预览：');
      lines.push('');
      lines.push('```');
      lines.push('cd <本目录>');
      lines.push('npx serve web');
      lines.push('# 或：python -m http.server 8080 --directory web');
      lines.push('```');
      lines.push('');
      lines.push('然后打开 `http://127.0.0.1:8080/`。生产环境把 `web/` 整个拷进 nginx 站点根目录即可。');
      lines.push('');
      lines.push('需要双击即用或离线分发的桌面应用，请回到导出向导选择 `tauri-desktop`。');
      lines.push('');
    }
    lines.push('## 安全说明');
    lines.push('');
    lines.push('本产物不包含任何密钥、密码或证书私钥；证书私钥必须在目标机器生成，或在部署时单独导入。');
    lines.push('');
    if (warnings.length) {
      lines.push('## 构建警告');
      lines.push('');
      warnings.forEach(function (item) {
        lines.push('- ' + (typeof item === 'string' ? item : item.message));
      });
      lines.push('');
    }
    return lines.join('\n');
  }

  /* 放在产物根目录的纯文本说明：双击 zip 里的文件时，最先看到的就是它。
     不使用 Markdown，避免用户机器上没有 Markdown 预览器。 */
  function buildHttpReadme(input) {
    var opts = input || {};
    var site = (opts.deploy && opts.deploy.site) || null;
    var deployLines = site && site.configured
      ? [
          '部署：',
          '  公开基址：' + site.publicBaseUrl + '（nginx 的 server_name 已按该域名生成）',
          '  把 web/ 放到 nginx 站点根目录，按 deploy/README.md 生成/导入证书。'
        ]
      : [
          '部署：',
          '  域名未配置，仅本机可用；正式部署前请在导出向导里填写站点域名。',
          '  把 web/ 整个目录拷到 nginx 站点根目录（例如 /usr/share/nginx/html），通过 http(s) 访问。'
        ];
    return [
      (opts.projectName || '低代码 Web 产物') + ' · 请通过 http 访问',
      '============================================================',
      '',
      '这个包不能直接双击 web/index.html 使用。',
      'file:// 下浏览器会限制 fetch、模块脚本与部分 API，双击只能看到说明页，不是完整站点。',
      '',
      '本地预览：',
      '  在本目录执行  npx serve web',
      '  或            python -m http.server 8080 --directory web',
      '  然后打开      http://127.0.0.1:8080/',
      ''
    ].concat(deployLines).concat([
      '',
      '想要双击即用的桌面应用：',
      '  回到低代码工作台的导出向导，目标选「Tauri 桌面」，导出后按 README.md 构建安装包。',
      '',
      '更完整的目录结构与安全说明见同目录 README.md。',
      ''
    ]).join('\n');
  }

  function buildNotices(input) {
    var opts = input || {};
    var bundled = normalizeBundled(opts.bundledAssets);
    var libs = normalizeLibraries(opts.editorLibraries);
    var rows = [];
    bundled.forEach(function (item) {
      rows.push({
        name: item.name || item.package,
        version: item.version,
        license: item.license,
        path: item.path,
        bytes: item.bytes
      });
    });
    libs.forEach(function (item) {
      rows.push({
        name: item.name,
        version: item.version,
        license: item.license,
        path: item.path,
        bytes: 0
      });
    });
    var lines = ['# 第三方组件与许可证', ''];
    if (!rows.length) {
      lines.push('本产物未包含额外的第三方运行时。');
      lines.push('');
      return lines.join('\n');
    }
    lines.push('| 组件 | 版本 | 许可证 | 路径 | 字节 |');
    lines.push('| --- | --- | --- | --- | --- |');
    rows.forEach(function (row) {
      lines.push('| ' + (row.name || '-') + ' | ' + (row.version || '-') + ' | ' + (row.license || '-') +
        ' | `' + row.path + '` | ' + (row.bytes || '-') + ' |');
    });
    lines.push('');
    lines.push('第三方许可证原文随依赖文件保留；压缩产物不会删除许可证注释。');
    lines.push('');
    return lines.join('\n');
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function makeArtifactId(project, createdAt) {
    var date = createdAt ? new Date(createdAt) : new Date();
    var stamp = String(date.getUTCFullYear()) + pad2(date.getUTCMonth() + 1) + pad2(date.getUTCDate()) +
      '-' + pad2(date.getUTCHours()) + pad2(date.getUTCMinutes());
    var base = String((project && project.id) || 'site').replace(/[^a-z0-9_-]/gi, '-');
    return base + '-' + stamp;
  }

  function normalizePlatform(platform) {
    var src = platform || {};
    return {
      name: String(src.name || 'lowcode'),
      version: String(src.version || '0.1.0'),
      contractsVersion: String(src.contractsVersion || CONTRACTS_VERSION)
    };
  }

  function normalizeTemplate(template) {
    var src = template || {};
    return { id: String(src.id || ''), version: Number(src.version || 1) };
  }

  function uniqueSorted(list) {
    var seen = {};
    return (list || []).filter(function (path) {
      if (!path || seen[path]) return false;
      seen[path] = true;
      return true;
    }).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  }

  /* 平台文件 / 用户文件 / 合并产物：让用户在清单里看清哪些能被重新生成替换。 */
  function normalizeOwnership(input) {
    var src = input || {};
    return {
      platform: uniqueSorted(src.platform),
      user: uniqueSorted(src.user),
      merged: uniqueSorted(src.merged)
    };
  }

  function summarize(entries) {
    var byCategory = {};
    CATEGORY_ORDER.forEach(function (key) { byCategory[key] = 0; });
    var total = 0;
    entries.forEach(function (item) {
      var key = categoryOf(item.path);
      byCategory[key] += item.size;
      total += item.size;
    });
    return { total: total, byCategory: byCategory };
  }

  /**
   * 组装产物清单与元文件。
   * 输入：
   *   target, artifactId, createdAt, platform, project, runtime, backend, modules, template,
   *   files（路径 → string/Buffer）、editorLibraries、bundledAssets、deploy、signing、warnings
   * 输出：
   *   { ok, failures, files, manifest, checks, warnings }
   * 注意：返回的 manifest 尚未写入 files；调用方最后写 artifact-manifest.json。
   */
  async function assemble(input) {
    var opts = input || {};
    var target = opts.target || 'web-static';
    var layout = layoutFor(target);
    var createdAt = String(opts.createdAt || new Date().toISOString());
    var artifactId = String(opts.artifactId || makeArtifactId(opts.project, createdAt));
    var files = {};
    Object.keys(opts.files || {}).forEach(function (path) {
      if (opts.files[path] != null) files[path] = opts.files[path];
    });

    var backend = normalizeBackend(opts.backend, target);
    var deploy = normalizeDeploy(opts.deploy, target);
    var signing = normalizeSigning(opts.signing, target);
    var warnings = normalizeWarnings(opts.warnings);
    var bundled = normalizeBundled(opts.bundledAssets);
    var libs = normalizeLibraries(opts.editorLibraries);
    var project = projectMeta(opts.project);
    var projectSource = opts.project || {};

    var bundledBytes = bundled.reduce(function (sum, item) { return sum + item.bytes; }, 0);
    if (bundledBytes > EXPORT_WARN_BYTES) {
      warnings.push({
        code: 'LC_W_ASSET_BYTES',
        message: '第三方运行时合计 ' + bundledBytes + ' 字节，超过 ' + EXPORT_WARN_BYTES + ' 字节提示线'
      });
    }

    var uploadConfig = (projectSource.config || projectSource.configuration || projectSource).upload || {};
    var uploadHeaders = uploadConfig.headers || {};
    if (Object.keys(uploadHeaders).length) {
      warnings.push({
        code: 'LC_W_UPLOAD_HEADERS',
        message: '产物包含 ' + Object.keys(uploadHeaders).length + ' 个上传请求头，请确认其中不含不应随产物分发的凭据'
      });
    }

    if (files['README.md'] == null) {
      files['README.md'] = buildReadme({
        artifactId: artifactId,
        project: projectSource,
        target: target,
        backend: backend,
        toolchain: opts.toolchain,
        deploy: deploy,
        warnings: warnings
      });
    }
    if (target === 'web-static' && files['README.txt'] == null) {
      files['README.txt'] = buildHttpReadme({
        projectName: project.name || '',
        deploy: deploy,
        toolchain: opts.toolchain
      });
    }
    if (files['THIRD-PARTY-NOTICES.md'] == null) {
      files['THIRD-PARTY-NOTICES.md'] = buildNotices({
        bundledAssets: bundled,
        editorLibraries: libs
      });
    }
    if (files['lowcode-project.json'] == null) {
      files['lowcode-project.json'] = JSON.stringify(buildProjectSnapshot({
        artifactId: artifactId,
        target: target,
        project: projectSource
      }), null, 2) + '\n';
    }

    var entries = await fileEntries(files);
    var hashes = {};
    entries.forEach(function (item) { hashes[item.path] = item.sha256; });
    bundled.forEach(function (item) {
      if (item.sha256 == null) item.sha256 = hashes[item.path] || '';
    });

    var checks = runChecks({
      files: files,
      layout: layout,
      target: target,
      backend: backend,
      deploy: deploy,
      allowExternal: opts.allowExternal,
      templateRequired: opts.templateRequired,
      syntax: opts.syntax
    });
    var failures = checks.filter(function (item) { return item.status === 'fail'; });
    var size = summarize(entries);

    var manifest = {
      formatVersion: EXPORT_MANIFEST_VERSION,
      artifactId: artifactId,
      createdAt: createdAt,
      platform: normalizePlatform(opts.platform),
      project: project,
      target: target,
      runtime: String(opts.runtime || layout.runtime),
      backend: backend,
      modules: Array.isArray(opts.modules) ? opts.modules.slice() : [],
      template: normalizeTemplate(opts.template),
      entry: layout.entry,
      files: entries,
      editorLibraries: libs,
      bundledAssets: bundled.map(function (item) {
        return {
          path: item.path,
          package: item.package,
          license: item.license,
          bytes: item.bytes,
          sha256: item.sha256
        };
      }),
      deploy: deploy,
      signing: signing,
      ownership: normalizeOwnership(opts.ownership),
      checks: checks,
      size: size,
      warnings: warnings,
      secrets: { included: false, note: '密钥与证书私钥不随产物分发' }
    };

    return {
      ok: failures.length === 0,
      failures: failures,
      files: files,
      manifest: manifest,
      checks: checks,
      warnings: warnings,
      size: size
    };
  }

  function serializeManifest(manifest) {
    return JSON.stringify(manifest, null, 2) + '\n';
  }

  return {
    EXPORT_MANIFEST_VERSION: EXPORT_MANIFEST_VERSION,
    CONTRACTS_VERSION: CONTRACTS_VERSION,
    EXPORT_WARN_BYTES: EXPORT_WARN_BYTES,
    META_FILES: META_FILES,
    TARGETS: TARGETS,
    layoutFor: layoutFor,
    categoryOf: categoryOf,
    validatePath: validatePath,
    projectMeta: projectMeta,
    buildProjectSnapshot: buildProjectSnapshot,
    buildReadme: buildReadme,
    buildNotices: buildNotices,
    makeArtifactId: makeArtifactId,
    normalizeOwnership: normalizeOwnership,
    runChecks: runChecks,
    assemble: assemble,
    serializeManifest: serializeManifest,
    byteSize: byteSize,
    sha256: sha256,
    isTextPath: isTextPath,
    isExternalRef: isExternalRef,
    localRefUsable: localRefUsable,
    resolveRef: resolveRef,
    htmlRefs: htmlRefs,
    cssRefs: cssRefs
  };
}));
