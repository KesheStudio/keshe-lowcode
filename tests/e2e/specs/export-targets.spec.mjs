import { test, expect, readFixture } from '../support/fixtures.mjs';
import { importResource } from '../support/api.mjs';
import {
  chooseBackend,
  chooseScope,
  chooseTarget,
  configureUpdate,
  exportAndDownload,
  fillDesktop,
  nextStep,
  openExportWizard,
  readExtracted,
  unzipArtifact
} from '../support/export.mjs';

const DESKTOP = {
  productName: 'E2E 桌面端',
  identifier: 'com.e2e.lowcode.desktop',
  version: '0.1.0',
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 640,
  protocol: 'https',
  httpsMode: 'generated'
};

async function prepareSite(request, siteId) {
  await importResource(request, siteId, 'page', 'page.json', await readFixture('page.json'));
}

async function configureTauri(page, siteId, update) {
  await openExportWizard(page, siteId);
  await chooseTarget(page, 'tauri-desktop');
  await nextStep(page, 2);
  await fillDesktop(page, DESKTOP);
  await expect(page.locator('[data-dt-https-note]'), '自签证书应给出提示文案').toContainText('自签');
  await expect(page.locator('[data-dt-https-note]')).toContainText('不能用于真实用户');
  await configureUpdate(page, update);
  await nextStep(page, 3);
  await chooseBackend(page, 'none');
}

test('Tauri 桌面工程：产物结构、配置、证书提示与更新开关校验', async ({ page, request, tempSite, artifacts }, testInfo) => {
  await prepareSite(request, tempSite.siteId);

  /* 1. 更新开关关闭：导出成功，配置里不应出现 updater 插件。 */
  await configureTauri(page, tempSite.siteId, { active: false });
  const zip = await exportAndDownload(page, testInfo, 'tauri-off.zip');
  const offDir = testInfo.outputPath('tauri-off');
  const files = await unzipArtifact(zip, offDir);

  for (const required of [
    'web/index.html',
    'desktop/config/desktop.json',
    'desktop/src-tauri/tauri.conf.json',
    'desktop/src-tauri/desktop.runtime.json',
    'web/desktop-config.js',
    'artifact-manifest.json'
  ]) {
    expect(files, 'Tauri 产物应包含 ' + required).toContain(required);
  }

  const desktopConfig = JSON.parse(await readExtracted(offDir, 'desktop/config/desktop.json'));
  expect(desktopConfig.productName).toBe(DESKTOP.productName);
  expect(desktopConfig.identifier).toBe(DESKTOP.identifier);
  expect(desktopConfig.version).toBe(DESKTOP.version);
  expect(desktopConfig.window.width).toBe(DESKTOP.width);
  expect(desktopConfig.window.height).toBe(DESKTOP.height);
  expect(desktopConfig.https.mode).toBe('generated');
  expect(desktopConfig.update.active, '默认更新开关应关闭').toBe(false);

  const tauriConf = JSON.parse(await readExtracted(offDir, 'desktop/src-tauri/tauri.conf.json'));
  expect(tauriConf.productName).toBe(DESKTOP.productName);
  expect(tauriConf.identifier).toBe(DESKTOP.identifier);
  expect(tauriConf.version).toBe(DESKTOP.version);
  expect(tauriConf.app.windows[0].width).toBe(DESKTOP.width);
  expect(tauriConf.plugins && tauriConf.plugins.updater, '更新关闭时不应生成 updater 插件配置').toBeFalsy();

  const runtimeConfig = JSON.parse(await readExtracted(offDir, 'desktop/src-tauri/desktop.runtime.json'));
  expect(runtimeConfig.updateActive, '运行时配置应反映更新关闭').toBe(false);

  const manifest = JSON.parse(await readExtracted(offDir, 'artifact-manifest.json'));
  expect(manifest.target).toBe('tauri-desktop');
  const note = (manifest.warnings || manifest.notes || []).find((item) => item.code === 'LC_W_TAURI_TEST_CERT');
  expect(note, 'manifest 应带自签证书提示').toBeTruthy();
  expect(note.message).toContain('不能用于真实用户');
  expect(note.message).toContain('自签测试证书');

  /* 2. 更新开关打开但配置不合法：向导在前置校验处拦住，并给出人话原因。 */
  await openExportWizard(page, tempSite.siteId);
  await chooseTarget(page, 'tauri-desktop');
  await nextStep(page, 2);
  await fillDesktop(page, DESKTOP);
  await configureUpdate(page, {
    active: true,
    endpoint: 'http://updates.example.com/latest.json',
    pubkey: 'RWQe2eDesktopUpdatePublicKeyPlaceholder'
  });
  await page.locator('[data-next]').click();
  await expect(page.locator('.lc-toast.is-error', { hasText: 'https' }).first(), '非 https 地址应被拦下')
    .toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-step="3"]'), '非法更新地址不应放行').toBeHidden();

  await page.locator('[data-dt-endpoint]').fill('https://updates.example.com/latest.json');
  await page.locator('[data-dt-pubkey]').fill('');
  await page.locator('[data-next]').click();
  await expect(page.locator('.lc-toast.is-error', { hasText: '公钥' }).first(), '缺签名公钥应被拦下')
    .toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-download]'), '校验未通过时不应出现下载入口').toBeHidden();

  /* 3. 补全 endpoint/pubkey：导出成功，updater 配置写入产物。 */
  await configureTauri(page, tempSite.siteId, {
    active: true,
    endpoint: 'https://updates.example.com/{{target}}/{{arch}}/{{current_version}}',
    pubkey: 'RWQe2eDesktopUpdatePublicKeyPlaceholder'
  });
  const zipOn = await exportAndDownload(page, testInfo, 'tauri-on.zip');
  const onDir = testInfo.outputPath('tauri-on');
  await unzipArtifact(zipOn, onDir);
  const onConfig = JSON.parse(await readExtracted(onDir, 'desktop/config/desktop.json'));
  expect(onConfig.update.active, '开启后配置应记录 active=true').toBe(true);
  expect(onConfig.update.endpoint).toContain('updates.example.com');
  expect(onConfig.update.pubkey).toBe('RWQe2eDesktopUpdatePublicKeyPlaceholder');
  const onTauri = JSON.parse(await readExtracted(onDir, 'desktop/src-tauri/tauri.conf.json'));
  expect(onTauri.plugins && onTauri.plugins.updater, '开启后应写入 updater 插件配置').toBeTruthy();
  expect(onTauri.plugins.updater.pubkey).toBe('RWQe2eDesktopUpdatePublicKeyPlaceholder');
  expect(onTauri.plugins.updater.endpoints[0]).toContain('updates.example.com');

  expect(artifacts.unexpectedConsoleErrors(), '导出向导不应报控制台错误').toEqual([]);
});

