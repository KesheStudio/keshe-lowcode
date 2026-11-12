/* 基础区块模块
   页面用 heading / paragraph / cards / image 这类基础区块；
   渲染引擎只内置 ui-* 组件，基础区块由这里注册，导出管线与 Builder 共用。
   只依赖注册表公开接口，不修改渲染层源码。

   schema 与渲染函数放在一起：Builder 的属性面板直接读 schema 生成字段，
   不再为每种区块写一套面板。字段存储位置用 store 标记（这里都是区块顶层）。 */

const SHARED_CSS_ID = 'lc-base-content';

const CONTENT_CSS = [
  '.lc-block[data-lc-type="paragraph"] p { margin: 0 0 .9em; }',
  '.lc-block[data-lc-type="paragraph"] p:last-child { margin-bottom: 0; }',
  '.lc-card-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }',
  '.lc-content-card { display: block; border: 1px solid var(--lc-color-line, #ded6c5); background: var(--lc-color-surface, #fffcf5); border-radius: 8px; padding: 14px 16px; text-decoration: none; color: inherit; }',
  '.lc-content-card h3 { margin: 0 0 6px; font-size: 1rem; }',
  '.lc-content-card p { margin: 0; color: var(--lc-color-muted, #6b7076); }',
  '.lc-note { border-left: 3px solid var(--lc-color-accent, #3e6a56); background: var(--lc-color-surface, #fffcf5); padding: 12px 14px; border-radius: 6px; }',
  '.lc-note strong { display: block; margin-bottom: 4px; }',
  '.lc-note.lc-note-warn { border-left-color: #b08a2e; }',
  '.lc-image { text-align: center; }',
  '.lc-image img { max-width: 100%; height: auto; border-radius: 6px; }',
  '.lc-image figcaption { margin-top: 6px; color: var(--lc-color-muted, #6b7076); font-size: .85rem; }',
  '.lc-btn-row { display: flex; }',
  '.lc-btn-row[data-align="center"] { justify-content: center; }',
  '.lc-btn-row[data-align="right"] { justify-content: flex-end; }',
  '.lc-btn { display: inline-block; padding: 8px 16px; border-radius: 8px; text-decoration: none; border: 1px solid var(--lc-color-accent, #3e6a56); }',
  '.lc-btn-primary { background: var(--lc-color-accent, #3e6a56); color: #fff; }',
  '.lc-btn-plain { border-color: var(--lc-color-line, #ded6c5); color: inherit; }',
  '.lc-code-block { overflow: auto; padding: 12px 14px; border-radius: 6px; background: var(--lc-color-code-bg, #efeade); }',
  '.lc-code-block code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9rem; }',
  '.lc-article-body pre, .lc-block pre { overflow-x: auto; }',
  '.lc-article-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }',
  '.lc-article-list li { border-bottom: 1px solid var(--lc-color-line, #ded6c5); padding-bottom: 10px; }',
  '.lc-article-list a { font-weight: 600; text-decoration: none; }',
  '.lc-article-list p { margin: 4px 0 0; color: var(--lc-color-muted, #6b7076); font-size: .9rem; }'
].join('\n');

function safeHref(ctx, value) {
  return typeof ctx.safeUrl === 'function' ? ctx.safeUrl(value) : String(value || '');
}

function define(type, name, schema, render) {
  return {
    type: type,
    name: name,
    schema: { type: type, name: name, store: 'block', props: schema },
    sharedCssId: SHARED_CSS_ID,
    sharedCss: CONTENT_CSS,
    render: render
  };
}

