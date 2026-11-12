import fs from 'node:fs/promises';
import { test, expect, fixturePath } from '../support/fixtures.mjs';
import { api, getPage, importResource, renderPage, writeSiteFile } from '../support/api.mjs';
import { dragLayerRow } from '../support/drag.mjs';
import {
  openExportWizard,
  chooseTarget,
  chooseScope,
  nextStep,
  exportAndDownload,
  unzipArtifact,
  readExtracted,
  openLocalPage
} from '../support/export.mjs';

const SOURCE_SEED = `
  window.LC = window.LC || {};
  window.LC.Render = window.LC.Render || {};
  window.LC.Render.dataSources = {
    'demo-range': {
      range: function () { return Promise.resolve({ min: 10, max: 90, step: 5 }); }
    }
  };
`;

function heading(id, text) {
  return { id, type: 'heading', level: 2, text };
}

function paragraph(id, md, extra) {
  return Object.assign({ id, type: 'paragraph', md }, extra || {});
}

function button(id, label, href) {
  return { id, type: 'button', label, href };
}

function dualPage(id, opts) {
  const o = opts || {};
  return {
    schemaVersion: 2,
    id,
    slug: id,
    path: id + '.html',
    title: o.title || '双端审计页面',
    nav: false,
    independentUi: true,
    article: o.article,
    layout: o.layout || { mode: 'flow' },
    size: o.size || {},
    blocks: o.blocks || [
      heading('d-head', '桌面端标题'),
      paragraph('d-body', '桌面端正文'),
      button('d-link', '跳到桌面端标题', '#d-head')
    ],
    blocksMobile: o.blocksMobile || [
      heading('m-head', '移动端标题'),
      paragraph('m-body', '移动端正文'),
      button('m-link', '跳到移动端标题', '#m-head')
    ]
  };
}

function legacyPage(id) {
  return {
    schemaVersion: 2,
    id,
    slug: id,
    path: id + '.html',
    title: '旧页面（无 independentUi）',
    nav: false,
    layout: { mode: 'flow' },
    blocks: [
      heading('legacy-head', '旧页面标题'),
      paragraph('legacy-body', '旧页面正文')
    ]
  };
}

function featurePage(id) {
  const bindings = [{ event: 'click', route: '/api/demo/binding', target: 'text' }];
  return dualPage(id, {
    title: '双端功能叠加',
    article: { tocTitle: '本文目录' },
    layout: { mode: 'free' },
    size: { maxWidth: '980px', maxHeight: '720px' },
    blocks: [
      Object.assign(heading('d-feat-head', '桌面端 · 功能页'), {
        pos: { x: 12, y: 12, w: '60%' }
      }),
      Object.assign(paragraph('d-bind', '桌面端绑定文本', { bindings }), {
        pos: { x: 12, y: 120, w: '70%' }
      }),
      {
        id: 'd-mmd',
        type: 'markdown',
        md: '```mermaid\nflowchart TD\n  A --> B\n```',
        pos: { x: 12, y: 220, w: '60%' }
      },
      {
        id: 'd-slide',
        type: 'ui-slider',
        pos: { x: 12, y: 420, w: '60%' },
        props: {
          label: '桌面滑块', datasource: 'demo-range', sourceMode: 'range', value: 40
        },
        overrides: {
          html: '<div class="e2e-inst-override">桌面实例覆盖</div>',
          css: '.e2e-inst-override { color: rgb(179, 38, 30); }'
        }
      },
      {
        id: 'd-src',
        type: 'ui-slider',
        pos: { x: 12, y: 520, w: '60%' },
        props: { label: '桌面数据源滑块', datasource: 'demo-range', sourceMode: 'range', value: 40 }
      }
    ],
    blocksMobile: [
      Object.assign(heading('m-feat-head', '移动端 · 功能页'), {
        pos: { x: 8, y: 8, w: '80%' }
      }),
      Object.assign(paragraph('m-bind', '移动端绑定文本', { bindings }), {
        pos: { x: 8, y: 90, w: '90%' }
      }),
      {
        id: 'm-mmd',
        type: 'markdown',
        md: '```mermaid\nflowchart TD\n  C --> D\n```',
        pos: { x: 8, y: 200, w: '80%' }
      },
      {
        id: 'm-slide',
        type: 'ui-slider',
        pos: { x: 8, y: 420, w: '80%' },
        props: {
          label: '移动滑块', datasource: 'demo-range', sourceMode: 'range', value: 50
        },
        overrides: {
          html: '<div class="e2e-inst-override">移动实例覆盖</div>',
          css: '.e2e-inst-override { color: rgb(20, 92, 62); }'
        }
      },
      {
        id: 'm-src',
        type: 'ui-slider',
        pos: { x: 8, y: 520, w: '80%' },
        props: { label: '移动数据源滑块', datasource: 'demo-range', sourceMode: 'range', value: 30 }
      }
    ]
  });
}

