import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { cleanupTempSite, createTempSite } from './api.mjs';

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

export function fixturePath(name) {
  return path.join(FIXTURE_DIR, name);
}

export async function readFixture(name) {
  return fs.readFile(fixturePath(name), 'utf8');
}

function isBenignConsoleError(text) {
  const value = String(text || '');
  if (/favicon/i.test(value)) return true;
  if (/Failed to load resource.*(404|Not Found)/i.test(value)) return true;
  return false;
}

function oneLine(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 200);
}

/* 区分「产品自身报错」与「测试脚本注入内容报错」：
   - 控制台错误来自平台页面、导出产物或画布 srcdoc → 产品；
   - about:blank / data: / blob: 里的脚本，或堆栈指向 tests/e2e → 测试脚本。 */
function originOf(entry) {
  const url = String((entry.location && entry.location.url) || '');
  const stack = String(entry.stack || '');
  if (/[\\/]tests[\\/]e2e[\\/]/i.test(stack)) return 'test';
  if (/^about:blank$/i.test(url) || /^(?:data|blob):/i.test(url)) return 'test';
  return 'product';
}

function guardLine(label, list) {
  if (!list.length) return '';
  const samples = list.slice(0, 3).map((item) => '「' + oneLine(item.text || item.message) + '」').join('、');
  return label + ' ' + list.length + ' 个：' + samples;
}

const extended = base.extend({
  artifacts: [async ({ page }, use, testInfo) => {
    const consoleErrors = [];
    const consoleWarnings = [];
    const pageErrors = [];
    const requestFailures = [];
    const responseErrors = [];

    page.on('console', (message) => {
      const entry = { type: message.type(), text: message.text(), location: message.location() };
      if (message.type() === 'error') consoleErrors.push(entry);
      else if (message.type() === 'warning') consoleWarnings.push(entry);
    });
    page.on('pageerror', (error) => {
      pageErrors.push({ message: error.message, stack: error.stack || '' });
    });
    page.on('requestfailed', (request) => {
      requestFailures.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        error: (request.failure() && request.failure().errorText) || ''
      });
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        responseErrors.push({ url: response.url(), status: response.status(), method: response.request().method() });
      }
    });

    /* 全局守卫：页面出现的未处理控制台错误 / 未捕获异常都算失败，
       并区分是产品自身报错还是测试脚本注入内容报错。 */
    const guard = () => {
      const product = [];
      const testErrors = [];
      const unexpectedConsole = consoleErrors.filter((item) => !isBenignConsoleError(item.text));
      unexpectedConsole.concat(pageErrors).forEach((entry) => {
        (originOf(entry) === 'test' ? testErrors : product).push(entry);
      });
      return { product, test: testErrors };
    };

    const collect = {
      consoleErrors,
      consoleWarnings,
      pageErrors,
      requestFailures,
      responseErrors,
      guard,
      unexpectedConsoleErrors: () => consoleErrors.filter((item) => !isBenignConsoleError(item.text)),
      failedRequests: () => requestFailures.filter((item) => item.error !== 'net::ERR_ABORTED'),
      unexpectedResponses: () => responseErrors.filter((item) => !/favicon/i.test(item.url))
    };

    await use(collect);

    const guardResult = guard();
    const productErrors = guardResult.product;
    const testErrors = guardResult.test;
    const guardFailed = productErrors.length + testErrors.length > 0;
    const alreadyFailed = testInfo.status !== testInfo.expectedStatus;
    const failing = alreadyFailed || guardFailed;

    if (failing) {
      const dir = testInfo.outputPath('');
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      const shot = testInfo.outputPath('failure.png');
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      /* 附到报告里，失败时不用去翻 artifacts 目录也能看到页面当时的样子。 */
      await testInfo.attach('失败页面截图', { path: shot, contentType: 'image/png' }).catch(() => {});

      const errors = (testInfo.errors || []).map((item) => ({
        message: item.message,
        stack: item.stack || ''
      }));
      const payload = {
        test: testInfo.title,
        status: guardFailed && !alreadyFailed ? 'failed (guard)' : testInfo.status,
        url: page.url(),
        guard: {
          failed: guardFailed,
          product: productErrors,
          test: testErrors
        },
        errors,
        consoleErrors,
        pageErrors,
        requestFailures,
        responseErrors
      };
      await fs.writeFile(testInfo.outputPath('failure.json'), JSON.stringify(payload, null, 2), 'utf8').catch(() => {});
      await testInfo.attach('失败上下文（步骤与错误）', {
        body: JSON.stringify({ errors, url: page.url(), guard: payload.guard }, null, 2),
        contentType: 'application/json'
      });
      await testInfo.attach('failure-console', {
        body: JSON.stringify({ consoleErrors, pageErrors }, null, 2),
        contentType: 'application/json'
      });
      await testInfo.attach('failure-network', {
        body: JSON.stringify({ requestFailures, responseErrors }, null, 2),
        contentType: 'application/json'
      });
    }

    /* 失败统一由 afterEach 里的守卫抛出，fixture 只负责收集与留证。 */
  }, { auto: true }],

  tempSite: async ({ request }, use, testInfo) => {
    /* 站点名不能带 \ / : * ? " < > |：导出向导会拿它当桌面应用名默认值。 */
    const site = await createTempSite(request, 'E2E 临时站点 ' + Date.now().toString(36));
    testInfo.annotations.push({ type: 'temp-site', description: site.siteId });
    await use(site);
    await cleanupTempSite(request, site.siteId);
  },

  /* 后端功能页（中间件 / 配置中心 / 后端积木）用带后端的站点，
     否则会被纯静态门禁挡住，进不到编辑区。 */
  tempBackendSite: async ({ request }, use, testInfo) => {
    const site = await createTempSite(request, 'E2E 后端站点 ' + Date.now().toString(36), {
      type: 'backend',
      backendLanguage: 'node'
    });
    testInfo.annotations.push({ type: 'temp-backend-site', description: site.siteId });
    await use(site);
    await cleanupTempSite(request, site.siteId);
  }
});

export const test = extended;

/* 全局守卫：用例自身没断言到、但页面报了错，同样算失败。
   放在 afterEach 能覆盖全部用例；失败原因里会标注是产品还是测试脚本。 */
test.afterEach(async ({ artifacts }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) return;
  const guard = artifacts.guard();
  if (!guard.product.length && !guard.test.length) return;
  const parts = [
    guardLine('产品自身报错', guard.product),
    guardLine('测试脚本报错', guard.test)
  ].filter(Boolean).join('；');
  throw new Error('[发布前自检] 页面出现未处理错误 → ' + parts);
});

export { expect };
