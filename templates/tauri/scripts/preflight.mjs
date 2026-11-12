#!/usr/bin/env node
// 打包前自检：把"换台机器就开始试错"变成一次可执行的检查。
// 用法：node scripts/preflight.mjs [--json]
// 只报"有/缺/可写/不可写"，绝不打印环境变量的值。
// 退出码：0 可以打包（可能有警告），1 有阻塞项。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'tauri');
const ARGS = process.argv.slice(2);
const platformArg = (() => {
  const i = ARGS.indexOf('--platform');
  return i >= 0 ? ARGS[i + 1] : null;
})();
const PLATFORM = platformArg || process.platform;
const PLATFORM_TARGETS = {
  win32: ['msi', 'nsis'],
  linux: ['appimage', 'deb', 'rpm'],
  android: ['apk', 'aab'],
};

const results = [];
function add(level, name, detail, fix) {
  results.push({ level, name, detail, fix });
}
const ok = (name, detail) => add('OK', name, detail);
const warn = (name, detail, fix) => add('WARN', name, detail, fix);
const fail = (name, detail, fix) => add('FAIL', name, detail, fix);
const skip = (name, detail) => add('SKIP', name, detail);

function readConfig() {
  const file = path.join(ROOT, 'config/desktop.json');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function run(cmd, args) {
  // 不能用 shell：Windows 下 node 的安装路径带空格，拼成命令串会被截断（"C:\Program" 不是命令）。
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.lc-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return null;
  } catch (e) {
    return e.code || e.message;
  }
}

function exists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

// ---- 工具链 ----
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 18) ok('Node', `v${process.versions.node}`);
else fail('Node', `v${process.versions.node} 太低`, '装 Node 18 或更高版本。');

const cliDir = path.join(ROOT, 'node_modules/@tauri-apps/cli');
if (fs.existsSync(cliDir)) ok('Tauri CLI（本地）', 'node_modules/@tauri-apps/cli 已安装');
else fail('Tauri CLI（本地）', 'node_modules 里没有 @tauri-apps/cli', '在模板根目录执行 npm ci（离线时用缓存的 package-lock.json）。');

const cargo = run('cargo', ['--version']);
if (cargo.status === 0) ok('cargo', cargo.out.split('\n')[0]);
else fail('cargo', 'cargo 不可用', '装 Rust 工具链（rustup），并把 %USERPROFILE%\\\\.cargo\\\\bin 加进 PATH。');

const rustc = run('rustc', ['--version']);
if (rustc.status === 0) {
  const m = rustc.out.match(/rustc\s+(\d+)\.(\d+)\.(\d+)/);
  const [, major, minor] = m || [];
  if (m && (Number(major) < 1 || (Number(major) === 1 && Number(minor) < 80))) {
    fail('rustc', `${m[1]}.${m[2]}.${m[3]} 低于 MSRV 1.80`, 'rustup update stable。');
  } else {
    ok('rustc', m ? `${m[1]}.${m[2]}.${m[3]}` : rustc.out.split('\n')[0]);
  }
} else {
  fail('rustc', 'rustc 不可用', '装 Rust 工具链（rustup）。');
}

// CLI 与 crate 的版本关系：补丁版不同是正常的（上游 npm 与 crates.io 发布节奏不一样），
// 但要让用户知道"这不等于包类型标记失效"，真正的原因由下面 __TAURI_BUNDLE_TYPE 的说明覆盖。
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cliVer = pkg.devDependencies?.['@tauri-apps/cli'];
  const cargoToml = fs.readFileSync(path.join(ROOT, 'src-tauri/Cargo.toml'), 'utf8');
  const crateVer = (cargoToml.match(/tauri\s*=\s*\{?\s*version\s*=\s*"([^"]+)"/) || [])[1];
  if (cliVer && crateVer) {
    if (cliVer === crateVer) ok('CLI / crate 版本', `一致（${cliVer}）`);
    else warn('CLI / crate 版本', `CLI ${cliVer}、crate ${crateVer}（补丁版不同）`,
      '两边都已是各自渠道的最新版时无法严格对齐；补丁差本身不会导致打包失败，包类型标记问题见本清单末尾说明。');
  }
} catch { /* 读不到就跳过，不阻塞 */ }

// ---- 配置 ----
let config = null;
try {
  config = readConfig();
  const { errors, warnings } = validateConfig(config, { platform: PLATFORM, root: ROOT });
  if (errors.length === 0) ok('配置校验', `通过（${warnings.length} 条警告）`);
  else fail('配置校验', `${errors.length} 个错误`, errors.slice(0, 3).map((e) => `${e.field}: ${e.message}`).join('；'));
} catch (e) {
  fail('配置读取', e.message, '检查 config/desktop.json 是否是合法 JSON（不要带 BOM 或注释）。');
}