function items(page) {
  return page.locator('[data-layer-tree] .lc-tree-item');
}

async function waitSaved(page) {
  await expect(page.locator('[data-save-state]')).toHaveText('已保存', { timeout: 12000 });
}

async function switchEnd(page, end) {
  const btn = page.locator('[data-ui-end-nav-btn="' + end + '"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toHaveClass(/is-active/);
}

async function deselect(page) {
  const frame = page.frameLocator('[data-canvas]');
  const body = frame.locator('body');
  const box = await body.boundingBox();
  /* 切到移动端后画布只有 390px 宽，区块铺满整行；只有底部留白能真正取消选中。 */
  await body.click({ position: { x: Math.round(box.width / 2), y: Math.max(2, box.height - 10) } });
  /* 页面属性面板出现即代表已取消选中；双端开关关闭时没有切端按钮，不能用它判断。 */
  await expect(page.locator('[data-page-independent-ui]')).toBeVisible();
}

async function editText(page, layerText, value) {
  await page.locator('[data-layer-tree] .lc-tree-item').filter({ hasText: layerText }).first().click();
  const input = page.locator('[data-inspector] [data-field-path="text"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.evaluate((el) => el.blur());
  await expect(page.frameLocator('[data-canvas]').locator('body')).toContainText(value, {
    timeout: 10000
  });
}

function uniqueIds(pageData) {
  const ids = [];
  const walk = (blocks) => {
    (blocks || []).forEach((block) => {
      if (block.id) ids.push(block.id);
      walk(block.blocks);
    });
  };
  walk(pageData.blocks);
  walk(pageData.blocksMobile);
  return ids;
}

test('双端编辑：开关往返保数据、选中与会话隔离、历史不串端', async ({
  page,
  request,
  tempSite
}) => {
  test.setTimeout(120_000);
  await writeSiteFile(request, tempSite.siteId, 'pages/dual.json', JSON.stringify(dualPage('dual')));
  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) + '&page=dual');
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).first()).toContainText('桌面端标题');

  /* 桌面端先改一笔，再切移动端改一笔。 */
  await editText(page, '桌面端标题', '桌面端标题 · D1');
  await waitSaved(page);
  await switchEnd(page, 'mobile');
  await expect(items(page).first()).toContainText('移动端标题');
  await editText(page, '移动端标题', '移动端标题 · M1');
  await waitSaved(page);

  /* 移动端连续撤销：只回退移动端，桌面端 D1 不能跟着丢。 */
  await page.keyboard.press('Control+z');
  await expect(page.frameLocator('[data-canvas]').locator('body')).toContainText('移动端标题');
  await expect(items(page).first()).toContainText('移动端标题');
  await page.keyboard.press('Control+z');
  await switchEnd(page, 'desktop');
  await expect(page.frameLocator('[data-canvas]').locator('body')).toContainText('桌面端标题 · D1');
  await switchEnd(page, 'mobile');

  /* 移动端重做回 M1。 */
  await page.keyboard.press('Control+Shift+z');
  await expect(items(page).first()).toContainText('移动端标题 · M1');

  /* 桌面端撤销一次，只回退桌面端，移动端 M1 不能丢。 */
  await switchEnd(page, 'desktop');
  await page.keyboard.press('Control+z');
  await expect(items(page).first()).toContainText('桌面端标题');
  await switchEnd(page, 'mobile');
  await expect(items(page).first()).toContainText('移动端标题 · M1');

  /* 选中项按端记忆：切回来仍停在原来的区块，但不会按位置串到另一端。 */
  await switchEnd(page, 'desktop');
  await items(page).nth(1).click();
  await expect(items(page).nth(1)).toHaveClass(/is-active/);
  await switchEnd(page, 'mobile');
  await expect(items(page).first()).toHaveClass(/is-active/);
  await expect(items(page).nth(1)).not.toHaveClass(/is-active/);
  await editText(page, '移动端标题', '移动端标题 · M2');
  await switchEnd(page, 'desktop');
  await expect(items(page).nth(1)).toHaveClass(/is-active/);
  await switchEnd(page, 'mobile');
  await expect(items(page).first()).toHaveClass(/is-active/);
  await waitSaved(page);

  /* 未保存就切端：内容不能丢，也不能被另一端的历史覆盖。 */
  await editText(page, '移动端标题 · M2', '移动端标题 · M3');
  await switchEnd(page, 'desktop');
  await switchEnd(page, 'mobile');
  await expect(items(page).first()).toContainText('移动端标题 · M3');
  await editText(page, '移动端标题 · M3', '移动端标题 · M2');
  await waitSaved(page);

  /* 关闭开关：桌面端可编辑，移动端数据保留但不渲染；再次开启不能被桌面端覆盖。 */
  await deselect(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-page-independent-ui]').uncheck();
  await expect(page.locator('[data-ui-end-nav-btn="desktop"]')).toBeHidden();
  await expect(page.frameLocator('[data-canvas]').locator('body')).toContainText('桌面端标题');
  await expect(page.frameLocator('[data-canvas]').locator('body')).not.toContainText('移动端正文');
  await editText(page, '桌面端标题', '桌面端标题 · 关闭态改');
  await waitSaved(page);
  await deselect(page);
  await page.locator('[data-page-independent-ui]').check();
  await switchEnd(page, 'mobile');
  await expect(items(page).first()).toContainText('移动端标题 · M2');

  for (let i = 0; i < 3; i += 1) {
    await switchEnd(page, 'desktop');
    await deselect(page);
    await page.locator('[data-page-independent-ui]').uncheck();
    await expect(page.frameLocator('[data-canvas]').locator('body')).not.toContainText('移动端正文');
    await page.locator('[data-page-independent-ui]').check();
    await switchEnd(page, 'mobile');
    await expect(items(page).first()).toContainText('移动端标题 · M2');
  }
  await waitSaved(page);

  const saved = await getPage(request, tempSite.siteId, 'dual');
  expect(saved.page.blocks[0].text).toBe('桌面端标题 · 关闭态改');
  expect(saved.page.blocksMobile[0].text).toBe('移动端标题 · M2');
});

