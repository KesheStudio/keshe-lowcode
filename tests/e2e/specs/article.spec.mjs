import { test, expect } from '../support/fixtures.mjs';
import { prepareArticleSite } from '../support/site-data.mjs';
import { startStaticServer } from '../support/static-server.mjs';
import {
  chooseBackend,
  chooseTarget,
  exportAndDownload,
  nextStep,
  openExportWizard,
  unzipArtifact
} from '../support/export.mjs';

test('文章页：右侧目录、章节定位、上下篇、站内检索在 http 部署下可用', async ({ page, request, tempSite, artifacts }, testInfo) => {
  await prepareArticleSite(request, tempSite.siteId);

  await openExportWizard(page, tempSite.siteId);
  await chooseTarget(page, 'web-static');
  await nextStep(page, 2);
  await nextStep(page, 3);
  await chooseBackend(page, 'none');
  const zip = await exportAndDownload(page, testInfo, 'article.zip');
  const outDir = testInfo.outputPath('article-site');
  const files = await unzipArtifact(zip, outDir);
  expect(files).toContain('web/article-one.html');
  expect(files).toContain('web/article-two.html');

  const server = await startStaticServer(outDir + '/web');
  try {
  await page.goto(server.base + '/article-one.html');
  await expect(page.locator('.lc-page')).toBeVisible();
  await expect(page).toHaveTitle(/第一篇/);
  await expect(page.locator('#s1')).toContainText('安装与运行');

  /* ---------- 右侧目录 ---------- */
  const aside = page.locator('.lc-article-aside');
  await expect(aside, '文章页应有右侧目录栏').toBeVisible();
  const toc = aside.locator('.lc-article-toc');
  await expect(toc).toBeVisible();
  const tocLinks = toc.locator('.lc-article-toc-list a[href^="#"]');
  await expect(tocLinks, '目录应列出三个章节').toHaveCount(3);
  await expect(tocLinks.nth(0)).toHaveAttribute('href', '#s1');
  await expect(tocLinks.nth(1)).toHaveAttribute('href', '#s2');

  /* ---------- 章节定位 ---------- */
  const targetTop = () => page.locator('#s2').evaluate((el) => el.getBoundingClientRect().top);
  const beforeTop = await targetTop();
  expect(beforeTop, '第二个章节初始不应贴着页首').toBeGreaterThan(120);
  await tocLinks.nth(1).click();
  await expect(tocLinks.nth(1), '定位后对应目录项应高亮').toHaveClass(/is-active/);
  await expect.poll(targetTop, { message: '点击目录后章节应滚动到视口上方' }).toBeLessThan(120);

  /* ---------- 滚动联动目录高亮 ---------- */
  await page.waitForTimeout(1500); /* 等目录点击的平滑滚动结束，再手动滚到底 */
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(
    async () => tocLinks.nth(2).getAttribute('class'),
    { message: '滚到底部时最后一项目录应高亮' }
  ).toContain('is-active');

  /* ---------- 站内检索 ---------- */
  const searchInput = page.locator('.lc-article-toc [placeholder="在正文中检索"]');
  await expect(searchInput, '目录下应有站内检索框').toBeVisible();
  await searchInput.fill('缓存');
  const searchCount = page.locator('.lc-rt-search-count');
  await expect.poll(async () => searchCount.innerText()).toMatch(/^1 \/ \d+$/);
  const total = Number((await searchCount.innerText()).split('/')[1].trim());
  expect(total, '关键词「缓存」应至少命中两处').toBeGreaterThan(1);
  await expect(page.locator('mark.lc-rt-hit'), '命中处应有高亮标记').toHaveCount(total);
  await page.locator('.lc-rt-search button[aria-label="下一处匹配"]').click();
  await expect.poll(async () => searchCount.innerText()).toMatch(/^2 \/ \d+$/);
  await page.locator('.lc-rt-search button[aria-label="上一处匹配"]').click();
  await expect.poll(async () => searchCount.innerText()).toMatch(/^1 \/ \d+$/);

  /* ---------- 上下篇 ---------- */
  const nextLink = page.locator('.lc-article-nav-next');
  await expect(nextLink, '第一篇应有下一篇').toBeVisible();
  await expect(nextLink).toHaveAttribute('href', 'article-two.html');
  await expect(nextLink).toContainText('第二篇');
  await page.locator('.lc-article-nav-prev').count().then((count) => {
    expect(count, '第一篇不应有上一篇').toBe(0);
  });
  await nextLink.click();
  await expect(page).toHaveTitle(/第二篇/);
  await expect(page.locator('#t1')).toContainText('发布前检查');
  const prevLink = page.locator('.lc-article-nav-prev');
  await expect(prevLink, '第二篇应有上一篇').toBeVisible();
  await expect(prevLink).toHaveAttribute('href', 'article-one.html');
  await expect(prevLink).toContainText('第一篇');

  expect(artifacts.unexpectedConsoleErrors(), '文章页不应报控制台错误').toEqual([]);
  } finally {
    await server.close();
  }
});