test('选定页面导出：只导出所选页，并生成入口跳转页', async ({ page, request, tempSite, artifacts }, testInfo) => {
  await prepareSite(request, tempSite.siteId);

  await openExportWizard(page, tempSite.siteId);
  await chooseTarget(page, 'web-static');
  await nextStep(page, 2);
  await chooseScope(page, 'selected', ['e2e-canvas']);
  await nextStep(page, 3);
  await chooseBackend(page, 'none');
  const zip = await exportAndDownload(page, testInfo, 'selected.zip');
  const outDir = testInfo.outputPath('selected');
  const files = await unzipArtifact(zip, outDir);

  expect(files, '应导出所选页面').toContain('web/e2e-canvas.html');
  expect(files, '选中页不含 index 时应生成入口跳转页').toContain('web/index.html');
  expect(files, '未选中的首页不应被导出').not.toContain('web/home.html');

  const shim = await readExtracted(outDir, 'web/index.html');
  expect(shim).toContain('e2e-canvas.html');
  expect(shim.toLowerCase()).toContain('http-equiv="refresh"');

  const manifest = JSON.parse(await readExtracted(outDir, 'artifact-manifest.json'));
  const shimNote = (manifest.warnings || manifest.notes || []).find((item) => item.code === 'LC_W_SCOPE_ENTRY_SHIM');
  expect(shimNote, 'manifest 应记录入口跳转页').toBeTruthy();

  expect(artifacts.unexpectedConsoleErrors(), '选定页面导出不应报控制台错误').toEqual([]);
});