test('复制布局到另一端：取消不改、覆盖后 id 唯一、锚点不串端', async ({
  page,
  request,
  tempSite
}) => {
  test.setTimeout(120_000);
  const data = dualPage('dual-copy');
  data.article = { tocTitle: '本文目录' };
  data.blocks[0].text = '桌面端原标题';
  /* 自定义 JS/CSS 里写死桌面标题 id，复制到另一端时必须跟着重映射。 */
  data.blocks[0].overrides = {
    js: 'document.querySelector("#d-head").dataset.copied = 1;',
    css: '#d-head { color: rgb(1, 2, 3); }'
  };
  data.blocksMobile[0].text = '移动端原标题';
  await writeSiteFile(request, tempSite.siteId, 'pages/dual-copy.json', JSON.stringify(data));
  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) + '&page=dual-copy');
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await expect(items(page)).toHaveCount(3);

  /* 取消：弹窗选“取消”后两端都不能动。 */
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('[data-ui-copy]').click();
  await expect(page.frameLocator('[data-canvas]').locator('body')).toContainText('桌面端原标题');
  await switchEnd(page, 'mobile');
  await expect(items(page).first()).toContainText('移动端原标题');
  await switchEnd(page, 'desktop');

  /* 确认：移动端被桌面端覆盖，但 id 全部重建，锚点指向移动端自己的标题。 */
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-ui-copy]').click();
  await expect(page.locator('[data-ui-end-nav-btn="mobile"]')).toHaveClass(/is-active/);
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).first()).toContainText('桌面端原标题');
  await expect(page.locator('.lc-toast.is-warn')).toContainText('自定义 JS/CSS');
  await waitSaved(page);

  const saved = await getPage(request, tempSite.siteId, 'dual-copy');
  const ids = uniqueIds(saved.page);
  expect(new Set(ids).size).toBe(ids.length);
  const mobileHead = saved.page.blocksMobile.find((block) => block.type === 'heading');
  expect(mobileHead.id).not.toBe('d-head');
  const mobileButton = saved.page.blocksMobile.find((block) => block.type === 'button');
  expect(mobileButton.href).toBe('#' + mobileHead.id);
  /* 写进 overrides 的旧 id 也要换成移动端自己的 id。 */
  expect(mobileHead.overrides.js).toContain('#' + mobileHead.id);
  expect(mobileHead.overrides.js).not.toContain('d-head');
  expect(mobileHead.overrides.css).toContain('#' + mobileHead.id);

  const frame = page.frameLocator('[data-canvas]');
  const href = await frame.locator('a', { hasText: '跳到桌面端标题' }).getAttribute('href');
  expect(href).toBe('#' + mobileHead.id);
  expect(saved.page.blocks.find((block) => block.type === 'heading').id).toBe('d-head');

  /* 复制后文章目录：渲染接口一次只渲染一端（双端用 uiEnd 指定），分两次取两端产物。
     双端同页里移动端 id 的 m- 前缀由导出链路负责，这里验证锚点各跳本端标题、不串端。 */
  const desktopHead = saved.page.blocks.find((block) => block.type === 'heading');
  const deskRender = await renderPage(request, tempSite.siteId, saved.page, 'ink-green', 'light', 'desktop');
  const deskHrefs = (deskRender.document.match(new RegExp('href="#' + desktopHead.id + '"', 'g')) || []).length;
  expect(deskHrefs, '桌面锚点只允许按钮与目录各一条').toBe(2);
  expect(deskRender.document, '桌面端不应串移动端锚点').not.toContain('href="#' + mobileHead.id + '"');

  const mobRender = await renderPage(request, tempSite.siteId, saved.page, 'ink-green', 'light', 'mobile');
  expect((mobRender.document.match(new RegExp('href="#' + mobileHead.id + '"', 'g')) || []).length,
    '移动端锚点只允许按钮与目录各一条').toBe(2);
  expect(mobRender.document, '移动端不应串桌面端锚点').not.toContain('href="#' + desktopHead.id + '"');

  /* 复制这个动作本身也能在移动端撤销，桌面端源布局保持不变。 */
  await page.keyboard.press('Control+z');
  await expect(items(page).first()).toContainText('移动端原标题');
  await switchEnd(page, 'desktop');
  await expect(items(page).first()).toContainText('桌面端原标题');
});

