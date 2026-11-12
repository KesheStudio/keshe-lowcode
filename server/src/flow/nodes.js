/* 后端积木 · 节点类型注册表
 *
 * 这里是唯一的类型定义来源：服务端校验、代码生成、浏览器节点库与属性面板
 * 都读同一份定义（页面通过 /api/sites/:siteId/backend-flow 拿到）。
 * 新增节点类型：在 NODE_TYPES 里加一项，再到 flow/compile.js 加对应的代码生成分支。
 */

export const FLOW_SCHEMA_VERSION = 1;
export const FLOW_LANGUAGE = 'node';
export const FLOW_ID = 'main';

// 积木的能力矩阵：language 是目标代码语言，不是站点/项目语言。
// - languages：这块积木在设计上能翻译成哪些语言
// - implementedLanguages：当前真正有 codegen 的语言（Node 纵向切片先跑通）
export const FLOW_LANGUAGES = ['node', 'rust', 'go'];

export const NODE_CATEGORIES = [
  { id: 'entry', label: '入口', hint: '请求进入流程的第一站：方法、路径、参数校验' },
  { id: 'middleware', label: '中间件', hint: 'CORS、鉴权、限流、日志；按安全顺序执行' },
  { id: 'data', label: '数据读写', hint: '集合、文件、外部 HTTP' },
  { id: 'transform', label: '数据处理', hint: '字段裁剪、模板拼装' },
  { id: 'control', label: '流程控制', hint: '条件分支、循环，可嵌套子节点' },
  { id: 'output', label: '响应', hint: '状态码、响应体、响应头' },
  { id: 'component', label: '后端组件', hint: '可复用的自定义积木，支持项目内或全局' },
  { id: 'code', label: '用户代码', hint: '写入 custom/，重新生成不会被覆盖' }
];

// 宽度只允许三档：短字段 180px、中等 280px、长字段整行。
const FIELD = {
  text(key, label, extra = {}) {
    return { key, label, kind: 'text', width: 'full', ...extra };
  },
  number(key, label, extra = {}) {
    return { key, label, kind: 'number', width: 'short', ...extra };
  },
  select(key, label, options, extra = {}) {
    return { key, label, kind: 'select', width: 'short', options, ...extra };
  },
  toggle(key, label, extra = {}) {
    return { key, label, kind: 'toggle', width: 'short', ...extra };
  },
  textarea(key, label, extra = {}) {
    return { key, label, kind: 'textarea', width: 'full', rows: 4, ...extra };
  },
  expression(key, label, extra = {}) {
    return { key, label, kind: 'expression', width: 'medium', ...extra };
  }
};

