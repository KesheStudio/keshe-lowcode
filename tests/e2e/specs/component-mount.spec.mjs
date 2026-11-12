import { test, expect } from '../support/fixtures.mjs';
import { PLATFORM_ROOT } from '../support/config.mjs';
import { startStaticServer } from '../support/static-server.mjs';

/* 内置组件的「真实挂载」检查。
   每个组件在自己的最小验收页（src/render/demo.html?page=…）里渲染一次，断言三件事：
   1. 渲染报告无区块错误（区块级失败只会写进 #report，不会抛异常，光靠全局守卫抓不到）；
   2. 关键子结构真的出现在 DOM 里（例如日期要能出日历面板、自动补全要能出建议列表）；
   3. 未捕获异常由 fixtures 的全局守卫兜底判失败。
   这样就不会再出现「手动输入能填值，所以看不出面板根本没渲染」的漏网。 */

let server;

test.beforeAll(async () => {
  server = await startStaticServer(PLATFORM_ROOT);
});

test.afterAll(async () => {
  if (server) await server.close();
});

async function openDemoPage(page, pageId) {
  await page.goto(server.base + '/src/render/demo.html?mode=light&page=' + pageId, { waitUntil: 'load' });
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('.demo-report-ok'), '渲染报告应无区块错误（有错时会列在 #report）')
    .toBeVisible({ timeout: 20_000 });
}

/* 只断言挂载数量，不要求可见：部分子结构默认隐藏（建议列表、遮罩、输入原件等）。 */
async function expectMounted(page, selectors) {
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    expect(count, selector + ' 应渲染到 DOM 里').toBeGreaterThanOrEqual(1);
  }
}

test('[组件挂载] 文本框：输入框、浮动标签与字数统计', async ({ page }) => {
  await openDemoPage(page, 'page-textfield');
  expect(await page.locator('[data-lc-textfield-input]').count(), '文本框应渲染多个实例').toBeGreaterThanOrEqual(3);
  await expectMounted(page, ['.lc-ui-textfield-float', '.lc-ui-textfield-count']);
  await expect(page.locator('[data-lc-block="tf-floating"]')).toBeVisible();
  await expect(page.locator('.lc-ui-textfield-count').first()).toHaveText(/\d+ \/ \d+/);
});

test('[组件挂载] 验证码：分格输入与整体复制', async ({ page }) => {
  await openDemoPage(page, 'page-otp');
  expect(await page.locator('[data-lc-otp-cell]').count(), '验证码应渲染出分格').toBeGreaterThanOrEqual(6);
  await expect(page.locator('[data-lc-block="otp-numeric"]')).toBeVisible();
  await expectMounted(page, ['[data-lc-otp-copy]']);
});

test('[组件挂载] 拖拽上传：投放区与文件输入', async ({ page }) => {
  await openDemoPage(page, 'page-upload');
  expect(await page.locator('[data-lc-upload]').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-lc-upload-zone]').first()).toBeVisible();
  await expectMounted(page, ['[data-lc-upload-input]', '[data-lc-upload-notice]']);
});

test('[组件挂载] 日期：日历面板能渲染并回填日期', async ({ page }) => {
  await openDemoPage(page, 'page-date');
  const block = page.locator('.lc-ui-date', { has: page.locator('[data-lc-date-toggle]:enabled') }).first();
  const toggle = block.locator('[data-lc-date-toggle]');
  await expect(toggle, '应有一个可用的日期选择器').toBeVisible();
  await toggle.click();

  /* 光断言输入框能填值不够：面板必须先真实渲染出来。 */
  const pop = block.locator('[data-lc-date-pop]');
  await expect(pop, '日历面板应真实渲染出来').toBeVisible();
  await expect(pop.locator('.lc-ui-date-cal-title'), '日历应显示年月标题').toHaveText(/\d{4} 年 \d+ 月/);
  await expect(pop.locator('.lc-ui-date-cal-weekday'), '日历应有七个星期表头').toHaveCount(7);
  const days = pop.locator('[data-lc-date-day]');
  expect(await days.count(), '日历至少要出一整月的日期').toBeGreaterThanOrEqual(28);

  const target = days.first();
  const iso = await target.getAttribute('data-lc-date-day');
  await target.click();
  await expect(block.locator('[data-lc-date-input]').first(), '点日期应回填到输入框').toHaveValue(iso);
});

test('[组件挂载] 滑块：轨道、读数与百分比', async ({ page }) => {
  await openDemoPage(page, 'page-slider');
  expect(await page.locator('[data-lc-slider-range]').count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator('[data-lc-slider-value]').first()).toHaveText(/%/);
});

test('[组件挂载] 自动补全：聚焦能展开建议列表并过滤', async ({ page }) => {
  await openDemoPage(page, 'page-autocomplete');
  const ac = page.locator('[data-lc-block="ac-local"]');
  await expect(ac).toBeVisible();
  await ac.locator('[data-lc-ac-input]').click();
  await expect(ac.locator('[data-lc-ac-list]'), '聚焦后建议列表应真实展开').toBeVisible();
  expect(await ac.locator('[data-lc-ac-value]').count(), '建议列表应有候选项').toBeGreaterThanOrEqual(1);

  await ac.locator('[data-lc-ac-input]').fill('上');
  await expect(ac.locator('[data-lc-ac-value]'), '输入后应过滤到一条').toHaveCount(1);
});