test('导出产物：断点边界、关闭残留、双端功能叠加', async ({
  page,
  request,
  tempSite,
  artifacts
}, testInfo) => {
  test.setTimeout(240_000);
  await writeSiteFile(request, tempSite.siteId, 'pages/dual-export.json',
    JSON.stringify(featurePage('dual-export')));

  await openExportWizard(page, tempSite.siteId);
  await chooseTarget(page, 'web-static');
  await chooseScope(page, 'all');
  const zip = await exportAndDownload(page, testInfo, 'dual-export.zip');
  const dir = testInfo.outputPath('dual-export');
  await unzipArtifact(zip, dir);
  const html = await readExtracted(dir, 'web/dual-export.html');
  const siteCss = await readExtracted(dir, 'web/assets/css/site.css');

  expect(html).toContain('data-lc-ui-ends');
  expect(html).toContain('data-lc-independent-ui="true"');
  expect(html).toContain('桌面端 · 功能页');
  expect(html).toContain('移动端 · 功能页');
  expect(html).toContain('data-lc-page-max-width="980px"');
  expect(html).toContain('data-lc-page-max-height="720px"');
  expect((html.match(/data-lc-layout="free"/g) || []).length).toBe(1);
  expect(siteCss).toContain('[data-lc-instance="d-slide"]');
  expect(siteCss).toContain('[data-lc-instance="m-slide"]');

  await page.addInitScript(SOURCE_SEED);
  await openLocalPage(page, dir, 'web/dual-export.html');
  /* 主题是页面级设置：产物必须带明确的亮/暗模式，两端都继承同一份。 */
  const mode = await page.locator('.lc-page').getAttribute('data-lc-mode');
  expect(['light', 'dark'], '产物应带明确的亮/暗模式').toContain(mode);
  await expect(page.locator('.lc-page')).toHaveAttribute('data-lc-theme', /.+/);
  /* 换暗色再渲染一次：模式落到页面属性上（双端结构在导出产物里已单独验证）。 */
  const dark = await renderPage(request, tempSite.siteId, featurePage('dual-export'), 'ink-green', 'dark');
  expect(dark.document).toContain('data-lc-mode="dark"');
  /* 文章目录：两端各生成一份，锚点只指向本端标题（移动端带 m- 前缀）。 */
  const deskToc = page.locator('.lc-ui-end[data-lc-ui-end="desktop"] .lc-toc-link');
  const mobToc = page.locator('.lc-ui-end[data-lc-ui-end="mobile"] .lc-toc-link');
  await expect(deskToc).toHaveCount(1);
  await expect(mobToc).toHaveCount(1);
  const deskHref = await deskToc.first().getAttribute('href');
  const mobHref = await mobToc.first().getAttribute('href');
  expect(deskHref, '桌面目录指向桌面标题').toBe('#d-feat-head');
  expect(mobHref.startsWith('#m-'), '移动端目录锚点带 m- 前缀').toBe(true);
  await expect(page.locator('#' + mobHref.slice(1))).toHaveCount(1);

  /* 自由定位在两端都生效：页面级 layout 只有一份，两端各有一棵 lc-free 区块树。 */
  await expect(page.locator('.lc-page')).toHaveAttribute('data-lc-layout', 'free');
  await expect(page.locator('.lc-ui-end .lc-blocks')).toHaveCount(2);
  await expect(page.locator('.lc-ui-end[data-lc-ui-end="desktop"] .lc-blocks')).toHaveClass(/lc-free/);
  await expect(page.locator('.lc-ui-end[data-lc-ui-end="mobile"] .lc-blocks')).toHaveClass(/lc-free/);
  await expect(page.locator('[data-lc-bindings]')).toHaveCount(2);
  await expect(page.locator('[data-lc-mermaid="true"]')).toHaveCount(2);
  await expect(page.locator('[data-lc-instance="d-slide"]')).toHaveCount(1);
  await expect(page.locator('[data-lc-instance="m-slide"]')).toHaveCount(1);
  /* 实例覆盖用 d-slide/m-slide；滑块数据源另用未覆盖的 d-src/m-src。 */
  await expect(page.locator('[data-lc-block="d-src"] [data-lc-ui="ui-slider"]'))
    .toHaveAttribute('data-lc-state', 'ready');
  await expect(page.locator('[data-lc-block="m-src"] [data-lc-ui="ui-slider"]'))
    .toHaveAttribute('data-lc-state', 'ready');
  await expect(page.locator('[data-lc-block="d-src"] input[data-lc-slider-range]'))
    .toHaveAttribute('min', '10');
  await expect(page.locator('[data-lc-block="m-src"] input[data-lc-slider-range]'))
    .toHaveAttribute('max', '90');
  await expect(page.locator('[data-lc-mermaid="true"]')).toHaveCount(2);
  await expect(page.locator('.e2e-inst-override')).toHaveCount(2);

  for (const [width, expected] of [[1200, 'desktop'], [901, 'desktop'], [900, 'mobile'],
    [800, 'mobile'], [390, 'mobile']]) {
    await page.setViewportSize({ width, height: 900 });
    const visible = await page.locator('.lc-ui-end').evaluateAll((nodes) =>
      nodes.filter((node) => getComputedStyle(node).display !== 'none').length);
    expect(visible, '宽度 ' + width + 'px 应恰好显示一端').toBe(1);
    await expect(page.locator('.lc-ui-end[data-lc-ui-end="' + expected + '"]')).toBeVisible();
    await expect(page.locator('.lc-ui-end[data-lc-ui-end="' +
      (expected === 'desktop' ? 'mobile' : 'desktop') + '"]')).toBeHidden();
    if (expected === 'desktop') {
      await expect(page.locator('.lc-ui-end[data-lc-ui-end="desktop"] [data-lc-block="d-feat-head"]'))
        .toBeVisible();
      await expect(page.locator('.lc-ui-end[data-lc-ui-end="mobile"] [data-lc-block="m-feat-head"]'))
        .toBeHidden();
    } else {
      await expect(page.locator('.lc-ui-end[data-lc-ui-end="mobile"] [data-lc-block="m-feat-head"]'))
        .toBeVisible();
      await expect(page.locator('.lc-ui-end[data-lc-ui-end="desktop"] [data-lc-block="d-feat-head"]'))
        .toBeHidden();
    }
  }

  /* 900~901 的分数视口：用 iframe 制造 900.5px 宽度，不能两端同时出现。 */
  await page.setViewportSize({ width: 1200, height: 900 });
  const fractional = await page.evaluate(async (cssText) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:900.5px;height:400px;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head></head><body>' +
      '<div class="lc-ui-ends">' +
      '<div class="lc-ui-end" data-lc-ui-end="desktop">D</div>' +
      '<div class="lc-ui-end" data-lc-ui-end="mobile">M</div>' +
      '</div></body></html>');
    doc.close();
    const style = doc.createElement('style');
    style.textContent = cssText;
    doc.head.appendChild(style);
    const visible = Array.from(doc.querySelectorAll('.lc-ui-end'))
      .filter((node) => getComputedStyle(node).display !== 'none');
    return { width: frame.contentWindow.innerWidth, visible: visible.length };
  }, siteCss);
  expect(fractional.visible, '900.5px 视口只能显示一端').toBe(1);

  /* 关闭开关后再导出：不能有双端包装，也不能出现移动端文案。 */
  const offPage = featurePage('dual-export');
  offPage.independentUi = false;
  await writeSiteFile(request, tempSite.siteId, 'pages/dual-export.json', JSON.stringify(offPage));
  await openExportWizard(page, tempSite.siteId);
  await chooseTarget(page, 'web-static');
  await chooseScope(page, 'all');
  const zipOff = await exportAndDownload(page, testInfo, 'dual-export-off.zip');
  const dirOff = testInfo.outputPath('dual-export-off');
  await unzipArtifact(zipOff, dirOff);
  const htmlOff = await readExtracted(dirOff, 'web/dual-export.html');
  expect(htmlOff).not.toContain('data-lc-ui-ends');
  expect(htmlOff).not.toContain('移动端 · 功能页');
  expect(htmlOff).not.toContain('m-feat-head');

  await openLocalPage(page, dirOff, 'web/dual-export.html');
  await expect(page.locator('.lc-ui-end')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator('body')).toContainText('桌面端 · 功能页');
  await expect(page.locator('[data-lc-block="d-feat-head"]')).toHaveCount(1);
  /* 同一区块不能渲染两次：按区块节点数判断（文章目录也会出现标题文案，不能按文字数）。 */
  const count = await page.locator('[data-lc-block="d-feat-head"]').count();
  expect(count, '同一内容不能重复渲染').toBe(1);
});

