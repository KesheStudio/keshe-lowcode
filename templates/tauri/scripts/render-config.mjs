#!/usr/bin/env node
// 把 config/desktop.json 渲染成 tauri.conf.json + desktop.runtime.json + web/desktop-config.js
// 用法：node scripts/render-config.mjs [--config <path>] [--platform win32|linux|android] [--check]
// --check：只比对不写盘，已有文件与渲染结果不一致时退出码 1（用于 CI 与导出前自检）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';

export const PLATFORM_TARGETS = {
  win32: ['msi', 'nsis'],
  linux: ['appimage', 'deb', 'rpm'],
  // Android 的 apk/aab 不走 `tauri build --bundles`，由 `tauri android build --apk/--aab` 产出。
  android: ['apk', 'aab'],
};

const ANDROID_TARGETS = new Set(['apk', 'aab']);

// 打包目标按当前平台裁剪：config 里保留全量清单，渲染时只留本机能产的，
// 避免 `tauri build` 因为包含 deb/appimage 这类跨平台目标直接报错。
export function pickTargets(config, platform) {
  const here = PLATFORM_TARGETS[platform] || [];
  const picked = config.bundle.targets.filter((t) => here.includes(t));
  return picked.length > 0 ? picked : here.slice(0, 1);
}

function sidecarBin(config) {
  // Tauri 会在这个相对路径后自动补 `-<target triple>` 与平台后缀，所以这里不加扩展名。
  return config.sidecar?.enabled ? `binaries/${config.sidecar.name}` : null;
}

function buildCsp(config) {
  const connect = ["'self'", 'ipc:', 'http://ipc.localhost'];
  if (config.delivery.mode === 'server') {
    connect.push(`${config.protocol}://${config.https.host}:${config.https.port}`);
  }
  if (config.backend.enabled) {
    try { connect.push(new URL(config.backend.baseUrl).origin); } catch { /* 校验阶段已报错 */ }
  }
  // sidecar 的端口是运行时才挑的，CSP 只能放开通配端口回环地址：
  // 写死某个端口会让「自动挑端口」失效，前端一换端口就全被 CSP 拦掉。
  if (config.sidecar?.enabled) {
    connect.push('http://127.0.0.1:*', 'http://localhost:*');
  }
  if (config.protocol === 'https') connect.push('https://ipc.localhost');
  return [
    "default-src 'self'",
    "img-src 'self' asset: http://asset.localhost data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "media-src 'self' asset: http://asset.localhost",
    "frame-src 'self'",
    `connect-src ${connect.join(' ')}`,
  ].join('; ');
}

export function buildTauriConf(config, { platform = process.platform } = {}) {
  const frontendDist = config.delivery.mode === 'server'
    ? `${config.protocol}://${config.https.host}:${config.https.port}`
    : config.delivery.webDir;

  const build = {
    frontendDist,
    // 静态接入下不写 devUrl：否则 `tauri dev` 会去等一个并不存在的开发服务器。
    ...(config.delivery.mode === 'server' && config.dev.url ? { devUrl: config.dev.url } : {}),
    ...(config.dev.beforeDevCommand ? { beforeDevCommand: config.dev.beforeDevCommand } : {}),
    ...(config.dev.beforeBuildCommand ? { beforeBuildCommand: config.dev.beforeBuildCommand } : {}),
  };

  const win = {
    label: 'main',
    title: config.window.title || config.productName,
    width: config.window.width,
    height: config.window.height,
    minWidth: config.window.minWidth,
    minHeight: config.window.minHeight,
    resizable: config.window.resizable,
    fullscreen: config.window.fullscreen,
    center: config.window.center,
    // 页面加载前的窗口底色：与默认主题亮色一致，避免首帧露出系统黑底。
    backgroundColor: '#f4f0e6',
    // 自定义协议方案：Windows/Android 上用 https://tauri.localhost，而不是 http。
    useHttpsScheme: config.protocol === 'https',
  };

  const conf = {
    productName: config.productName,
    version: config.version,
    identifier: config.identifier,
    build,
    app: {
      windows: [win],
      // 前端可能没有打包器（导出管线只落静态文件），sidecar 或更新面板都需要
      // 从页面直接调 window.__TAURI__.core.invoke，所以这两种情况都打开全局注入。
      ...(config.sidecar?.enabled || config.update.active ? { withGlobalTauri: true } : {}),
      security: { csp: buildCsp(config) },
    },
    bundle: {
      active: true,
      // tauri.conf.json 的 bundle.targets 只接受桌面安装包类型；apk/aab 由 android build 命令单独产出。
      ...(() => {
        const targets = pickTargets(config, platform).filter((t) => !ANDROID_TARGETS.has(t));
        return targets.length ? { targets } : {};
      })(),
      icon: ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.ico'],
      ...(config.description ? { shortDescription: config.description } : {}),
      // 发布者写入 MSI 的 Manufacturer 与 NSIS 的厂商注册表键；保持与 GitHub 组织一致。
      publisher: 'KesheStudio',
      // MSI（WiX）默认 1252 代码页装不下中文 productName，会报 LGHT0311；
      // 按站点语言设置 WiX 语言，中文站点自动落到 936 代码页。
      windows: { wix: { language: String((config.bundle.windows && config.bundle.windows.wixLanguage) || 'zh-CN') } },
      ...(sidecarBin(config) ? { externalBin: [sidecarBin(config)] } : {}),
      // 开启自动更新时必须产出更新包签名；渲染阶段直接校正，不把矛盾配置留给构建期。
      createUpdaterArtifacts: config.update.active ? true : config.bundle.createUpdaterArtifacts,
      // installMode 是更新器的安装方式（quiet/passive/basicUi），只属于 plugins.updater.windows；
      // 写进 bundle.windows 会被 schema 拒绝（那里是 NSIS 的安装范围 currentUser/perMachine）。
      // 这里不再注入，避免「看着配了、构建直接失败」。
    },
  };

  if (config.update.active) {
    conf.plugins = {
      updater: {
        endpoints: [config.update.endpoint],
        pubkey: config.update.pubkey,
        ...(config.bundle.windows?.installMode ? { windows: { installMode: config.bundle.windows.installMode } } : {}),
        // 仅本机/内网调试用：http 更新源必须显式打开这个危险开关，否则插件会在启动时拒绝。
        ...(config.update.insecureTransport === true ? { dangerousInsecureTransportProtocol: true } : {}),
      },
    };
  }

  return conf;
}

