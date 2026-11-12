import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { expect } from '@playwright/test';

/** 打开导出向导并等到第 1 步就绪。 */
export async function openExportWizard(page, siteId) {
  await page.goto('/export.html?site=' + encodeURIComponent(siteId));
  await expect(page.locator('[data-step="1"]')).toBeVisible();
  await expect(page.locator('[data-target][value="web-static"]')).toBeVisible();
}

/** 选择导出目标（web-static / tauri-desktop）。 */
export async function chooseTarget(page, target) {
  await page.locator('[data-target][value="' + target + '"]').check();
}

/** 点「下一步」，等待指定步骤出现。 */
export async function nextStep(page, step) {
  await page.locator('[data-next]').click();
  await expect(page.locator('[data-step="' + step + '"]')).toBeVisible();
}

/** 走到第 step 步（1 起）；从任意当前步骤出发，只点当前可见面板的“下一步”。 */
export async function goToStep(page, step) {
  const panels = page.locator('[data-step]:visible');
  const current = Number(await panels.first().getAttribute('data-step'));
  for (let s = current; s < step; s += 1) await page.locator('[data-next]').click();
  await expect(page.locator('[data-step="' + step + '"]')).toBeVisible();
}

/** 第 2 步：页面范围。scope 为 all / selected。 */
export async function chooseScope(page, scope, pageIds) {
  await page.locator('[data-scope][value="' + scope + '"]').check();
  if (scope !== 'selected') return;
  const picker = page.locator('[data-page-picker]');
  await expect(picker).toBeVisible();
  const boxes = page.locator('[data-page-check]');
  const count = await boxes.count();
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    const id = await box.getAttribute('value');
    if (pageIds.includes(id)) await box.check();
    else await box.uncheck();
  }
}

/** 第 2 步：Tauri 桌面配置。 */
export async function fillDesktop(page, config) {
  await expect(page.locator('[data-tauri-fields]')).toBeVisible();
  /* 站点导出配置是异步拉取的，拉到后会把桌面字段重填成默认值（应用名默认取站点名）。
     先等默认值落定再输入，避免刚填的内容被迟到的配置覆盖。 */
  const product = page.locator('[data-dt-product]');
  await expect(product, '桌面配置默认值应已就绪').not.toHaveValue('', { timeout: 15_000 });
  await product.fill(config.productName);
  await expect(product).toHaveValue(config.productName);
  await page.locator('[data-dt-identifier]').fill(config.identifier);
  await page.locator('[data-dt-version]').fill(config.version);
  await page.locator('[data-dt-width]').fill(String(config.width));
  await page.locator('[data-dt-height]').fill(String(config.height));
  await page.locator('[data-dt-min-width]').fill(String(config.minWidth));
  await page.locator('[data-dt-min-height]').fill(String(config.minHeight));
  await page.locator('[data-dt-protocol]').selectOption(config.protocol || 'https');
  await page.locator('[data-dt-https-mode]').selectOption(config.httpsMode || 'generated');
}

/** 第 2 步：打开/关闭自动更新并填写地址与公钥。 */
export async function configureUpdate(page, update) {
  const toggle = page.locator('[data-dt-update]');
  /* 复选框视觉上是开关，input 本身被样式隐藏且不在视口内；直接切换状态并触发 change。 */
  await toggle.evaluate((el, active) => {
    if (el.checked === active) return;
    el.checked = active;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, update.active);
  if (!update.active) {
    await expect(page.locator('[data-dt-update-fields]')).toBeHidden();
    return;
  }
  await expect(page.locator('[data-dt-update-fields]')).toBeVisible();
  if (update.endpoint) await page.locator('[data-dt-endpoint]').fill(update.endpoint);
  if (update.pubkey) await page.locator('[data-dt-pubkey]').fill(update.pubkey);
}

/** 第 3 步：选择后端语言（none / rust / node / go）。 */
export async function chooseBackend(page, language) {
  await page.locator('[data-backend][value="' + language + '"]').check();
}

/** 第 4 步：点开始导出，返回结果状态。 */
export async function startExport(page) {
  await page.locator('[data-start-btn]').click();
  /* 成功时展示 [data-result]；失败时只展示 [data-failures] / 进度文案，结果卡片保持隐藏。 */
  await page.waitForFunction(() => {
    const result = document.querySelector('[data-result]');
    const failures = document.querySelector('[data-failures]');
    return (result && !result.hidden) || (failures && !failures.hidden);
  }, null, { timeout: 60000 });
  const result = page.locator('[data-result]');
  if (await result.isVisible()) {
    return (await page.locator('[data-result-badge]').innerText()).trim();
  }
  return '失败';
}

/** 点开始导出，等待前端校验/提交失败的提示，返回提示文案。 */
export async function startExportExpectError(page, contains) {
  await page.locator('[data-start-btn]').click();
  const toast = page.locator('.lc-toast.is-error', contains ? { hasText: contains } : {});
  await expect(toast, '校验失败应给出可读提示').toBeVisible({ timeout: 10000 });
  return (await toast.innerText()).trim();
}

/** 开始导出并断言成功，返回下载到测试产物的 zip 路径。 */
export async function exportAndDownload(page, testInfo, fileName) {
  await goToStep(page, 4);
  const badge = await startExport(page);
  expect(badge, '导出应成功（失败信息见 [data-failures]）').toBe('成功');
  const downloadLink = page.locator('[data-download]');
  await expect(downloadLink).toBeVisible();
  const target = testInfo.outputPath(fileName || 'artifact.zip');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadLink.click()
  ]);
  await download.saveAs(target);
  return target;
}

/** 解压 zip 到目录，返回全部条目名（不含目录项）。 */
export async function unzipArtifact(zipPath, destDir) {
  const buffer = await fs.readFile(zipPath);
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  for (const name of names) {
    if (name.includes('..')) throw new Error('导出包内含非法路径：' + name);
    const output = path.join(destDir, name);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, await zip.files[name].async('nodebuffer'));
  }
  return names;
}

/** 读取解压后的文本文件。 */
export function readExtracted(destDir, relativePath) {
  return fs.readFile(path.join(destDir, relativePath), 'utf8');
}

/** 用 file:// 打开解压后的页面（离真实用户双击最近的方式）。 */
export async function openLocalPage(page, destDir, relativePath) {
  const file = path.join(destDir, relativePath);
  await fs.access(file);
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  return file;
}
