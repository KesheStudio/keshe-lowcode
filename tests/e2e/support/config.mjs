import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PLATFORM_ROOT = path.resolve(SUPPORT_DIR, '../../..');
export const E2E_RUNTIME_DIR = path.join(PLATFORM_ROOT, 'tests', 'e2e', '.runtime');

/* 自动端口探测：监听 0 让系统给一个空闲端口，拿到后立刻释放。
   多个 e2e 轮次并行时，各自拿到的端口不同，不会互抢 9817。 */
const FREE_PORT_SCRIPT = [
  'const net = require("node:net");',
  'const srv = net.createServer();',
  'srv.listen(0, "127.0.0.1", () => {',
  '  const port = srv.address().port;',
  '  srv.close(() => process.stdout.write(String(port)));',
  '});'
].join('\n');

function pickFreePort() {
  const out = execFileSync(process.execPath, ['-e', FREE_PORT_SCRIPT], { encoding: 'utf8', timeout: 8_000 });
  const port = Number(String(out || '').trim());
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('E2E 自动分配测试端口失败：' + (out || '（无输出）'));
  }
  return port;
}

/* 一轮测试一个运行标识：并行时各自建自己的平台根目录，互不共用状态文件。 */
function makeRunId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = '' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  return stamp + '-' + Math.random().toString(36).slice(2, 8);
}

const envPort = Number(process.env.LC_E2E_PORT || 0);
const explicitPort = Number.isInteger(envPort) && envPort > 0 ? envPort : 0;

/* 显式端口由预检负责占用检查；未指定时每轮自动分配，避免并行互抢。 */
export const E2E_PORT_EXPLICIT = explicitPort > 0;
export const E2E_PORT = explicitPort || pickFreePort();
process.env.LC_E2E_PORT = String(E2E_PORT);

export const E2E_RUN_ID = String(process.env.LC_E2E_RUN_ID || '').trim() || makeRunId();
process.env.LC_E2E_RUN_ID = E2E_RUN_ID;

export const E2E_RUN_ROOT = String(process.env.LC_E2E_RUN_ROOT || '').trim() ||
  path.join(E2E_RUNTIME_DIR, 'lc-e2e-platform-' + E2E_RUN_ID);
process.env.LC_E2E_RUN_ROOT = E2E_RUN_ROOT;

export const E2E_BASE_URL = String(process.env.LC_E2E_BASE_URL || ('http://127.0.0.1:' + E2E_PORT)).replace(/\/+$/, '');

/* 产物与报告目录：并行跑多轮时各写各的，避免报告互相覆盖。默认仍在 tests/e2e 下。 */
export const E2E_ARTIFACTS_DIR = String(process.env.LC_E2E_ARTIFACTS_DIR || '').trim() ||
  path.join(PLATFORM_ROOT, 'tests', 'e2e', '.artifacts');
export const E2E_REPORT_DIR = String(process.env.LC_E2E_REPORT_DIR || '').trim() ||
  path.join(PLATFORM_ROOT, 'tests', 'e2e', '.report');

export const TEMP_SITE_PREFIX = 'lc-e2e-';

export function readPlatformConfig() {
  const file = path.join(PLATFORM_ROOT, 'platform.config.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const WINDOWS_BROWSERS = [
  {
    channel: 'msedge',
    label: '本机 Microsoft Edge',
    paths: [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ]
  },
  {
    channel: 'chrome',
    label: '本机 Google Chrome',
    paths: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
    ]
  }
];

function bundledChromiumPath() {
  try {
    const require = createRequire(import.meta.url);
    const { chromium } = require('playwright-core');
    const exe = chromium.executablePath();
    return exe && fs.existsSync(exe) ? exe : '';
  } catch (error) {
    return '';
  }
}

/**
 * 浏览器选择顺序：环境变量 > 本机 Edge / Chrome > Playwright 自带 Chromium。
 * 默认走本机已安装的浏览器，不触发任何浏览器二进制下载。
 */
export function detectBrowser() {
  const override = String(process.env.LC_E2E_CHANNEL || '').trim();
  if (override) {
    if (override === 'chromium') return { channel: undefined, label: 'Playwright 自带 Chromium', source: 'env' };
    return { channel: override, label: override, source: 'env' };
  }
  for (const item of WINDOWS_BROWSERS) {
    const hit = item.paths.find((candidate) => fs.existsSync(candidate));
    if (hit) return { channel: item.channel, label: item.label, source: hit };
  }
  if (bundledChromiumPath()) {
    return { channel: undefined, label: 'Playwright 自带 Chromium', source: 'bundled' };
  }
  return { channel: undefined, label: '', source: '' };
}