export function buildRuntimeConfig(config) {
  const sidecar = config.sidecar;
  return {
    schemaVersion: 1,
    productName: config.productName,
    version: config.version,
    singleInstance: config.runtime.singleInstance,
    autostart: config.runtime.autostart,
    updateActive: config.update.active,
    checkOnStartup: config.update.checkOnStartup,
    backend: { enabled: config.backend.enabled, baseUrl: config.backend.baseUrl },
    delivery: { mode: config.delivery.mode, protocol: config.protocol },
    // 字段全是行为开关；二进制路径由 Rust 侧按可执行文件位置解析，不写进配置。
    sidecar: sidecar
      ? {
          enabled: sidecar.enabled === true,
          name: sidecar.name,
          args: sidecar.args || [],
          readinessPath: sidecar.readinessPath || '/health',
          readinessTimeoutMs: sidecar.readinessTimeoutMs || 10000,
          versionCheck: sidecar.versionCheck !== false,
          env: sidecar.env || {},
        }
      : null,
  };
}

export function buildFrontendBridge(config) {
  const payload = {
    appName: config.productName,
    appVersion: config.version,
    protocol: config.protocol,
    deliveryMode: config.delivery.mode,
    backend: { enabled: config.backend.enabled, baseUrl: config.backend.baseUrl },
    // 更新面板只在开启更新时显示；检查/下载按钮都调用外壳命令，前端不直接碰插件权限。
    update: { active: config.update.active === true, checkOnStartup: config.update.checkOnStartup === true },
    // backendUrl 只是占位：真实地址在运行时由 Rust 挑端口后通过 invoke 返回。
    sidecar: config.sidecar
      ? {
          enabled: config.sidecar.enabled === true,
          readinessPath: config.sidecar.readinessPath || '/health',
          readinessTimeoutMs: config.sidecar.readinessTimeoutMs || 10000,
          backendUrl: null,
        }
      : { enabled: false },
  };
  return `/* 由 scripts/render-config.mjs 生成，勿手改；导出管线会替换为同一份内容。 */\nwindow.__LC_DESKTOP__ = ${JSON.stringify(payload)};\n`;
}

const stable = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

function writeOrCheck(file, content, check) {
  const exists = fs.existsSync(file);
  const old = exists ? fs.readFileSync(file, 'utf8') : null;
  if (check) {
    if (!exists) { console.error(`[不一致] 缺失：${file}`); return false; }
    if (old !== content) { console.error(`[不一致] 内容不同：${file}`); return false; }
    return true;
  }
  if (old === content) return true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function parseArgs(argv) {
  const out = { check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--config') out.config = argv[++i];
    else if (a === '--platform') out.platform = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const platform = args.platform || process.platform;
  const configFile = path.resolve(root, args.config || 'config/desktop.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));

  const { errors, warnings } = validateConfig(config, { platform, root });
  for (const w of warnings) console.error(`[警告] ${w.field || '(根)'} ${w.message}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[错误] ${e.field || '(根)'} ${e.message}`);
    console.error(`配置有 ${errors.length} 个错误，已停止渲染。`);
    process.exit(1);
  }

  const outputs = [
    [path.join(root, 'src-tauri/tauri.conf.json'), stable(buildTauriConf(config, { platform }))],
    [path.join(root, 'src-tauri/desktop.runtime.json'), stable(buildRuntimeConfig(config))],
    [path.join(root, 'web/desktop-config.js'), buildFrontendBridge(config)],
  ];
  let ok = true;
  for (const [file, content] of outputs) {
    if (!writeOrCheck(file, content, args.check)) ok = false;
  }
  if (args.check) {
    console.log(ok ? '渲染结果与磁盘一致。' : '渲染结果与磁盘不一致，执行 npm run render 重新生成。');
    process.exit(ok ? 0 : 1);
  }
  console.log(`已渲染（平台 ${platform}）：src-tauri/tauri.conf.json、src-tauri/desktop.runtime.json、web/desktop-config.js`);
  console.log(`打包目标：${pickTargets(config, platform).join(', ')}（配置里的全量清单：${config.bundle.targets.join(', ')}）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