test('入口兼容：页面 JSON 导入、跨页粘贴、起步模板', async ({
  page,
  request,
  tempSite
}, testInfo) => {
  test.setTimeout(120_000);
  /* 旧页面：没有 independentUi 字段，导入后不凭空多出双端数据。 */
  const legacy = legacyPage('legacy-import');
  const legacyRes = await importResource(request, tempSite.siteId, 'page',
    'legacy.page.json', JSON.stringify(legacy));
  const importedLegacy = await getPage(request, tempSite.siteId, legacyRes.id);
  expect(importedLegacy.page.independentUi).toBeUndefined();
  expect(importedLegacy.page.blocksMobile).toBeUndefined();

  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) +
    '&page=' + encodeURIComponent(legacyRes.id));
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await expect(page.locator('[data-page-independent-ui]')).not.toBeChecked();
  await expect(items(page)).toHaveCount(2);
  await page.locator('[data-page-independent-ui]').check();
  await switchEnd(page, 'mobile');
  await expect(items(page)).toHaveCount(2);
  await expect(page.frameLocator('[data-canvas]').locator('body')).toContainText('旧页面标题');
  await waitSaved(page);

  /* 双端页面导入：两端重复 id 要被拆开，移动端锚点跟随自己的新区块。 */
  const dup = dualPage('dual-import');
  dup.blocksMobile[0].id = 'd-head';
  dup.blocksMobile[2].href = '#d-head';
  /* 页面级设置也要随模板/页面 JSON 一起走。 */
  dup.size = { maxWidth: '960px', maxHeight: '640px' };
  dup.article = { tocTitle: '模板目录' };
  /* 导入改名时，自定义 JS 里写死的旧 id 也要替换，并给出检查提示。 */
  dup.blocksMobile[0].overrides = { js: 'document.querySelector("#d-head").focus();' };
  const dualRes = await importResource(request, tempSite.siteId, 'page',
    'dual.page.json', JSON.stringify(dup));
  const importedDual = await getPage(request, tempSite.siteId, dualRes.id);
  const ids = uniqueIds(importedDual.page);
  expect(new Set(ids).size).toBe(ids.length);
  const importedMobileHead = importedDual.page.blocksMobile.find((block) => block.type === 'heading');
  expect(importedMobileHead.id).not.toBe('d-head');
  expect(importedDual.page.blocksMobile.find((block) => block.type === 'button').href)
    .toBe('#' + importedMobileHead.id);
  expect(importedDual.page.blocksMobile[0].overrides.js).toContain('#' + importedMobileHead.id);
  expect(dualRes.notices.join(''), '自定义代码改 id 后要提示用户检查').toContain('自定义 JS/CSS');

  /* 页面 JSON 导出再导入（开关开启态）：双端字段与移动端内容必须完整往返。 */
  const roundTrip = JSON.parse(JSON.stringify(importedDual.page));
  roundTrip.id = 'dual-roundtrip';
  roundTrip.slug = 'dual-roundtrip';
  roundTrip.path = 'dual-roundtrip.html';
  const roundRes = await importResource(request, tempSite.siteId, 'page',
    'dual-roundtrip.json', JSON.stringify(roundTrip));
  const roundPage = await getPage(request, tempSite.siteId, roundRes.id);
  expect(roundPage.page.independentUi).toBe(true);
  expect(roundPage.page.blocksMobile).toHaveLength(3);
  expect(roundPage.page.blocksMobile.some((block) => block.text === '移动端标题')).toBe(true);
  expect(roundPage.page.blocks.some((block) => block.text === '桌面端标题')).toBe(true);

  /* 页面列表在打开工作台时一次性拉取；重新加载才能看见刚导入的两页。 */
  await page.reload();
  await expect(page.locator('[data-page-list]')).toBeVisible();

  /* 跨页复制粘贴：从旧页面复制，粘到双端页面的移动端。 */
  await page.locator('[data-page-list] [data-page-id="' + legacyRes.id + '"]').click();
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await page.locator('[data-layer-tree] .lc-tree-item').first().click();
  await page.keyboard.press('Control+c');
  await page.locator('[data-page-list] [data-page-id="' + dualRes.id + '"]').click();
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await switchEnd(page, 'mobile');
  await page.keyboard.press('Control+v');
  await expect(items(page)).toHaveCount(4);
  await expect(items(page).last()).toContainText('旧页面标题');
  await waitSaved(page);
  const pasted = await getPage(request, tempSite.siteId, dualRes.id);
  expect(pasted.page.blocksMobile.some((block) => block.text === '旧页面标题' ||
    block.md === '旧页面正文')).toBe(true);
  const pastedIds = uniqueIds(pasted.page);
  expect(new Set(pastedIds).size).toBe(pastedIds.length);

  /* 关闭开关后再跨页粘贴：只进桌面端，移动端内容不被清空或改写。 */
  await switchEnd(page, 'desktop');
  await expect(items(page)).toHaveCount(3);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-page-independent-ui]').uncheck();
  await expect(items(page)).toHaveCount(3);
  await page.keyboard.press('Control+v');
  await expect(items(page)).toHaveCount(4);
  await expect(items(page).last()).toContainText('旧页面标题');
  await waitSaved(page);
  const offPasted = await getPage(request, tempSite.siteId, dualRes.id);
  expect(offPasted.page.blocks.some((block) => block.text === '旧页面标题')).toBe(true);
  expect(offPasted.page.blocksMobile, '关闭态粘贴不能动移动端').toHaveLength(4);
  await deselect(page);
  await page.locator('[data-page-independent-ui]').check();
  await switchEnd(page, 'mobile');
  await expect(items(page)).toHaveCount(4);
  await waitSaved(page);

  /* 双端页存成模板再套用（开关开启态）：移动端内容必须跟着模板走，不能被截断成单端。 */
  const savedTpl = await api(request, 'POST', '/api/sites/' + tempSite.siteId + '/templates',
    { kind: 'page', pageId: dualRes.id, name: '双端模板' });
  const applied = await api(request, 'POST', '/api/sites/' + tempSite.siteId +
    '/templates/' + savedTpl.template.id + '/apply', { mode: 'new', title: '双端模板页' });
  const appliedPage = applied.pages[0];
  expect(appliedPage.independentUi, '套用后仍应是双端页').toBe(true);
  expect(appliedPage.blocksMobile, '移动端区块要随模板保留').toHaveLength(4);
  expect(appliedPage.blocks, '桌面端区块也要保留').toHaveLength(4);
  expect(appliedPage.size, '页面限宽限高要随模板还原')
    .toEqual({ maxWidth: '960px', maxHeight: '640px' });
  expect(appliedPage.article.tocTitle, '文章目录设置要随模板还原').toBe('模板目录');

  /* 起步模板：套用生成的页面是旧页面形态，开启双端后照常克隆。 */
  await importResource(request, tempSite.siteId, 'template', 'template.json',
    await fs.readFile(fixturePath('template.json'), 'utf8'));
  await page.reload();
  await page.locator('[data-panel-tab="templates"]').click();
  await expect(page.locator('[data-template-list]')).toContainText('E2E 页面模板');
  await page.locator('[data-apply-template="e2e-template"]').click();
  await page.locator('[data-panel-tab="pages"]').click();
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');
  await expect(page.locator('[data-page-independent-ui]')).not.toBeChecked();
  await expect(items(page).first()).toContainText('模板生成的标题');
  await page.locator('[data-page-independent-ui]').check();
  await switchEnd(page, 'mobile');
  await expect(items(page)).toHaveCount(2);
  await expect(page.frameLocator('[data-canvas]').locator('body')).toContainText('模板生成的标题');

  /* 覆盖套用：页面级设置也要以模板为准，旧的单端残留要被替换。 */
  const overwritten = await api(request, 'POST', '/api/sites/' + tempSite.siteId +
    '/templates/' + savedTpl.template.id + '/apply',
    { mode: 'overwrite', pageId: 'legacy-import', confirm: true });
  expect(overwritten.pages[0].size.maxWidth).toBe('960px');
  expect(overwritten.pages[0].article.tocTitle).toBe('模板目录');
  expect(overwritten.pages[0].independentUi).toBe(true);
  expect(overwritten.pages[0].blocksMobile).toHaveLength(4);

  /* 旧页面（无 independentUi）导出：产物正常出内容，且没有双端包装或移动端泄漏。 */
  const plainLegacy = legacyPage('legacy-plain');
  plainLegacy.title = '旧页面导出';
  await writeSiteFile(request, tempSite.siteId, 'pages/legacy-plain.json',
    JSON.stringify(plainLegacy));
  await openExportWizard(page, tempSite.siteId);
  await chooseTarget(page, 'web-static');
  await nextStep(page, 2);
  await chooseScope(page, 'selected', ['legacy-plain']);
  const zipLegacy = await exportAndDownload(page, testInfo, 'legacy.zip');
  const dirLegacy = testInfo.outputPath('legacy');
  await unzipArtifact(zipLegacy, dirLegacy);
  const legacyHtml = await readExtracted(dirLegacy, 'web/legacy-plain.html');
  expect(legacyHtml).toContain('旧页面标题');
  expect(legacyHtml).not.toContain('data-lc-ui-ends');
  expect(legacyHtml).not.toContain('data-lc-ui-end');
  await openLocalPage(page, dirLegacy, 'web/legacy-plain.html');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toContainText('旧页面标题');
  await expect(page.locator('.lc-ui-end')).toHaveCount(0);
});

