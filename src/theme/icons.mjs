/* 低代码平台 · 图标集
 *
 * 一套 24×24 网格、1.75 描边、圆头端点线性图标。全部内联 SVG，不引图标库 CDN、
 * 不引外部字体、不用 iconfont。
 *
 * 用法（构建产物 lc-icons.html 是一段可直接粘到 <body> 开头的 sprite）：
 *   <svg class="lc-icon" aria-hidden="true"><use href="#lc-icon-save"></use></svg>
 *   颜色：图形统一走 currentColor，父级 color 改什么图标就是什么；
 *   尺寸：.lc-icon 默认 16px，可加 .lc-icon-sm/-lg/-xl，或设 --lc-icon-size；
 *   描边：默认 1.75，父级设 --lc-icon-stroke 可加粗/减细（建议 1.5–2.25）。
 *
 * 图标按 id 取用，id 规则固定为 lc-icon-<name>，name 见 ICON_SET。
 * 所有图标在同一网格上画：视觉重心落在 x=12、y=12 附近，端点半径 1.75 像素，
 * 所以并排摆放不会出现有的偏高、有的偏沉。
 */

export const ICON_SIZE = 24;
export const ICON_STROKE = 1.75;

/* 形状 DSL：
 *   ['p', d]             描边路径
 *   ['c', cx, cy, r, fill]  圆；fill=true 时用实心点（如省略号、拖拽手柄）
 *   ['r', x, y, w, h, rx]    圆角矩形
 */
