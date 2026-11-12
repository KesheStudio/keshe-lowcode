import { importResource, writeSiteFile } from './api.mjs';
import { readFixture } from './fixtures.mjs';

/**
 * 准备一个包含离线首页与两篇文章的临时站点：
 * 页面走官方导入接口，文章元数据走站点文件接口（仍然只作用于临时站点）。
 */
export async function prepareArticleSite(request, siteId) {
  /* 站点创建时已经带一个空首页 pages/home.json；这里直接覆盖它，
     避免导入的首页因为 index.html 路径重复被平台改成 index-2.html，
     导致导出包的入口 index.html 仍是空页面。 */
  const home = JSON.parse(await readFixture('article-home.json')).page;
  await writeSiteFile(request, siteId, 'pages/home.json', JSON.stringify({
    ...home,
    id: 'home',
    slug: 'home',
    path: 'index.html'
  }, null, 2));

  await importResource(request, siteId, 'page', 'article-one.json', await readFixture('article-one.json'));
  await importResource(request, siteId, 'page', 'article-two.json', await readFixture('article-two.json'));
  await importResource(request, siteId, 'page', 'chart-page.json', await readFixture('chart-page.json'));

  await writeSiteFile(request, siteId, 'articles/a1.json', JSON.stringify({
    id: 'a1',
    title: '第一篇：安装与运行',
    path: 'article-one.html',
    summary: '安装、配置与发布的第一篇。',
    order: 1,
    date: '2026-01-01'
  }));
  await writeSiteFile(request, siteId, 'articles/a2.json', JSON.stringify({
    id: 'a2',
    title: '第二篇：发布检查清单',
    path: 'article-two.html',
    summary: '发布前后的检查项。',
    order: 2,
    date: '2026-01-02'
  }));
}
