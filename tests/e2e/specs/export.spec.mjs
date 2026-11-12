import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { test, expect, readFixture } from '../support/fixtures.mjs';
import { importResource } from '../support/api.mjs';

const SECRET_MARKER = 'E2E_SECRET_MARKER_' + Date.now().toString(36);

function textEntries(zip) {
  const entries = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (/\.(html|css|js|json|yaml|yml|md|txt|xml|conf|toml|sh|ts|rs|go|properties|env)$/i.test(relativePath)) {
      entries.push({ path: relativePath, entry });
    }
  });
  return entries;
}

test('导出 Web 静态包：关键文件齐全、无外链资源、无密钥明文', async ({ page, request, tempSite, artifacts }, testInfo) => {
  test.setTimeout(180_000);
  await importResource(request, tempSite.siteId, 'page', 'page.json', await readFixture('page.json'));

  await page.goto('/export.html?site=' + encodeURIComponent(tempSite.siteId));
  await expect(page.locator('[data-status-text]')).toContainText('已加载站点');

  await page.locator('[data-next]').click();
  await expect(page.locator('[data-step="2"]')).toBeVisible();
  await page.locator('[data-next]').click();

  await expect(page.locator('[data-step="3"]')).toBeVisible();
  await page.locator('[data-db-driver]').selectOption('mysql');
  await expect(page.locator('[data-db-fields]')).toBeVisible();
  await page.locator('[data-db-host]').fill('127.0.0.1');
  await page.locator('[data-db-port]').fill('3306');
  await page.locator('[data-db-name]').fill('e2e_demo');
  await page.locator('[data-db-user]').fill('e2e_user');
  await page.locator('[data-db-password]').fill(SECRET_MARKER);
  await page.locator('[data-config-save]').click();
  await expect(page.locator('[data-config-status]')).toContainText('已保存');

  await page.locator('[data-next]').click();
  await expect(page.locator('[data-step="4"]')).toBeVisible();

  await page.locator('[data-start-btn]').click();
  await expect(page.locator('[data-result]')).toBeVisible({ timeout: 150_000 });
  await expect(page.locator('[data-result-badge]')).toHaveText('成功');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-download]').click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath('artifact.zip');
  await download.saveAs(zipPath);

  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const names = Object.keys(zip.files);

  const required = [
    'web/index.html',
    'web/e2e-canvas.html',
    'web/assets/css/site.css',
    'web/assets/js/site.js',
    'artifact-manifest.json'
  ];
  for (const file of required) {
    expect(names, '导出包应包含 ' + file).toContain(file);
  }

  const manifest = JSON.parse(await zip.file('artifact-manifest.json').async('string'));
  expect(manifest.target).toBe('web-static');
  const checks = new Map((manifest.checks || []).map((item) => [item.id, item.status]));
  expect(checks.get('offline-external'), '导出包外链检查应通过').toBe('pass');
  expect(checks.get('secrets-scan'), '导出包密钥扫描应通过').toBe('pass');

  const entries = textEntries(zip);
  const externalHits = [];
  const secretHits = [];
  for (const item of entries) {
    const content = await item.entry.async('string');
    if (content.includes(SECRET_MARKER)) secretHits.push(item.path);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) secretHits.push(item.path);
    if (/<(?:script|link|img|iframe|source|video|audio)[^>]+(?:src|href)="https?:\/\//i.test(content) ||
        /url\(\s*['"]?https?:\/\//i.test(content) ||
        /@import\s+(?:url\()?['"]?https?:\/\//i.test(content)) {
      externalHits.push(item.path);
    }
  }
  expect(externalHits, '导出包不应引用外链资源：' + externalHits.join(', ')).toEqual([]);
  expect(secretHits, '导出包不应出现密钥明文：' + secretHits.join(', ')).toEqual([]);

  expect(artifacts.unexpectedConsoleErrors(), '导出向导不应有控制台错误').toEqual([]);
  expect(artifacts.pageErrors, '导出向导不应有未捕获异常').toEqual([]);
});