const check = run(process.execPath, [path.join(ROOT, 'scripts/render-config.mjs'), '--check', '--platform', PLATFORM]);
if (check.status === 0) ok('渲染产物', '与 config 一致');
else fail('渲染产物', 'tauri.conf.json / desktop.runtime.json / desktop-config.js 与配置不一致', '先执行 npm run render，再打包。');

// ---- 磁盘与打包工具缓存（Windows）----
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(ROOT, 'src-tauri/target');
const writeErr = canWrite(targetDir);
if (writeErr) fail('target 目录可写', `${targetDir} 写入失败（${writeErr}）`, '换一个可写目录：设置 CARGO_TARGET_DIR，或把工程放到用户目录下。');
else ok('target 目录可写', targetDir);

try {
  const st = fs.statfsSync(targetDir);
  const freeGb = (st.bavail * st.bsize) / 1024 ** 3;
  if (freeGb < 3) warn('磁盘空间', `剩余 ${freeGb.toFixed(1)} GB`, 'release 构建 + 打包缓存通常要 3 GB 以上，清理磁盘后再打包。');
  else ok('磁盘空间', `剩余 ${freeGb.toFixed(1)} GB`);
} catch { /* 平台不支持就跳过 */ }

const bundleTargets = Array.isArray(config?.bundle?.targets) ? config.bundle.targets : [];
const targets = bundleTargets.filter((t) => (PLATFORM_TARGETS[PLATFORM] || []).includes(t));
if (process.platform === 'win32' && PLATFORM !== 'android') {
  const cacheErr = canWrite(CACHE);
  if (cacheErr) {
    fail('打包缓存可写', `${CACHE} 写入失败（${cacheErr}）`, '检查杀毒软件/受控文件夹访问是否拦住了这个目录；必要时把工程与 %LOCALAPPDATA%\\tauri 加入排除项。');
  } else {
    ok('打包缓存可写', CACHE);
  }

  if (targets.includes('msi')) {
    const wix = path.join(CACHE, 'WixTools314');
    if (exists(path.join(wix, 'candle.exe')) && exists(path.join(wix, 'light.exe'))) {
      ok('WiX 缓存', 'candle.exe / light.exe 就绪');
    } else {
      fail('WiX 缓存', `${wix} 不完整（candle.exe 或 light.exe 缺失）`,
        '这是"拒绝访问 (os error 5)"的常见根因。手动把 wix314-binaries.zip 解压到该目录：\n' +
        `  Invoke-WebRequest https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip -OutFile $env:TEMP\\wix314.zip\n` +
        `  Expand-Archive $env:TEMP\\wix314.zip -DestinationPath "${wix}" -Force`);
    }
  }

  const nsis = path.join(CACHE, 'NSIS', 'makensis.exe');
  if (exists(nsis)) {
    ok('NSIS 缓存', nsis);
  } else if (targets.includes('nsis')) {
    fail('NSIS 缓存', `${nsis} 不存在`, '首次打包会联网下载；若下载后仍缺文件，删掉 %LOCALAPPDATA%\\tauri\\NSIS 让 CLI 重新解压，或手动解压 nsis 归档到该目录。');
  } else {
    warn('NSIS 缓存', `${nsis} 不存在`, '只影响 `--bundles nsis`；要出 NSIS 安装包先补缓存或让 CLI 首次运行时下载。');
  }
} else {
  skip('Windows 打包缓存', `${PLATFORM} 不使用 WiX/NSIS`);
}

// ---- 证书（仅 server 模式）----
const serverMode = config?.delivery?.mode === 'server';
const httpsMode = config?.https?.mode;
if (serverMode) {
  const crt = path.join(ROOT, 'certs/site.crt');
  const key = path.join(ROOT, 'certs/site.key');
  if (httpsMode === 'generated') {
    if (exists(crt) && exists(key)) {
      ok('本地 HTTPS 证书', 'certs/site.crt + site.key 存在');
      warn('自签证书信任', '自签证书只在导入了信任的机器上可用', '测试机需手动信任，否则 WebView 会报证书错误（见 docs/https.md）。');
    } else {
      fail('本地 HTTPS 证书', '缺 certs/site.crt 或 site.key', '执行 npm run gen:cert（或把自有证书按 docs/https.md 放到 certs/）。');
    }
  } else {
    skip('本地 HTTPS 证书', `https.mode=${httpsMode}，按 docs/https.md 手动放置`);
  }
  for (const dir of ['web', 'dist']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const leaked = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(key|p12|pfx|jks|keystore)$/i.test(e.name)) leaked.push(path.relative(ROOT, p));
      }
    };
    walk(abs);
    if (leaked.length) fail('证书混入前端产物', `${dir}/ 里有证书或私钥文件：${leaked.join(', ')}`, '从产物目录删除；私钥绝不能进安装包。');
  }
} else {
  skip('证书', '静态接入：不涉及真实 TLS');
}