test('[组件挂载] 表单控件：下拉、单选多选、开关、数字、标签、级联与评分', async ({ page }) => {
  await openDemoPage(page, 'page-controls');
  await expectMounted(page, [
    '[data-lc-select]',
    '[data-lc-choices]',
    '[data-lc-switch-btn]',
    '[data-lc-number]',
    '[data-lc-textarea]',
    '[data-lc-tags]',
    '[data-lc-cascade-select]',
    '[data-lc-rating-input]'
  ]);
  await expect(page.locator('[data-lc-select]').first(), '下拉控件应可见可交互').toBeVisible();
});

test('[组件挂载] 数据图表：SVG 真实绘制（含异步数据源）', async ({ page }) => {
  await openDemoPage(page, 'page-charts');
  await expect(page.locator('[data-lc-chart-canvas]').first()).toBeVisible();
  await expect(page.locator('svg.lc-ui-chart-svg').first(), '图表 SVG 应真实绘制').toBeVisible({ timeout: 20_000 });
  expect(await page.locator('svg.lc-ui-chart-svg').count()).toBeGreaterThanOrEqual(3);
});

test('[组件挂载] 统计指标：卡片填上加载后的数据', async ({ page }) => {
  await openDemoPage(page, 'page-stats');
  const bodies = page.locator('[data-lc-stat-body]');
  await expect(bodies.first()).toBeVisible();
  expect(await bodies.count()).toBeGreaterThanOrEqual(5);
  await expect.poll(async () => (await bodies.first().innerText()).trim(), {
    message: '统计卡片应填上加载后的数据（不能只剩空壳）'
  }).not.toBe('');
});

test('[组件挂载] 表格与内容块：表格行、页签、轮播、时间线、代码块', async ({ page }) => {
  await openDemoPage(page, 'page-components');
  await expect(page.locator('.lc-ui-table-el').first(), '表格应渲染').toBeVisible();
  expect(await page.locator('.lc-ui-table-el tbody tr').count(), '表格应有数据行').toBeGreaterThanOrEqual(2);
  expect(await page.locator('[data-lc-tab]').count(), '页签应渲染出按钮').toBeGreaterThanOrEqual(2);
  await expectMounted(page, ['[data-lc-carousel-prev]', '.lc-ui-timeline', '[data-lc-code-source]']);
});

test('[组件挂载] 弹层：对话框与抽屉能真实打开并 ESC 关闭', async ({ page }) => {
  await openDemoPage(page, 'page-components');

  const modal = page.locator('[data-lc-ui="ui-modal"]').first();
  await expect(modal).toBeVisible();
  await modal.locator('[data-lc-overlay-open]').first().click();
  await expect(modal.locator('[data-lc-overlay-panel]').first(), '对话框应真实打开').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal.locator('[data-lc-overlay-panel]').first(), 'ESC 应关闭对话框').toBeHidden();

  const drawer = page.locator('[data-lc-ui="ui-drawer"]').first();
  await drawer.locator('[data-lc-overlay-open]').first().click();
  await expect(drawer.locator('[data-lc-overlay-panel]').first(), '抽屉应真实打开').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer.locator('[data-lc-overlay-panel]').first(), 'ESC 应关闭抽屉').toBeHidden();
});

test('[组件挂载] 站点外壳：导航、页头、面包屑、侧栏与页脚', async ({ page }) => {
  await openDemoPage(page, 'page-shell');
  await expectMounted(page, [
    '.lc-shell-nav-panel',
    '[data-lc-ui="ui-page-header"]',
    '.lc-shell-breadcrumb-list',
    '.lc-shell-sidebar-nav',
    '.lc-shell-footer-inner'
  ]);
  await expect(page.locator('[data-lc-ui="ui-page-header"]').first()).toBeVisible();
});

test('[组件挂载] Mermaid 图表：内置渲染器出 SVG', async ({ page }) => {
  await openDemoPage(page, 'page-mermaid');
  expect(await page.locator('[data-lc-mermaid="true"]').count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-lc-mermaid-status="ready"]').first(), 'Mermaid 应渲染完成')
    .toBeAttached({ timeout: 20_000 });
  await expect(page.locator('.lc-mermaid-svg').first(), 'Mermaid 图应真实绘制').toBeVisible();
});

test('[组件挂载] 文章页：正文与右侧目录锚点', async ({ page }) => {
  await openDemoPage(page, 'page-article');
  const toc = page.locator('.lc-article-toc').first();
  await expect(toc, '文章目录应真实渲染').toBeVisible();
  expect(await toc.locator('.lc-toc-link').count(), '目录应有可跳转的条目').toBeGreaterThanOrEqual(2);
});