export const NODE_TYPES = {
  'entry.request': {
    category: 'entry',
    label: 'HTTP 入口',
    summary: '方法 + 路径 + 参数校验',
    color: 'entry',
    singleton: true,
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.select('method', '方法', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], {
        default: 'GET',
        required: true,
        hint: '同一流程只能有一个启用的入口节点。'
      }),
      FIELD.text('path', '路径', {
        default: '/api/example',
        required: true,
        placeholder: '/api/items',
        pattern: '^/[A-Za-z0-9_\\-./:]*$',
        hint: '必须以 / 开头；不支持查询串和空格。'
      }),
      {
        key: 'params',
        label: '参数校验',
        kind: 'params',
        width: 'full',
        default: [],
        hint: '运行时在进入处理节点前校验；缺必填参数直接返回 400。',
        columns: [
          { key: 'name', label: '参数名', kind: 'text', width: 'short', required: true },
          { key: 'in', label: '位置', kind: 'select', width: 'short', options: ['query', 'body', 'params', 'header'], default: 'query' },
          { key: 'type', label: '类型', kind: 'select', width: 'short', options: ['string', 'number', 'boolean'], default: 'string' },
          { key: 'required', label: '必填', kind: 'toggle', width: 'short', default: false }
        ]
      }
    ]
  },

  'middleware.cors': {
    category: 'middleware',
    label: 'CORS',
    summary: '跨域响应头 + OPTIONS 预检',
    color: 'middleware',
    middlewarePriority: 10,
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.text('origins', '允许的来源', {
        default: '*',
        width: 'medium',
        placeholder: '*, http://localhost:5173',
        hint: '逗号分隔。仅当全部为 * 且未开凭证时使用通配符。'
      }),
      FIELD.toggle('credentials', '允许携带凭证', { default: false, hint: '与 * 同时开启会被校验拒绝。' }),
      FIELD.number('maxAgeSeconds', '预检缓存（秒）', { default: 600, min: 0, max: 86400 })
    ]
  },

  'middleware.auth': {
    category: 'middleware',
    label: '鉴权',
    summary: '登录校验 + 角色白名单',
    color: 'middleware',
    middlewarePriority: 30,
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.text('roles', '允许的角色', {
        default: '',
        width: 'medium',
        placeholder: 'admin, editor',
        hint: '留空表示只要登录即可；角色来自后端鉴权服务。'
      })
    ]
  },

  'middleware.rateLimit': {
    category: 'middleware',
    label: '限流',
    summary: '令牌桶，按 IP 或令牌限速',
    color: 'middleware',
    middlewarePriority: 40,
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.number('rps', '每秒补充', { default: 20, min: 1, max: 100000 }),
      FIELD.number('burst', '桶容量', { default: 40, min: 1, max: 100000, hint: '允许的瞬时突发请求数。' }),
      FIELD.select('keyBy', '限流键', ['ip', 'token'], { default: 'ip', hint: 'token 取 Authorization 头的摘要，不存原文。' })
    ]
  },

  'middleware.log': {
    category: 'middleware',
    label: '日志',
    summary: '方法、路径、状态码、耗时',
    color: 'middleware',
    middlewarePriority: 20,
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.select('level', '日志级别', ['info', 'warn', 'debug'], { default: 'info' }),
      FIELD.toggle('skipHealth', '跳过健康检查', { default: true })
    ]
  },

  'db.readCollection': {
    category: 'data',
    label: '读取集合',
    summary: '按页读取集合行，输出 { items, total }',
    color: 'data',
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.text('collection', '集合 ID', { default: 'items', width: 'short', required: true, pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }),
      FIELD.expression('page', '页码', { default: '{{request.query.page}}', hint: '留空按 1；支持 {{表达式}}。' }),
      FIELD.expression('pageSize', '每页条数', { default: '{{request.query.pageSize}}', hint: '留空按 20，上限由后端配置决定。' }),
      FIELD.expression('q', '关键字', { default: '{{request.query.q}}', width: 'medium', hint: '对应集合接口的 q。' }),
      FIELD.expression('filter', '过滤条件', { default: '{{request.query.filter}}', hint: '可选对象；按集合字段精确匹配，内部转成集合接口的 filter。' }),
      FIELD.text('sort', '排序', { default: '', width: 'medium', placeholder: 'createdAt:desc' }),
      FIELD.text('fields', '字段投影', { default: '', width: 'medium', placeholder: 'id,title' }),
      FIELD.text('output', '输出变量', { default: 'rows', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$', hint: '后续节点用 {{rows.items}} 引用。' })
    ]
  },

  'db.insertCollection': {
    category: 'data',
    label: '写入集合',
    summary: '把对象写入集合，输出新行',
    color: 'data',
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.text('collection', '集合 ID', { default: 'items', width: 'short', required: true, pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }),
      FIELD.expression('body', '写入内容', { default: '{{request.body}}', hint: '必须是对象；字段按集合定义校验。' }),
      FIELD.text('output', '输出变量', { default: 'created', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$' })
    ]
  },

  'file.read': {
    category: 'data',
    label: '读取文件',
    summary: '读取 data/files 下的文件',
    color: 'data',
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.text('path', '文件路径', { default: '', required: true, width: 'medium', placeholder: 'uploads/a.txt', hint: '相对 data/files；不允许 .. 或绝对路径。' }),
      FIELD.select('encoding', '编码', ['utf8', 'base64'], { default: 'utf8' }),
      FIELD.text('output', '输出变量', { default: 'file', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$' })
    ]
  },

  'file.write': {
    category: 'data',
    label: '写入文件',
    summary: '写入 data/files 下的文件',
    color: 'data',
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.text('path', '文件路径', { default: '', required: true, width: 'medium', placeholder: 'out/result.json', hint: '相对 data/files；父目录会自动创建。' }),
      FIELD.expression('content', '写入内容', { default: '', required: true, hint: '字符串或可 JSON 序列化的值；单文件上限 1 MB。' }),
      FIELD.toggle('append', '追加写入', { default: false })
    ]
  },

  'http.request': {
    category: 'data',
    label: '外部 HTTP',
    summary: '调用外部接口，输出 { status, data }',
    color: 'data',
    // Rust 模板没有 HTTP 客户端依赖：设计上就不纳入能力矩阵。
    languages: ['node', 'go'],
    implementedLanguages: ['node', 'go'],
    fields: [
      FIELD.select('method', '方法', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], { default: 'GET' }),
      FIELD.text('url', '地址', { default: '', required: true, placeholder: 'https://api.example.com/items', hint: '只允许 http/https；禁止本机与内网地址。' }),
      FIELD.textarea('headers', '请求头', { default: '{}', rows: 3, json: true }),
      FIELD.textarea('body', '请求体', { default: '', rows: 3, hint: '可写 JSON 模板；GET/HEAD 会忽略。' }),
      FIELD.number('timeoutMs', '超时（毫秒）', { default: 8000, min: 100, max: 60000 }),
      FIELD.text('output', '输出变量', { default: 'response', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$' })
    ]
  },

  'data.transform': {
    category: 'transform',
    label: '数据变换',
    summary: '挑字段或按模板重组',
    color: 'transform',
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.select('mode', '方式', ['pick', 'template'], { default: 'pick', hint: 'pick 只保留字段；template 按 JSON 模板拼装。' }),
      FIELD.expression('input', '输入数据', { default: '{{rows.items}}', required: true }),
      FIELD.text('fields', '保留字段', { default: 'id,title', width: 'full', placeholder: 'id,title', hint: '仅 pick 方式使用，逗号分隔。' }),
      FIELD.textarea('template', '输出模板', { default: '{\n  "items": "{{rows.items}}"\n}', rows: 5, json: true, hint: '仅 template 方式使用；{{…}} 会被替换成真实值。' }),
      FIELD.text('output', '输出变量', { default: 'data', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$' })
    ]
  },

  'flow.branch': {
    category: 'control',
    label: '条件分支',
    summary: 'if / else 两棵子树',
    color: 'control',
    container: true,
    implementedLanguages: FLOW_LANGUAGES.slice(),
    slots: [
      { key: 'children', label: '满足条件' },
      { key: 'elseChildren', label: '否则' }
    ],
    fields: [
      FIELD.expression('condition', '条件', {
        default: '{{request.query.debug === "1"}}',
        required: true,
        hint: '支持比较与 && / ||，例如 {{rows.total > 0}}。'
      })
    ]
  },

  'flow.loop': {
    category: 'control',
    label: '循环',
    summary: '遍历数组，可收集结果',
    color: 'control',
    container: true,
    implementedLanguages: FLOW_LANGUAGES.slice(),
    slots: [{ key: 'children', label: '循环体' }],
    fields: [
      FIELD.expression('source', '数据源', { default: '{{rows.items}}', required: true, hint: '必须是数组；非数组按空数组处理。' }),
      FIELD.text('itemVar', '当前项变量', { default: 'item', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$' }),
      FIELD.number('maxIterations', '最大次数', { default: 100, min: 1, max: 1000, hint: '超过上限的部分会被截断，避免死循环。' }),
      FIELD.expression('collect', '收集表达式', { default: '{{item}}', hint: '每次循环追加入输出数组；留空则收集当前项。' }),
      FIELD.text('output', '输出变量', { default: 'loopItems', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$' })
    ]
  },

  'response.json': {
    category: 'output',
    label: '返回 JSON',
    summary: '状态码 + 响应体 + 响应头',
    color: 'output',
    implementedLanguages: FLOW_LANGUAGES.slice(),
    fields: [
      FIELD.number('status', '状态码', { default: 200, min: 100, max: 599 }),
      FIELD.textarea('body', '响应体', {
        default: '{\n  "ok": true\n}',
        rows: 6,
        json: true,
        required: true,
        hint: 'JSON 模板；{{…}} 会被替换成真实值。'
      }),
      FIELD.textarea('headers', '响应头', { default: '{}', rows: 3, json: true, hint: 'JSON 对象；不能包含换行。' })
    ]
  },

  'component.custom': {
    category: 'component',
    label: '自定义组件',
    summary: '项目内或全局的后端组件',
    color: 'component',
    // 组件自身声明支持哪些语言，节点上取组件定义的 languages。
    languages: FLOW_LANGUAGES.slice(),
    // 组件实现目前只有 Node 的运行时装配；Rust/Go 会明确报“组件 codegen 未接入”。
    implementedLanguages: ['node'],
    componentNode: true,
    fields: [
      {
        key: 'component',
        label: '组件',
        kind: 'select',
        width: 'full',
        required: true,
        options: [],
        componentOptions: true,
        hint: '组件定义来自后端组件库；项目内组件跟随站点目录，全局组件可跨项目复用。'
      },
      FIELD.textarea('args', '调用参数', {
        default: '{\n  "input": "{{request.body}}"\n}',
        rows: 5,
        json: true,
        hint: 'JSON 对象；字符串里的 {{…}} 会按表达式求值后传给组件。'
      }),
      FIELD.text('output', '输出变量', { default: 'componentResult', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$' })
    ]
  },

  'code.node': {
    category: 'code',
    label: '用户代码',
    summary: '写入 custom/，生成过程不改写',
    color: 'code',
    codeNode: true,
    languages: FLOW_LANGUAGES.slice(),
    // 用户代码目前只有 Node 的 custom/ 装配；Rust/Go 会明确报“代码节点未接入”。
    implementedLanguages: ['node'],
    fields: [
      FIELD.select('codeLanguage', '代码语言', FLOW_LANGUAGES, {
        default: 'node',
        required: true,
        hint: '这个代码节点属于哪种语言；只有生成该语言时才参与，其他语言会跳过并在诊断里说明。'
      }),
      FIELD.text('output', '输出变量', { default: 'code', width: 'short', required: true, pattern: '^[a-z][a-z0-9_]{0,31}$', hint: 'run(ctx) 的返回值写入该变量。' })
    ]
  }
};

// 没写 languages 的内置积木默认按“三种语言都能翻译”设计；当前只有 Node 有 codegen。
for (const def of Object.values(NODE_TYPES)) {
  if (!Array.isArray(def.languages)) def.languages = FLOW_LANGUAGES.slice();
  if (!Array.isArray(def.implementedLanguages)) def.implementedLanguages = ['node'];
  if (!def.produces) def.produces = true;
}

export const NODE_TYPE_LIST = Object.keys(NODE_TYPES).map((type) => ({ type, ...NODE_TYPES[type] }));

export function nodeType(type) {
  return NODE_TYPES[String(type || '')] || null;
}

export function isContainer(node) {
  const def = nodeType(node && node.type);
  return Boolean(def && def.container);
}

export function codeFileFor(flowId, nodeId, language = 'node') {
  if (language === 'rust') return `src/custom/handlers/${flowId}.${nodeId}.rs`;
  if (language === 'go') return `src/custom/handlers/${flowId}.${nodeId}.go`;
  return `src/custom/handlers/${flowId}.${nodeId}.js`;
}

export function componentFileFor(componentId, language = 'node') {
  if (language === 'rust') return `src/custom/components/${componentId}.rs`;
  if (language === 'go') return `src/custom/components/${componentId}.go`;
  return `src/custom/components/${componentId}.js`;
}

export function codeTemplate(flowId, nodeId, label) {
  return `// 用户代码 · 不会被平台生成过程改写。
// 流程 ${flowId} 的节点 ${nodeId}（${label || '用户代码'}）。
// ctx: { vars, request, reply, deps }
// 返回值为该节点的输出变量。
export async function run(ctx) {
  const { vars, request, deps } = ctx
  return {
    ok: true,
    method: request.method,
    url: request.url
  }
}
`;
}

// 节点参数补默认值；未知参数保留，避免旧草稿被静默丢弃。
export function applyDefaults(type, params = {}) {
  const def = nodeType(type);
  const out = { ...params };
  if (!def) return out;
  for (const field of def.fields) {
    if (field.default !== undefined && out[field.key] === undefined) {
      out[field.key] = Array.isArray(field.default) ? [] : field.default;
    }
  }
  return out;
}

let nodeSeq = 0;

export function newNode(type, overrides = {}) {
  const def = nodeType(type);
  if (!def) throw new Error('未知节点类型：' + type);
  nodeSeq += 1;
  const prefix = {
    entry: 'entry',
    middleware: 'mw',
    data: 'db',
    transform: 'tf',
    control: 'ctl',
    output: 'res',
    component: 'cmp',
    code: 'code'
  }[def.category] || 'n';
  const id = overrides.id || `${prefix}_${Date.now().toString(36).slice(-4)}${nodeSeq.toString(36)}`;
  return {
    id,
    type,
    name: overrides.name || def.label,
    enabled: true,
    params: applyDefaults(type, overrides.params || {}),
    children: overrides.children || [],
    elseChildren: overrides.elseChildren || []
  };
}

export function defaultFlow(siteId, language = FLOW_LANGUAGE) {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    siteId,
    language,
    flow: {
      id: FLOW_ID,
      name: '默认流程',
      treeVersion: 0,
      lastCompiledAt: '',
      lastTreeHash: '',
      root: {
        id: 'root',
        type: 'flow.root',
        name: '流程根',
        enabled: true,
        params: {},
        children: [
          newNode('entry.request', { id: 'entry_main', name: 'GET /api/example', params: { method: 'GET', path: '/api/example', params: [] } }),
          newNode('response.json', { id: 'res_main', name: '返回 JSON', params: { status: 200, body: '{\n  "ok": true\n}', headers: '{}' } })
        ]
      }
    },
    settings: {
      configCenter: { definitions: [], values: {} }
    }
  };
}

// 纵向切片样例：入口 → CORS → 日志 → 读集合 items → 返回 JSON。
export function sampleFlow(siteId, language = FLOW_LANGUAGE) {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    siteId,
    language,
    flow: {
      id: FLOW_ID,
      name: '物品列表接口',
      treeVersion: 0,
      lastCompiledAt: '',
      lastTreeHash: '',
      root: {
        id: 'root',
        type: 'flow.root',
        name: '流程根',
        enabled: true,
        params: {},
        children: [
          newNode('entry.request', {
            id: 'entry_items',
            name: 'GET /api/items',
            params: {
              method: 'GET',
              path: '/api/items',
              params: [
                { name: 'pageSize', in: 'query', type: 'number', required: false }
              ]
            }
          }),
          newNode('middleware.cors', { id: 'mw_cors', name: 'CORS', params: { origins: '*', credentials: false, maxAgeSeconds: 600 } }),
          newNode('middleware.log', { id: 'mw_log', name: '访问日志', params: { level: 'info', skipHealth: true } }),
          newNode('db.readCollection', {
            id: 'db_items',
            name: '读取集合 items',
            params: {
              collection: 'items',
              page: '{{request.query.page}}',
              pageSize: '{{request.query.pageSize}}',
              q: '{{request.query.q}}',
              sort: '',
              fields: '',
              output: 'rows'
            }
          }),
          newNode('response.json', {
            id: 'res_items',
            name: '返回列表 JSON',
            params: {
              status: 200,
              body: '{\n  "items": "{{rows.items}}",\n  "total": "{{rows.total}}"\n}',
              headers: '{}'
            }
          })
        ]
      }
    },
    settings: {
      configCenter: {
        definitions: [
          { key: 'appName', type: 'string', default: '积木示例', description: '给用户代码读取的站点名称' }
        ],
        values: {}
      }
    }
  };
}
