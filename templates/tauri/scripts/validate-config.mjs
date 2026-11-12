#!/usr/bin/env node
// 桌面导出配置校验：字段缺失 / 类型错误 / 标识符与版本格式 / 窗口尺寸 / 证书与更新耦合
// 用法：node scripts/validate-config.mjs [--config <path>] [--platform win32|linux|android] [--json]
// 退出码：0 通过（可能带警告），1 有错误。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
export const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const PLATFORM_TARGETS = {
  win32: ['msi', 'nsis'],
  linux: ['appimage', 'deb', 'rpm'],
  android: ['apk', 'aab'],
};
const ALL_TARGETS = new Set(Object.values(PLATFORM_TARGETS).flat());

const TOP_KEYS = new Set([
  'schemaVersion', 'productName', 'identifier', 'version', 'description',
  'window', 'icon', 'protocol', 'delivery', 'https', 'backend', 'runtime',
  'sidecar', 'update', 'bundle', 'android', 'dev',
]);
const WINDOW_KEYS = new Set(['title', 'width', 'height', 'minWidth', 'minHeight', 'resizable', 'fullscreen', 'center']);
const ICON_KEYS = new Set(['source', 'path']);
const DELIVERY_KEYS = new Set(['mode', 'webDir']);
const HTTPS_KEYS = new Set(['mode', 'host', 'port']);
const BACKEND_KEYS = new Set(['enabled', 'baseUrl']);
const RUNTIME_KEYS = new Set(['singleInstance', 'autostart']);
const SIDECAR_KEYS = new Set(['enabled', 'name', 'args', 'readinessPath', 'readinessTimeoutMs', 'versionCheck', 'env']);
// 随包配置里出现这些键名，基本就是把密钥写进了会打进安装包的文件。
const SECRET_KEY_RE = /pass|pwd|secret|token|credential|private|apikey|api_key|dsn/i;
const UPDATE_KEYS = new Set(['active', 'endpoint', 'pubkey', 'checkOnStartup', 'insecureTransport']);
const BUNDLE_KEYS = new Set(['targets', 'createUpdaterArtifacts', 'windows']);
const BUNDLE_WIN_KEYS = new Set(['installMode', 'wixLanguage']);
// Android 只记录签名路径选择；密码放 keystore.properties（不导出）或构建机环境变量。
const ANDROID_KEYS = new Set(['signing', 'keystorePath', 'keyAlias']);
const DEV_KEYS = new Set(['url', 'beforeDevCommand', 'beforeBuildCommand']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

function unknownKeys(obj, allowed, prefix, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push({ field: `${prefix}${key}`, code: 'E_UNKNOWN_KEY', message: `不认识的字段 "${prefix}${key}"，请检查拼写；写错字段不会生效，且容易被误认为已配置。` });
    }
  }
}

