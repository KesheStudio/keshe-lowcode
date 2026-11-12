/* 模板库 · 纯逻辑
   模板文件存放在 templates/<id>.json，外层是与组件一致的导出信封，
   内层是模板本体。页面模板 = 单个页面快照；站点模板 = 多个页面 + 站点配置快照。
   这里只做校验与快照，不读磁盘，便于路由与测试复用。 */

export const TEMPLATE_FORMAT = 'lowcode-template';
export const TEMPLATE_SCHEMA_VERSION = 1;

export const TEMPLATE_CATEGORIES = [
  { value: 'landing', label: '落地页' },
  { value: 'content', label: '内容页' },
  { value: 'form', label: '表单页' },
  { value: 'dashboard', label: '数据展示' },
  { value: 'other', label: '其他' }
];

export const TEMPLATE_KINDS = [
  { value: 'page', label: '页面模板' },
  { value: 'site', label: '站点模板' }
];

export const TEMPLATE_LIMITS = {
  nameLength: 64,
  tagsMax: 8,
  tagLength: 24,
  descriptionLength: 160,
  importBytes: 4 * 1024 * 1024,
  pagesMax: 200
};

const CATEGORY_VALUES = new Set(TEMPLATE_CATEGORIES.map((item) => item.value));
const KIND_VALUES = new Set(TEMPLATE_KINDS.map((item) => item.value));
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

export function fail(statusCode, code, message, detail) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.detail = detail;
  return error;
}

export function asText(value) {
  return value == null ? '' : String(value);
}

const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

export function slugifyId(name, fallback) {
  const raw = asText(name);
  let safe = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  /* 中文名被逐字替换后往往只剩很短的 ASCII 尾巴（如「扫地模板xqf3」→ xqf3）。
     这种情况用可读的 fallback 打头，尾巴只作区分，避免 ID 退化成纯 hash 观感（TPL-03）。 */
  if (safe && CJK_RE.test(raw) && safe.length <= 6) {
    safe = (asText(fallback) || 'template') + '-' + safe;
  }
  return safe || asText(fallback) || 'template';
}

export function normalizeTemplateId(value) {
  const id = asText(value).trim();
  if (!ID_RE.test(id)) {
    throw fail(422, 'LC_E_TEMPLATE_ID', '模板 ID 只能包含字母、数字、下划线和连字符，且以字母或数字开头');
  }
  return id;
}

export function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : asText(value).split(',');
  const tags = [];
  for (const item of raw) {
    const tag = asText(item).trim().slice(0, TEMPLATE_LIMITS.tagLength);
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length >= TEMPLATE_LIMITS.tagsMax) break;
  }
  return tags;
}

export function normalizeTemplateMeta(raw, options = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = asText(options.name != null ? options.name : source.name).trim();
  if (!name) throw fail(422, 'LC_E_TEMPLATE_NAME', '模板名称不能为空');
  if (name.length > TEMPLATE_LIMITS.nameLength) {
    throw fail(422, 'LC_E_TEMPLATE_NAME', '模板名称不能超过 ' + TEMPLATE_LIMITS.nameLength + ' 个字符');
  }
  const kind = KIND_VALUES.has(options.kind) ? options.kind : KIND_VALUES.has(source.kind) ? source.kind : 'page';
  const category = CATEGORY_VALUES.has(options.category)
    ? options.category
    : CATEGORY_VALUES.has(source.category)
      ? source.category
      : 'other';
  const tags = normalizeTags(options.tags != null ? options.tags : source.tags);
  const description = asText(options.description != null ? options.description : source.description)
    .trim()
    .slice(0, TEMPLATE_LIMITS.descriptionLength);
  return { name, kind, category, tags, description };
}

function cloneBlocks(blocks) {
  return JSON.parse(JSON.stringify(Array.isArray(blocks) ? blocks : []));
}

/* 页面级内容设置：套用模板时要和区块一起还原，不能只带走 nav/layout。 */
export const PAGE_EXTRA_FIELDS = ['size', 'article', 'overrides', 'summary', 'order', 'meta', 'seo'];

export function pageExtraFields(page) {
  const out = {};
  if (!page || typeof page !== 'object') return out;
  for (const key of PAGE_EXTRA_FIELDS) {
    if (page[key] == null) continue;
    out[key] = JSON.parse(JSON.stringify(page[key]));
  }
  return out;
}

function assertBlocks(blocks, label) {
  walkBlocks(blocks, (block) => {
    if (!asText(block.type).trim()) {
      throw fail(422, 'LC_E_TEMPLATE_PAGE', label + '存在缺少 type 的区块，模板不可用');
    }
  });
  return blocks;
}

/** 页面快照：只保留页面内容，不保留导出路径以外的运行时字段。 */
export function pageSnapshot(page, fallbackId) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    throw fail(422, 'LC_E_TEMPLATE_PAGE', '模板页面不是对象');
  }
  if (!Array.isArray(page.blocks)) {
    throw fail(422, 'LC_E_TEMPLATE_PAGE', '模板页面缺少 blocks 区块数组');
  }
  const snapshot = {
    schemaVersion: 2,
    id: asText(page.id || fallbackId || 'page'),
    title: asText(page.title || page.id || '未命名页面'),
    slug: asText(page.slug || page.id || ''),
    path: asText(page.path || ''),
    nav: page.nav !== false,
    layout: page.layout && typeof page.layout === 'object' ? JSON.parse(JSON.stringify(page.layout)) : { mode: 'flow' },
    blocks: assertBlocks(cloneBlocks(page.blocks), '页面「' + asText(page.title || page.id) + '」')
  };
  Object.assign(snapshot, pageExtraFields(page));
  /* 双端独立 UI：模板必须同时保留移动端区块，否则套用后移动端内容会整段消失。 */
  if (page.independentUi === true && Array.isArray(page.blocksMobile)) {
    snapshot.independentUi = true;
    snapshot.blocksMobile = assertBlocks(
      cloneBlocks(page.blocksMobile),
      '页面「' + asText(page.title || page.id) + '」移动端'
    );
  }
  return snapshot;
}