test('长页延迟渲染：移动端长度也计入阈值', async ({ page, request, tempSite }, testInfo) => {
  const longBlocks = [];
  for (let i = 0; i < 22; i += 1) longBlocks.push(paragraph('m-long-' + i, '移动端长页 ' + (i + 1)));
  const data = dualPage('dual-long', {
    blocks: [
      heading('d-long-1', '桌面一'),
      heading('d-long-2', '桌面二'),
      heading('d-long-3', '桌面三')
    ],
    blocksMobile: longBlocks
  });
  await writeSiteFile(request, tempSite.siteId, 'pages/dual-long.json', JSON.stringify(data));
  await openExportWizard(page, tempSite.siteId);
  await chooseTarget(page, 'web-static');
  await nextStep(page, 2);
  await chooseScope(page, 'selected', ['dual-long']);
  const zip = await exportAndDownload(page, testInfo, 'long.zip');
  const dir = testInfo.outputPath('long');
  await unzipArtifact(zip, dir);
  const html = await readExtracted(dir, 'web/dual-long.html');
  const body = html.slice(html.lastIndexOf('</style>'));
  /* 桌面 3 块本身不会触发；桌面 3 + 移动 22 共 25 块后，移动端 22 块应延迟 10 块。 */
  expect((body.match(/data-lc-defer="true"/g) || []).length, '移动端长页也要延迟渲染').toBe(10);
});