export const ICON_SET = [
  /* 编辑与操作 */
  { id: 'add', label: '新增', shapes: [['p', 'M12 5v14'], ['p', 'M5 12h14']] },
  { id: 'remove', label: '移除', shapes: [['p', 'M5 12h14']] },
  {
    id: 'delete',
    label: '删除',
    shapes: [
      ['p', 'M4.5 7h15'],
      ['p', 'M9 7V5.5h6V7'],
      ['p', 'M6.5 7l.9 12.5h9.2L17.5 7'],
      ['p', 'M10 10.5v5.5'],
      ['p', 'M14 10.5v5.5']
    ]
  },
  {
    id: 'edit',
    label: '编辑',
    shapes: [
      ['p', 'M12.5 5H5.5a1 1 0 0 0-1 1v12.5a1 1 0 0 0 1 1H18a1 1 0 0 0 1-1V12'],
      ['p', 'M17 4.2l2.8 2.8-8.4 8.4-3.8 1 1-3.8 8.4-8.4z']
    ]
  },
  {
    id: 'copy',
    label: '复制',
    shapes: [
      ['p', 'M9 8V6.5A1.5 1.5 0 0 1 10.5 5H19A1.5 1.5 0 0 1 20.5 6.5V15A1.5 1.5 0 0 1 19 16.5h-1.8'],
      ['p', 'M5 9.5A1.5 1.5 0 0 1 6.5 8H15a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 15 19.5H6.5A1.5 1.5 0 0 1 5 18V9.5z']
    ]
  },
  {
    id: 'undo',
    label: '撤销',
    shapes: [['p', 'M9.5 14.5L4.5 9.5l5-5'], ['p', 'M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H10']]
  },
  {
    id: 'redo',
    label: '重做',
    shapes: [['p', 'M14.5 14.5l5-5-5-5'], ['p', 'M19.5 9.5H10a5.5 5.5 0 0 0 0 11h4']]
  },
  {
    id: 'save',
    label: '保存',
    shapes: [
      ['p', 'M5.5 5.5a1 1 0 0 1 1-1h8l4 4v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-13z'],
      ['p', 'M8.5 4.5v3.5h5.5V4.5'],
      ['r', 8.5, 13, 7, 6.5, 1]
    ]
  },
  {
    id: 'export',
    label: '导出',
    shapes: [['p', 'M12 4v11'], ['p', 'M7.5 7.5L12 3l4.5 4.5'], ['p', 'M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15']]
  },
  {
    id: 'download',
    label: '下载',
    shapes: [['p', 'M12 4v11'], ['p', 'M7.5 10.5L12 15l4.5-4.5'], ['p', 'M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15']]
  },
  {
    id: 'upload',
    label: '上传',
    shapes: [['p', 'M12 15V4'], ['p', 'M7.5 8.5L12 4l4.5 4.5'], ['p', 'M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15']]
  },
  { id: 'run', label: '运行', shapes: [['p', 'M8 5.5v13L19 12z']] },
  { id: 'close', label: '关闭', shapes: [['p', 'M6 6l12 12'], ['p', 'M18 6l-12 12']] },
  {
    id: 'more',
    label: '更多（横向）',
    shapes: [['c', 6, 12, 1.5, true], ['c', 12, 12, 1.5, true], ['c', 18, 12, 1.5, true]]
  },
  {
    id: 'more-vertical',
    label: '更多（纵向）',
    shapes: [['c', 12, 6, 1.5, true], ['c', 12, 12, 1.5, true], ['c', 12, 18, 1.5, true]]
  },

  /* 展开与拖拽 */
  {
    id: 'grip',
    label: '拖拽手柄',
    shapes: [
      ['c', 9, 7, 1.3, true], ['c', 15, 7, 1.3, true],
      ['c', 9, 12, 1.3, true], ['c', 15, 12, 1.3, true],
      ['c', 9, 17, 1.3, true], ['c', 15, 17, 1.3, true]
    ]
  },
  { id: 'chevron-down', label: '展开', shapes: [['p', 'M6 9.5l6 5.5 6-5.5']] },
  { id: 'chevron-right', label: '收起', shapes: [['p', 'M9 5.5l6.5 6.5-6.5 6.5']] },
  { id: 'chevron-up', label: '向上收起', shapes: [['p', 'M6 14.5l6-5.5 6 5.5']] },

  /* 可见性与状态 */
  {
    id: 'eye',
    label: '可见',
    shapes: [['p', 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'], ['c', 12, 12, 3]]
  },
  {
    id: 'eye-off',
    label: '隐藏',
    shapes: [
      ['p', 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'],
      ['c', 12, 12, 3],
      ['p', 'M4 4l16 16']
    ]
  },
  {
    id: 'lock',
    label: '锁定',
    shapes: [
      ['p', 'M6 11.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z'],
      ['p', 'M8.5 11.5V8a3.5 3.5 0 0 1 7 0v3.5'],
      ['c', 12, 16, 1.2, true]
    ]
  },
  {
    id: 'unlock',
    label: '解锁',
    shapes: [
      ['p', 'M6 11.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z'],
      ['p', 'M8.5 11.5V8a3.5 3.5 0 0 1 6.6-1.6'],
      ['c', 12, 16, 1.2, true]
    ]
  },
  { id: 'check', label: '完成', shapes: [['p', 'M5 12.5l4.5 4.5L19 7']] },
  {
    id: 'warning',
    label: '警告',
    shapes: [['p', 'M12 4.5l8 14.5h-16z'], ['p', 'M12 9.5v4.5'], ['c', 12, 17.2, 1, true]]
  },
  {
    id: 'info',
    label: '信息',
    shapes: [['c', 12, 12, 8.5], ['p', 'M12 11v5.5'], ['c', 12, 7.8, 1.1, true]]
  },
  {
    id: 'help',
    label: '帮助',
    shapes: [
      ['c', 12, 12, 8.5],
      ['p', 'M9.4 9.2a2.7 2.7 0 0 1 5.3 1c0 1.9-2.5 2.2-2.5 3.6'],
      ['c', 12, 17, 1.1, true]
    ]
  },

  /* 查找与排列 */
  { id: 'search', label: '搜索', shapes: [['c', 11, 11, 6.5], ['p', 'M16 16l4.5 4.5']] },
  { id: 'filter', label: '筛选', shapes: [['p', 'M4 5.5h16l-6.2 7.2v6l-3.6 2v-8z']] },
  {
    id: 'sort',
    label: '排序',
    shapes: [['p', 'M8 19V5'], ['p', 'M4.5 8.5L8 5l3.5 3.5'], ['p', 'M16 5v14'], ['p', 'M12.5 15.5L16 19l3.5-3.5']]
  },
  {
    id: 'grid',
    label: '网格',
    shapes: [['r', 4.5, 4.5, 6, 6, 1], ['r', 13.5, 4.5, 6, 6, 1], ['r', 4.5, 13.5, 6, 6, 1], ['r', 13.5, 13.5, 6, 6, 1]]
  },
  {
    id: 'layers',
    label: '图层',
    shapes: [
      ['p', 'M12 3.5l8.5 4.8-8.5 4.8-8.5-4.8 8.5-4.8z'],
      ['p', 'M3.5 12.2l8.5 4.8 8.5-4.8'],
      ['p', 'M3.5 16.2l8.5 4.8 8.5-4.8']
    ]
  },
  {
    id: 'settings',
    label: '设置',
    shapes: [
      ['p', 'M4.5 6.5h9'], ['p', 'M18 6.5h2'], ['c', 15.8, 6.5, 2],
      ['p', 'M4.5 12h2'], ['p', 'M10.5 12h9.5'], ['c', 8.5, 12, 2],
      ['p', 'M4.5 17.5h10.5'], ['p', 'M19 17.5h.5'], ['c', 17, 17.5, 2]
    ]
  },
  {
    id: 'palette',
    label: '色板',
    shapes: [
      ['c', 12, 12, 8.5],
      ['c', 9, 9.5, 1.2, true],
      ['c', 15, 9.5, 1.2, true],
      ['c', 10, 15.5, 1.2, true]
    ]
  },

  /* 内容类型 */
  { id: 'text', label: '文本', shapes: [['p', 'M5.5 6.5V4.5h13v2'], ['p', 'M12 4.5v15'], ['p', 'M8.5 19.5h7']] },
  {
    id: 'image',
    label: '图片',
    shapes: [['r', 4, 5.5, 16, 13, 1.5], ['c', 9, 10.2, 1.4, true], ['p', 'M5.5 16.5l4.3-4.6 3.7 3.7 2.6-2.6 4.4 4.4']]
  },
  {
    id: 'link',
    label: '链接',
    shapes: [
      ['p', 'M10.2 14a3.4 3.4 0 0 1 0-4.9l2.9-2.9a3.4 3.4 0 0 1 4.9 4.9l-1.5 1.5'],
      ['p', 'M13.8 10a3.4 3.4 0 0 1 0 4.9l-2.9 2.9a3.4 3.4 0 0 1-4.9-4.9l1.5-1.5']
    ]
  },
  {
    id: 'external',
    label: '外部打开',
    shapes: [
      ['p', 'M14 4.5h6v6'],
      ['p', 'M20 4.5l-8.5 8.5'],
      ['p', 'M18 14v5.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h5.5']
    ]
  }
];

/* 分组只影响预览页的排列顺序，不影响取用。 */
export const ICON_GROUPS = [
  { label: '编辑与操作', ids: ['add', 'remove', 'delete', 'edit', 'copy', 'undo', 'redo', 'save', 'export', 'download', 'upload', 'run', 'close', 'more', 'more-vertical'] },
  { label: '展开与拖拽', ids: ['grip', 'chevron-down', 'chevron-right', 'chevron-up'] },
  { label: '可见性与状态', ids: ['eye', 'eye-off', 'lock', 'unlock', 'check', 'warning', 'info', 'help'] },
  { label: '查找与排列', ids: ['search', 'filter', 'sort', 'grid', 'layers', 'settings', 'palette'] },
  { label: '内容类型', ids: ['text', 'image', 'link', 'external'] }
];

/* 任务要求覆盖的常见动作。check.mjs 会核对一个都不能少。 */
export const REQUIRED_ICON_IDS = [
  'add', 'remove', 'delete', 'edit', 'copy', 'undo', 'redo',
  'grip', 'chevron-down', 'chevron-right', 'eye', 'eye-off',
  'lock', 'unlock', 'save', 'export', 'run', 'search', 'filter',
  'sort', 'close', 'more'
];

export const ICON_IDS = ICON_SET.map((icon) => icon.id);

export const ICON_USAGE = `<svg class="lc-icon" aria-hidden="true"><use href="#lc-icon-save"></use></svg>`;

/* ---------------- 生成 ---------------- */

function shapeMarkup(shape) {
  if (shape[0] === 'p') return `<path d="${shape[1]}"/>`;
  if (shape[0] === 'c') {
    const [, cx, cy, r, filled] = shape;
    return `<circle cx="${cx}" cy="${cy}" r="${r}"${filled ? ' fill="currentColor" stroke="none"' : ''}/>`;
  }
  if (shape[0] === 'r') {
    const [, x, y, w, h, rx] = shape;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}/>`;
  }
  throw new Error(`不认识的图形类型：${shape[0]}`);
}

export function renderSymbol(icon) {
  return `  <symbol id="lc-icon-${icon.id}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">${icon.shapes.map(shapeMarkup).join('')}</symbol>`;
}

/* 返回一段可直接粘进 HTML 的 sprite。造型的 fill/stroke 由 .lc-icon svg 统一下发，
   这里只给实心点写 fill，保证换描边色时实心点也跟着 currentColor 走。 */
export function spriteMarkup() {
  return [
    '<svg class="lc-sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">',
    ...ICON_SET.map(renderSymbol),
    '</svg>'
  ].join('\n');
}

export function iconMarkup(id, className = '', label = '') {
  const cls = ['lc-icon', className].filter(Boolean).join(' ');
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="${cls}" ${a11y}><use href="#lc-icon-${id}"></use></svg>`;
}
