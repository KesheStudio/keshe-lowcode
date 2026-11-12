/* 渲染核心 · 站点模板骨架
   四套起步模板，全部是纯数据：project + shellBlocks + pages（+ articles）。
   套用方式：深拷贝一份模板数据，把 project/shellBlocks/pages 合并进目标站点即可；
   页面与区块都可以在编辑器里逐项修改，不存在「生成一段无法维护的模板代码」。
   约束：模板内只使用 builtins 与样例区块里已有的组件，不为模板单独造组件。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LC = root.LC || {};
    root.LC.StarterTemplates = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var templates = [
    /* ---------- 1. 文档站 ---------- */
    {
      schemaVersion: 1,
      id: 'doc-site',
      name: '文档站',
      description: '左侧目录 + 正文 + 右侧章节导航 + 上下篇，适合产品手册与开发文档。',
      tags: ['文档', '侧栏', '文章'],
      themeId: 'ink-green',
      project: {
        schemaVersion: 5,
        name: '文档站',
        language: 'zh-CN',
        navigation: { blockId: 'tpl-doc-nav' },
        footer: { blockId: 'tpl-doc-footer' },
        sidebar: { blockId: 'tpl-doc-sidebar' },
        breadcrumb: { blockId: 'tpl-doc-breadcrumb' }
      },
      shellBlocks: [
        {
          id: 'tpl-doc-nav',
          type: 'ui-site-nav',
          brand: '文档站',
          brandHref: 'index.html',
          sticky: true,
          items: [
            { label: '首页', href: 'index.html', pageId: 'tpl-doc-home' },
            { label: '快速开始', href: 'quickstart.html', pageId: 'tpl-doc-quickstart' },
            { label: '配置说明', href: 'config.html', pageId: 'tpl-doc-config' },
            { label: '外部参考', href: 'https://developer.mozilla.org/', external: true }
          ]
        },
        {
          id: 'tpl-doc-footer',
          type: 'ui-site-footer',
          brand: '文档站',
          description: '套用模板后可直接替换品牌、链接与版权。',
          columns: [
            {
              title: '文档',
              links: [
                { label: '快速开始', href: 'quickstart.html', pageId: 'tpl-doc-quickstart' },
                { label: '配置说明', href: 'config.html', pageId: 'tpl-doc-config' }
              ]
            },
            {
              title: '资源',
              links: [
                { label: 'MDN', href: 'https://developer.mozilla.org/', external: true }
              ]
            }
          ],
          copyright: '© 2026 文档站',
          legal: [{ label: '隐私说明', href: 'privacy.html' }]
        },
        {
          id: 'tpl-doc-sidebar',
          type: 'ui-sidebar',
          title: '目录',
          description: '文档站目录',
          footnote: '当前页面会自动高亮。',
          items: [
            {
              label: '入门',
              children: [
                { label: '文档首页', href: 'index.html', pageId: 'tpl-doc-home' },
                { label: '快速开始', href: 'quickstart.html', pageId: 'tpl-doc-quickstart' }
              ]
            },
            {
              label: '指南',
              children: [
                { label: '配置说明', href: 'config.html', pageId: 'tpl-doc-config' },
                {
                  label: '进阶',
                  children: [
                    { label: '主题与模式', href: 'config.html#theme', pageId: 'tpl-doc-config' }
                  ]
                }
              ]
            }
          ]
        },
        {
          id: 'tpl-doc-breadcrumb',
          type: 'ui-breadcrumb',
          auto: true,
          homeLabel: '文档',
          homeHref: 'index.html'
        }
      ],
      articles: [
        { id: 'tpl-doc-home', title: '文档首页', path: 'index.html', summary: '文档站的入口页。' },
        { id: 'tpl-doc-quickstart', title: '快速开始', path: 'quickstart.html', summary: '从零跑通第一个页面。' },
        { id: 'tpl-doc-config', title: '配置说明', path: 'config.html', summary: '导航、侧栏与主题怎么配。' }
      ],
      pages: [
        {
          schemaVersion: 2,
          id: 'tpl-doc-home',
          slug: 'index',
          path: 'index.html',
          title: '文档首页',
          nav: { label: '文档首页', trail: ['入门'] },
          layout: { mode: 'flow' },
          shell: { header: true, footer: true, sidebar: true, breadcrumb: true },
          article: { id: 'tpl-doc-home', toc: true, tocTitle: '本页目录' },
          blocks: [
            { id: 'tpl-doc-home-hero', type: 'heading', level: 1, text: '文档首页', sub: '左侧目录、右侧章节导航、底部上下篇都已接好。' },
            { id: 'tpl-doc-home-body', type: 'markdown', md: '这是一套可修改的文档站骨架。\n\n## 从哪里开始\n\n先看「快速开始」，再按需改「配置说明」。\n\n## 结构说明\n\n- 站点外壳：`ui-site-nav`、`ui-site-footer`、`ui-sidebar`、`ui-breadcrumb`\n- 页面正文：普通区块，按需增删\n- 右侧目录与上下篇：页面 `article` 配置开启，章节从正文标题自动生成' },
            { id: 'tpl-doc-home-note', type: 'note', tone: 'info', title: '可修改', md: '所有页面与区块都是数据，套用后可直接在编辑器里改，不需要改模板代码。' }
          ]
        },
        {
          schemaVersion: 2,
          id: 'tpl-doc-quickstart',
          slug: 'quickstart',
          path: 'quickstart.html',
          title: '快速开始',
          nav: { label: '快速开始', trail: ['入门'] },
          layout: { mode: 'flow' },
          shell: { header: true, footer: true, sidebar: true, breadcrumb: true },
          article: { id: 'tpl-doc-quickstart', toc: true, tocTitle: '本页目录' },
          blocks: [
            { id: 'tpl-doc-quickstart-hero', type: 'heading', level: 1, text: '快速开始', sub: '三步把站点跑起来。' },
            { id: 'tpl-doc-quickstart-body', type: 'markdown', md: '## 安装\n\n准备好渲染核心的脚本文件，按顺序引入即可。\n\n### 引入脚本\n\n```html\n<script src="src/render/index.js"></script>\n<script src="src/render/builtins.js"></script>\n```\n\n## 创建页面\n\n在站点数据里新增一个页面，把区块按顺序放进去。\n\n### 最小页面\n\n```js\n{ id: "home", path: "index.html", blocks: [] }\n```\n\n## 渲染与导出\n\n用渲染器渲染页面，再把产物交给导出管线。' },
            { id: 'tpl-doc-quickstart-note', type: 'note', tone: 'ok', title: '下一步', md: '看「配置说明」了解导航、侧栏和主题的配置方式。' }
          ]
        },
        {
          schemaVersion: 2,
          id: 'tpl-doc-config',
          slug: 'config',
          path: 'config.html',
          title: '配置说明',
          nav: { label: '配置说明', trail: ['指南'] },
          layout: { mode: 'flow' },
          shell: { header: true, footer: true, sidebar: true, breadcrumb: true },
          article: { id: 'tpl-doc-config', toc: true, tocTitle: '本页目录' },
          blocks: [
            { id: 'tpl-doc-config-hero', type: 'heading', level: 1, text: '配置说明', sub: '导航、侧栏与主题的常用配置。' },
            { id: 'tpl-doc-config-body', type: 'markdown', md: '## 导航\n\n导航项支持多级 `children`，用 `pageId` 标记目标页面即可自动高亮。\n\n### 外链\n\n`href` 以 `http(s)://` 开头时自动新窗口打开。\n\n## 侧栏\n\n把 `ui-sidebar` 的区块 id 填进 `project.sidebar`，全站共用一份目录。\n\n### 目录层级\n\n目录同样支持多级，当前页会高亮整条分支。\n\n## 主题\n\n主题只通过变量注入，组件不写死颜色。' },
            { id: 'tpl-doc-config-note', type: 'note', tone: 'warn', title: '注意', md: '模板只给默认结构，品牌、链接与文案请按项目替换。' }
          ]
        }
      ]
    },

    /* ---------- 2. 落地页作品集 ---------- */
    {
      schemaVersion: 1,
      id: 'portfolio',
      name: '落地页作品集',
      description: '英雄区 + 作品网格 + 联系区，适合个人主页与作品展示。',
      tags: ['落地页', '作品集'],
      themeId: 'ink-ochre',
      project: {
        schemaVersion: 5,
        name: '作品集',
        language: 'zh-CN',
        navigation: { blockId: 'tpl-portfolio-nav' },
        footer: { blockId: 'tpl-portfolio-footer' }
      },
      shellBlocks: [
        {
          id: 'tpl-portfolio-nav',
          type: 'ui-site-nav',
          brand: '林一',
          brandHref: 'index.html',
          sticky: true,
          items: [
            { label: '作品', href: '#work', pageId: 'tpl-portfolio-home' },
            { label: '关于', href: '#about' },
            { label: '联系', href: '#contact' }
          ],
          cta: { label: '发邮件', href: 'mailto:hello@example.com' }
        },
        {
          id: 'tpl-portfolio-footer',
          type: 'ui-site-footer',
          brand: '林一',
          description: '产品设计 / 前端实现 / 独立开发。',
          columns: [
            {
              title: '站点',
              links: [
                { label: '作品', href: '#work' },
                { label: '联系', href: '#contact' }
              ]
            },
            {
              title: '外部',
              links: [
                { label: 'GitHub', href: 'https://github.com/', external: true },
                { label: 'Dribbble', href: 'https://dribbble.com/', external: true }
              ]
            }
          ],
          copyright: '© 2026 林一',
          legal: [{ label: '隐私说明', href: '#' }]
        }
      ],
      pages: [
        {
          schemaVersion: 2,
          id: 'tpl-portfolio-home',
          slug: 'index',
          path: 'index.html',
          title: '作品集',
          nav: { label: '作品集' },
          layout: { mode: 'flow' },
          shell: { header: true, footer: true, breadcrumb: false },
          blocks: [
            {
              id: 'tpl-portfolio-hero',
              type: 'ui-page-header',
              align: 'center',
              eyebrow: '独立设计与开发',
              title: '把想法做成能用的产品',
              subtitle: '十年产品设计与前端实现经验，专注把复杂流程做成简单界面。',
              actions: [
                { label: '查看作品', href: '#work', variant: 'primary' },
                { label: '聊聊合作', href: '#contact' }
              ]
            },
            { id: 'tpl-portfolio-work-title', type: 'heading', level: 2, text: '作品', sub: '每个卡片都是一个普通容器，可在编辑器里换成截图、说明或链接。' },
            {
              id: 'tpl-portfolio-work-grid',
              type: 'container',
              variant: 'columns',
              columns: 3,
              blocks: [
                {
                  id: 'tpl-portfolio-work-1',
                  type: 'container',
                  variant: 'card',
                  title: '协作白板',
                  blocks: [
                    { id: 'tpl-portfolio-work-1-text', type: 'paragraph', md: '实时多人白板，支持便签、连线与导出。' }
                  ]
                },
                {
                  id: 'tpl-portfolio-work-2',
                  type: 'container',
                  variant: 'card',
                  title: '数据看板',
                  blocks: [
                    { id: 'tpl-portfolio-work-2-text', type: 'paragraph', md: '把分散的运营指标收进一块可读的看板。' }
                  ]
                },
                {
                  id: 'tpl-portfolio-work-3',
                  type: 'container',
                  variant: 'card',
                  title: '移动端工具',
                  blocks: [
                    { id: 'tpl-portfolio-work-3-text', type: 'paragraph', md: '离线可用的记录工具，专注单手操作。' }
                  ]
                }
              ]
            },
            { id: 'tpl-portfolio-about-title', type: 'heading', level: 2, text: '关于', sub: '一段简短介绍，按需替换。' },
            { id: 'tpl-portfolio-about', type: 'markdown', md: '做过工具、社区与数据产品。喜欢把模糊需求拆成可验证的小步骤，也喜欢把界面写到像素级对齐。' },
            { id: 'tpl-portfolio-contact-title', type: 'heading', level: 2, text: '联系', sub: '表单使用现有 `ui-form` 组件，提交逻辑由平台接入。' },
            {
              id: 'tpl-portfolio-contact',
              type: 'container',
              variant: 'card',
              title: '留下需求',
              blocks: [
                {
                  id: 'tpl-portfolio-contact-form',
                  type: 'ui-form',
                  submitLabel: '发送',
                  resetLabel: '清空',
                  fields: [
                    { name: 'name', label: '称呼', type: 'text', required: true, placeholder: '怎么称呼你' },
                    { name: 'email', label: '邮箱', type: 'email', required: true, placeholder: 'you@example.com', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
                    { name: 'message', label: '需求', type: 'textarea', required: true, rows: 4, placeholder: '简单说说项目目标与时间' }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },

    /* ---------- 3. 后台仪表盘 ---------- */
    {
      schemaVersion: 1,
      id: 'dashboard',
      name: '后台仪表盘',
      description: '侧栏 + 顶部栏 + KPI 卡 + 图表 + 表格，适合运营与管理后台。',
      tags: ['后台', '仪表盘', '图表'],
      themeId: 'ink-slate',
      project: {
        schemaVersion: 5,
        name: '运营后台',
        language: 'zh-CN',
        navigation: { blockId: 'tpl-dash-nav' },
        footer: { blockId: 'tpl-dash-footer' },
        sidebar: { blockId: 'tpl-dash-sidebar' }
      },
      shellBlocks: [
        {
          id: 'tpl-dash-nav',
          type: 'ui-site-nav',
          brand: '运营后台',
          brandHref: 'index.html',
          sticky: true,
          items: [
            { label: '概览', href: 'index.html', pageId: 'tpl-dash-overview' },
            { label: '项目', href: 'projects.html', pageId: 'tpl-dash-projects' }
          ],
          cta: { label: '新建项目', href: 'projects.html' }
        },
        {
          id: 'tpl-dash-footer',
          type: 'ui-site-footer',
          brand: '运营后台',
          description: '演示数据均为静态只读，不连接任何真实业务库。',
          columns: [
            {
              title: '快捷入口',
              links: [
                { label: '概览', href: 'index.html', pageId: 'tpl-dash-overview' },
                { label: '项目', href: 'projects.html', pageId: 'tpl-dash-projects' }
              ]
            }
          ],
          copyright: '© 2026 运营后台'
        },
        {
          id: 'tpl-dash-sidebar',
          type: 'ui-sidebar',
          title: '导航',
          sticky: true,
          items: [
            { label: '概览', href: 'index.html', pageId: 'tpl-dash-overview' },
            {
              label: '项目',
              children: [
                { label: '项目列表', href: 'projects.html', pageId: 'tpl-dash-projects' },
                { label: '新建项目', href: 'projects.html#new' }
              ]
            }
          ],
          footnote: '当前页自动高亮'
        }
      ],
      pages: [
        {
          schemaVersion: 2,
          id: 'tpl-dash-overview',
          slug: 'index',
          path: 'index.html',
          title: '概览',
          nav: { label: '概览' },
          layout: { mode: 'flow' },
          shell: { header: true, footer: true, sidebar: true, breadcrumb: false },
          blocks: [
            {
              id: 'tpl-dash-header',
              type: 'ui-page-header',
              eyebrow: '本周',
              title: '概览',
              subtitle: '关键指标、趋势与最近项目。',
              actions: [{ label: '导出报表', href: '#', variant: 'ghost' }]
            },
            {
              id: 'tpl-dash-kpis',
              type: 'container',
              variant: 'columns',
              columns: 4,
              blocks: [
                { id: 'tpl-dash-kpi-1', type: 'ui-kpi', title: '活跃用户', value: 12840, comparison: 12.6, positiveIsGood: true, unit: '人' },
                { id: 'tpl-dash-kpi-2', type: 'ui-kpi', title: '本周新增', value: 1320, comparison: 4.2, positiveIsGood: true, unit: '人' },
                { id: 'tpl-dash-kpi-3', type: 'ui-kpi', title: '平均响应', value: 186, comparison: -8.4, positiveIsGood: false, unit: 'ms' },
                { id: 'tpl-dash-kpi-4', type: 'ui-kpi', title: '转化率', value: 3.8, comparison: -0.6, positiveIsGood: true, unit: '%' }
              ]
            },
            {
              id: 'tpl-dash-chart-line',
              type: 'ui-chart-line',
              title: '近七日活跃',
              labels: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
              series: [{ name: '活跃用户', values: [8200, 9320, 9010, 12340, 12900, 13300, 14200] }],
              height: 240
            },
            {
              id: 'tpl-dash-chart-bar',
              type: 'ui-chart-bar',
              title: '渠道来源',
              data: [
                { label: '自然搜索', value: 4200 },
                { label: '直接访问', value: 3100 },
                { label: '社交媒体', value: 2400 },
                { label: '合作方', value: 1200 }
              ],
              height: 220
            },
            { id: 'tpl-dash-table-title', type: 'heading', level: 2, text: '最近项目', sub: '表格支持排序、分页与空态。' },
            {
              id: 'tpl-dash-table',
              type: 'ui-table',
              pageSize: 5,
              columns: [
                { key: 'name', title: '项目', sortable: true },
                { key: 'owner', title: '负责人' },
                { key: 'status', title: '状态' },
                { key: 'updated', title: '更新时间', format: 'date' },
                { key: 'progress', title: '进度', align: 'right', format: 'number' }
              ],
              rows: [
                { name: '官网改版', owner: '陈一', status: '进行中', updated: '2026-11-06', progress: 68 },
                { name: '会员中心', owner: '李二', status: '已完成', updated: '2026-11-04', progress: 100 },
                { name: '数据迁移', owner: '王三', status: '风险', updated: '2026-11-03', progress: 42 }
              ]
            }
          ]
        },
        {
          schemaVersion: 2,
          id: 'tpl-dash-projects',
          slug: 'projects',
          path: 'projects.html',
          title: '项目',
          nav: { label: '项目' },
          layout: { mode: 'flow' },
          shell: { header: true, footer: true, sidebar: true, breadcrumb: false },
          blocks: [
            {
              id: 'tpl-dash-projects-header',
              type: 'ui-page-header',
              eyebrow: '项目管理',
              title: '项目',
              subtitle: '全部项目的静态示例数据。',
              actions: [{ label: '新建项目', href: '#new', variant: 'primary' }]
            },
            { id: 'tpl-dash-projects-note', type: 'note', tone: 'info', title: '数据说明', md: '此页只演示表格与筛选结构，数据是静态只读的演示值，不连接任何业务数据库。' },
            {
              id: 'tpl-dash-projects-table',
              type: 'ui-table',
              pageSize: 10,
              selectable: true,
              columns: [
                { key: 'name', title: '项目', sortable: true },
                { key: 'owner', title: '负责人', sortable: true },
                { key: 'status', title: '状态' },
                { key: 'updated', title: '更新时间', format: 'date' },
                { key: 'progress', title: '进度', align: 'right', format: 'number' }
              ],
              rows: [
                { name: '官网改版', owner: '陈一', status: '进行中', updated: '2026-11-06', progress: 68 },
                { name: '会员中心', owner: '李二', status: '已完成', updated: '2026-11-04', progress: 100 },
                { name: '数据迁移', owner: '王三', status: '风险', updated: '2026-11-03', progress: 42 },
                { name: '移动端适配', owner: '赵四', status: '进行中', updated: '2026-11-01', progress: 55 },
                { name: '帮助中心', owner: '钱五', status: '未开始', updated: '2026-10-29', progress: 0 }
              ]
            }
          ]
        }
      ]
    },

    /* ---------- 4. 认证中心 ---------- */
    {
      schemaVersion: 1,
      id: 'auth',
      name: '认证中心',
      description: '居中卡片 + 表单 + 错误提示区，适合登录、注册与找回密码。',
      tags: ['认证', '登录', '表单'],
      themeId: 'ink-green',
      project: {
        schemaVersion: 5,
        name: '认证中心',
        language: 'zh-CN'
      },
      shellBlocks: [],
      pages: [
        {
          schemaVersion: 2,
          id: 'tpl-auth-signin',
          slug: 'index',
          path: 'index.html',
          title: '登录',
          nav: { label: '登录' },
          layout: { mode: 'flow', align: 'center', maxWidth: '480px' },
          shell: { header: false, footer: false, breadcrumb: false },
          blocks: [
            {
              id: 'tpl-auth-card',
              type: 'container',
              variant: 'card',
              blocks: [
                {
                  id: 'tpl-auth-header',
                  type: 'ui-page-header',
                  align: 'center',
                  eyebrow: '认证中心',
                  title: '登录账号',
                  subtitle: '使用邮箱与密码继续。'
                },
                {
                  id: 'tpl-auth-error',
                  type: 'ui-state',
                  kind: 'error',
                  title: '邮箱或密码不正确',
                  text: '请检查后重试。连续失败 5 次将临时锁定账号。'
                },
                {
                  id: 'tpl-auth-form',
                  type: 'ui-form',
                  submitLabel: '登录',
                  resetLabel: '清空',
                  fields: [
                    { name: 'email', label: '邮箱', type: 'email', required: true, placeholder: 'you@example.com', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
                    { name: 'password', label: '密码', type: 'password', required: true, minLength: 8, placeholder: '至少 8 位' },
                    { name: 'remember', label: '记住我', type: 'checkbox' }
                  ]
                },
                {
                  id: 'tpl-auth-links',
                  type: 'paragraph',
                  md: '忘记密码？联系管理员重置。'
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function listStarterTemplates() {
    return clone(templates);
  }

  function starterTemplateIds() {
    return templates.map(function (item) { return item.id; });
  }

  function getStarterTemplate(id) {
    for (var i = 0; i < templates.length; i += 1) {
      if (templates[i].id === id) return clone(templates[i]);
    }
    return null;
  }

  return {
    schemaVersion: 1,
    templates: templates,
    listStarterTemplates: listStarterTemplates,
    starterTemplateIds: starterTemplateIds,
    getStarterTemplate: getStarterTemplate
  };
}));