test('390 窄屏：移动端可切换、可选中、可改字段并保存生效', async ({
  page,
  request,
  tempSite
}) => {
  test.setTimeout(120_000);
  await writeSiteFile(request, tempSite.siteId, 'pages/dual-narrow.json',
    JSON.stringify(dualPage('dual-narrow')));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/builder.html?site=' + encodeURIComponent(tempSite.siteId) +
    '&page=dual-narrow');
  await expect(page.locator('[data-save-state]')).toHaveText('已保存');

  await page.locator('[data-toggle-inspector]').click();
  await page.locator('[data-ui-end-btn="mobile"]').click();
  await expect(page.locator('[data-ui-end-btn="mobile"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-ui-end-nav-btn="mobile"]')).toHaveClass(/is-active/);
  await page.locator('[data-toggle-inspector]').click();

  const frame = page.frameLocator('[data-canvas]');
  await expect(frame.locator('body')).toContainText('移动端标题');
  await expect(frame.locator('body')).not.toContainText('桌面端标题');
  await frame.locator('[data-lc-block]').filter({ hasText: '移动端标题' }).first().click();
  await page.locator('[data-toggle-inspector]').click();
  const input = page.locator('[data-inspector] [data-field-path="text"]');
  await expect(input).toBeVisible();
  await input.fill('窄屏编辑后的移动标题');
  await input.evaluate((el) => el.blur());
  await page.locator('[data-toggle-inspector]').click();
  await expect(frame.locator('body')).toContainText('窄屏编辑后的移动标题');
  await waitSaved(page);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, '编辑区不能出现横向滚动').toBeLessThanOrEqual(1);
  const saved = await getPage(request, tempSite.siteId, 'dual-narrow');
  expect(saved.page.blocksMobile[0].text).toBe('窄屏编辑后的移动标题');

  /* 390 下真实拖拽：打开侧栏抽屉，在图层树把第 2 块拖到第 1 块之前。 */
  await page.locator('[data-toggle-sidebar]').click();
  await expect(page.locator('[data-layer-tree]')).toBeVisible();
  await expect(page.locator('[data-layer-tree] .lc-tree-item')).toHaveCount(3);
  await dragLayerRow(page, '1', '0', 'before');
  await expect(page.locator('[data-layer-tree] .lc-tree-item').first()).toContainText('移动端正文');
  await waitSaved(page);
  const moved = await getPage(request, tempSite.siteId, 'dual-narrow');
  expect(moved.page.blocksMobile[0].type).toBe('paragraph');
  expect(moved.page.blocksMobile[1].text).toBe('窄屏编辑后的移动标题');
  expect(moved.page.blocks[0].text, '拖拽只影响移动端').toBe('桌面端标题');
  await page.locator('[data-toggle-sidebar]').click();
  await expect(page.locator('[data-toggle-sidebar]')).toHaveAttribute('aria-expanded', 'false');

  const overflowAfterDrag = await page.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth);
  expect(overflowAfterDrag, '拖拽后仍不能出现横向滚动').toBeLessThanOrEqual(1);
});