function walkBlocks(blocks, visit) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object') continue;
    visit(block);
    if (Array.isArray(block.blocks)) walkBlocks(block.blocks, visit);
  }
}

/** 模板引用了哪些自定义组件（内置组件 id 以 builtin: 开头，不需要随模板带走）。 */
export function collectComponentIds(pages) {
  const ids = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    walkBlocks(page && page.blocks, (block) => {
      if (asText(block.type) !== 'component') return;
      const id = asText(block.componentId).trim();
      if (!id || id.startsWith('builtin:')) return;
      if (!ids.includes(id)) ids.push(id);
    });
  }
  return ids;
}

export function countBlocks(blocks) {
  let total = 0;
  walkBlocks(blocks, () => { total += 1; });
  return total;
}

export function templateInfo(template) {
  const kind = template.kind === 'site' ? 'site' : 'page';
  const pages = kind === 'site'
    ? (Array.isArray(template.pages) ? template.pages : [])
    : (template.page ? [template.page] : []);
  return {
    id: asText(template.id),
    name: asText(template.name || template.id),
    kind,
    category: asText(template.category || 'other'),
    tags: Array.isArray(template.tags) ? template.tags.slice() : [],
    description: asText(template.description),
    pageCount: pages.length,
    pageTitles: pages.map((page) => asText(page && page.title) || asText(page && page.id)),
    blockCount: pages.reduce((sum, page) => sum + countBlocks(page && page.blocks), 0),
    componentCount: Array.isArray(template.components) ? template.components.length : 0,
    componentNames: Array.isArray(template.components) ? template.components.map((item) => asText(item && item.name) || asText(item && item.id)) : [],
    source: template.source && typeof template.source === 'object' ? template.source : {},
    createdAt: asText(template.createdAt),
    updatedAt: asText(template.updatedAt)
  };
}

export function exportPayload(template) {
  return {
    format: TEMPLATE_FORMAT,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    template
  };
}

/** 导入校验：只接受与导出信封一致的格式，页面内容要能通过快照校验。 */
export function normalizeTemplateRecord(raw, options = {}) {
  const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (options.envelope === false) {
    return normalizeTemplateBody(payload);
  }
  if (payload.format !== TEMPLATE_FORMAT) {
    throw fail(422, 'LC_E_TEMPLATE_FORMAT', '不是模板文件（缺少 format: ' + TEMPLATE_FORMAT + '）');
  }
  if (Number(payload.schemaVersion) !== TEMPLATE_SCHEMA_VERSION) {
    throw fail(422, 'LC_E_TEMPLATE_FORMAT', '模板文件 schemaVersion 是 ' + payload.schemaVersion + '，只接受 ' + TEMPLATE_SCHEMA_VERSION);
  }
  return normalizeTemplateBody(payload.template);
}

function normalizeTemplateBody(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const meta = normalizeTemplateMeta(source);
  const kind = meta.kind;
  let pages;
  if (kind === 'site') {
    const list = Array.isArray(source.pages) ? source.pages : [];
    if (!list.length) throw fail(422, 'LC_E_TEMPLATE_PAGES', '站点模板缺少非空的 pages 数组');
    if (list.length > TEMPLATE_LIMITS.pagesMax) {
      throw fail(422, 'LC_E_TEMPLATE_PAGES', '站点模板最多包含 ' + TEMPLATE_LIMITS.pagesMax + ' 个页面');
    }
    pages = list.map((page, index) => pageSnapshot(page, 'page-' + (index + 1)));
  } else {
    if (!source.page || typeof source.page !== 'object') {
      throw fail(422, 'LC_E_TEMPLATE_PAGE', '页面模板缺少 page 对象');
    }
    pages = [pageSnapshot(source.page, meta.name)];
  }
  const components = Array.isArray(source.components)
    ? source.components.filter((item) => item && typeof item === 'object' && item.id && !asText(item.id).startsWith('builtin:'))
      .map((item) => JSON.parse(JSON.stringify(item)))
    : [];
  const config = kind === 'site' && source.config && typeof source.config === 'object'
    ? JSON.parse(JSON.stringify(source.config))
    : undefined;
  const template = {
    id: asText(source.id || ''),
    name: meta.name,
    kind,
    category: meta.category,
    tags: meta.tags,
    description: meta.description,
    source: source.source && typeof source.source === 'object' ? JSON.parse(JSON.stringify(source.source)) : {},
    createdAt: asText(source.createdAt) || new Date().toISOString(),
    updatedAt: asText(source.updatedAt) || new Date().toISOString(),
    components
  };
  if (kind === 'site') {
    template.pages = pages;
    if (config) template.config = config;
  } else {
    template.page = pages[0];
  }
  return template;
}
