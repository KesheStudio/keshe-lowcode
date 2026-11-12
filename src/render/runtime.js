/* 渲染核心 · 静态产物交互运行时
   目标：导出包只带一个 JS 文件，file:// 双击可跑，无构建依赖。
   做法：把下面这些真实函数用 toString() 拼成一段经典脚本；按页面实际用到的
   组件选择模块，纯文档页不会背表单 / 图表代码。重复注入只做 rescan，不重复绑定。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    var api = factory();
    Object.keys(api).forEach(function (key) { root.LC.Render[key] = api[key]; });
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var MAX_BYTES = 64 * 1024;
  var ORDER = ['core', 'nav', 'theme', 'article', 'form', 'async', 'table', 'media'];

  var MODULE_META = {
    core: { label: '启动与幂等', hint: '配置、存储降级、全局样式' },
    nav: { label: '导航', hint: '移动端菜单展开收起、当前页高亮兜底' },
    theme: { label: '主题', hint: '跟随系统 / 亮 / 暗，多主题，localStorage 降级内存' },
    article: { label: '文章', hint: '目录滚动高亮、折叠、深链接、正文检索' },
    form: { label: '表单', hint: '字段联动、校验、提交与成功失败反馈' },
    async: { label: '异步数据', hint: '图表 / KPI / 进度的加载、失败重试、空态' },
    table: { label: '表格', hint: '客户端排序、分页、选择与虚拟滚动' },
    media: { label: '图片', hint: '懒加载、宽高占位、失败说明' }
  };

  /* ---------------- 运行时工具（会被序列化进产物） ---------------- */

  function runtimeUtilBase() {
    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function qa(selector, scope) {
      var host = scope || document;
      if (!host || !host.querySelectorAll) return [];
      return Array.prototype.slice.call(host.querySelectorAll(selector));
    }

    function emit(el, name, detail) {
      if (!el || !el.dispatchEvent) return null;
      var event;
      try {
        event = new CustomEvent(name, { detail: detail, bubbles: true, cancelable: true });
      } catch (error) {
        event = document.createEvent('CustomEvent');
        event.initCustomEvent(name, true, true, detail);
      }
      el.dispatchEvent(event);
      return event;
    }

    function islandNode(root) {
      if (!root || !root.querySelector) return null;
      var node = root.querySelector('script.lc-ui-data');
      if (!node) {
        var list = qa('script.lc-ui-data', root);
        node = list.length ? list[list.length - 1] : null;
      }
      return node;
    }

    function readIsland(root) {
      var node = islandNode(root);
      if (!node) return null;
      try { return JSON.parse(node.textContent || '{}'); } catch (error) { return null; }
    }

    /* localStorage 在 file:// 或隐私模式下可能抛错；失败后退回内存，不影响本次会话。 */
    function createStore(win) {
      var memory = {};
      var local = null;
      try {
        local = win.localStorage;
        local.setItem('__lc_probe__', '1');
        local.removeItem('__lc_probe__');
      } catch (error) {
        local = null;
      }
      return {
        mode: local ? 'localStorage' : 'memory',
        get: function (key) {
          try { return local ? local.getItem(key) : (memory[key] == null ? null : memory[key]); }
          catch (error) { return memory[key] == null ? null : memory[key]; }
        },
        set: function (key, value) {
          memory[key] = String(value);
          try { if (local) local.setItem(key, String(value)); } catch (error) { /* 只用内存 */ }
        },
        remove: function (key) {
          delete memory[key];
          try { if (local) local.removeItem(key); } catch (error) { /* 忽略 */ }
        }
      };
    }

    function resolveMode(pref) {
      var mode = pref === 'light' || pref === 'dark' ? pref : 'auto';
      /* auto 只回退到默认主题的亮色，不按系统 prefers-color-scheme 猜暗色。 */
      if (mode === 'auto') return 'light';
      return mode;
    }

    function isEmptyValue(value) {
      if (Array.isArray(value)) return value.length === 0;
      if (value == null) return true;
      return String(value).trim() === '';
    }

    function rowValue(row, key) {
      if (!row || key == null) return null;
      var parts = String(key).split('.');
      var current = row;
      for (var i = 0; i < parts.length; i += 1) {
        if (current == null) return null;
        current = current[parts[i]];
      }
      return current == null ? null : current;
    }

    function publicBase() {
      var base = '';
      try {
        var win = typeof window !== 'undefined' ? window : null;
        if (win && typeof win.LC_PUBLIC_BASE_URL === 'string') base = win.LC_PUBLIC_BASE_URL;
      } catch (error) {
        base = '';
      }
      base = String(base == null ? '' : base).trim();
      /* 未配置或字面量 undefined/null 都视为没有基址，回退同源相对路径。 */
      if (!base || base === 'undefined' || base === 'null') return '';
      return base.replace(/\/+$/, '');
    }

    /* 相对路径拼「项目域名 + 路径前缀」；绝对地址、协议相对地址、页内锚点原样保留。
       没有基址时直接返回原值，交给浏览器按同源解析，绝不把 undefined 拼进 URL。 */
    function resolveUrl(input) {
      var raw = input == null ? '' : String(input);
      var text = raw.trim();
      if (!text) return raw;
      if (text.charAt(0) === '#' || text.slice(0, 2) === '//') return raw;
      if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return raw;
      var base = publicBase();
      if (!base) return raw;
      return base + (text.charAt(0) === '/' ? text : '/' + text);
    }

    return {
      esc: esc,
      qa: qa,
      emit: emit,
      islandNode: islandNode,
      readIsland: readIsland,
      createStore: createStore,
      resolveMode: resolveMode,
      isEmptyValue: isEmptyValue,
      rowValue: rowValue,
      publicBase: publicBase,
      resolveUrl: resolveUrl
    };
  }

  /* 大数据岛导出后只剩 data-lc-src；仅在存在外部数据岛时进入产物。
     按 URL 记忆化 fetch，一次请求分发给多个实例；失败不写缓存，重试会重新请求。 */
  function runtimeUtilIsland(base) {
    var islandNode = base.islandNode;

    function loadIsland(root, win, done) {
      var node = islandNode(root);
      if (!node) { done(null, new Error('缺少数据岛')); return; }
      var text = node.textContent || '';
      if (text.replace(/\s/g, '') !== '') {
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (error) { parsed = null; }
        done(parsed, parsed ? null : new Error('数据岛 JSON 解析失败'));
        return;
      }
      var src = node.getAttribute('data-lc-src');
      if (!src) { done(null, new Error('缺少数据地址')); return; }
      var url = typeof base.resolveUrl === 'function' ? base.resolveUrl(src) : src;
      var key = node.getAttribute('data-lc-key');
      var cache = win.__LC_ISLAND_CACHE__ || (win.__LC_ISLAND_CACHE__ = {});
      var queue = win.__LC_ISLAND_QUEUE__ || (win.__LC_ISLAND_QUEUE__ = {});

      function finish(payload, error) {
        if (error) { done(null, error); return; }
        var value = key && payload ? payload[key] : payload;
        try { node.textContent = JSON.stringify(value == null ? {} : value); } catch (ignore) { /* 只影响下次读取 */ }
        done(value, null);
      }

      if (Object.prototype.hasOwnProperty.call(cache, url)) { finish(cache[url], null); return; }
      if (queue[url]) { queue[url].push(finish); return; }
      queue[url] = [finish];
      if (typeof win.fetch !== 'function') {
        var unsupported = new Error('当前环境不支持 fetch');
        var pending = queue[url];
        delete queue[url];
        pending.forEach(function (fn) { fn(null, unsupported); });
        return;
      }
      win.fetch(url, { credentials: 'same-origin' }).then(function (response) {
        if (!response || !response.ok) throw new Error('HTTP ' + (response ? response.status : '请求失败'));
        return response.json();
      }).then(function (payload) {
        cache[url] = payload;
        var waiting = queue[url] || [];
        delete queue[url];
        waiting.forEach(function (fn) { fn(payload, null); });
      }).catch(function (error) {
        var waiting = queue[url] || [];
        delete queue[url];
        waiting.forEach(function (fn) { fn(null, error); });
      });
    }

    return { loadIsland: loadIsland };
  }

  /* 表单联动与校验只在页面有表单时进入产物。 */
  function runtimeUtilForm(base) {
    var isEmptyValue = base.isEmptyValue;

    function has(rule, key) {
      return Object.prototype.hasOwnProperty.call(rule, key);
    }

    function normalizeWhen(rule) {
      if (!rule || typeof rule !== 'object' || !rule.field) return null;
      return {
        field: String(rule.field),
        hasEquals: has(rule, 'equals'),
        equals: rule.equals,
        hasNotEquals: has(rule, 'notEquals'),
        notEquals: rule.notEquals,
        in: Array.isArray(rule['in']) ? rule['in'].map(function (item) { return String(item); }) : null,
        notEmpty: rule.notEmpty === true
      };
    }

    function isFieldVisible(rule, values) {
      var when = normalizeWhen(rule);
      if (!when) return true;
      var value = values ? values[when.field] : '';
      if (when.notEmpty) return !isEmptyValue(value);
      if (when['in']) return when['in'].indexOf(String(value == null ? '' : value)) !== -1;
      if (when.hasEquals) return String(value == null ? '' : value) === String(when.equals == null ? '' : when.equals);
      if (when.hasNotEquals) return String(value == null ? '' : value) !== String(when.notEquals == null ? '' : when.notEquals);
      return true;
    }

    /* 校验顺序与 form.js 保持一致：必填 → 长度 → 正则 → 数值范围。 */
    function validateField(field, value) {
      if (!field || typeof field !== 'object') return null;
      var empty = isEmptyValue(value);
      if (field.required && empty) return field.message || '此项为必填项。';
      if (empty) return null;
      var text = Array.isArray(value) ? value.join(',') : String(value);
      if (field.minLength != null && text.length < field.minLength) {
        return field.message || ('至少需要 ' + field.minLength + ' 个字符。');
      }
      if (field.maxLength != null && text.length > field.maxLength) {
        return field.message || ('最多允许 ' + field.maxLength + ' 个字符。');
      }
      if (field.pattern) {
        var regex = null;
        try { regex = new RegExp(field.pattern); } catch (error) { regex = null; }
        if (regex && !regex.test(text)) return field.message || '格式不符合要求。';
      }
      if (field.type === 'number' || field.min != null || field.max != null) {
        var number = Number(text);
        if (isFinite(number)) {
          if (field.min != null && number < field.min) return field.message || ('不能小于 ' + field.min + '。');
          if (field.max != null && number > field.max) return field.message || ('不能大于 ' + field.max + '。');
        }
      }
      return null;
    }

    return { normalizeWhen: normalizeWhen, isFieldVisible: isFieldVisible, validateField: validateField };
  }

  /* 表格排序 / 分页 / 格式化只在页面有表格时进入产物。 */
  function runtimeUtilTable(base) {
    var rowValue = base.rowValue;

    function pad(value) { return ('0' + value).slice(-2); }

    function formatDate(value) {
      var date = value instanceof Date ? value : new Date(value);
      if (isNaN(date.getTime())) return String(value);
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
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
      var size = Number(pageSize);
      if (!isFinite(size) || size < 0) size = 0;
      var totalPages = size > 0 ? Math.max(1, Math.ceil(list.length / size)) : 1;
      var current = Number(page);
      if (!isFinite(current)) current = 1;
      current = Math.min(Math.max(Math.floor(current), 1), totalPages);
      var start = size > 0 ? (current - 1) * size : 0;
      var end = size > 0 ? Math.min(list.length, start + size) : list.length;
      return { page: current, totalPages: totalPages, start: start, end: end, rows: list.slice(start, end) };
    }

    function windowRange(scrollTop, viewportHeight, rowHeight, total, buffer) {
      var size = Math.max(1, Math.ceil(viewportHeight / rowHeight));
      var span = Math.min(total, size + buffer * 2);
      var start = Math.floor(Math.max(0, scrollTop) / rowHeight) - buffer;
      if (start < 0) start = 0;
      if (start + span > total) start = Math.max(0, total - span);
      return { start: start, end: Math.min(total, start + span) };
    }

    return {
      formatCell: formatCell,
      sortRows: sortRows,
      paginate: paginate,
      windowRange: windowRange
    };
  }

  /* 图表绘制只在页面有图表 / KPI / 进度时进入产物。 */
  function runtimeUtilAsync(base) {
    var esc = base.esc;
    var rowValue = base.rowValue;

    function toNumber(value) {
      var number = Number(value);
      return isFinite(number) ? number : null;
    }

    /* 把数据源返回值统一成 { labels, series:[{name,values}] }。 */
    function normalizeChartModel(result, config) {
      config = config || {};
      var name = config.seriesName || '数值';
      if (result == null) return { labels: [], series: [] };
      if (typeof result === 'number') {
        return { labels: ['1'], series: [{ name: name, values: [result] }] };
      }
      if (Array.isArray(result)) {
        var first = result[0];
        if (typeof first === 'number' || typeof first === 'string') {
          var values = result.map(function (item) { return toNumber(item); });
          return {
            labels: values.map(function (item, index) { return String(index + 1); }),
            series: [{ name: name, values: values }]
          };
        }
        if (first && typeof first === 'object') {
          var labelField = config.labelField || 'label';
          var valueField = config.valueField || 'value';
          var labels = [], seriesValues = [];
          result.forEach(function (item, index) {
            if (item == null) return;
            var label = rowValue(item, labelField);
            if (label == null) label = String(index + 1);
            var value = toNumber(rowValue(item, valueField));
            if (value == null) return;
            labels.push(String(label));
            seriesValues.push(value);
          });
          return { labels: labels, series: [{ name: name, values: seriesValues }] };
        }
        return { labels: [], series: [] };
      }
      if (typeof result !== 'object') return { labels: [], series: [] };
      if (Array.isArray(result.data) && !Array.isArray(result.series)) {
        return normalizeChartModel(result.data, config);
      }
      if (Array.isArray(result.series)) {
        var baseLabels = Array.isArray(result.labels)
          ? result.labels.map(function (item) { return String(item); }) : [];
        var series = result.series.map(function (item, index) {
          var list = Array.isArray(item) ? item : (item && Array.isArray(item.values) ? item.values : []);
          return {
            name: String((item && item.name) || ('系列 ' + (index + 1))),
            values: list.map(function (value) { return toNumber(value); })
          };
        });
        if (!baseLabels.length && series.length) {
          var longest = 0;
          series.forEach(function (item) { longest = Math.max(longest, item.values.length); });
          for (var i = 0; i < longest; i += 1) baseLabels.push(String(i + 1));
        }
        return { labels: baseLabels, series: series };
      }
      if (Array.isArray(result.data)) {
        var inline = result.data.map(function (item) { return toNumber(item); });
        return {
          labels: inline.map(function (item, index) { return String(index + 1); }),
          series: [{ name: name, values: inline }]
        };
      }
      if (result.value != null) {
        return { labels: ['1'], series: [{ name: name, values: [toNumber(result.value)] }] };
      }
      return { labels: [], series: [] };
    }

    var CHART_COLORS = [
      'var(--lc-chart-1)', 'var(--lc-chart-2)', 'var(--lc-chart-3)', 'var(--lc-chart-4)',
      'var(--lc-chart-5)', 'var(--lc-chart-6)', 'var(--lc-chart-7)', 'var(--lc-chart-8)'
    ];
    var SPARK_COLOR = 'var(--lc-spark-color)';

    function colorAt(index, kind) {
      if (kind === 'sparkline') return SPARK_COLOR;
      return CHART_COLORS[index % CHART_COLORS.length];
    }

    function modelSummary(kind, model) {
      var count = 0;
      (model.series || []).forEach(function (item) { count += item.values.length; });
      return (model.labels.length ? model.labels.length + ' 个分类，' : '') + count + ' 个数据点';
    }

    function chartSvg(kind, model, config) {
      config = config || {};
      var width = kind === 'sparkline' ? 120 : 320;
      var height = kind === 'sparkline' ? 36 : 180;
      var labels = model.labels || [];
      var series = model.series || [];
      var out = [];
      var i, j;
      if (kind === 'pie' || kind === 'donut') {
        var values = series.length ? series[0].values : [];
        var total = 0;
        values.forEach(function (value) { if (value != null && value > 0) total += value; });
        var cx = width / 2, cy = height / 2, radius = Math.min(width, height) / 2 - 14;
        var inner = kind === 'donut' ? radius * 0.58 : 0;
        var angle = -Math.PI / 2;
        for (i = 0; i < values.length; i += 1) {
          var value = values[i];
          if (value == null || value <= 0) continue;
          var slice = (value / total) * Math.PI * 2;
          var end = angle + slice;
          var x1 = cx + Math.cos(angle) * radius;
          var y1 = cy + Math.sin(angle) * radius;
          var x2 = cx + Math.cos(end) * radius;
          var y2 = cy + Math.sin(end) * radius;
          var large = slice > Math.PI ? 1 : 0;
          if (inner) {
            var ix1 = cx + Math.cos(end) * inner;
            var iy1 = cy + Math.sin(end) * inner;
            var ix2 = cx + Math.cos(angle) * inner;
            var iy2 = cy + Math.sin(angle) * inner;
            out.push('<path d="M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
              ' A ' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) +
              ' L ' + ix1.toFixed(2) + ' ' + iy1.toFixed(2) +
              ' A ' + inner.toFixed(2) + ' ' + inner.toFixed(2) + ' 0 ' + large + ' 0 ' + ix2.toFixed(2) + ' ' + iy2.toFixed(2) +
              ' Z" fill="' + colorAt(i, kind) + '"></path>');
          } else {
            out.push('<path d="M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
              ' A ' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) +
              ' Z" fill="' + colorAt(i, kind) + '"></path>');
          }
          angle = end;
        }
        return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height +
          '" role="img" aria-label="' + esc(modelSummary(kind, model)) + '" focusable="false">' +
          out.join('') + '</svg>';
      }

      var all = [];
      series.forEach(function (item) {
        item.values.forEach(function (value) { if (value != null) all.push(value); });
      });
      var max = all.length ? Math.max.apply(Math, all) : 1;
      var min = all.length ? Math.min.apply(Math, all) : 0;
      if (max === min) max = min + 1;
      var left = kind === 'sparkline' ? 2 : 30;
      var right = kind === 'sparkline' ? 2 : 10;
      var top = kind === 'sparkline' ? 3 : 12;
      var bottom = kind === 'sparkline' ? 3 : 24;
      var plotW = width - left - right;
      var plotH = height - top - bottom;
      var count = Math.max(1, labels.length);
      function xOf(index) {
        return left + (count === 1 ? plotW / 2 : (plotW * index) / (count - 1));
      }
      function yOf(value) {
        if (value == null) return null;
        return top + plotH - ((value - min) / (max - min)) * plotH;
      }
      if (kind === 'bar') {
        var groups = Math.max(1, series.length);
        var slot = plotW / count;
        var barWidth = Math.max(2, slot / groups - 2);
        series.forEach(function (item, seriesIndex) {
          item.values.forEach(function (value, index) {
            var y = yOf(value);
            if (y == null) return;
            var x = left + slot * index + (slot - barWidth * groups - 2 * (groups - 1)) / 2 + (barWidth + 2) * seriesIndex;
            out.push('<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barWidth.toFixed(2) +
              '" height="' + Math.max(0, top + plotH - y).toFixed(2) + '" rx="2" fill="' + colorAt(seriesIndex, kind) + '"></rect>');
          });
        });
      } else {
        series.forEach(function (item, seriesIndex) {
          var points = [];
          item.values.forEach(function (value, index) {
            var y = yOf(value);
            if (y == null) return;
            points.push(xOf(index).toFixed(2) + ',' + y.toFixed(2));
          });
          if (points.length) {
            out.push('<polyline fill="none" stroke="' + colorAt(seriesIndex, kind) +
              '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' + points.join(' ') + '"></polyline>');
          }
        });
      }
      if (kind !== 'sparkline' && labels.length) {
        var step = Math.max(1, Math.ceil(labels.length / 6));
        labels.forEach(function (label, index) {
          if (index % step !== 0 && index !== labels.length - 1) return;
          out.push('<text x="' + xOf(index).toFixed(2) + '" y="' + (height - 6) +
            '" text-anchor="middle" font-size="10" fill="var(--lc-color-muted)">' + esc(label) + '</text>');
        });
      }
      return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height +
        '" role="img" aria-label="' + esc(modelSummary(kind, model)) + '" focusable="false">' +
        out.join('') + '</svg>';
    }

    return { normalizeChartModel: normalizeChartModel, chartSvg: chartSvg, modelSummary: modelSummary };
  }

  /* ---------------- 启动 ---------------- */

  function runtimeBoot(VERSION, CONFIG, UTIL, MODULES, NAMES) {
    var win = window;
    var doc = document;
    var prev = win.__LC_RUNTIME__;
    if (prev && prev.version === VERSION && typeof prev.rescan === 'function') {
      try { prev.rescan(); } catch (error) { /* 重复注入静默 */ }
      return;
    }
    var ctx = {
      version: VERSION,
      win: win,
      doc: doc,
      config: CONFIG,
      util: UTIL,
      names: NAMES
    };
    function run() {
      for (var i = 0; i < MODULES.length; i += 1) {
        try { MODULES[i](ctx); }
        catch (error) {
          if (win.console && win.console.error) win.console.error('[lc-runtime] 模块初始化失败：' + NAMES[i], error);
        }
      }
    }
    function boot() {
      if (!doc.body) return;
      run();
      win.__LC_RUNTIME__ = {
        version: VERSION,
        modules: NAMES,
        config: CONFIG,
        rescan: function () { run(); }
      };
      win.LC_RUNTIME = win.__LC_RUNTIME__;
    }
    if (doc.readyState === 'loading') {
      if (!win.__LC_RUNTIME_PENDING__) {
        win.__LC_RUNTIME_PENDING__ = true;
        doc.addEventListener('DOMContentLoaded', function onReady() {
          win.__LC_RUNTIME_PENDING__ = false;
          boot();
        });
      }
      return;
    }
    boot();
  }

  /* ---------------- 模块：core ---------------- */

  function runtimeCore(ctx) {
    var doc = ctx.doc;
    /* 产物内联脚本与用户组件脚本都可用 window.lcResolveUrl 拼公开基址。 */
    if (ctx.win && ctx.util && typeof ctx.util.resolveUrl === 'function') {
      ctx.win.lcResolveUrl = ctx.util.resolveUrl;
    }
    if (doc.getElementById('lc-runtime-style')) return;
    var style = doc.createElement('style');
    style.id = 'lc-runtime-style';
    style.textContent = [
      '.lc-rt-theme{position:fixed;right:var(--lc-space-3-5);bottom:var(--lc-space-3-5);z-index:2147483000;font-family:var(--lc-font-sans);font-size:var(--lc-text-sm);line-height:1.5;color:var(--lc-color-ink)}',
      '.lc-rt-theme-btn{padding:7px var(--lc-space-3);border:var(--lc-border-width) solid var(--lc-color-line);border-radius:var(--lc-radius-md);background:var(--lc-color-surface);color:inherit;font:inherit;cursor:pointer;box-shadow:var(--lc-shadow-sm)}',
      '.lc-rt-theme-panel{position:absolute;right:0;bottom:42px;width:210px;padding:var(--lc-space-3);border:var(--lc-border-width) solid var(--lc-color-line);border-radius:var(--lc-radius-lg);background:var(--lc-color-surface);box-shadow:var(--lc-shadow-md)}',
      '.lc-rt-theme-panel[hidden]{display:none}',
      '.lc-rt-theme-row{margin-bottom:var(--lc-space-2-5)}.lc-rt-theme-row:last-child{margin-bottom:0}',
      '.lc-rt-theme-label{display:block;margin-bottom:var(--lc-space-1);font-size:var(--lc-text-xs);letter-spacing:.04em;text-transform:uppercase;color:var(--lc-color-muted-2)}',
      '.lc-rt-theme select{width:100%;padding:5px var(--lc-space-1-5);border:var(--lc-border-width) solid var(--lc-color-line);border-radius:var(--lc-radius-sm);background:var(--lc-color-surface);color:inherit;font:inherit}',
      '.lc-rt-modes{display:flex;gap:var(--lc-space-1)}.lc-rt-modes button{flex:1;padding:5px 0;border:var(--lc-border-width) solid var(--lc-color-line);border-radius:var(--lc-radius-sm);background:transparent;color:inherit;font:inherit;cursor:pointer}',
      '.lc-rt-modes button[aria-pressed="true"]{border-color:var(--lc-color-accent);background:var(--lc-color-accent-soft);color:var(--lc-color-accent)}',
      '.lc-rt-theme-note{margin:var(--lc-space-1-5) 0 0;font-size:var(--lc-text-xs);color:var(--lc-color-muted)}',
      '.lc-rt-search{display:flex;align-items:center;gap:var(--lc-space-1);margin:var(--lc-space-1-5) 0 var(--lc-space-2-5)}',
      '.lc-rt-search input{flex:1;min-width:0;padding:5px var(--lc-space-2);border:var(--lc-border-width) solid var(--lc-color-line);border-radius:var(--lc-radius-sm);background:var(--lc-color-surface);color:inherit;font:inherit;font-size:var(--lc-text-xs)}',
      '.lc-rt-search button{width:24px;height:24px;border:var(--lc-border-width) solid var(--lc-color-line);border-radius:var(--lc-radius-sm);background:transparent;color:inherit;font:inherit;cursor:pointer}',
      '.lc-rt-search-count{font-size:var(--lc-text-xs);color:var(--lc-color-muted-2);white-space:nowrap}',
      '.lc-rt-toc-toggle{display:inline-flex;align-items:center;gap:var(--lc-space-1);padding:2px var(--lc-space-1-5);border:var(--lc-border-width) solid var(--lc-color-line);border-radius:var(--lc-radius-sm);background:transparent;color:inherit;font:inherit;font-size:var(--lc-text-xs);cursor:pointer}',
      '.lc-article-toc a.is-active{color:var(--lc-color-accent);font-weight:600}',
      'mark.lc-rt-hit{padding:0 1px;border-radius:var(--lc-radius-xs);background:var(--lc-color-accent-soft);color:inherit;border-bottom:var(--lc-border-width) solid var(--lc-color-accent-line)}',
      'mark.lc-rt-hit.is-current{outline:2px solid var(--lc-color-accent);outline-offset:1px}',
      '.lc-ui-tr.is-active{box-shadow:inset 0 0 0 2px var(--lc-color-accent)}',
      '.lc-ui-table-scroll:focus-visible{outline:2px solid var(--lc-color-accent);outline-offset:2px}',
      '.lc-ui-image-error[hidden]{display:none}'
    ].join('');
    (doc.head || doc.documentElement).appendChild(style);
    doc.documentElement.setAttribute('data-lc-runtime', 'ready');
  }

  /* ---------------- 模块：nav ---------------- */

  function runtimeNav(ctx) {
    var u = ctx.util;
    u.qa('.lc-shell-nav', ctx.doc).forEach(function (nav) {
      if (nav.getAttribute('data-lc-rt-nav') === 'true') return;
      nav.setAttribute('data-lc-rt-nav', 'true');
      var check = nav.querySelector('.lc-shell-nav-check');
      var burger = nav.querySelector('.lc-shell-nav-burger');
      function sync() {
        var open = !!(check && check.checked);
        if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      if (check) {
        check.addEventListener('change', sync);
        sync();
      }
      nav.addEventListener('click', function (event) {
        var link = event.target && event.target.closest ? event.target.closest('a') : null;
        if (link && check) { check.checked = false; sync(); }
      });
      var doc = ctx.doc;
      doc.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && check && check.checked) {
          check.checked = false;
          sync();
          if (burger) { try { burger.focus(); } catch (error) { /* 忽略 */ } }
        }
      });
      doc.addEventListener('click', function (event) {
        if (!check || !check.checked) return;
        if (!nav.contains(event.target)) { check.checked = false; sync(); }
      });
    });
  }

  /* ---------------- 模块：theme ---------------- */

  function runtimeTheme(ctx) {
    var doc = ctx.doc, win = ctx.win, u = ctx.util, cfg = ctx.config || {};
    var themes = Array.isArray(cfg.themes) ? cfg.themes.filter(function (item) { return item && item.id; }) : [];
    var store = ctx.store || (ctx.store = u.createStore(win));
    var themeId = store.get('lc-theme') || cfg.theme || (themes[0] && themes[0].id) || '';
    if (themes.length && !themes.some(function (item) { return item.id === themeId; })) {
      themeId = (themes[0] && themes[0].id) || '';
    }
    var stored = store.get('lc-mode');
    var pref = stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : (cfg.mode || 'auto');

    function apply() {
      var mode = u.resolveMode(pref);
      var roots = [doc.documentElement].concat(u.qa('.lc-page', doc));
      roots.forEach(function (el) {
        if (!el) return;
        if (themeId) el.setAttribute('data-lc-theme', themeId);
        el.setAttribute('data-lc-mode', mode);
        el.setAttribute('data-theme', mode);
      });
    }
    apply();
    if (cfg.themeSwitch === false) return;
    if (doc.getElementById('lc-runtime-theme')) return;

    var wrap = doc.createElement('div');
    wrap.className = 'lc-rt-theme';
    wrap.id = 'lc-runtime-theme';
    var button = doc.createElement('button');
    button.type = 'button';
    button.className = 'lc-rt-theme-btn';
    button.textContent = '外观';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'lc-runtime-theme-panel');
    var panel = doc.createElement('div');
    panel.className = 'lc-rt-theme-panel';
    panel.id = 'lc-runtime-theme-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', '外观设置');

    if (themes.length > 1) {
      var row = doc.createElement('div');
      row.className = 'lc-rt-theme-row';
      var label = doc.createElement('span');
      label.className = 'lc-rt-theme-label';
      label.textContent = '主题';
      var select = doc.createElement('select');
      select.setAttribute('aria-label', '选择主题');
      themes.forEach(function (item) {
        var option = doc.createElement('option');
        option.value = item.id;
        option.textContent = item.name || item.id;
        if (item.id === themeId) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', function () {
        themeId = select.value;
        store.set('lc-theme', themeId);
        apply();
      });
      row.appendChild(label);
      row.appendChild(select);
      panel.appendChild(row);
    }

    var modeRow = doc.createElement('div');
    modeRow.className = 'lc-rt-theme-row';
    var modeLabel = doc.createElement('span');
    modeLabel.className = 'lc-rt-theme-label';
    modeLabel.textContent = '明暗';
    var modes = doc.createElement('div');
    modes.className = 'lc-rt-modes';
    [{ id: 'auto', label: '跟随系统' }, { id: 'light', label: '亮' }, { id: 'dark', label: '暗' }].forEach(function (item) {
      var modeButton = doc.createElement('button');
      modeButton.type = 'button';
      modeButton.textContent = item.label;
      modeButton.setAttribute('data-lc-mode-value', item.id);
      modeButton.setAttribute('aria-pressed', pref === item.id ? 'true' : 'false');
      modeButton.addEventListener('click', function () {
        pref = item.id;
        store.set('lc-mode', pref);
        u.qa('[data-lc-mode-value]', modes).forEach(function (node) {
          node.setAttribute('aria-pressed', node.getAttribute('data-lc-mode-value') === pref ? 'true' : 'false');
        });
        apply();
      });
      modes.appendChild(modeButton);
    });
    modeRow.appendChild(modeLabel);
    modeRow.appendChild(modes);
    panel.appendChild(modeRow);

    if (store.mode === 'memory') {
      var note = doc.createElement('p');
      note.className = 'lc-rt-theme-note';
      note.textContent = '存储不可用，选择只在本次会话有效。';
      panel.appendChild(note);
    }

    button.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    });
    doc.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.hidden) {
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        try { button.focus(); } catch (error) { /* 忽略 */ }
      }
    });
    doc.addEventListener('click', function (event) {
      if (panel.hidden) return;
      if (!wrap.contains(event.target)) { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); }
    });
    wrap.appendChild(button);
    wrap.appendChild(panel);
    doc.body.appendChild(wrap);
  }

  /* ---------------- 模块：article ---------------- */

  function runtimeArticle(ctx) {
    var doc = ctx.doc, win = ctx.win, u = ctx.util;
    var toc = doc.querySelector('.lc-article-toc');
    if (!toc) return;
    var article = doc.querySelector('article.lc-article-body');
    if (!article) return;
    var tocs = doc.getElementById('lc-runtime-theme') ? u.createStore(win) : u.createStore(win);
    if (toc.getAttribute('data-lc-rt-toc') === 'true') return;
    toc.setAttribute('data-lc-rt-toc', 'true');

    var list = toc.querySelector('.lc-article-toc-list');
    var title = toc.querySelector('.lc-article-toc-title');
    var links = u.qa('a[href^="#"]', toc);
    var targets = [];
    links.forEach(function (link) {
      var id = '';
      try { id = decodeURIComponent(link.getAttribute('href').slice(1)); }
      catch (error) { id = link.getAttribute('href').slice(1); }
      var target = id ? doc.getElementById(id) : null;
      if (target) targets.push({ id: id, link: link, target: target });
    });

    /* 折叠：状态记在 localStorage，失败退回内存。 */
    var collapsed = tocs.get('lc-toc-collapsed') === '1';
    var toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'lc-rt-toc-toggle';
    toggle.setAttribute('aria-label', '折叠目录');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.textContent = collapsed ? '展开目录' : '收起目录';
    if (title && title.parentNode) title.parentNode.insertBefore(toggle, title.nextSibling);
    else toc.insertBefore(toggle, toc.firstChild);

    var searchBox = doc.createElement('div');
    searchBox.className = 'lc-rt-search';
    var searchInput = doc.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = '在正文中检索';
    searchInput.setAttribute('aria-label', '在正文中检索');
    var searchCount = doc.createElement('span');
    searchCount.className = 'lc-rt-search-count';
    searchCount.setAttribute('role', 'status');
    searchCount.setAttribute('aria-live', 'polite');
    searchCount.textContent = '0 / 0';
    var prevButton = doc.createElement('button');
    prevButton.type = 'button';
    prevButton.textContent = '↑';
    prevButton.setAttribute('aria-label', '上一处匹配');
    var nextButton = doc.createElement('button');
    nextButton.type = 'button';
    nextButton.textContent = '↓';
    nextButton.setAttribute('aria-label', '下一处匹配');
    searchBox.appendChild(searchInput);
    searchBox.appendChild(searchCount);
    searchBox.appendChild(prevButton);
    searchBox.appendChild(nextButton);
    if (list && list.parentNode) list.parentNode.insertBefore(searchBox, list);
    else toc.appendChild(searchBox);

    function syncCollapse() {
      if (list) list.hidden = collapsed;
      searchBox.hidden = collapsed;
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.textContent = collapsed ? '展开目录' : '收起目录';
      tocs.set('lc-toc-collapsed', collapsed ? '1' : '0');
    }
    syncCollapse();
    toggle.addEventListener('click', function () {
      if (collapsed && !searchBox.hidden) searchBox.hidden = false;
      collapsed = !collapsed;
      syncCollapse();
    });

    var hits = [], current = -1;

    function updateCount() {
      searchCount.textContent = (hits.length ? current + 1 : 0) + ' / ' + hits.length;
    }

    function clearHits() {
      hits.forEach(function (mark) {
        var parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(doc.createTextNode(mark.textContent || ''), mark);
        if (parent.normalize) parent.normalize();
      });
      hits = [];
      current = -1;
      updateCount();
    }

    function collectTextNodes() {
      if (!doc.createTreeWalker) return [];
      var walker = doc.createTreeWalker(article, 4, {
        acceptNode: function (node) {
          var parent = node.parentNode;
          if (!parent) return 2;
          var tag = parent.nodeName;
          if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|MARK)$/.test(tag)) return 2;
          if (parent.closest && parent.closest('.lc-ui-sr-only')) return 2;
          if (!node.nodeValue || !node.nodeValue.replace(/\s+/g, '')) return 2;
          return 1;
        }
      }, false);
      var nodes = [];
      var node = walker.nextNode();
      while (node && nodes.length < 400) {
        nodes.push(node);
        node = walker.nextNode();
      }
      return nodes;
    }

    function wrapNode(node, needle) {
      var text = node.nodeValue || '';
      var lower = text.toLowerCase();
      var index = lower.indexOf(needle);
      if (index < 0) return;
      var fragment = doc.createDocumentFragment();
      var cursor = 0;
      while (index !== -1 && hits.length < 200) {
        if (index > cursor) fragment.appendChild(doc.createTextNode(text.slice(cursor, index)));
        var mark = doc.createElement('mark');
        mark.className = 'lc-rt-hit';
        mark.textContent = text.slice(index, index + needle.length);
        fragment.appendChild(mark);
        hits.push(mark);
        cursor = index + needle.length;
        index = lower.indexOf(needle, cursor);
      }
      if (cursor < text.length) fragment.appendChild(doc.createTextNode(text.slice(cursor)));
      if (node.parentNode) node.parentNode.replaceChild(fragment, node);
    }

    function goto(index) {
      if (!hits.length) { updateCount(); return; }
      if (index < 0) index = hits.length - 1;
      if (index >= hits.length) index = 0;
      if (hits[current] && hits[current].classList) hits[current].classList.remove('is-current');
      current = index;
      var mark = hits[current];
      if (mark && mark.classList) mark.classList.add('is-current');
      if (mark && mark.scrollIntoView) {
        try { mark.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        catch (error) { try { mark.scrollIntoView(); } catch (ignored) { /* 忽略 */ } }
      }
      updateCount();
    }

    function runSearch(value) {
      clearHits();
      var needle = String(value == null ? '' : value).replace(/^\s+|\s+$/g, '').toLowerCase();
      if (!needle) return;
      collectTextNodes().forEach(function (node) { wrapNode(node, needle); });
      if (hits.length) goto(0);
      else { searchCount.textContent = '0 / 0'; }
    }

    var timer = null;
    searchInput.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { runSearch(searchInput.value); }, 120);
    });
    searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!hits.length) runSearch(searchInput.value);
        else goto(event.shiftKey ? current - 1 : current + 1);
      } else if (event.key === 'Escape') {
        searchInput.value = '';
        clearHits();
      }
    });
    prevButton.addEventListener('click', function () { goto(current - 1); });
    nextButton.addEventListener('click', function () { goto(current + 1); });

    function jumpTo(id, updateHash) {
      var target = doc.getElementById(id);
      if (!target) return;
      var rect = target.getBoundingClientRect();
      var top = rect.top + (win.pageYOffset || doc.documentElement.scrollTop || 0) - 96;
      try { win.scrollTo({ top: top, behavior: 'smooth' }); }
      catch (error) { win.scrollTo(0, top); }
      if (updateHash) {
        try { win.history.replaceState(null, '', '#' + id); } catch (error) { /* file:// 可能拒绝 */ }
      }
      try {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      } catch (error) { /* 忽略 */ }
    }

    targets.forEach(function (item) {
      item.link.addEventListener('click', function (event) {
        event.preventDefault();
        setActive(item.id);
        jumpTo(item.id, true);
      });
    });

    function setActive(id) {
      targets.forEach(function (item) {
        var on = item.id === id;
        if (on) {
          item.link.classList.add('is-active');
          item.link.setAttribute('aria-current', 'location');
        } else {
          item.link.classList.remove('is-active');
          item.link.removeAttribute('aria-current');
        }
      });
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      var run = function () {
        ticking = false;
        var active = null;
        targets.forEach(function (item) {
          var top = item.target.getBoundingClientRect().top;
          if (top <= 120) active = item;
        });
        if (!active && targets.length) active = targets[0];
        if (active) setActive(active.id);
      };
      if (win.requestAnimationFrame) win.requestAnimationFrame(run);
      else setTimeout(run, 60);
    }
    win.addEventListener('scroll', onScroll, { passive: true });
    if (targets.length) setActive(targets[0].id);
    if (win.location && win.location.hash.length > 1) {
      var initial = '';
      try { initial = decodeURIComponent(win.location.hash.slice(1)); }
      catch (error) { initial = win.location.hash.slice(1); }
      setTimeout(function () { jumpTo(initial, false); }, 0);
    }
  }

  /* ---------------- 模块：form ---------------- */

  function runtimeForm(ctx) {
    var u = ctx.util;
    u.qa('[data-lc-ui="ui-form"]', ctx.doc).forEach(function (el) {
      if (el.getAttribute('data-lc-rt-form') === 'true') return;
      var data = u.readIsland(el);
      if (!data || !Array.isArray(data.fields) || !data.fields.length) return;
      el.setAttribute('data-lc-rt-form', 'true');
      var fields = data.fields;
      var form = el.querySelector('form') || el;
      var status = el.querySelector('[data-lc-form-status]');
      var submit = el.querySelector('[data-lc-submit]');
      var endpoint = String(data.endpoint || '');
      var method = String(data.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
      var touched = {};

      function fieldBox(name) {
        var list = el.querySelectorAll('[data-field]');
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].getAttribute('data-field') === name) return list[i];
        }
        return null;
      }

      function controlsFor(name) {
        return Array.prototype.slice.call(form.querySelectorAll('input, select, textarea')).filter(function (control) {
          return control.getAttribute('data-lc-control') === name;
        });
      }

      function values() {
        var out = {};
        fields.forEach(function (field) {
          var controls = controlsFor(field.name);
          if (field.type === 'checkbox') {
            out[field.name] = controls.filter(function (control) { return control.checked; })
              .map(function (control) { return control.value; });
          } else if (field.type === 'radio') {
            var hit = controls.filter(function (control) { return control.checked; })[0];
            out[field.name] = hit ? hit.value : '';
          } else {
            out[field.name] = controls.length ? controls[0].value : '';
          }
        });
        return out;
      }

      function visibleFields() {
        var current = values();
        return fields.filter(function (field) { return u.isFieldVisible(field.visibleWhen, current); });
      }

      function applyLinkage() {
        var current = values();
        fields.forEach(function (field) {
          var box = fieldBox(field.name);
          if (!box) return;
          var visible = u.isFieldVisible(field.visibleWhen, current);
          box.hidden = !visible;
          Array.prototype.slice.call(box.querySelectorAll('input, select, textarea')).forEach(function (control) {
            control.disabled = !visible || field.disabled === true;
          });
        });
      }

      function setFieldError(name, message) {
        var box = fieldBox(name);
        if (!box) return;
        var error = box.querySelector('[data-lc-error]');
        var controls = Array.prototype.slice.call(box.querySelectorAll('input, select, textarea'));
        if (message) {
          box.classList.add('has-error');
          if (error) { error.textContent = message; error.removeAttribute('hidden'); }
          controls.forEach(function (control) { control.setAttribute('aria-invalid', 'true'); });
        } else {
          box.classList.remove('has-error');
          if (error) { error.textContent = ''; error.setAttribute('hidden', ''); }
          controls.forEach(function (control) { control.removeAttribute('aria-invalid'); });
        }
      }

      function setStatus(kind, text) {
        if (!status) return;
        status.className = 'lc-ui-form-status' + (kind ? ' is-' + kind : '');
        status.textContent = text || '';
        if (kind === 'ok' || kind === 'invalid') {
          status.setAttribute('role', 'status');
          status.setAttribute('aria-live', 'polite');
        } else {
          status.setAttribute('role', 'alert');
          status.setAttribute('aria-live', 'assertive');
        }
      }

      function finish(text) {
        setStatus('ok', text || data.successText || '提交成功。');
        if (submit) submit.disabled = false;
      }

      function fail(text) {
        setStatus('error', text || data.errorText || '提交失败，请稍后重试。');
        if (submit) submit.disabled = false;
        u.emit(el, 'lc:form-error', { message: text || data.errorText || '' });
      }

      function send(payload) {
        if (!endpoint) {
          fail('未配置提交地址，未发送请求。');
          return;
        }
        if (!ctx.win.XMLHttpRequest) { fail('当前环境不支持网络请求。'); return; }
        var url = u.resolveUrl(endpoint);
        var xhr = new ctx.win.XMLHttpRequest();
        xhr.open(method, url, true);
        if (method !== 'GET') xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            finish();
            u.emit(el, 'lc:form-success', { status: xhr.status, values: payload });
          } else {
            fail('提交失败（HTTP ' + xhr.status + '）。');
          }
        };
        xhr.onerror = function () {
          fail('提交失败：无法连接 ' + url + (ctx.win.location && ctx.win.location.protocol === 'file:' ? '（file:// 下浏览器会拦截网络请求）' : '') + '。');
        };
        try {
          xhr.send(method === 'GET' ? null : JSON.stringify(payload));
        } catch (error) {
          fail('提交失败：' + (error && error.message ? error.message : '请求无法发出'));
        }
      }

      function onSubmit(event) {
        if (event) event.preventDefault();
        applyLinkage();
        var current = values();
        var errors = {};
        var first = null;
        visibleFields().forEach(function (field) {
          var message = u.validateField(field, current[field.name]);
          errors[field.name] = message;
          setFieldError(field.name, message);
          if (message && !first) first = field;
        });
        if (first) {
          setStatus('invalid', '请检查标红的字段。');
          var box = fieldBox(first.name);
          var control = box ? box.querySelector('input, select, textarea') : null;
          if (control) { try { control.focus(); } catch (error) { /* 忽略 */ } }
          u.emit(el, 'lc:form-invalid', { values: current, errors: errors });
          return;
        }
        var payload = {};
        visibleFields().forEach(function (field) { payload[field.name] = current[field.name]; });
        setStatus('loading', '正在提交…');
        if (submit) submit.disabled = true;
        var outgoing = u.emit(el, 'lc:form-submit', { values: payload, fields: fields });
        if (outgoing && outgoing.defaultPrevented) {
          setStatus('idle', '已交给外部处理器。');
          if (submit) submit.disabled = false;
          return;
        }
        send(payload);
      }

      function onChange(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var name = target.getAttribute('data-lc-control');
        if (!name) return;
        applyLinkage();
        if (!touched[name]) return;
        var field = null;
        fields.forEach(function (item) { if (item.name === name) field = item; });
        if (field) setFieldError(name, u.validateField(field, values()[name]));
      }

      function onBlur(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var name = target.getAttribute('data-lc-control');
        if (!name) return;
        touched[name] = true;
        applyLinkage();
        var field = null;
        fields.forEach(function (item) { if (item.name === name) field = item; });
        if (field) setFieldError(name, u.validateField(field, values()[name]));
      }

      function onReset() {
        touched = {};
        fields.forEach(function (field) { setFieldError(field.name, null); });
        setStatus('idle', '');
        if (submit) submit.disabled = false;
        u.emit(el, 'lc:form-reset', {});
      }

      applyLinkage();
      form.addEventListener('submit', onSubmit);
      form.addEventListener('change', onChange);
      form.addEventListener('focusout', onBlur);
      form.addEventListener('reset', onReset);
      el.__lcRuntimeForm = { values: values, validate: onSubmit };
    });
  }

  /* ---------------- 模块：async ---------------- */

  function runtimeAsync(ctx) {
    var u = ctx.util, doc = ctx.doc, win = ctx.win;
    var saved = null;
    try {
      var node = doc.querySelector('script[data-lc-sources]');
      if (node) saved = JSON.parse(node.textContent || '{}');
    } catch (error) { saved = null; }

    function resolveSource(name) {
      var cfgSources = ctx.config && ctx.config.sources;
      if (cfgSources && Object.prototype.hasOwnProperty.call(cfgSources, name)) return cfgSources[name];
      if (saved && Object.prototype.hasOwnProperty.call(saved, name)) return saved[name];
      if (win.LC_RUNTIME_SOURCES && Object.prototype.hasOwnProperty.call(win.LC_RUNTIME_SOURCES, name)) return win.LC_RUNTIME_SOURCES[name];
      var render = win.LC && win.LC.Render;
      if (render) {
        if (typeof render.resolveDataSource === 'function') {
          var resolved = render.resolveDataSource(name);
          if (resolved) return resolved;
        }
        if (render.dataSources && Object.prototype.hasOwnProperty.call(render.dataSources, name)) {
          return render.dataSources[name];
        }
      }
      var holder = doc.querySelector('[data-lc-source="' + name.replace(/"/g, '\\"') + '"]');
      if (holder) {
        try { return JSON.parse(holder.textContent || 'null'); } catch (error) { return null; }
      }
      return null;
    }

    function load(source) {
      if (typeof source === 'function') return source();
      if (source && typeof source.load === 'function') return source.load();
      if (source && typeof source.fetchData === 'function') return source.fetchData();
      if (typeof source === 'string') {
        if (!win.fetch) return Promise.reject(new Error('当前环境不支持 fetch'));
        var url = u.resolveUrl(source);
        return win.fetch(url, { credentials: 'same-origin' }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url);
          return response.json();
        });
      }
      return source;
    }

    function stateNode(el, kind, text, retry) {
      var body = el.querySelector('[data-lc-chart-body]') || el.querySelector('[data-lc-stat-body]') || el;
      body.innerHTML = '<div class="lc-ui-state lc-ui-state-' + (kind === 'error' ? 'error' : kind) + '" data-lc-runtime-state="' + kind + '">' +
        '<div class="lc-ui-state-body"><p class="lc-ui-state-title">' +
        u.esc(kind === 'error' ? '加载失败' : (kind === 'empty' ? '暂无数据' : '正在加载')) + '</p>' +
        (text ? '<p class="lc-ui-state-text">' + u.esc(text) + '</p>' : '') +
        (retry ? '<p><button type="button" class="lc-ui-action" data-lc-retry="true">重试</button></p>' : '') +
        '</div></div>';
      el.setAttribute('data-lc-state', kind === 'error' ? 'error' : kind);
    }

    function paint(el, type, config, result) {
      var body = el.querySelector('[data-lc-chart-body]');
      if (type.indexOf('ui-chart-') === 0 || type === 'ui-sparkline') {
        var kind = type === 'ui-sparkline' ? 'sparkline' : type.slice('ui-chart-'.length);
        var model = u.normalizeChartModel(result, config);
        var count = 0;
        model.series.forEach(function (item) { count += item.values.filter(function (value) { return value != null; }).length; });
        if (!count) {
          stateNode(el, 'empty', config.emptyText || '没有可绘制的数据点。', false);
          u.emit(el, 'lc:chart-load', { chart: kind, datasource: config.datasource, points: 0, empty: true });
          return;
        }
        var head = '';
        if (kind !== 'sparkline' && (config.title || config.subtitle)) {
          head = '<div class="lc-ui-chart-head">' +
            (config.title ? '<p class="lc-ui-chart-title">' + u.esc(config.title) + '</p>' : '') +
            (config.subtitle ? '<p class="lc-ui-chart-subtitle">' + u.esc(config.subtitle) + '</p>' : '') +
            '</div>';
        }
        body.innerHTML = head + '<div class="lc-ui-chart-canvas' + (kind === 'sparkline' ? ' is-sparkline' : '') +
          '" data-lc-chart-canvas="true"' + (kind === 'sparkline' ? ' aria-hidden="true"' : ' role="img" aria-label="' + u.esc(config.ariaLabel || u.modelSummary(kind, model)) + '"') + '>' +
          u.chartSvg(kind, model, config) + '</div>';
        el.setAttribute('data-lc-state', 'ready');
        u.emit(el, 'lc:chart-load', { chart: kind, datasource: config.datasource, points: count });
        return;
      }
      var value = result;
      if (result && typeof result === 'object') {
        value = u.rowValue(result, config.valueField || 'value');
        if (value == null) value = result.value;
      }
      if (value == null) {
        stateNode(el, 'empty', config.emptyText || '暂无数值。', false);
        u.emit(el, 'lc:stat-load', { kind: type, datasource: config.datasource, empty: true });
        return;
      }
      var max = config.max;
      if (result && typeof result === 'object' && config.maxField) {
        var readMax = u.rowValue(result, config.maxField);
        if (readMax != null) max = readMax;
      }
      if (type === 'ui-kpi') {
        var number = el.querySelector('.lc-ui-kpi-number');
        if (number) number.textContent = String(value);
      } else if (type === 'ui-progress') {
        var pct = Math.min(100, Math.max(0, (Number(value) / (Number(max) || 100)) * 100));
        var bar = el.querySelector('.lc-ui-progress-bar');
        if (bar) bar.style.width = pct.toFixed(1) + '%';
        var track = el.querySelector('.lc-ui-progress-track');
        if (track) {
          track.setAttribute('aria-valuenow', String(value));
          track.setAttribute('aria-valuetext', String(value) + ' / ' + String(max || 100));
        }
      } else if (type === 'ui-progress-ring') {
        var ringPct = Math.min(100, Math.max(0, (Number(value) / (Number(max) || 100)) * 100));
        var circle = el.querySelector('.lc-ui-ring-bar');
        if (circle) {
          var circumference = parseFloat(circle.getAttribute('stroke-dasharray')) || 326.73;
          circle.setAttribute('stroke-dashoffset', String(Math.round(circumference * (1 - ringPct / 100) * 100) / 100));
        }
        var ringValue = el.querySelector('.lc-ui-ring-value');
        if (ringValue) ringValue.textContent = String(value) + '%';
      }
      el.setAttribute('data-lc-state', 'ready');
      u.emit(el, 'lc:stat-load', { kind: type, datasource: config.datasource });
    }

    u.qa('[data-lc-ui]', doc).forEach(function (el) {
      var type = el.getAttribute('data-lc-ui') || '';
      if (!/^ui-(chart-|sparkline$|kpi$|progress$|progress-ring$)/.test(type)) return;
      if (el.getAttribute('data-lc-rt-async') === 'true') return;
      var config = u.readIsland(el);
      if (!config || !config.datasource) return;
      el.setAttribute('data-lc-rt-async', 'true');
      var name = String(config.datasource);
      var source = resolveSource(name);
      if (!source) {
        stateNode(el, 'empty', '数据源「' + name + '」未注册，暂不展示数据。', false);
        return;
      }
      var attempt = 0;
      var seq = 0;
      function request() {
        attempt += 1;
        var token = ++seq;
        stateNode(el, 'loading', '正在从数据源「' + name + '」加载…', false);
        var output;
        try { output = load(source); }
        catch (error) { failure(error, token); return; }
        if (output && typeof output.then === 'function') {
          output.then(function (result) {
            if (token !== seq) return;
            paint(el, type, config, result);
          }, function (error) { failure(error, token); });
        } else {
          paint(el, type, config, output);
        }
      }
      function failure(error, token) {
        if (token !== seq) return;
        var message = error && error.message ? error.message : '请求失败';
        var retry = attempt < 3;
        stateNode(el, 'error', '数据源「' + name + '」加载失败：' + message + '。', retry);
        u.emit(el, 'lc:chart-error', { chart: type, datasource: name, message: message });
        var button = el.querySelector('[data-lc-retry]');
        if (button) button.addEventListener('click', request);
      }
      /* 首屏之外的图表等滚动到附近再请求，减少首屏并发与主线程占用；无 IO 时立即加载。 */
      var started = false;
      function begin() {
        if (started) return;
        started = true;
        request();
      }
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      var farBelow = rect && rect.top > ((win.innerHeight || 0) + 200);
      if (farBelow && typeof win.IntersectionObserver === 'function') {
        var observer = new win.IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            observer.unobserve(el);
            begin();
          });
        }, { rootMargin: '200px 0px' });
        observer.observe(el);
      } else {
        begin();
      }
    });

    /* 事件绑定写图表 / KPI / 进度时复用这里的绘制函数，避免第二套图元实现。 */
    ctx.paintAsync = paint;
    ctx.win.__LC_PAINT_ASYNC__ = paint;
  }

  /* ---------------- 模块：table ---------------- */

  /* 图片懒加载：视口外不写真实 src；失败展示占位与说明；无 IO 时立即加载。 */
  function runtimeMedia(ctx) {
    var u = ctx.util;
    var view = ctx.doc.defaultView;

    function bind(img) {
      if (!img || img.getAttribute('data-lc-rt-media') === 'true') return;
      img.setAttribute('data-lc-rt-media', 'true');
      var box = img.closest ? img.closest('.lc-ui-image') : null;
      var errorBox = box ? box.querySelector('[data-lc-image-error]') : null;
      var errorText = box ? box.querySelector('[data-lc-image-error-text]') : null;
      var data = box ? u.readIsland(box) : null;
      if (errorText && data && data.errorText) errorText.textContent = data.errorText;
      var settled = false;

      function settle(ok) {
        if (settled) return;
        settled = true;
        if (box) {
          box.classList.remove('is-loading');
          box.classList.toggle('is-loaded', ok);
          box.classList.toggle('is-error', !ok);
        }
        if (ok) {
          if (errorBox) errorBox.hidden = true;
          img.removeAttribute('hidden');
        } else {
          if (errorBox) errorBox.hidden = false;
          img.setAttribute('hidden', '');
          img.setAttribute('aria-hidden', 'true');
          if (!box) img.setAttribute('alt', (img.getAttribute('alt') || '') + '（图片加载失败）');
        }
        u.emit(box || img, ok ? 'lc:image-load' : 'lc:image-error', { src: img.getAttribute('data-lc-src') || '' });
      }

      function load(force) {
        var src = img.getAttribute('data-lc-src');
        if (!src) { settle(false); return; }
        settled = false;
        if (box) {
          box.classList.add('is-loading');
          box.classList.remove('is-error', 'is-loaded');
        }
        if (errorBox) errorBox.hidden = true;
        img.removeAttribute('hidden');
        img.removeAttribute('aria-hidden');
        var onLoad = function () {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          settle(true);
        };
        var onError = function () {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          settle(false);
        };
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
        if (force) {
          var join = src.indexOf('?') === -1 ? '?' : '&';
          src += join + 'lc_retry=' + Date.now();
        }
        img.src = src;
        if (img.complete) settle(!!img.naturalWidth);
      }

      img.__lcImageLoad = load;

      var lazy = img.getAttribute('loading') !== 'eager';
      if (lazy && view && typeof view.IntersectionObserver === 'function') {
        var observer = new view.IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            observer.unobserve(img);
            load(false);
          });
        }, { rootMargin: '200px 0px' });
        observer.observe(img);
      } else {
        load(false);
      }
    }

    u.qa('img[data-lc-src]', ctx.doc).forEach(bind);

    ctx.doc.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var button = target.closest('[data-lc-image-retry]');
      if (!button) return;
      var box = button.closest('.lc-ui-image');
      var img = box ? box.querySelector('img[data-lc-src]') : null;
      if (img && typeof img.__lcImageLoad === 'function') img.__lcImageLoad(true);
    });
  }

  function runtimeTable(ctx) {
    var u = ctx.util;

    function initTable(el, data) {
      if (el.getAttribute('data-lc-rt-table') === 'true') return;
      if (!data || !Array.isArray(data.rows) || !Array.isArray(data.columns)) return;
      if (data.state && data.state !== 'ready') return;
      el.setAttribute('data-lc-rt-table', 'true');
      var columns = data.columns;
      var rows = data.rows;
      var rowKey = data.rowKey || 'id';
      var pageSize = Number(data.pageSize) || 0;
      var sort = { key: '', dir: 'asc' };
      var page = Number(data.page) || 1;
      var tbody = el.querySelector('[data-lc-tbody]');
      var pager = el.querySelector('[data-lc-pager]');
      var info = el.querySelector('[data-lc-page-info]');
      var prev = el.querySelector('[data-lc-page-prev]');
      var next = el.querySelector('[data-lc-page-next]');
      var selection = el.querySelector('[data-lc-selected]');
      var selected = {};
      var scrollEl = el.querySelector('[data-lc-table-scroll]');
      var virtual = !!data.virtual && !!scrollEl;
      var rowH = Math.max(20, Number(data.rowHeight) || 37);
      var viewportH = Math.max(80, Number(data.height) || 360);
      var colSpan = columns.length + (data.selectable ? 1 : 0);
      var ticking = false;
      var tableId = 'lc-rt-table-' + ((ctx.tableSeed = (ctx.tableSeed || 0) + 1));
      var activeIndex = null;

      function currentRows() {
        return sort.key ? u.sortRows(rows, sort.key, sort.dir, columns) : rows.slice();
      }

      function currentPager() { return u.paginate(currentRows(), page, pageSize); }

      function idFor(row, index) {
        var value = u.rowValue(row, rowKey);
        return value == null ? String(index) : String(value);
      }

      function rowElementId(absolute) { return tableId + '-row-' + absolute; }

      function rowHtml(row, absolute) {
        var cells = '';
        if (data.selectable) {
          var id = idFor(row, absolute);
          cells += '<td class="lc-ui-td lc-ui-td-check"><input type="checkbox" class="lc-ui-check" data-lc-row-check="true" data-lc-row-key="' +
            u.esc(id) + '" value="' + u.esc(id) + '" aria-label="选择第 ' + (absolute + 1) + ' 行"' +
            (selected[id] ? ' checked' : '') + '></td>';
        }
        columns.forEach(function (column) {
          var style = column.width ? ' style="width:' + u.esc(column.width) + '"' : '';
          cells += '<td class="lc-ui-td lc-ui-align-' + u.esc(column.align || 'left') + '"' + style + '>' +
            u.esc(u.formatCell(u.rowValue(row, column.key), column)) + '</td>';
        });
        return '<tr class="lc-ui-tr" data-lc-row-index="' + absolute + '"' +
          (virtual ? ' id="' + rowElementId(absolute) + '" style="height:' + rowH + 'px"' : '') + '>' + cells + '</tr>';
      }

      function padHtml(count, height, position) {
        if (count <= 0 || height <= 0) return '';
        return '<tr class="lc-ui-virtual-pad" data-lc-pad="' + position + '" aria-hidden="true"><td colspan="' +
          colSpan + '" style="height:' + height + 'px;padding:0;border:0"></td></tr>';
      }

      function renderBody() {
        if (!tbody) return;
        var result = currentPager();
        var total = result.rows.length;
        var range = virtual
          ? u.windowRange(scrollEl ? scrollEl.scrollTop : 0, viewportH, rowH, total, 6)
          : { start: 0, end: total };
        var start = range.start;
        var end = range.end;
        var html = padHtml(start, start * rowH, 'top');
        for (var i = start; i < end; i += 1) html += rowHtml(result.rows[i], result.start + i);
        html += padHtml(total - end, (total - end) * rowH, 'bottom');
        tbody.innerHTML = html;

        var infoEl = el.querySelector('[data-lc-virtual-info]');
        if (infoEl) {
          infoEl.textContent = total
            ? (result.start + start + 1) + '–' + (result.start + end) + ' / ' + rows.length + ' 行'
            : '0 / ' + rows.length + ' 行';
        }
        /* 焦点留在滚动容器，活动行用高亮 + aria-activedescendant 表达，
           重绘时不会因为行被替换而丢失焦点。 */
        if (virtual && scrollEl) {
          var rendered = activeIndex != null && activeIndex >= result.start + start &&
            activeIndex < result.start + end;
          var activeRow = rendered ? tbody.querySelector('tr[data-lc-row-index="' + activeIndex + '"]') : null;
          u.qa('.lc-ui-tr.is-active', tbody).forEach(function (tr) { tr.classList.remove('is-active'); });
          if (activeRow) {
            activeRow.classList.add('is-active');
            scrollEl.setAttribute('aria-activedescendant', rowElementId(activeIndex));
          } else {
            scrollEl.removeAttribute('aria-activedescendant');
          }
        }
      }

      function renderSort() {
        u.qa('[data-lc-col]', el).forEach(function (th) {
          var key = th.getAttribute('data-lc-col');
          var button = th.querySelector('[data-lc-sort]');
          if (!button) return;
          th.setAttribute('aria-sort', sort.key && sort.key === key
            ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none');
          var use = th.querySelector('.lc-ui-sort-icon use');
          var icon = th.querySelector('.lc-ui-sort-icon');
          if (icon) icon.classList.toggle('is-active', !!(sort.key && sort.key === key));
          if (use) {
            use.setAttribute('href', '#lc-icon-' + (sort.key && sort.key === key
              ? (sort.dir === 'desc' ? 'chevron-down' : 'chevron-up') : 'sort'));
          }
        });
      }

      function renderPager() {
        var result = currentPager();
        if (!pager) return;
        if (pageSize <= 0 || result.totalPages <= 1) {
          pager.setAttribute('hidden', '');
          return;
        }
        pager.removeAttribute('hidden');
        if (info) info.textContent = '第 ' + result.page + ' / ' + result.totalPages + ' 页';
        if (prev) prev.disabled = result.page <= 1;
        if (next) next.disabled = result.page >= result.totalPages;
      }

      function refresh() {
        renderSort();
        renderBody();
        renderPager();
      }

      function syncSelection() {
        if (!selection) return;
        var count = Object.keys(selected).length;
        selection.textContent = '已选 ' + count + ' 行';
        selection.hidden = count === 0;
      }

      function scrollToIndex(target) {
        var result = currentPager();
        var total = result.rows.length;
        if (virtual && scrollEl && total) {
          var local = Math.max(0, Math.min(total - 1, target - result.start));
          var max = Math.max(0, total * rowH + 40 - viewportH);
          scrollEl.scrollTop = Math.max(0, Math.min(max, local * rowH - Math.floor((viewportH - rowH) / 2)));
        }
        activeIndex = target;
        renderBody();
        if (virtual && scrollEl && ctx.doc.activeElement !== scrollEl) {
          try { scrollEl.focus({ preventScroll: true }); }
          catch (error) { try { scrollEl.focus(); } catch (ignored) { /* 忽略 */ } }
        }
      }

      function resetScroll() {
        if (virtual && scrollEl) scrollEl.scrollTop = 0;
      }

      if (virtual && scrollEl) {
        scrollEl.addEventListener('scroll', function () {
          if (ticking) return;
          ticking = true;
          var view = ctx.doc.defaultView;
          var run = function () { ticking = false; renderBody(); };
          if (view && view.requestAnimationFrame) view.requestAnimationFrame(run);
          else setTimeout(run, 50);
        }, { passive: true });
        scrollEl.addEventListener('keydown', function (event) {
          var result = currentPager();
          var total = result.rows.length;
          if (!total) return;
          var focused = activeIndex;
          var range = u.windowRange(scrollEl.scrollTop, viewportH, rowH, total, 0);
          var base = focused != null ? focused : result.start + range.start;
          var visible = Math.max(1, Math.floor(viewportH / rowH));
          var target = null;
          if (event.key === 'ArrowDown') target = base + 1;
          else if (event.key === 'ArrowUp') target = base - 1;
          else if (event.key === 'PageDown') target = base + visible;
          else if (event.key === 'PageUp') target = base - visible;
          else if (event.key === 'Home') target = result.start;
          else if (event.key === 'End') target = result.start + total - 1;
          if (target == null) return;
          event.preventDefault();
          scrollToIndex(Math.max(result.start, Math.min(result.start + total - 1, target)));
        });
      }

      el.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var sortButton = target.closest('[data-lc-sort]');
        if (sortButton) {
          var key = sortButton.getAttribute('data-lc-sort');
          sort = sort.key === key ? { key: key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: key, dir: 'asc' };
          page = 1;
          resetScroll();
          refresh();
          u.emit(el, 'lc:table-sort', { key: sort.key, direction: sort.dir, rows: currentRows().slice() });
          return;
        }
        if (target.closest('[data-lc-page-prev]')) {
          page = Math.max(1, currentPager().page - 1);
          resetScroll();
          refresh();
          u.emit(el, 'lc:table-page', { page: page, pageSize: pageSize });
          return;
        }
        if (target.closest('[data-lc-page-next]')) {
          page = Math.min(currentPager().totalPages, currentPager().page + 1);
          resetScroll();
          refresh();
          u.emit(el, 'lc:table-page', { page: page, pageSize: pageSize });
          return;
        }
        if (target.closest('[data-lc-jump-top]')) {
          scrollToIndex(currentPager().start);
          return;
        }
        if (target.closest('[data-lc-jump-bottom]')) {
          var result = currentPager();
          scrollToIndex(result.start + result.rows.length - 1);
        }
      });

      el.addEventListener('change', function (event) {
        var target = event.target;
        if (!target || !target.hasAttribute) return;
        if (target.hasAttribute('data-lc-select-all')) {
          var result = currentPager();
          u.qa('[data-lc-row-check]', el).forEach(function (input) { input.checked = target.checked; });
          result.rows.forEach(function (row, index) {
            var id = idFor(row, result.start + index);
            if (target.checked) selected[id] = true;
            else delete selected[id];
          });
          syncSelection();
          return;
        }
        if (target.hasAttribute('data-lc-row-check')) {
          var rowId = target.getAttribute('data-lc-row-key');
          if (target.checked) selected[rowId] = true;
          else delete selected[rowId];
          syncSelection();
        }
      });

      /* 事件绑定 / 外部脚本替换表格数据：保留列定义与排序能力，重置到第一页。 */
      el.__lcTable = {
        setRows: function (nextRows) {
          if (!Array.isArray(nextRows)) return false;
          rows = nextRows.slice();
          page = 1;
          selected = {};
          activeIndex = null;
          resetScroll();
          syncSelection();
          refresh();
          return true;
        },
        getRows: function () { return rows.slice(); }
      };

      refresh();
    }

    function showLoadError(el, error, retry) {
      var old = el.querySelector('[data-lc-table-load-error]');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var box = ctx.doc.createElement('div');
      box.setAttribute('data-lc-table-load-error', 'true');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin:0 0 8px;padding:10px 14px;border:1px solid var(--lc-color-line, #d9d4c7);' +
        'border-radius:var(--lc-radius-md, 8px);background:var(--lc-color-surface-2, #f1efe7);color:var(--lc-color-ink, #1d2320)';
      var text = ctx.doc.createElement('p');
      text.style.cssText = 'margin:0 0 8px;font-size:13px;line-height:1.6';
      text.textContent = '表格数据加载失败：' + (error && error.message ? error.message : '请求未完成') +
        '。此导出包需要通过 HTTP 访问；双击打开不可用，需要双击请导出 Tauri 应用。';
      var button = ctx.doc.createElement('button');
      button.type = 'button';
      button.setAttribute('data-lc-table-retry', 'true');
      button.style.cssText = 'padding:5px 12px;border:1px solid var(--lc-color-line-strong, #b9b2a1);' +
        'border-radius:var(--lc-radius-sm, 5px);background:var(--lc-color-surface, #fffefb);' +
        'color:var(--lc-color-ink, #1d2320);font:inherit;font-size:13px;cursor:pointer';
      button.textContent = '重试';
      box.appendChild(text);
      box.appendChild(button);
      el.insertBefore(box, el.firstChild);
      el.__lcTableRetry = retry;
    }

    function start(el) {
      if (el.getAttribute('data-lc-rt-table') === 'true' ||
        el.getAttribute('data-lc-rt-pending') === 'true') return;
      if (el.getAttribute('data-lc-rt-retry-bound') !== 'true') {
        el.setAttribute('data-lc-rt-retry-bound', 'true');
        el.addEventListener('click', function (event) {
          var target = event.target;
          if (!target || !target.closest || !target.closest('[data-lc-table-retry]')) return;
          event.preventDefault();
          var old = el.querySelector('[data-lc-table-load-error]');
          if (old && old.parentNode) old.parentNode.removeChild(old);
          if (typeof el.__lcTableRetry === 'function') el.__lcTableRetry();
        });
      }
      var node = u.islandNode(el);
      if (node && node.getAttribute('data-lc-src') && (node.textContent || '').replace(/\s/g, '') === '') {
        el.setAttribute('data-lc-rt-pending', 'true');
        el.setAttribute('aria-busy', 'true');
        u.loadIsland(el, ctx.win, function (data, error) {
          el.removeAttribute('data-lc-rt-pending');
          el.setAttribute('aria-busy', 'false');
          if (data) initTable(el, data);
          else showLoadError(el, error, function () { start(el); });
        });
        return;
      }
      var data = u.readIsland(el);
      if (!data || !Array.isArray(data.rows) || !Array.isArray(data.columns)) return;
      if (data.state && data.state !== 'ready') return;
      initTable(el, data);
    }

    u.qa('[data-lc-ui="ui-table"]', ctx.doc).forEach(start);
  }

  /* ---------------- 模块选择与拼装 ---------------- */

  var SOURCES = {
    core: runtimeCore,
    nav: runtimeNav,
    theme: runtimeTheme,
    article: runtimeArticle,
    form: runtimeForm,
    async: runtimeAsync,
    table: runtimeTable,
    media: runtimeMedia
  };

  function normalizeInput(input) {
    if (typeof input === 'string') return { html: input };
    if (input && typeof input === 'object') {
      return {
        html: typeof input.html === 'string' ? input.html
          : (typeof input.markup === 'string' ? input.markup : ''),
        site: input.site || null,
        page: input.page || null
      };
    }
    return { html: '' };
  }

  /* 只根据页面里真实出现的组件选择模块，纯文档页不背表单 / 图表。 */
  function selectModules(input) {
    var model = normalizeInput(input);
    var html = model.html || '';
    var modules = ['core', 'theme'];
    if (/lc-shell-nav|data-lc-ui="ui-site-nav"/.test(html)) modules.push('nav');
    if (/data-lc-article="true"|lc-article-toc/.test(html)) modules.push('article');
    if (/data-lc-ui="ui-form"/.test(html)) modules.push('form');
    if (/data-lc-ui="ui-table"/.test(html)) modules.push('table');
    if (/data-lc-ui="ui-image"|<img[^>]*data-lc-src="/.test(html)) modules.push('media');
    if (/data-lc-ui="ui-(chart-|sparkline|kpi|progress)/.test(html)) {
      modules.push('async');
    }
    return ORDER.filter(function (name) { return modules.indexOf(name) !== -1; });
  }

  function byteLength(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    return unescape(encodeURIComponent(text)).length;
  }

  function themeList(model, options) {
    var source = options.themes || (model.site && (model.site.themes || (model.site.project && model.site.project.themes))) || [];
    return (Array.isArray(source) ? source : []).filter(function (item) {
      return item && item.id;
    }).map(function (item) {
      return { id: String(item.id), name: String(item.name || item.label || item.id) };
    });
  }

  function buildRuntime(input, options) {
    var opts = options || {};
    var model = normalizeInput(input);
    var modules = Array.isArray(opts.modules) ? opts.modules.filter(function (name) {
      return ORDER.indexOf(name) !== -1;
    }) : selectModules(model);
    modules = ORDER.filter(function (name) { return modules.indexOf(name) !== -1; });
    if (modules.indexOf('core') === -1) modules.unshift('core');

    var config = {
      version: VERSION,
      theme: opts.theme || (model.page && model.page.themeId) || '',
      mode: opts.mode || 'auto',
      themes: themeList(model, opts),
      themeSwitch: opts.themeSwitch !== false,
      articleSearch: opts.articleSearch !== false,
      sources: opts.sources && typeof opts.sources === 'object' ? opts.sources : null
    };

    var functionLines = modules.map(function (name) {
      return 'var M_' + name + ' = ' + SOURCES[name].toString() + ';';
    }).join('\n');
    var names = JSON.stringify(modules);
    var list = modules.map(function (name) { return 'M_' + name; }).join(', ');
    var configText = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

    var utilLines = [
      'var UTIL = (' + runtimeUtilBase.toString() + ')();',
      'function __lcMerge(target, source) { Object.keys(source).forEach(function (key) { target[key] = source[key]; }); return target; }'
    ];
    if (modules.indexOf('form') !== -1) {
      utilLines.push('__lcMerge(UTIL, (' + runtimeUtilForm.toString() + ')(UTIL));');
    }
    if (modules.indexOf('table') !== -1) {
      utilLines.push('__lcMerge(UTIL, (' + runtimeUtilTable.toString() + ')(UTIL));');
      var htmlText = typeof input === 'string' ? input : (input && input.html) || '';
      if (/\bdata-lc-src="[^"]+\.json"/.test(htmlText)) {
        utilLines.push('__lcMerge(UTIL, (' + runtimeUtilIsland.toString() + ')(UTIL));');
      }
    }
    if (modules.indexOf('async') !== -1) {
      utilLines.push('__lcMerge(UTIL, (' + runtimeUtilAsync.toString() + ')(UTIL));');
    }

    var code = [
      '/* lc-runtime ' + VERSION + ' · modules: ' + modules.join(',') + ' */',
      '(function () {',
      "'use strict';",
      'var VERSION = ' + JSON.stringify(VERSION) + ';',
      'var CONFIG = ' + configText + ';',
      utilLines.join('\n'),
      functionLines,
      'var MODULES = [' + list + '];',
      'var NAMES = ' + names + ';',
      '(' + runtimeBoot.toString() + ')(VERSION, CONFIG, UTIL, MODULES, NAMES);',
      '}());',
      ''
    ].join('\n');

    var bytes = byteLength(code);
    if (bytes > MAX_BYTES) {
      throw new Error('产物运行时超出体积上限：' + bytes + ' 字节 > ' + MAX_BYTES + ' 字节');
    }
    return {
      version: VERSION,
      modules: modules,
      names: modules.map(function (name) { return MODULE_META[name].label; }),
      bytes: bytes,
      code: code,
      config: config,
      maxBytes: MAX_BYTES
    };
  }

  var util = runtimeUtilBase();
  [runtimeUtilForm, runtimeUtilTable, runtimeUtilAsync].forEach(function (factory) {
    var part = factory(util);
    Object.keys(part).forEach(function (key) { util[key] = part[key]; });
  });

  return {
    runtimeVersion: VERSION,
    runtimeMaxBytes: MAX_BYTES,
    runtimeModuleOrder: ORDER.slice(),
    runtimeModuleMeta: MODULE_META,
    selectRuntimeModules: selectModules,
    buildRuntime: buildRuntime,
    runtimeUtil: util,
    runtimeSources: SOURCES
  };
}));