function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function validateConfig(cfg, opts = {}) {
  const errors = [];
  const warnings = [];
  const platform = opts.platform || process.platform;
  const root = opts.root || process.cwd();
  const err = (field, code, message) => errors.push({ field, code, message });
  const warn = (field, code, message) => warnings.push({ field, code, message });

  if (!isObj(cfg)) {
    err('', 'E_TYPE', '配置根必须是对象。');
    return { errors, warnings };
  }
  unknownKeys(cfg, TOP_KEYS, '', errors);

  if (cfg.schemaVersion !== 1) err('schemaVersion', 'E_TYPE', 'schemaVersion 必须为 1。');

  // 应用名
  if (typeof cfg.productName !== 'string' || !cfg.productName.trim()) {
    err('productName', 'E_MISSING', 'productName 必填，不能为空。');
  } else {
    if (cfg.productName.length > 80) err('productName', 'E_LENGTH', 'productName 最长 80 字符。');
    if (/[\\/:*?"<>|]/.test(cfg.productName)) {
      err('productName', 'E_NAME_UNSAFE', 'productName 含文件系统保留字符（\\ / : * ? " < > |），Windows 打包会失败。');
    }
  }

  // 标识符
  if (typeof cfg.identifier !== 'string' || !cfg.identifier) {
    err('identifier', 'E_MISSING', 'identifier 必填，反向域名格式，例如 com.example.app。');
  } else if (!IDENTIFIER_RE.test(cfg.identifier)) {
    err('identifier', 'E_IDENTIFIER', 'identifier 必须是反向域名且每段以字母或数字开头，不能含空格、下划线；例如 com.example.app。');
  } else {
    if (cfg.identifier.split('.').length < 2) err('identifier', 'E_IDENTIFIER', 'identifier 至少包含两段，例如 com.example。');
    if (cfg.identifier.length > 255) err('identifier', 'E_LENGTH', 'identifier 最长 255 字符。');
    if (platform === 'android') {
      // Android 的 applicationId 只允许字母、数字、下划线分段，连字符会让 Gradle 直接拒绝。
      if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(cfg.identifier)) {
        err('identifier', 'E_ANDROID_IDENTIFIER', 'Android 的 applicationId 只允许字母、数字、下划线分段（不能含连字符），例如 com.example.desktop。');
      }
    }
  }

  // 版本
  if (typeof cfg.version !== 'string' || !cfg.version) {
    err('version', 'E_MISSING', 'version 必填，必须是 semver，例如 0.1.0。');
  } else if (!SEMVER_RE.test(cfg.version)) {
    err('version', 'E_VERSION', 'version 必须是 semver（主.次.修订，可带预发布后缀），不能带前缀 v；例如 0.1.0 或 1.2.0-beta.1。');
  }

  if (cfg.description !== undefined && cfg.description !== '' && typeof cfg.description !== 'string') {
    err('description', 'E_TYPE', 'description 必须是字符串。');
  }

  // 窗口
  if (!isObj(cfg.window)) {
    err('window', 'E_MISSING', 'window 必填。');
  } else {
    unknownKeys(cfg.window, WINDOW_KEYS, 'window.', errors);
    for (const key of ['width', 'height', 'minWidth', 'minHeight']) {
      if (!isInt(cfg.window[key])) err(`window.${key}`, 'E_TYPE', `window.${key} 必须是整数像素值。`);
    }
    if (isInt(cfg.window.width) && cfg.window.width < 320) err('window.width', 'E_WINDOW', 'window.width 最小 320。');
    if (isInt(cfg.window.height) && cfg.window.height < 240) err('window.height', 'E_WINDOW', 'window.height 最小 240。');
    if (isInt(cfg.window.minWidth) && cfg.window.minWidth < 320) err('window.minWidth', 'E_WINDOW', 'window.minWidth 最小 320。');
    if (isInt(cfg.window.minHeight) && cfg.window.minHeight < 240) err('window.minHeight', 'E_WINDOW', 'window.minHeight 最小 240。');
    if (isInt(cfg.window.minWidth) && isInt(cfg.window.width) && cfg.window.minWidth > cfg.window.width) {
      err('window.minWidth', 'E_WINDOW', 'window.minWidth 不能大于 window.width，否则窗口一创建就违反最小尺寸。');
    }
    if (isInt(cfg.window.minHeight) && isInt(cfg.window.height) && cfg.window.minHeight > cfg.window.height) {
      err('window.minHeight', 'E_WINDOW', 'window.minHeight 不能大于 window.height。');
    }
    for (const key of ['resizable', 'fullscreen', 'center']) {
      if (cfg.window[key] !== undefined && typeof cfg.window[key] !== 'boolean') err(`window.${key}`, 'E_TYPE', `window.${key} 必须是布尔值。`);
    }
    if (cfg.window.title !== undefined && typeof cfg.window.title !== 'string') err('window.title', 'E_TYPE', 'window.title 必须是字符串。');
    if (cfg.window.fullscreen === true && cfg.window.resizable === false) {
      warn('window.fullscreen', 'W_WINDOW', '全屏且不可调整大小时，用户无法通过窗口控件退出全屏，只能靠快捷键；确认这是你要的。');
    }
  }

  // 图标
  if (!isObj(cfg.icon)) {
    err('icon', 'E_MISSING', 'icon 必填（source 为 builtin 或 imported）。');
  } else {
    unknownKeys(cfg.icon, ICON_KEYS, 'icon.', errors);
    if (!['builtin', 'imported'].includes(cfg.icon.source)) {
      err('icon.source', 'E_ICON', 'icon.source 只能是 builtin 或 imported。');
    }
    if (cfg.icon.source === 'imported') {
      if (!cfg.icon.path) {
        err('icon.path', 'E_ICON', '选择 imported 时必须给 icon.path（PNG，≥ 512×512）。');
      } else {
        const file = path.resolve(root, cfg.icon.path);
        if (!fs.existsSync(file)) {
          err('icon.path', 'E_ICON', `icon.path 指向的文件不存在：${cfg.icon.path}。`);
        } else if (!/\.png$/i.test(file)) {
          err('icon.path', 'E_ICON', 'icon.path 必须是 PNG；ICO 由脚本从 PNG 生成。');
        } else {
          const size = pngSize(file);
          if (!size) err('icon.path', 'E_ICON', 'icon.path 不是合法 PNG 文件。');
          else if (size.width < 512 || size.height < 512) {
            err('icon.path', 'E_ICON', `图标尺寸 ${size.width}×${size.height} 偏小，至少 512×512（建议 1024×1024，且为正方形）。`);
          }
        }
      }
    }
  }

  // 协议与接入方式
  if (!['http', 'https'].includes(cfg.protocol)) {
    err('protocol', 'E_PROTOCOL', 'protocol 只能是 http 或 https。');
  }
  if (!isObj(cfg.delivery)) {
    err('delivery', 'E_MISSING', 'delivery 必填（mode: static 或 server）。');
  } else {
    unknownKeys(cfg.delivery, DELIVERY_KEYS, 'delivery.', errors);
    if (!['static', 'server'].includes(cfg.delivery.mode)) {
      err('delivery.mode', 'E_TYPE', 'delivery.mode 只能是 static（资源打进应用）或 server（加载外部服务地址）。');
    }
    if (cfg.delivery.mode === 'static') {
      if (typeof cfg.delivery.webDir !== 'string' || !cfg.delivery.webDir) {
        err('delivery.webDir', 'E_MISSING', '静态接入必须给 delivery.webDir，例如 ../web。');
      } else {
        const dir = path.resolve(path.join(root, 'src-tauri'), cfg.delivery.webDir);
        if (!fs.existsSync(path.join(dir, 'index.html')) && !opts.skipFileChecks) {
          warn('delivery.webDir', 'W_WEB_DIR', `webDir 下没找到 index.html（${cfg.delivery.webDir}）；导出管线会先落产物再构建，如果你手改过路径请确认。`);
        }
      }
    }
  }

  // HTTPS（只对 server 接入生效）
  if (!isObj(cfg.https)) {
    err('https', 'E_MISSING', 'https 必填（mode/host/port），即使走静态接入也要保留默认值。');
  } else {
    unknownKeys(cfg.https, HTTPS_KEYS, 'https.', errors);
    if (!['generated', 'imported', 'none'].includes(cfg.https.mode)) {
      err('https.mode', 'E_HTTPS', 'https.mode 只能是 generated / imported / none。');
    }
    if (typeof cfg.https.host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(cfg.https.host || '')) {
      err('https.host', 'E_HTTPS', 'https.host 只能是主机名或域名，例如 localhost。');
    }
    if (!isInt(cfg.https.port) || cfg.https.port < 1 || cfg.https.port > 65535) {
      err('https.port', 'E_HTTPS', 'https.port 必须是 1–65535 的整数。');
    }
    if (cfg.protocol === 'http' && cfg.https.mode !== 'none') {
      warn('https.mode', 'W_MODE_IGNORED', 'protocol 为 http 时不会使用证书，https.mode 会被忽略；需要 TLS 请把 protocol 改成 https。');
    }
    if (cfg.delivery && cfg.delivery.mode === 'server') {
      if (cfg.protocol === 'https' && cfg.https.mode === 'generated') {
        warn('https.mode', 'W_SELF_SIGNED', '自签证书不会被系统信任，WebView 会直接拒绝加载（ERR_CERT_AUTHORITY_INVALID）。要么先导入系统信任库，要么改用 http + 回环地址。');
      }
      if (cfg.protocol === 'https' && cfg.https.mode === 'none') {
        err('https.mode', 'E_HTTPS', 'server 接入 + https 协议时，https.mode 不能是 none：没有证书就没有 TLS。');
      }
      if (cfg.protocol === 'http' && !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(cfg.https.host)) {
        warn('https.host', 'W_HTTP_REMOTE', 'http 且不是回环地址时，前端资源与接口都是明文传输；只在内网可信环境使用。');
      }
    }
    if (cfg.https.mode === 'imported') {
      warn('https.mode', 'W_CERT_IMPORTED', '导入自有证书时，证书与私钥只在构建机准备（站点 certs/ 内，权限 0600）；配置里不写私钥路径，也不会进导出包，详见 docs/https.md。');
    }
  }

  // 后端地址
  if (!isObj(cfg.backend)) {
    err('backend', 'E_MISSING', 'backend 必填（enabled/baseUrl）。');
  } else {
    unknownKeys(cfg.backend, BACKEND_KEYS, 'backend.', errors);
    if (typeof cfg.backend.enabled !== 'boolean') err('backend.enabled', 'E_TYPE', 'backend.enabled 必须是布尔值。');
    if (cfg.backend.enabled) {
      let url = null;
      try { url = new URL(cfg.backend.baseUrl); } catch { /* 下面统一报错 */ }
      if (!url) err('backend.baseUrl', 'E_TYPE', 'backend.enabled 为真时 baseUrl 必须是完整 URL，例如 http://127.0.0.1:8080。');
      else if (!['http:', 'https:'].includes(url.protocol)) err('backend.baseUrl', 'E_TYPE', 'backend.baseUrl 只接受 http/https。');
    }
  }

  // 运行时行为
  if (!isObj(cfg.runtime)) {
    err('runtime', 'E_MISSING', 'runtime 必填（singleInstance/autostart）。');
  } else {
    unknownKeys(cfg.runtime, RUNTIME_KEYS, 'runtime.', errors);
    for (const key of ['singleInstance', 'autostart']) {
      if (typeof cfg.runtime[key] !== 'boolean') err(`runtime.${key}`, 'E_TYPE', `runtime.${key} 必须是布尔值。`);
    }
    if (cfg.runtime.autostart === true && cfg.runtime.singleInstance !== true) {
      warn('runtime.autostart', 'W_AUTOSTART', '开机自启但没开单实例：开机后可能同时拉起两个进程，建议同时打开 singleInstance。');
    }
  }

  // 本地内置后端（sidecar）
  if (cfg.sidecar !== undefined) {
    if (!isObj(cfg.sidecar)) {
      err('sidecar', 'E_TYPE', 'sidecar 必须是对象；不需要内置后端时直接省略该字段。');
    } else {
      unknownKeys(cfg.sidecar, SIDECAR_KEYS, 'sidecar.', errors);
      for (const key of ['enabled', 'versionCheck']) {
        if (cfg.sidecar[key] !== undefined && typeof cfg.sidecar[key] !== 'boolean') {
          err(`sidecar.${key}`, 'E_TYPE', `sidecar.${key} 必须是布尔值。`);
        }
      }
      const name = cfg.sidecar.name;
      if (typeof name !== 'string' || !name) {
        err('sidecar.name', 'E_MISSING', 'sidecar.name 必填，例如 lc-sidecar（对应 src-tauri/binaries/<name>-<target triple>）。');
      } else if (!/^[A-Za-z0-9._-]+$/.test(name) || /\.\./.test(name) || /\.exe$/i.test(name)) {
        err('sidecar.name', 'E_SIDECAR_NAME', 'sidecar.name 只能是字母、数字、点、下划线、连字符，且不带路径分隔符与 .exe 后缀（Tauri 会自动补平台后缀）。');
      }
      if (!Array.isArray(cfg.sidecar.args)) {
        err('sidecar.args', 'E_TYPE', 'sidecar.args 必须是字符串数组；端口等运行时参数由外壳注入，不要写死在这里。');
      } else if (cfg.sidecar.args.some((a) => typeof a !== 'string')) {
        err('sidecar.args', 'E_TYPE', 'sidecar.args 里只能放字符串。');
      }
      const readinessPath = cfg.sidecar.readinessPath;
      if (readinessPath !== undefined) {
        if (typeof readinessPath !== 'string' || !readinessPath.startsWith('/')) {
          err('sidecar.readinessPath', 'E_TYPE', 'readinessPath 必须以 / 开头，例如 /health。');
        } else if (/\s/.test(readinessPath)) {
          err('sidecar.readinessPath', 'E_TYPE', 'readinessPath 不能含空白字符：健康探测是直接拼进 HTTP 请求行的。');
        }
      }
      if (cfg.sidecar.readinessTimeoutMs !== undefined) {
        if (!isInt(cfg.sidecar.readinessTimeoutMs) || cfg.sidecar.readinessTimeoutMs < 1000 || cfg.sidecar.readinessTimeoutMs > 60000) {
          err('sidecar.readinessTimeoutMs', 'E_TYPE', 'readinessTimeoutMs 必须是 1000–60000 的整数（毫秒）。');
        }
      }
      if (cfg.sidecar.env !== undefined) {
        if (!isObj(cfg.sidecar.env)) {
          err('sidecar.env', 'E_TYPE', 'sidecar.env 必须是对象（键值都是字符串）。');
        } else {
          for (const [key, value] of Object.entries(cfg.sidecar.env)) {
            if (SECRET_KEY_RE.test(key)) {
              err(`sidecar.env.${key}`, 'E_SECRET_IN_CONFIG', `sidecar.env 出现疑似密钥的键名 "${key}"：desktop.json 会随安装包分发，密码/令牌一律走首次启动引导或系统凭据，不能写在这里。`);
            }
            if (typeof value !== 'string') {
              err(`sidecar.env.${key}`, 'E_TYPE', `sidecar.env.${key} 的值必须是字符串。`);
            }
          }
        }
      }
      if (cfg.sidecar.enabled === true) {
        if (cfg.backend?.enabled === true) {
          warn('sidecar.enabled', 'W_SIDECAR_BACKEND', '同时开了 sidecar 和外部 backend：外壳会启动本地 sidecar，但前端仍按 backend.baseUrl 连外部服务。确认这是你要的（一般只留一个）。');
        }
        if (cfg.delivery?.mode === 'server') {
          warn('sidecar.enabled', 'W_SIDECAR_SERVER', 'server 接入 + sidecar：前端由远端提供，远端页面的 CSP 与混合内容策略不由本模板控制，本地后端地址可能拿不到；离线可用的意义也没了。');
        }
        if (!opts.skipFileChecks && typeof name === 'string' && name) {
          const binDir = path.resolve(root, 'src-tauri/binaries');
          const found = fs.existsSync(binDir)
            ? fs.readdirSync(binDir).filter((f) => f.startsWith(`${name}-`) && !f.endsWith('.sig'))
            : [];
          if (found.length === 0) {
            err('sidecar.name', 'E_SIDECAR_BINARY', `src-tauri/binaries 下没有 ${name}-<target triple> 文件：先执行 npm run sidecar:build 把后端二进制复制进来，否则打包会直接失败。`);
          }
        }
        if (cfg.sidecar.versionCheck === true) {
          warn('sidecar.versionCheck', 'W_SIDECAR_VERSION', '开启版本校验后，sidecar 必须支持 --version 且输出版本号与应用 version 一致；否则外壳会拒绝启动后端并显示错误页。');
        }
      }
    }
  }

  // 更新
  if (!isObj(cfg.update)) {
    err('update', 'E_MISSING', 'update 必填（active/endpoint/pubkey）。');
  } else {
    unknownKeys(cfg.update, UPDATE_KEYS, 'update.', errors);
    if (typeof cfg.update.active !== 'boolean') err('update.active', 'E_TYPE', 'update.active 必须是布尔值。');
    if (typeof cfg.update.checkOnStartup !== 'boolean') err('update.checkOnStartup', 'E_TYPE', 'update.checkOnStartup 必须是布尔值。');
    if (cfg.update.insecureTransport !== undefined && typeof cfg.update.insecureTransport !== 'boolean') {
      err('update.insecureTransport', 'E_TYPE', 'update.insecureTransport 必须是布尔值。');
    }
    if (cfg.update.active) {
      const insecureAllowed = cfg.update.insecureTransport === true;
      if (!cfg.update.endpoint) {
        err('update.endpoint', 'E_MISSING', '开启更新时 endpoint 必填：更新清单的完整 URL。');
      } else {
        let url = null;
        try { url = new URL(cfg.update.endpoint); } catch { /* 统一报错 */ }
        if (!url) err('update.endpoint', 'E_TYPE', 'endpoint 必须是完整 URL（可以是 {{target}}/{{arch}}/{{current_version}} 占位模板），不是文件路径。');
        else if (url.protocol !== 'https:') {
          if (url.protocol === 'http:' && insecureAllowed) {
            warn('update.endpoint', 'W_UPDATE_HTTP', 'update.insecureTransport 允许了明文 http 更新源：签名仍能拦住被替换的包，但拦不住中间人拒绝服务；仅限本机/内网调试，正式发布必须 https。');
          } else {
            err('update.endpoint', 'E_UPDATE_TLS', '生产构建强制 TLS：endpoint 必须是 https。内网调试可加 update.insecureTransport: true，但必须在构建前明确这是临时配置。');
          }
        }
      }
      if (!cfg.update.pubkey) {
        err('update.pubkey', 'E_MISSING', '开启更新时 pubkey 必填（tauri signer generate 产出的公钥内容）。');
      } else if (/\.(pem|pub|txt)$|^[A-Za-z]:[\\/]|^\//.test(cfg.update.pubkey)) {
        err('update.pubkey', 'E_UPDATE_PUBKEY', 'pubkey 要填公钥内容本身，不是文件路径。');
      }
      if (cfg.bundle && cfg.bundle.createUpdaterArtifacts !== true) {
        warn('bundle.createUpdaterArtifacts', 'W_UPDATER_ARTIFACT', '开启更新后必须产出更新包签名：渲染时会强制把 createUpdaterArtifacts 置为 true。');
      }
    }
    if (cfg.update.active === false && cfg.update.checkOnStartup) {
      warn('update.checkOnStartup', 'W_UPDATE_INACTIVE', '更新未开启，checkOnStartup 不会生效（不会发起任何网络请求）。');
    }
  }

  // 打包
  if (!isObj(cfg.bundle)) {
    err('bundle', 'E_MISSING', 'bundle 必填（targets/createUpdaterArtifacts）。');
  } else {
    unknownKeys(cfg.bundle, BUNDLE_KEYS, 'bundle.', errors);
    if (!Array.isArray(cfg.bundle.targets) || cfg.bundle.targets.length === 0) {
      err('bundle.targets', 'E_TARGET', 'bundle.targets 必须是非空数组，取值 msi/nsis/apk/aab/appimage/deb/rpm。');
    } else {
      const bad = cfg.bundle.targets.filter((t) => !ALL_TARGETS.has(t));
      if (bad.length) err('bundle.targets', 'E_TARGET', `不支持的打包目标：${bad.join(', ')}。`);
      // Android 的 apk/aab 由 android build 单独产出，不参与 bundle.targets 的平台裁剪。
      if (platform !== 'android') {
        const here = new Set(PLATFORM_TARGETS[platform] || []);
        if (!cfg.bundle.targets.some((t) => here.has(t))) {
          warn('bundle.targets', 'W_TARGET_PLATFORM', `当前平台（${platform}）没有可用目标：渲染时会按平台裁剪，产物可能为空。建议保留 ${[...here].join('/')} 中的一个。`);
        }
        if (cfg.bundle.targets.some((t) => !here.has(t))) {
          warn('bundle.targets', 'W_TARGET_CROSS', `含跨平台目标（${cfg.bundle.targets.filter((t) => !here.has(t)).join(', ')}），渲染时会自动裁掉，不会让构建直接报错。`);
        }
      }
    }
    if (typeof cfg.bundle.createUpdaterArtifacts !== 'boolean') {
      err('bundle.createUpdaterArtifacts', 'E_TYPE', 'bundle.createUpdaterArtifacts 必须是布尔值。');
    } else if (cfg.bundle.createUpdaterArtifacts && !cfg.update?.active) {
      warn('bundle.createUpdaterArtifacts', 'W_UPDATER_KEY', '开启产物签名需要构建机设置 TAURI_SIGNING_PRIVATE_KEY 与密码，否则打包阶段会失败；不需要自动更新时建议关掉。');
    }
    if (cfg.bundle.windows !== undefined) {
      if (!isObj(cfg.bundle.windows)) err('bundle.windows', 'E_TYPE', 'bundle.windows 必须是对象。');
      else {
        unknownKeys(cfg.bundle.windows, BUNDLE_WIN_KEYS, 'bundle.windows.', errors);
        if (cfg.bundle.windows.installMode !== undefined && !['passive', 'basicUi', 'quiet'].includes(cfg.bundle.windows.installMode)) {
          err('bundle.windows.installMode', 'E_TYPE', 'installMode 只能是 passive / basicUi / quiet。');
        }
      }
    }
  }

  // Android 签名路径（只记录选择，不写密码）
  if (cfg.android !== undefined) {
    if (!isObj(cfg.android)) {
      err('android', 'E_TYPE', 'android 必须是对象（signing/keystorePath/keyAlias）。');
    } else {
      for (const key of Object.keys(cfg.android)) {
        if (SECRET_KEY_RE.test(key) || /password/i.test(key)) {
          err(`android.${key}`, 'E_SECRET_IN_CONFIG', `android 配置出现疑似密码的字段 "${key}"：desktop.json 会随安装包分发，签名密码只能放构建机环境变量或未导出的 keystore.properties。`);
        }
      }
      unknownKeys(cfg.android, ANDROID_KEYS, 'android.', errors);
      if (!['test', 'release'].includes(cfg.android.signing)) {
        err('android.signing', 'E_TYPE', 'android.signing 只能是 test（测试 keystore，只能自己安装）或 release（上传密钥，可上架）。');
      }
      for (const key of ['keystorePath', 'keyAlias']) {
        if (typeof cfg.android[key] !== 'string') err(`android.${key}`, 'E_TYPE', `android.${key} 必须是字符串。`);
      }
    }
  }

  // 开发与构建命令
  if (!isObj(cfg.dev)) {
    err('dev', 'E_MISSING', 'dev 必填（url/beforeDevCommand/beforeBuildCommand）。');
  } else {
    unknownKeys(cfg.dev, DEV_KEYS, 'dev.', errors);
    if (cfg.dev.url && typeof cfg.dev.url !== 'string') err('dev.url', 'E_TYPE', 'dev.url 必须是字符串。');
    if (cfg.dev.url && cfg.delivery && cfg.delivery.mode === 'static') {
      warn('dev.url', 'W_DEV_URL_IGNORED', '静态接入下 devUrl 会被忽略：`tauri dev` 直接加载内嵌产物，否则会一直等一个没启动的开发服务器。');
    }
    if (!cfg.dev.url && cfg.delivery && cfg.delivery.mode === 'server') {
      warn('dev.url', 'W_DEV_URL_MISSING', '服务端接入时没配 dev.url，`tauri dev` 会直接加载线上地址，热更新与调试都不方便。');
    }
    for (const key of ['beforeDevCommand', 'beforeBuildCommand']) {
      if (cfg.dev[key] !== undefined && typeof cfg.dev[key] !== 'string') err(`dev.${key}`, 'E_TYPE', `dev.${key} 必须是字符串。`);
    }
  }

  return { errors, warnings };
}

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--config') out.config = argv[++i];
    else if (a === '--platform') out.platform = argv[++i];
    else if (a === '--quiet') out.quiet = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.resolve(root, args.config || 'config/desktop.json');
  let cfg;
  try {
    // 导出侧有可能带 BOM 写文件，读的时候先剥掉，不让 BOM 变成「配置损坏」。
    cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    console.error(`配置读不出来：${file}\n${e.message}`);
    process.exit(1);
  }
  const { errors, warnings } = validateConfig(cfg, { platform: args.platform, root });
  if (args.json) {
    console.log(JSON.stringify({ ok: errors.length === 0, file, errors, warnings }, null, 2));
  } else if (!args.quiet) {
    for (const w of warnings) console.log(`[警告] ${w.field || '(根)'} ${w.message}`);
    for (const e of errors) console.log(`[错误] ${e.field || '(根)'} ${e.message}`);
    console.log(errors.length === 0
      ? `配置通过：${path.relative(process.cwd(), file)}（${warnings.length} 条警告）`
      : `配置有 ${errors.length} 个错误，先改完再渲染/构建。`);
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