const BLOCKS = [
  define('heading', '标题', {
    text: { type: 'string', label: '标题文字', default: '' },
    level: { type: 'enum', label: '标题级别', options: [
      { value: 2, label: 'H2 · 章节标题' },
      { value: 3, label: 'H3 · 小节标题' }
    ], default: 2 }
  }, (block, ctx) => {
    const level = Number(block.level) === 3 ? 3 : 2;
    return ctx.h('h' + level, { id: block.id || null }, String(block.text || ''));
  }),

  define('paragraph', '段落', {
    md: { type: 'text', label: '正文（支持 Markdown）', default: '' }
  }, (block, ctx) => {
    const md = String(block.md != null ? block.md : block.text || '');
    return ctx.raw(ctx.markdown(md));
  }),

  define('markdown', 'Markdown', {
    md: { type: 'text', label: 'Markdown 内容', default: '' }
  }, (block, ctx) => ctx.raw(ctx.markdown(String(block.md || '')))),

  define('html', 'HTML', {
    html: { type: 'code', label: 'HTML 片段', language: 'html', default: '' }
  }, (block, ctx) => ctx.raw(String(block.html || ''))),

  define('note', '提示块', {
    title: { type: 'string', label: '小标题', default: '' },
    variant: { type: 'enum', label: '语气', options: [
      { value: 'info', label: '普通提示' },
      { value: 'warn', label: '警告' }
    ], default: 'info' },
    md: { type: 'text', label: '提示正文（支持 Markdown）', default: '' }
  }, (block, ctx) => {
    const variant = block.variant === 'warn' || block.variant === 'warning' ? 'warn' : 'info';
    return ctx.h('div', { class: 'lc-note lc-note-' + variant }, [
      block.title ? ctx.h('strong', {}, String(block.title)) : null,
      ctx.raw(ctx.markdown(String(block.md || '')))
    ]);
  }),

  define('cards', '卡片组', {
    columns: { type: 'number', label: '列数', min: 1, max: 4, default: 3 },
    cards: { type: 'json', label: '卡片列表', default: [] }
  }, (block, ctx) => {
    const cards = Array.isArray(block.cards) ? block.cards : [];
    return ctx.h('div', { class: 'lc-card-grid', style: { '--lc-cols': Number(block.columns) || 3 } }, cards.map((card) => {
      const title = String((card && card.title) || '');
      const body = String((card && card.body) || '');
      const href = safeHref(ctx, card && card.href);
      const inner = [ctx.h('h3', {}, title), body ? ctx.h('p', {}, body) : null];
      return href
        ? ctx.h('a', { class: 'lc-content-card', href: href }, inner)
        : ctx.h('div', { class: 'lc-content-card' }, inner);
    }));
  }),

  define('image', '图片', {
    src: { type: 'string', label: '图片地址', default: '' },
    alt: { type: 'string', label: '替代文字', default: '' },
    caption: { type: 'string', label: '图注', default: '' }
  }, (block, ctx) => {
    const src = safeHref(ctx, block.src);
    return ctx.h('figure', { class: 'lc-image' }, [
      src ? ctx.h('img', { src: src, alt: String(block.alt || '') }) : null,
      block.caption ? ctx.h('figcaption', {}, String(block.caption)) : null
    ]);
  }),

  define('divider', '分隔线', {}, (_block, ctx) => ctx.h('hr', {})),

  define('button', '按钮', {
    label: { type: 'string', label: '按钮文字', default: '' },
    href: { type: 'string', label: '链接地址', default: '' },
    variant: { type: 'enum', label: '样式', options: [
      { value: 'primary', label: '实心' },
      { value: 'plain', label: '描边' }
    ], default: 'primary' },
    align: { type: 'enum', label: '对齐', options: [
      { value: 'left', label: '靠左' },
      { value: 'center', label: '居中' },
      { value: 'right', label: '靠右' }
    ], default: 'left' }
  }, (block, ctx) => {
    const variant = block.variant === 'plain' ? 'plain' : 'primary';
    const align = block.align === 'center' || block.align === 'right' ? block.align : 'left';
    return ctx.h('div', { class: 'lc-btn-row', 'data-align': align }, [
      ctx.h('a', { class: 'lc-btn lc-btn-' + variant, href: safeHref(ctx, block.href) }, String(block.label || ''))
    ]);
  }),

  define('code', '代码块', {
    lang: { type: 'string', label: '语言标记', default: '' },
    code: { type: 'code', label: '代码内容', language: 'text', default: '' }
  }, (block, ctx) => {
    const lang = String(block.lang || '');
    return ctx.h('pre', { class: 'lc-code-block' }, [
      ctx.h('code', { class: lang ? 'language-' + lang : null }, String(block.code || ''))
    ]);
  }),

  define('articleList', '文章列表', {
    limit: { type: 'number', label: '最多显示条数（0 为全部）', min: 0, default: 0 }
  }, (block, ctx) => {
    const site = ctx.site || {};
    let articles = Array.isArray(site.articles) ? site.articles.slice() : [];
    articles.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const limit = Number(block.limit) || 0;
    if (limit > 0) articles = articles.slice(0, limit);
    if (!articles.length) return ctx.h('p', { class: 'lc-article-list-empty' }, '暂无文章');
    return ctx.h('ul', { class: 'lc-article-list' }, articles.map((article) => {
      const href = safeHref(ctx, article.path || ('articles/' + (article.id || '') + '.html'));
      return ctx.h('li', {}, [
        ctx.h('a', { href: href }, String(article.title || article.id || '')),
        article.summary ? ctx.h('p', {}, String(article.summary)) : null
      ]);
    }));
  })
];

export function registerBaseBlocks(registry) {
  if (!registry || typeof registry.registerBlock !== 'function') {
    throw new Error('registerBaseBlocks 需要注册表实例');
  }
  for (const def of BLOCKS) registry.registerBlock(def.type, def);
  return registry;
}

/** 供 Builder 属性面板读取：区块名称 + 字段 schema，不暴露渲染函数。 */
export function baseBlockSchemas() {
  return BLOCKS.map((def) => ({
    type: def.type,
    name: def.name,
    store: def.schema.store,
    props: def.schema.props
  }));
}