// ---- 签名材料（只看有无，不打印值）----
const env = process.env;
if (config?.update?.active) {
  if (env.TAURI_SIGNING_PRIVATE_KEY) ok('更新签名私钥', 'TAURI_SIGNING_PRIVATE_KEY 已设置');
  else fail('更新签名私钥', '未设置 TAURI_SIGNING_PRIVATE_KEY', '开更新时必须给私钥，否则 createUpdaterArtifacts 构建失败。私钥只放环境变量/CI secret。');
}

if (process.platform === 'win32') {
  if (targets.includes('msi') || targets.includes('nsis')) {
    const signtool = run('where', ['signtool']);
    const configured = Boolean(config?.bundle?.windows?.certificateThumbprint || config?.bundle?.windows?.signCommand);
    if (signtool.status === 0) ok('signtool', signtool.out.split(/\r?\n/)[0]);
    else if (configured) warn('signtool', '配置了签名但 PATH 里找不到 signtool', '装 Windows SDK，或改用 signCommand 写全路径。');
    else warn('Windows 签名', '未配置签名材料，产物会是未签名', '只影响正式分发（SmartScreen），不影响本地打包；材料见 templates/signing/windows/README.md。');
  }
}

const androidTargets = PLATFORM === 'android' && (targets.includes('apk') || targets.includes('aab'));
if (androidTargets) {
  const java = run('java', ['-version']);
  if (java.status === 0) ok('JDK', (java.out.match(/version "([^"]+)"/) || [])[1] || '可用');
  else fail('JDK', 'java 不可用', 'Android 打包需要 JDK 17 或 21；装 JDK 后把 JAVA_HOME 指向它。');

  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || '';
  if (sdk && fs.existsSync(sdk)) ok('Android SDK', sdk);
  else fail('Android SDK', '未设置 ANDROID_HOME / ANDROID_SDK_ROOT 或目录不存在', '装 Android command-line tools 与 platform/build-tools，并导出 ANDROID_HOME。');

  const ndk = env.NDK_HOME || (sdk ? path.join(sdk, 'ndk') : '');
  const ndkReady = ndk && (fs.existsSync(ndk)
    ? fs.readdirSync(ndk).length > 0
    : false);
  if (ndkReady) ok('Android NDK', ndk);
  else fail('Android NDK', '未找到 NDK', '用 sdkmanager 安装 NDK（如 ndk;27.0.12077973），或解压 NDK 后设置 NDK_HOME。');

  const installed = run('rustup', ['target', 'list', '--installed']);
  const rustAndroid = ['aarch64-linux-android', 'armv7-linux-androideabi', 'i686-linux-android', 'x86_64-linux-android']
    .filter((t) => installed.status === 0 && installed.out.includes(t));
  if (rustAndroid.length >= 2) ok('Rust Android 目标', rustAndroid.join(', '));
  else fail('Rust Android 目标', '缺少 Android 编译目标', '执行 rustup target add aarch64-linux-android x86_64-linux-android（需要 armv7/i686 时一并加）。');

  const kt = run('where', ['keytool']);
  if (kt.status === 0) ok('keytool', kt.out.split(/\r?\n/)[0]);
  else warn('keytool', 'PATH 里找不到 keytool', 'Android 打包需要 JDK；装 JDK 21 或 Android Studio。');
  const props = path.join(ROOT, 'src-tauri/gen/android/keystore.properties');
  if (exists(props)) ok('Android 签名属性', 'keystore.properties 存在');
  else warn('Android 签名属性', 'keystore.properties 不存在', '发布包必须签名；测试包可用 apksigner + 测试 keystore，见 templates/signing/android/README.md。');
}

// ---- 包类型标记说明（本次实测结论）----
warn('包类型标记', '打包中断/失败后可能留下"已改写未还原"的二进制，下一次打包报 __TAURI_BUNDLE_TYPE 并可能发错包类型',
  '失败后先 cargo clean -p lc-desktop 或 touch src-main 强制重编译再打；每次打包确认日志里有 "Patching ... with bundle type information"。详见 docs/build-checklist.md 第 8 节。');

// ---- 输出 ----
const order = { FAIL: 0, WARN: 1, OK: 2, SKIP: 3 };
results.sort((a, b) => order[a.level] - order[b.level]);
const fails = results.filter((r) => r.level === 'FAIL').length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: fails === 0, results }, null, 2));
} else {
  console.log(`打包前自检（${process.platform} / Node ${process.versions.node}）\n`);
  for (const r of results) {
    console.log(`[${r.level.padEnd(4)}] ${r.name}：${r.detail}`);
    if (r.fix) console.log(`         └─ ${r.fix.replace(/\n/g, '\n            ')}`);
  }
  console.log(`\n${fails === 0 ? '没有阻塞项。' : `有 ${fails} 个阻塞项，先处理再打包。`}`);
}
process.exit(fails === 0 ? 0 : 1);
