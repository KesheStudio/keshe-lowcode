/* 四套模板与默认主题的对应关系。
 *
 * 模板本身在平台里是页面骨架，主题是配色；这里只做映射，不写 HTML。
 * 构建脚本、预览页和主题编辑器共用这一份，避免「文档站该用哪套」出现三个答案。
 *
 * 约定：
 *   defaultThemeId 必须在 themes/ 里存在，且四套模板不能指向同一套主题；
 *   构建时 check.mjs 会核对；指向不存在的 id 直接报错，不会静默回落。
 */

export const TEMPLATE_PRESETS = [
  {
    id: 'docs',
    name: '文档站',
    defaultThemeId: 'docs-quiet',
    themeIds: ['docs-quiet', 'ink-green', 'ink-navy', 'ink-graphite'],
    summary: '纸感素净。近白纸面、墨绿强调，标题层级克制，适合长文、教程和 API 文档。'
  },
  {
    id: 'portfolio',
    name: '作品集',
    defaultThemeId: 'portfolio-bold',
    themeIds: ['portfolio-bold', 'ink-ochre', 'blueprint-amber'],
    summary: '大胆。暖白纸面配赤陶红，色块和图表更抢眼，适合项目封面、案例展示。'
  },
  {
    id: 'dashboard',
    name: '仪表盘',
    defaultThemeId: 'dashboard-calm',
    themeIds: ['dashboard-calm', 'ink-navy', 'ink-graphite', 'blueprint-amber'],
    summary: '冷静。冷灰蓝底、低饱和数据色，长时间盯盘不刺眼，状态色仍能一眼分开。'
  },
  {
    id: 'auth',
    name: '认证中心',
    defaultThemeId: 'auth-clean',
    themeIds: ['auth-clean', 'docs-quiet', 'ink-green'],
    summary: '干净。接近纯白的底色和单一蓝强调，焦点留给表单、验证码和状态提示。'
  }
];

export function presetById(id) {
  return TEMPLATE_PRESETS.find((item) => item.id === id) || null;
}

export function presetForTheme(themeId) {
  return TEMPLATE_PRESETS.find((item) => item.defaultThemeId === themeId) || null;
}
