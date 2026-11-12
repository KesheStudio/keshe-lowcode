/* 渲染核心 · 内置组件 · 表格
   列定义、排序、分页、行选择；缺列时按首行键名推导，缺数据时进入空状态。
   交互与渲染分离：render 输出静态结构 + 数据岛，enhance 才绑定排序/分页/选择。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../dom.js'), require('./common.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    root.LC.Render.Components = root.LC.Render.Components || {};
    factory(root.LC.Render, root.LC.Render.ComponentsCommon);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (dom, kit) {
  'use strict';

  var h = dom.h;
  var raw = dom.raw;
  var escapeHtml = dom.escapeHtml;

  var ALIGN = { left: 'left', center: 'center', right: 'right' };
  var FORMAT = { text: 1, number: 1, date: 1 };

  /* 虚拟滚动：展示行数达到阈值才启用，避免小表格为此付出额外 DOM。 */
  var VIRTUAL_MIN = 200;
  var VIRTUAL_BUFFER = 6;
  var DEFAULT_ROW_H = 37;
  var DEFAULT_VIEWPORT = 360;
  var TABLE_SEED = 0;

  function virtualConfig(block, displayCount, dense) {
    var mode = kit.prop(block, 'virtual', 'auto');
    var on = mode === true || (mode !== false && displayCount >= VIRTUAL_MIN);
    if (!on) return { on: false };
    var fallback = dense ? 29 : DEFAULT_ROW_H;
    return {
      on: true,
      rowHeight: Math.max(20, kit.num(kit.prop(block, 'rowHeight', fallback), fallback)),
      height: Math.max(80, kit.num(kit.prop(block, 'height', DEFAULT_VIEWPORT), DEFAULT_VIEWPORT))
    };
  }

  function windowRange(scrollTop, viewportHeight, rowHeight, total, buffer) {
    var size = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    var span = Math.min(total, size + buffer * 2);
    var start = Math.floor(Math.max(0, scrollTop) / rowHeight) - buffer;
    if (start < 0) start = 0;
    if (start + span > total) start = Math.max(0, total - span);
    return { start: start, end: Math.min(total, start + span) };
  }

  var SCHEMA = {
    type: 'ui-table',
    name: '表格',
    version: 1,
    description: '列定义、排序、分页、行选择，支持空/加载/错误状态。',
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:table-sort', 'lc:table-page', 'lc:table-select'],
    props: {
      columns: {
        type: 'array',
        label: '列定义',
        required: true,
        default: [],
        description: '缺省时按首行键名推导；每项支持 key/title/align/width/sortable/format/empty。',
        items: {
          type: 'object',
          props: {
            key: { type: 'string', label: '字段名', required: true },
            title: { type: 'string', label: '表头' },
            align: { type: 'enum', label: '对齐', options: ['left', 'center', 'right'], default: 'left' },
            width: { type: 'string', label: '列宽', description: '数字按 px，字符串原样。' },
            sortable: { type: 'boolean', label: '可排序', default: true },
            format: { type: 'enum', label: '格式', options: ['text', 'number', 'date'], default: 'text' },
            empty: { type: 'string', label: '空值占位', default: '—' }
          }
        }
      },
      rows: { type: 'array', label: '行数据', default: [], items: { type: 'object' } },
      rowKey: { type: 'string', label: '行标识字段', default: 'id' },
      pageSize: { type: 'number', label: '每页条数', default: 8, min: 0, description: '0 表示不分页。' },
      page: { type: 'number', label: '初始页', default: 1, min: 1 },
      virtual: { type: 'enum', label: '虚拟滚动', options: ['auto', true, false], default: 'auto', description: 'auto 在展示行数 ≥ 200 时启用；多行单元格请关闭虚拟滚动并按页渲染。' },
      height: { type: 'number', label: '可视高度', default: DEFAULT_VIEWPORT, description: '虚拟滚动容器高度（px）。' },
      rowHeight: { type: 'number', label: '行高', default: DEFAULT_ROW_H, description: '虚拟滚动固定行高（px）；固定行高是精确跳转的前提，行高不一致时请关闭虚拟滚动。' },
      selectable: { type: 'boolean', label: '行选择', default: false },
      sortKey: { type: 'string', label: '初始排序列', default: '' },
      sortDir: { type: 'enum', label: '初始排序方向', options: ['asc', 'desc'], default: 'asc' },
      caption: { type: 'string', label: '表格标题' },
      dense: { type: 'boolean', label: '紧凑模式', default: false },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' },
      emptyText: { type: 'string', label: '空状态文案', default: '暂无数据' },
      loadingText: { type: 'string', label: '加载文案', default: '' },
      errorText: { type: 'string', label: '错误文案', default: '' },
      retryLabel: { type: 'string', label: '重试按钮', default: '重试' }
    }
  };

  function normalizeColumns(columns, rows) {
    var source = Array.isArray(columns) ? columns : [];
    var list = source.filter(function (col) { return col && typeof col === 'object'; }).map(function (col, index) {
      var key = String(col.key == null ? 'col-' + (index + 1) : col.key);
      var align = ALIGN[col.align] || 'left';
      var format = FORMAT[col.format] ? col.format : 'text';
      var width = col.width == null || col.width === '' ? null : col.width;
      return {
        key: key,
        title: col.title == null ? key : String(col.title),
        align: align,
        width: typeof width === 'number' ? width + 'px' : width,
        sortable: col.sortable !== false,
        format: format,
        empty: col.empty == null ? '—' : String(col.empty)
      };
    });
    if (list.length) return list;

    var first = Array.isArray(rows) && rows.length && rows[0] && typeof rows[0] === 'object' ? rows[0] : null;
    if (!first) return [];
    return Object.keys(first).map(function (key) {
      return {
        key: key,
        title: key,
        align: 'left',
        width: null,
        sortable: true,
        format: 'text',
        empty: '—'
      };
    });
  }

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return row && typeof row === 'object' && !Array.isArray(row);
    });
  }

  function rowValue(row, key) {
    if (!row || !key) return null;
    return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null;
  }

  function rowId(row, key, index) {
    var value = rowValue(row, key);
    if (value == null || value === '') return 'row-' + index;
    return String(value);
  }

  function formatDate(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    var month = ('0' + (date.getMonth() + 1)).slice(-2);
    var day = ('0' + date.getDate()).slice(-2);
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function formatCell(value, column) {
    if (value == null || value === '') return column && column.empty != null ? column.empty : '—';
    if (column && column.format === 'number') {
      var number = Number(value);
      if (isFinite(number)) return String(number);
    }
    if (column && column.format === 'date') return formatDate(value);
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (error) { return String(value); }
    }
    return String(value);
  }

  function compareValues(a, b, column) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    var forceNumber = column && column.format === 'number';
    var na = Number(a);
    var nb = Number(b);
    if (forceNumber || (isFinite(na) && isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '')) {
      if (na === nb) return 0;
      return na < nb ? -1 : 1;
    }
    var sa = String(a).toLowerCase();
    var sb = String(b).toLowerCase();
    if (sa === sb) return 0;
    return sa < sb ? -1 : 1;
  }

  /* 稳定排序：用原始索引兜底，避免同值行跳动。 */
  function sortRows(rows, key, dir, columns) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    if (!key) return list;
    var column = null;
    (columns || []).forEach(function (item) { if (item && item.key === key) column = item; });
    var factor = dir === 'desc' ? -1 : 1;
    return list.map(function (row, index) { return { row: row, index: index }; })
      .sort(function (a, b) {
        var result = compareValues(rowValue(a.row, key), rowValue(b.row, key), column);
        if (result === 0) return a.index - b.index;
        return result * factor;
      })
      .map(function (item) { return item.row; });
  }

  function paginate(rows, page, pageSize) {
    var list = Array.isArray(rows) ? rows : [];
    var size = kit.num(pageSize, 0);
    if (size < 0) size = 0;
    var totalPages = size > 0 ? Math.max(1, Math.ceil(list.length / size)) : 1;
    var current = kit.clamp(kit.num(page, 1), 1, totalPages);
    var start = size > 0 ? (current - 1) * size : 0;
    var end = size > 0 ? Math.min(list.length, start + size) : list.length;
    return { page: current, totalPages: totalPages, start: start, end: end, rows: list.slice(start, end) };
  }

  function nextSort(key, dir) {
    return { key: key, dir: dir === 'asc' ? 'desc' : 'asc' };
  }

  function buildCell(row, index, column) {
    return h('td', { class: 'lc-ui-td lc-ui-align-' + column.align, style: widthStyle(column) }, [
      formatCell(rowValue(row, column.key), column)
    ]);
  }

  function buildRow(row, index, columns, options) {
    var opts = options || {};
    var absolute = (opts.indexBase || 0) + index;
    var data = { class: 'lc-ui-tr', 'data-lc-row-index': absolute };
    if (opts.rowElementId) data.id = opts.rowElementId;
    if (opts.rowHeight) data.style = { height: opts.rowHeight + 'px' };
    if (opts.selectable) data['data-lc-row'] = opts.idFor(row, absolute);
    var cells = [];
    if (opts.selectable) {
      cells.push(h('td', { class: 'lc-ui-td lc-ui-td-check' }, [
        h('input', {
          type: 'checkbox',
          class: 'lc-ui-check',
          'data-lc-row-check': 'true',
          'data-lc-row-key': opts.idFor(row, absolute),
          value: opts.idFor(row, absolute),
          'aria-label': '选择第 ' + (absolute + 1) + ' 行',
          checked: opts.isSelected && opts.isSelected(opts.idFor(row, absolute)) ? true : null
        })
      ]));
    }
    columns.forEach(function (column) { cells.push(buildCell(row, absolute, column)); });
    return h('tr', data, cells);
  }

  function sortIcon(key, sort) {
    if (!sort.key || sort.key !== key) return kit.icon('sort', 'lc-ui-sort-icon');
    return kit.icon(sort.dir === 'desc' ? 'chevron-down' : 'chevron-up', 'lc-ui-sort-icon is-active');
  }

  function buildHead(columns, options) {
    var opts = options || {};
    var cells = [];
    if (opts.selectable) {
      cells.push(h('th', { class: 'lc-ui-th lc-ui-td-check', scope: 'col' }, [
        h('input', {
          type: 'checkbox',
          class: 'lc-ui-check',
          'data-lc-select-all': 'true',
          'aria-label': '全选本页'
        })
      ]));
    }
    columns.forEach(function (column) {
      var attrs = { class: 'lc-ui-th lc-ui-align-' + column.align, scope: 'col', 'data-lc-col': column.key, style: widthStyle(column) };
      if (column.sortable) attrs['aria-sort'] = opts.sort && opts.sort.key === column.key
        ? (opts.sort.dir === 'desc' ? 'descending' : 'ascending') : 'none';
      cells.push(h('th', attrs, [
        column.sortable ? h('button', {
          type: 'button',
          class: 'lc-ui-sort-btn',
          'data-lc-sort': column.key,
          'aria-label': '按 ' + column.title + ' 排序'
        }, [column.title, sortIcon(column.key, opts.sort || {})]) : column.title
      ]));
    });
    return h('thead', { class: 'lc-ui-thead' }, [h('tr', {}, cells)]);
  }

  function widthStyle(column) {
    return column.width ? { width: column.width } : null;
  }

  function buildPager(pager) {
    var hidden = !(pager.totalPages > 1);
    return h('div', {
      class: 'lc-ui-pager',
      'data-lc-pager': 'true',
      hidden: hidden,
      'aria-live': 'polite'
    }, [
      h('button', {
        type: 'button',
        class: 'lc-ui-action',
        'data-lc-page-prev': 'true',
        'aria-label': '上一页',
        disabled: pager.page <= 1 ? true : null
      }, [kit.icon('chevron-right', 'lc-icon-sm lc-ui-flip')]),
      h('span', { class: 'lc-ui-pager-info', 'data-lc-page-info': 'true' }, '第 ' + pager.page + ' / ' + pager.totalPages + ' 页'),
      h('button', {
        type: 'button',
        class: 'lc-ui-action',
        'data-lc-page-next': 'true',
        'aria-label': '下一页',
        disabled: pager.page >= pager.totalPages ? true : null
      }, [kit.icon('chevron-right', 'lc-icon-sm')])
    ]);
  }

  /* 上下填充行撑出真实滚动条高度；行高固定，总高度 = 行数 × 行高。 */
  function buildPadRow(count, colSpan, height, position) {
    if (count <= 0 || height <= 0) return null;
    return h('tr', {
      class: 'lc-ui-virtual-pad',
      'data-lc-pad': position,
      'aria-hidden': 'true'
    }, [
      h('td', { colspan: colSpan, style: { height: height + 'px', padding: '0', border: '0' } })
    ]);
  }

  function buildVirtualBar(total, start, end) {
    return h('div', { class: 'lc-ui-virtual-bar', 'data-lc-virtual-bar': 'true' }, [
      h('span', { class: 'lc-ui-virtual-info', 'data-lc-virtual-info': 'true' }, (start + 1) + '–' + end + ' / ' + total + ' 行'),
      h('span', { class: 'lc-ui-virtual-actions' }, [
        h('button', {
          type: 'button', class: 'lc-ui-icon-btn', 'data-lc-jump-top': 'true', 'aria-label': '跳到第一行'
        }, '↑'),
        h('button', {
          type: 'button', class: 'lc-ui-icon-btn', 'data-lc-jump-bottom': 'true', 'aria-label': '跳到最后一行'
        }, '↓')
      ])
    ]);
  }

  function render(block, ctx) {
    var columns = normalizeColumns(kit.prop(block, 'columns', []), kit.prop(block, 'rows', []));
    var rows = normalizeRows(kit.prop(block, 'rows', []));
    var rowKey = kit.prop(block, 'rowKey', 'id');
    var pageSize = kit.num(kit.prop(block, 'pageSize', 8), 8);
    var initialPage = kit.num(kit.prop(block, 'page', 1), 1);
    var selectable = kit.bool(kit.prop(block, 'selectable', false), false);
    var dense = kit.bool(kit.prop(block, 'dense', false), false);

    var hasData = rows.length > 0 && columns.length > 0;
    var state = kit.stateOf(block, hasData);
    var caption = kit.prop(block, 'caption', '');
    var emptyText = kit.prop(block, 'emptyText', '暂无数据');
    var loadingText = kit.prop(block, 'loadingText', '');
    var errorText = kit.prop(block, 'errorText', '');
    var retryLabel = kit.prop(block, 'retryLabel', '重试');

    var sortKey = kit.prop(block, 'sortKey', '');
    var sortDir = kit.prop(block, 'sortDir', 'asc') === 'desc' ? 'desc' : 'asc';
    if (sortKey) rows = sortRows(rows, sortKey, sortDir, columns);

    var pager = paginate(rows, initialPage, pageSize);
    var sort = { key: sortKey || '', dir: sortDir };
    var vc = virtualConfig(block, pager.rows.length, dense);
    var colSpan = columns.length + (selectable ? 1 : 0);

    var rootAttrs = {
      class: 'lc-ui lc-ui-table' + (dense ? ' lc-ui-table-dense' : '') + (vc.on ? ' lc-ui-table-virtual' : ''),
      'data-lc-ui': 'ui-table',
      'data-lc-state': state
    };
    if (vc.on) {
      rootAttrs['data-lc-virtual'] = 'true';
      rootAttrs['data-lc-row-height'] = vc.rowHeight;
      rootAttrs['data-lc-viewport'] = vc.height;
      rootAttrs.style = { '--lc-table-row-h': vc.rowHeight + 'px' };
    }
    var children = [];

    if (state !== 'ready') {
      children.push(kit.renderStatus(state, {
        title: state === 'loading' ? (loadingText || '正在加载表格') : undefined,
        text: state === 'loading' ? loadingText : (state === 'error' ? (errorText || '表格数据加载失败') : emptyText),
        retry: state === 'error',
        retryLabel: retryLabel,
        variant: state === 'loading' ? 'skeleton' : null,
        lines: 3
      }));
      children.push(raw(kit.jsonIsland({
        columns: columns, rows: rows, rowKey: rowKey, pageSize: pageSize, page: pager.page,
        selectable: selectable, failed: state === 'error', state: state
      })));
      return h('div', rootAttrs, children);
    }

    if (caption) {
      children.push(h('p', { class: 'lc-ui-table-caption', id: kit.uid('lc-ui-caption') }, caption));
    }

    var head = buildHead(columns, { selectable: selectable, sort: sort });
    var windowInfo = vc.on
      ? windowRange(0, vc.height, vc.rowHeight, pager.rows.length, VIRTUAL_BUFFER)
      : { start: 0, end: pager.rows.length };
    var focusable = false;
    var bodyRows = vc.on
      ? [buildPadRow(windowInfo.start, colSpan, windowInfo.start * vc.rowHeight, 'top')].concat(
        buildRowList(pager.rows.slice(windowInfo.start, windowInfo.end), columns, {
          selectable: selectable,
          indexBase: pager.start + windowInfo.start,
          rowHeight: vc.rowHeight,
          focusable: focusable,
          idFor: function (row, index) { return rowId(row, rowKey, index); }
        }),
        [buildPadRow(pager.rows.length - windowInfo.end, colSpan, (pager.rows.length - windowInfo.end) * vc.rowHeight, 'bottom')]
      )
      : buildRowList(pager.rows, columns, {
        selectable: selectable,
        indexBase: pager.start,
        focusable: focusable,
        idFor: function (row, index) { return rowId(row, rowKey, index); }
      });
    var tableAttrs = {
      class: 'lc-ui-table-el',
      'aria-rowcount': vc.on ? pager.rows.length + 1 : null,
      'aria-colcount': colSpan || null
    };
    if (vc.on) tableAttrs.style = { 'table-layout': 'fixed' };
    var table = h('table', tableAttrs, [
      caption ? h('caption', { class: 'lc-ui-sr-only' }, caption) : null,
      head,
      h('tbody', { class: 'lc-ui-tbody', 'data-lc-tbody': 'true' }, bodyRows)
    ]);

    var scrollAttrs = {
      class: 'lc-ui-table-scroll',
      tabindex: '0',
      role: 'group',
      'aria-label': (caption || '数据表格') + '，可滚动，方向键移动活动行'
    };
    if (vc.on) {
      scrollAttrs['data-lc-table-scroll'] = 'true';
      scrollAttrs.style = { height: vc.height + 'px' };
    }
    children.push(h('div', scrollAttrs, [table]));

    if (vc.on) children.push(buildVirtualBar(pager.rows.length, windowInfo.start, windowInfo.end));

    if (selectable) {
      children.push(h('p', {
        class: 'lc-ui-selection',
        'data-lc-selected': 'true',
        'aria-live': 'polite',
        hidden: true
      }, '已选 0 行'));
    }

    children.push(buildPager(pager));
    children.push(raw(kit.jsonIsland({
      columns: columns, rows: rows, rowKey: rowKey, pageSize: pageSize, page: pager.page,
      selectable: selectable, failed: false, state: 'ready',
      virtual: vc.on, height: vc.on ? vc.height : null, rowHeight: vc.on ? vc.rowHeight : null
    })));
    return h('div', rootAttrs, children);
  }

  function buildRowList(rows, columns, options) {
    return rows.map(function (row, index) { return buildRow(row, index, columns, options); });
  }

  /* ---------------- 运行时增强 ---------------- */

  function enhance(el) {
    if (!el || el.getAttribute('data-lc-enhanced') === 'true') return null;
    var data = kit.readJsonScript(el);
    if (!data || !Array.isArray(data.rows) || !Array.isArray(data.columns)) return null;

    var doc = el.ownerDocument;
    var columns = data.columns;
    var rows = data.rows;
    var rowKey = data.rowKey || 'id';
    var pageSize = kit.num(data.pageSize, 0);
    var selectable = !!data.selectable;
    var sort = { key: String(data.sortKey || ''), dir: 'asc' };
    var page = kit.num(data.page, 1);
    var selected = {};
    var currentRows = rows.slice();
    var destroyed = false;
    var scrollEl = el.querySelector('[data-lc-table-scroll]');
    var virtual = !!data.virtual && !!scrollEl;
    var rowHeight = Math.max(20, kit.num(data.rowHeight, DEFAULT_ROW_H));
    var viewportHeight = Math.max(80, kit.num(data.height, DEFAULT_VIEWPORT));
    var ticking = false;
    var instanceId = el.getAttribute('data-lc-table-id') ||
      ('lc-ui-table-' + (++TABLE_SEED));

    /* 初始排序列可能来自渲染时的 sortKey，从表头 data 属性恢复。 */
    var firstSorted = el.querySelector('th[aria-sort="ascending"], th[aria-sort="descending"]');
    if (firstSorted) {
      sort.key = firstSorted.getAttribute('data-lc-col') || '';
      sort.dir = firstSorted.getAttribute('aria-sort') === 'descending' ? 'desc' : 'asc';
    }
    if (sort.key) currentRows = sortRows(currentRows, sort.key, sort.dir, columns);

    function pager() { return paginate(currentRows, page, pageSize); }

    function syncSelection() {
      var count = Object.keys(selected).length;
      var info = el.querySelector('[data-lc-selected]');
      if (info) {
        if (count) {
          info.textContent = '已选 ' + count + ' 行';
          info.removeAttribute('hidden');
        } else {
          info.textContent = '已选 0 行';
          info.setAttribute('hidden', '');
        }
      }
      var all = el.querySelector('[data-lc-select-all]');
      if (!all) return;
      var current = pager();
      var pageCount = 0;
      if (virtual) {
        pageCount = count;
      } else {
        current.rows.forEach(function (row, index) {
          if (selected[rowId(row, rowKey, current.start + index)]) pageCount += 1;
        });
      }
      all.checked = !!(current.rows.length && pageCount >= current.rows.length);
      all.indeterminate = !!(pageCount > 0 && pageCount < current.rows.length);
    }

    function rowElementId(absolute) { return instanceId + '-row-' + absolute; }
    var activeIndex = null;

    function buildPad(count, height, position) {
      if (count <= 0 || height <= 0) return null;
      var tr = doc.createElement('tr');
      tr.className = 'lc-ui-virtual-pad';
      tr.setAttribute('data-lc-pad', position);
      tr.setAttribute('aria-hidden', 'true');
      var td = doc.createElement('td');
      td.colSpan = columns.length + (selectable ? 1 : 0);
      td.style.height = height + 'px';
      td.style.padding = '0';
      td.style.border = '0';
      tr.appendChild(td);
      return tr;
    }

    function renderBody() {
      var tbody = el.querySelector('[data-lc-tbody]');
      if (!tbody) return;
      var current = pager();
      var total = current.rows.length;
      var range = virtual
        ? windowRange(scrollEl ? scrollEl.scrollTop : 0, viewportHeight, rowHeight, total, VIRTUAL_BUFFER)
        : { start: 0, end: total };
      var start = range.start;
      var end = range.end;
      var fragment = doc.createDocumentFragment();
      var topPad = buildPad(start, start * rowHeight, 'top');
      if (topPad) fragment.appendChild(topPad);
      current.rows.slice(start, end).forEach(function (row, index) {
        var absolute = current.start + start + index;
        fragment.appendChild(dom.toDom(buildRow(row, index, columns, {
          selectable: selectable,
          indexBase: current.start + start,
          rowHeight: virtual ? rowHeight : 0,
          rowElementId: virtual ? rowElementId(absolute) : null,
          idFor: function (item, i) { return rowId(item, rowKey, i); },
          isSelected: function (id) { return !!selected[id]; }
        }), doc));
      });
      var bottomPad = buildPad(total - end, (total - end) * rowHeight, 'bottom');
      if (bottomPad) fragment.appendChild(bottomPad);
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      tbody.appendChild(fragment);

      var info = el.querySelector('[data-lc-virtual-info]');
      if (info) {
        info.textContent = total
          ? (current.start + start + 1) + '–' + (current.start + end) + ' / ' + rows.length + ' 行'
          : '0 / ' + rows.length + ' 行';
      }
      /* 焦点始终留在滚动容器上，活动行只做视觉高亮 + aria-activedescendant，
         这样滚动重绘不会把焦点连同被移除的行一起丢掉。 */
      if (virtual && scrollEl) {
        var rendered = activeIndex != null && activeIndex >= current.start + start &&
          activeIndex < current.start + end;
        var activeRow = rendered ? tbody.querySelector('tr[data-lc-row-index="' + activeIndex + '"]') : null;
        Array.prototype.slice.call(tbody.querySelectorAll('.lc-ui-tr.is-active')).forEach(function (tr) {
          tr.classList.remove('is-active');
        });
        if (activeRow) {
          activeRow.classList.add('is-active');
          scrollEl.setAttribute('aria-activedescendant', rowElementId(activeIndex));
        } else {
          scrollEl.removeAttribute('aria-activedescendant');
        }
      }
    }

    function renderSort() {
      Array.prototype.slice.call(el.querySelectorAll('th[data-lc-col]')).forEach(function (th) {
        var key = th.getAttribute('data-lc-col');
        if (!th.querySelector('[data-lc-sort]')) return;
        th.setAttribute('aria-sort', sort.key && sort.key === key
          ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none');
        var use = th.querySelector('.lc-ui-sort-icon use');
        if (use) {
          var name = sort.key && sort.key === key
            ? (sort.dir === 'desc' ? 'chevron-down' : 'chevron-up')
            : 'sort';
          use.setAttribute('href', '#lc-icon-' + name);
          var iconEl = th.querySelector('.lc-ui-sort-icon');
          if (iconEl) iconEl.classList.toggle('is-active', !!(sort.key && sort.key === key));
        }
      });
    }

    function renderPager() {
      var current = pager();
      var box = el.querySelector('[data-lc-pager]');
      var info = el.querySelector('[data-lc-page-info]');
      var prev = el.querySelector('[data-lc-page-prev]');
      var next = el.querySelector('[data-lc-page-next]');
      if (pageSize <= 0 || current.totalPages <= 1) {
        if (box) box.setAttribute('hidden', '');
        return;
      }
      if (box) box.removeAttribute('hidden');
      if (info) info.textContent = '第 ' + current.page + ' / ' + current.totalPages + ' 页';
      if (prev) prev.disabled = current.page <= 1;
      if (next) next.disabled = current.page >= current.totalPages;
    }

    function refresh() {
      renderSort();
      renderBody();
      renderPager();
      syncSelection();
    }

    function scrollToIndex(targetIndex) {
      var current = pager();
      var total = current.rows.length;
      if (virtual && scrollEl && total) {
        var local = Math.max(0, Math.min(total - 1, targetIndex - current.start));
        var max = Math.max(0, total * rowHeight + 40 - viewportHeight);
        var top = local * rowHeight - Math.floor((viewportHeight - rowHeight) / 2);
        scrollEl.scrollTop = Math.max(0, Math.min(max, top));
      }
      activeIndex = targetIndex;
      renderBody();
      if (virtual && scrollEl && doc.activeElement !== scrollEl) {
        try { scrollEl.focus({ preventScroll: true }); }
        catch (error) { try { scrollEl.focus(); } catch (ignored) { /* 忽略 */ } }
      }
    }

    function onScroll() {
      if (!virtual || ticking) return;
      ticking = true;
      var view = doc.defaultView;
      var run = function () { ticking = false; renderBody(); };
      if (view && view.requestAnimationFrame) view.requestAnimationFrame(run);
      else setTimeout(run, 50);
    }

    function onScrollKey(event) {
      if (!virtual) return;
      var current = pager();
      var total = current.rows.length;
      if (!total) return;
      var range = windowRange(scrollEl ? scrollEl.scrollTop : 0, viewportHeight, rowHeight, total, 0);
      var base = activeIndex != null ? activeIndex : current.start + range.start;
      var visible = Math.max(1, Math.floor(viewportHeight / rowHeight));
      var target = null;
      if (event.key === 'ArrowDown') target = base + 1;
      else if (event.key === 'ArrowUp') target = base - 1;
      else if (event.key === 'PageDown') target = base + visible;
      else if (event.key === 'PageUp') target = base - visible;
      else if (event.key === 'Home') target = current.start;
      else if (event.key === 'End') target = current.start + total - 1;
      if (target == null) return;
      event.preventDefault();
      target = Math.max(current.start, Math.min(current.start + total - 1, target));
      scrollToIndex(target);
    }

    if (virtual && scrollEl) {
      scrollEl.addEventListener('scroll', onScroll, { passive: true });
      scrollEl.addEventListener('keydown', onScrollKey);
    }

    function resetScroll() {
      if (virtual && scrollEl) scrollEl.scrollTop = 0;
    }

    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var sortBtn = target.closest('[data-lc-sort]');
      if (sortBtn) {
        var key = sortBtn.getAttribute('data-lc-sort');
        sort = sort.key === key ? nextSort(key, sort.dir) : { key: key, dir: 'asc' };
        currentRows = sortRows(rows, sort.key, sort.dir, columns);
        page = 1;
        resetScroll();
        refresh();
        kit.emit(el, 'lc:table-sort', {
          key: sort.key,
          direction: sort.dir,
          rows: currentRows.slice()
        });
        return;
      }
      if (target.closest('[data-lc-page-prev]')) {
        page = Math.max(1, pager().page - 1);
        resetScroll();
        refresh();
        kit.emit(el, 'lc:table-page', { page: page, pageSize: pageSize });
        return;
      }
      if (target.closest('[data-lc-page-next]')) {
        page = Math.min(pager().totalPages, pager().page + 1);
        resetScroll();
        refresh();
        kit.emit(el, 'lc:table-page', { page: page, pageSize: pageSize });
        return;
      }
      if (target.closest('[data-lc-jump-top]')) {
        scrollToIndex(pager().start);
        return;
      }
      if (target.closest('[data-lc-jump-bottom]')) {
        var current = pager();
        scrollToIndex(current.start + current.rows.length - 1);
        return;
      }
      if (target.closest('[data-lc-retry]')) {
        kit.emit(el, 'lc:state-retry', { kind: 'table' });
      }
    }

    function onChange(event) {
      var target = event.target;
      if (!target) return;
      if (target.hasAttribute && target.hasAttribute('data-lc-select-all')) {
        var current = pager();
        Array.prototype.slice.call(el.querySelectorAll('[data-lc-row-check]')).forEach(function (input) {
          input.checked = target.checked;
        });
        current.rows.forEach(function (row, index) {
          var id = rowId(row, rowKey, current.start + index);
          if (target.checked) selected[id] = true;
          else delete selected[id];
        });
        syncSelection();
        kit.emit(el, 'lc:table-select', {
          selected: Object.keys(selected),
          rows: rows.filter(function (row, index) {
            return !!selected[rowId(row, rowKey, index)];
          })
        });
        return;
      }
      if (target.hasAttribute && target.hasAttribute('data-lc-row-check')) {
        var key = target.getAttribute('data-lc-row-key');
        if (target.checked) selected[key] = true;
        else delete selected[key];
        syncSelection();
        kit.emit(el, 'lc:table-select', { selected: Object.keys(selected) });
      }
    }

    function onKeydown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var target = event.target;
      if (target && target.hasAttribute && target.hasAttribute('data-lc-select-all')) {
        /* 原生 checkbox 已经处理键盘，避免重复触发。 */
        return;
      }
    }

    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKeydown);

    refresh();

    var api = {
      sort: function (key, dir) {
        sort = { key: key, dir: dir === 'desc' ? 'desc' : 'asc' };
        currentRows = sortRows(rows, sort.key, sort.dir, columns);
        page = 1;
        resetScroll();
        refresh();
      },
      /* 事件绑定 auto 处理：把接口返回的数组写成表格行；空态表格先补一次骨架。 */
      setRows: function (nextRows) {
        var normalized = normalizeRows(nextRows);
        if (!el.querySelector('[data-lc-tbody]')) {
          var rebuilt = render({ props: Object.assign({}, data, { rows: normalized, state: 'ready' }) }, {});
          var fresh = dom.toDom(rebuilt, doc);
          while (el.firstChild) el.removeChild(el.firstChild);
          while (fresh.firstChild) el.appendChild(fresh.firstChild);
          columns = normalizeColumns(data.columns, normalized);
          scrollEl = el.querySelector('[data-lc-table-scroll]');
          virtual = false;
        } else if (!columns.length) {
          columns = normalizeColumns([], normalized);
        }
        rows = normalized;
        currentRows = sortRows(rows, sort.key, sort.dir, columns);
        page = 1;
        if (scrollEl) scrollEl.scrollTop = 0;
        refresh();
      },
      setPage: function (next) { page = next; resetScroll(); refresh(); },
      scrollToRow: function (index) { scrollToIndex(pager().start + Math.max(0, index)); },
      getSelection: function () { return Object.keys(selected); },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        el.removeEventListener('click', onClick);
        el.removeEventListener('change', onChange);
        el.removeEventListener('keydown', onKeydown);
        if (virtual && scrollEl) {
          scrollEl.removeEventListener('scroll', onScroll);
          scrollEl.removeEventListener('keydown', onScrollKey);
        }
      }
    };
    el.__lcTable = api;
    return api;
  }

  var def = {
    type: 'ui-table',
    name: '表格',
    version: 1,
    schema: SCHEMA,
    sharedCss: kit.css,
    sharedCssId: 'lc-ui-common',
    css: [
      '.lc-ui-table { display: flex; flex-direction: column; gap: var(--lc-space-2-5); }',
      '.lc-ui-table-caption { margin: 0; font-size: var(--lc-text-sm, 13px); font-weight: var(--lc-weight-semibold, 600); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-table-scroll { overflow: auto; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, transparent)); }',
      '.lc-ui-table-el { width: 100%; border-collapse: collapse; font-size: var(--lc-text-sm, 13px); }',
      '.lc-ui-th, .lc-ui-td { padding: 9px var(--lc-space-3); text-align: left; border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); white-space: nowrap; }',
      '.lc-ui-th { position: sticky; top: 0; z-index: 1; background: var(--lc-color-surface-2, var(--surface-2, #f1efe7)); color: var(--lc-color-ink, var(--ink, inherit)); font-weight: var(--lc-weight-semibold, 600); }',
      '.lc-ui-tbody .lc-ui-tr:last-child .lc-ui-td { border-bottom: 0; }',
      '.lc-ui-tbody .lc-ui-tr:hover { background: var(--lc-color-surface-2, var(--surface-2, #f1efe7)); }',
      '.lc-ui-table-dense .lc-ui-th, .lc-ui-table-dense .lc-ui-td { padding: 5px var(--lc-space-2-5); }',
      '.lc-ui-align-center { text-align: center; }',
      '.lc-ui-align-right { text-align: right; }',
      '.lc-ui-td-check, .lc-ui-th.lc-ui-td-check { width: 36px; padding-right: 0; }',
      '.lc-ui-sort-btn { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-weight: inherit; cursor: pointer; }',
      '.lc-ui-sort-btn:hover { color: var(--lc-color-accent, var(--accent, currentColor)); }',
      '.lc-ui-sort-icon { width: 14px; height: 14px; opacity: 0.5; }',
      '.lc-ui-sort-icon.is-active { opacity: 1; color: var(--lc-color-accent, var(--accent, currentColor)); }',
      '.lc-ui-pager { display: flex; align-items: center; gap: var(--lc-space-2-5); font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-pager-info { font-variant-numeric: tabular-nums; }',
      '.lc-ui-flip { transform: rotate(180deg); }',
      '.lc-ui-selection { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-accent, var(--accent, currentColor)); }',
      '.lc-ui-check { width: 15px; height: 15px; accent-color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-table-virtual .lc-ui-table-scroll { overflow-anchor: none; }',
      '.lc-ui-table-virtual .lc-ui-tr { height: var(--lc-table-row-h, 37px); }',
      '.lc-ui-virtual-pad td { padding: 0; border: 0; }',
      '.lc-ui-virtual-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-2-5); font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-virtual-info { font-variant-numeric: tabular-nums; }',
      '.lc-ui-virtual-actions { display: inline-flex; gap: 2px; }',
      '.lc-ui-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-xs, 4px); background: var(--lc-color-surface, transparent); color: inherit; font: inherit; cursor: pointer; }',
      '.lc-ui-icon-btn:hover { border-color: var(--lc-color-accent, var(--accent, currentColor)); color: var(--lc-color-accent, var(--accent, currentColor)); }',
      '.lc-ui-tr:focus { outline: var(--lc-focus-width, 2px) solid var(--lc-color-accent, var(--accent, currentColor)); outline-offset: -2px; }',
      '.lc-ui-tr.is-active { box-shadow: inset 0 0 0 2px var(--lc-color-accent, var(--accent, currentColor)); }',
      '.lc-ui-table-scroll:focus-visible { outline: var(--lc-focus-width, 2px) solid var(--lc-color-accent, var(--accent, currentColor)); outline-offset: 2px; }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeColumns: normalizeColumns,
      normalizeRows: normalizeRows,
      formatCell: formatCell,
      sortRows: sortRows,
      paginate: paginate,
      nextSort: nextSort,
      rowId: rowId,
      virtualConfig: virtualConfig,
      windowRange: windowRange
    }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = def;
  } else {
    dom.Components['ui-table'] = def;
  }

  return def;
}));
