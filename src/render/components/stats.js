/* 渲染核心 · 统计组件（KPI 数字卡 / 进度条 / 环形进度）
   数据来源：内联属性，或平台注册的数据源（只读消费，组件内不发请求）。
   颜色只取主题变量；缺数据、负数、超上限都做夹取或空态，不画假数据。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../dom.js'), require('./common.js'), require('../datasource.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    root.LC.Render.Components = root.LC.Render.Components || {};
    factory(root.LC.Render, root.LC.Render.ComponentsCommon);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R, kit, dsSource) {
  'use strict';

  var h = R.h;
  var raw = R.raw;

  /* ---------- 基础数值工具 ---------- */

  function toNum(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'string') {
      var text = value.replace(/,/g, '').trim();
      if (!text) return null;
      var number = Number(text);
      return isFinite(number) ? number : null;
    }
    return null;
  }

  function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function thousands(text) {
    var parts = String(text).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function formatMetric(value, config) {
    var number = toNum(value);
    if (number == null) return '—';
    var cfg = config || {};
    var decimals = clampNumber(Math.round(toNum(cfg.decimals) == null ? 0 : toNum(cfg.decimals)), 0, 6);
    var abs = Math.abs(number);
    var text;
    var compactUnit = '';
    if (cfg.compact) {
      if (abs >= 1e8) { text = (number / 1e8).toFixed(decimals); compactUnit = '亿'; }
      else if (abs >= 1e4) { text = (number / 1e4).toFixed(decimals); compactUnit = '万'; }
      else if (abs >= 1e3) { text = (number / 1e3).toFixed(decimals); compactUnit = 'k'; }
      else text = number.toFixed(decimals);
    } else {
      text = number.toFixed(decimals);
    }
    text = thousands(text);
    return (cfg.prefix || '') + text + compactUnit + (cfg.suffix || '');
  }

  function formatDelta(value) {
    var number = toNum(value);
    if (number == null) return '—';
    var text = Math.abs(Math.round(number * 10) / 10).toString();
    if (text.indexOf('.') !== -1) text = text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    return (number > 0 ? '+' : (number < 0 ? '-' : '')) + text + '%';
  }

  function resolveStatSource(name) {
    var key = String(name == null ? '' : name).trim();
    if (!key) return null;
    var resolver = (dsSource && dsSource.resolveDataSource) || (R && R.resolveDataSource);
    if (typeof resolver !== 'function') return null;
    try { return resolver(key) || null; } catch (error) { return null; }
  }

  function readSource(source) {
    var options = {};
    if (typeof AbortController === 'function') {
      options.controller = new AbortController();
      options.signal = options.controller.signal;
    }
    var promise;
    if (typeof source.load === 'function') promise = source.load(options);
    else if (typeof source.fetchData === 'function') promise = source.fetchData(options);
    else if (typeof source.search === 'function') promise = source.search('', options);
    else throw new Error('数据源缺少 load / fetchData / search 方法');
    return { promise: Promise.resolve(promise), controller: options.controller || null };
  }

  function pickRecord(result) {
    if (result == null) return null;
    if (typeof result === 'number' || typeof result === 'string') return { value: result };
    if (Array.isArray(result)) return result.length ? result[0] : null;
    if (typeof result !== 'object') return null;
    if (Array.isArray(result.items)) return result.items.length ? result.items[0] : null;
    if (Array.isArray(result.records)) return result.records.length ? result.records[0] : null;
    if (Array.isArray(result.data)) return result.data.length ? result.data[0] : null;
    if (Array.isArray(result.series) && result.series.length) {
      var values = Array.isArray(result.series[0].values) ? result.series[0].values : [];
      for (var i = values.length - 1; i >= 0; i -= 1) {
        var number = toNum(values[i]);
        if (number != null) return { value: number };
      }
      return null;
    }
    return result;
  }

  /* ---------- KPI 配置与结构 ---------- */

  function kpiConfig(block) {
    var value = kit.prop(block, 'value', null);
    if (value === '') value = null;
    return {
      title: String(kit.prop(block, 'title', '') || kit.prop(block, 'label', '') || ''),
      subtitle: String(kit.prop(block, 'subtitle', '') || ''),
      value: value,
      unit: String(kit.prop(block, 'unit', '') || ''),
      prefix: String(kit.prop(block, 'prefix', '') || ''),
      suffix: String(kit.prop(block, 'suffix', '') || ''),
      decimals: kit.num(kit.prop(block, 'decimals', 0), 0),
      compact: kit.bool(kit.prop(block, 'compact', false), false),
      format: String(kit.prop(block, 'format', 'number') || 'number'),
      comparison: kit.prop(block, 'comparison', null),
      comparisonLabel: String(kit.prop(block, 'comparisonLabel', '较上期') || '较上期'),
      comparisonUnit: String(kit.prop(block, 'comparisonUnit', '%') || '%'),
      trend: String(kit.prop(block, 'trend', 'auto') || 'auto'),
      positiveIsGood: kit.bool(kit.prop(block, 'positiveIsGood', true), true),
      note: String(kit.prop(block, 'note', '') || ''),
      datasource: String(kit.prop(block, 'datasource', '') || ''),
      valueField: String(kit.prop(block, 'valueField', 'value') || 'value'),
      labelField: String(kit.prop(block, 'labelField', 'label') || 'label'),
      comparisonField: String(kit.prop(block, 'comparisonField', 'comparison') || 'comparison'),
      state: String(kit.prop(block, 'state', '') || ''),
      error: String(kit.prop(block, 'error', '') || ''),
      emptyText: String(kit.prop(block, 'emptyText', '') || ''),
      loadingText: String(kit.prop(block, 'loadingText', '') || ''),
      errorText: String(kit.prop(block, 'errorText', '') || '')
    };
  }

  function deltaDirection(delta) {
    var number = toNum(delta);
    if (number == null || number === 0) return 'flat';
    return number > 0 ? 'up' : 'down';
  }

  function kpiTone(config) {
    var direction = config.trend === 'up' || config.trend === 'down' || config.trend === 'flat'
      ? config.trend : deltaDirection(config.comparison);
    if (direction === 'flat') return { direction: direction, tone: 'flat' };
    return { direction: direction, tone: (direction === 'up') === config.positiveIsGood ? 'good' : 'bad' };
  }

  function deltaNode(config, tone) {
    var delta = toNum(config.comparison);
    if (delta == null) return null;
    var arrowIcon = tone.direction === 'up' ? 'chevron-up' : (tone.direction === 'down' ? 'chevron-down' : null);
    var spoken = config.comparisonLabel + (tone.direction === 'up' ? '上升' : (tone.direction === 'down' ? '下降' : '持平')) +
      ' ' + Math.abs(delta) + (config.comparisonUnit || '');
    var children = [];
    if (arrowIcon) {
      children.push(h('span', { class: 'lc-ui-kpi-arrow', 'aria-hidden': 'true' }, [kit.icon(arrowIcon, 'lc-icon-sm')]));
    }
    children.push(h('span', { class: 'lc-ui-kpi-delta-value', 'aria-hidden': 'true' }, formatDelta(delta)));
    children.push(h('span', { class: 'lc-ui-kpi-delta-label', 'aria-hidden': 'true' }, config.comparisonLabel));
    children.push(h('span', { class: 'lc-ui-sr-only' }, spoken));
    return h('p', { class: 'lc-ui-kpi-delta is-' + tone.tone }, children);
  }

  function kpiBody(config) {
    var tone = kpiTone(config);
    var valueText = formatMetric(config.value, config);
    if (config.format === 'percent' && config.value != null && !config.suffix) valueText += '%';
    var titleId = kit.uid('lc-kpi-title');
    var nodes = [];
    nodes.push(h('div', { class: 'lc-ui-kpi-head' }, [
      config.title ? h('p', { class: 'lc-ui-kpi-label', id: titleId }, config.title) : null
    ]));
    nodes.push(h('p', { class: 'lc-ui-kpi-value' }, [
      h('span', { class: 'lc-ui-kpi-number' }, valueText),
      config.unit ? h('span', { class: 'lc-ui-kpi-unit' }, config.unit) : null
    ]));
    var delta = deltaNode(config, tone);
    if (delta) nodes.push(delta);
    if (config.subtitle) nodes.push(h('p', { class: 'lc-ui-kpi-subtitle' }, config.subtitle));
    if (config.note) nodes.push(h('p', { class: 'lc-ui-kpi-note' }, config.note));
    return h('div', { class: 'lc-ui-kpi-inner' }, nodes);
  }

  /* ---------- 进度条配置与结构 ---------- */

  function progressConfig(block) {
    var rawValue = kit.prop(block, 'value', null);
    if (rawValue === '') rawValue = null;
    var max = kit.num(kit.prop(block, 'max', 100), 100);
    if (!(max > 0)) max = 100;
    return {
      label: String(kit.prop(block, 'title', '') || kit.prop(block, 'label', '') || ''),
      value: rawValue,
      max: max,
      showValue: kit.bool(kit.prop(block, 'showValue', true), true),
      format: String(kit.prop(block, 'format', 'percent') || 'percent'),
      decimals: kit.num(kit.prop(block, 'decimals', 0), 0),
      unit: String(kit.prop(block, 'unit', '') || ''),
      tone: String(kit.prop(block, 'tone', 'accent') || 'accent'),
      size: String(kit.prop(block, 'size', 'md') || 'md'),
      indeterminate: kit.bool(kit.prop(block, 'indeterminate', false), false),
      caption: String(kit.prop(block, 'caption', '') || ''),
      datasource: String(kit.prop(block, 'datasource', '') || ''),
      valueField: String(kit.prop(block, 'valueField', 'value') || 'value'),
      maxField: String(kit.prop(block, 'maxField', 'max') || 'max'),
      state: String(kit.prop(block, 'state', '') || ''),
      error: String(kit.prop(block, 'error', '') || ''),
      emptyText: String(kit.prop(block, 'emptyText', '') || ''),
      loadingText: String(kit.prop(block, 'loadingText', '') || ''),
      errorText: String(kit.prop(block, 'errorText', '') || '')
    };
  }

  function percentOf(value, max) {
    var v = toNum(value);
    var m = toNum(max);
    if (v == null || m == null || m <= 0) return 0;
    return clampNumber((v / m) * 100, 0, 100);
  }

  function progressText(config) {
    var pct = percentOf(config.value, config.max);
    if (config.format === 'number') {
      return formatMetric(config.value, { decimals: config.decimals }) + ' / ' +
        formatMetric(config.max, { decimals: config.decimals }) + (config.unit || '');
    }
    return formatMetric(pct, { decimals: config.decimals }) + '%';
  }

  function progressBody(config) {
    var pct = percentOf(config.value, config.max);
    var labelId = kit.uid('lc-progress-label');
    var hasLabel = !!config.label;
    var trackAttrs = {
      class: 'lc-ui-progress-track',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': String(config.max),
      'aria-valuetext': progressText(config)
    };
    if (hasLabel) trackAttrs['aria-labelledby'] = labelId;
    else trackAttrs['aria-label'] = '进度';
    if (config.indeterminate) {
      trackAttrs['data-indeterminate'] = 'true';
      trackAttrs['aria-busy'] = 'true';
    } else {
      trackAttrs['aria-valuenow'] = String(clampNumber(toNum(config.value) == null ? 0 : toNum(config.value), 0, config.max));
    }
    var children = [];
    var head = [];
    if (hasLabel) head.push(h('span', { class: 'lc-ui-progress-label', id: labelId }, config.label));
    if (config.showValue && !config.indeterminate) {
      head.push(h('span', { class: 'lc-ui-progress-value' }, progressText(config)));
    }
    if (head.length) children.push(h('div', { class: 'lc-ui-progress-head' }, head));
    children.push(h('div', trackAttrs, [
      h('span', {
        class: 'lc-ui-progress-bar',
        style: 'width:' + (config.indeterminate ? '40' : String(Math.round(pct * 100) / 100)) + '%'
      })
    ]));
    if (config.caption) children.push(h('p', { class: 'lc-ui-progress-caption' }, config.caption));
    return h('div', { class: 'lc-ui-progress-inner' }, children);
  }

  /* ---------- 环形进度 ---------- */

  function ringConfig(block) {
    var base = progressConfig(block);
    return {
      label: base.label,
      value: base.value,
      max: base.max,
      showValue: kit.bool(kit.prop(block, 'showValue', true), true),
      format: String(kit.prop(block, 'format', 'percent') || 'percent'),
      decimals: kit.num(kit.prop(block, 'decimals', 0), 0),
      unit: base.unit,
      tone: base.tone,
      caption: base.caption,
      centerLabel: String(kit.prop(block, 'centerLabel', '') || ''),
      size: clampNumber(kit.num(kit.prop(block, 'size', 128), 128), 48, 360),
      thickness: clampNumber(kit.num(kit.prop(block, 'thickness', 12), 12), 2, 40),
      datasource: base.datasource,
      valueField: base.valueField,
      maxField: base.maxField,
      state: base.state,
      error: base.error,
      emptyText: base.emptyText,
      loadingText: base.loadingText,
      errorText: base.errorText
    };
  }

  function ringBody(config) {
    var pct = percentOf(config.value, config.max);
    var radius = 52;
    var circumference = 2 * Math.PI * radius;
    var offset = circumference * (1 - pct / 100);
    var labelId = kit.uid('lc-ring-label');
    var attrs = {
      class: 'lc-ui-ring-track',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': String(config.max),
      'aria-valuenow': String(clampNumber(toNum(config.value) == null ? 0 : toNum(config.value), 0, config.max)),
      'aria-valuetext': progressText(config)
    };
    if (config.label) attrs['aria-labelledby'] = labelId;
    else attrs['aria-label'] = '进度';
    var svg = h('svg', {
      class: 'lc-ui-ring-svg',
      viewBox: '0 0 120 120',
      width: String(config.size),
      height: String(config.size),
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
      focusable: 'false'
    }, [
      h('circle', {
        class: 'lc-ui-ring-bg',
        cx: '60', cy: '60', r: String(radius),
        fill: 'none',
        'stroke-width': String(config.thickness)
      }),
      h('circle', {
        class: 'lc-ui-ring-bar',
        cx: '60', cy: '60', r: String(radius),
        fill: 'none',
        'stroke-width': String(config.thickness),
        'stroke-linecap': 'round',
        'stroke-dasharray': String(Math.round(circumference * 100) / 100),
        'stroke-dashoffset': String(Math.round(offset * 100) / 100),
        transform: 'rotate(-90 60 60)'
      })
    ]);
    var center = [];
    if (config.showValue) {
      center.push(h('span', { class: 'lc-ui-ring-value' }, progressText(config)));
    }
    if (config.centerLabel) center.push(h('span', { class: 'lc-ui-ring-center-label' }, config.centerLabel));
    var children = [];
    if (config.label) children.push(h('p', { class: 'lc-ui-ring-label', id: labelId }, config.label));
    children.push(h('div', attrs, [
      h('div', { class: 'lc-ui-ring-figure' }, [
        svg,
        center.length ? h('span', { class: 'lc-ui-ring-center' }, center) : null
      ])
    ]));
    if (config.caption) children.push(h('p', { class: 'lc-ui-ring-caption' }, config.caption));
    return h('div', { class: 'lc-ui-ring-inner' }, children);
  }

  /* ---------- 状态与远程数据 ---------- */

  function emptyNode(config, text, title) {
    return kit.renderStatus('empty', {
      title: title || '暂无数据',
      text: text || config.emptyText || '还没有可展示的数值。'
    });
  }

  function loadingNode(config, text) {
    return kit.renderStatus('loading', {
      title: '正在加载',
      text: text || config.loadingText || '',
      variant: 'skeleton',
      lines: 2
    });
  }

  function errorNode(config, message) {
    return kit.renderStatus('error', {
      title: '加载失败',
      text: message || config.errorText || '请稍后重试。',
      retryLabel: '重试'
    });
  }

  function bodyOf(kind, config) {
    if (kind === 'ui-kpi') return kpiBody(config);
    if (kind === 'ui-progress-ring') return ringBody(config);
    return progressBody(config);
  }

  function rootTone(kind, config) {
    if (kind === 'ui-kpi') return kpiTone(config).tone;
    return config.tone || 'accent';
  }

  function rootTrend(kind, config) {
    if (kind === 'ui-kpi') return kpiTone(config).direction;
    return '';
  }

  function statRender(kind) {
    return function (block) {
      var config = kind === 'ui-kpi' ? kpiConfig(block)
        : (kind === 'ui-progress-ring' ? ringConfig(block) : progressConfig(block));
      var explicit = config.state;
      var source = config.datasource ? resolveStatSource(config.datasource) : null;
      var state;
      var body;

      if (explicit === 'error') {
        state = 'error';
        body = errorNode(config, config.error);
      } else if (explicit === 'loading') {
        state = 'loading';
        body = loadingNode(config);
      } else if (explicit === 'empty') {
        state = 'empty';
        body = emptyNode(config);
      } else if (config.datasource && !source) {
        state = 'empty';
        body = emptyNode(config, '数据源「' + config.datasource + '」未注册，暂不展示数值。', '数据源不可用');
      } else if (config.datasource) {
        state = 'loading';
        body = loadingNode(config, '正在从数据源「' + config.datasource + '」加载…');
      } else if (toNum(config.value) == null && !(kind === 'ui-progress' && config.indeterminate)) {
        state = 'empty';
        body = emptyNode(config);
      } else {
        state = 'ready';
        body = bodyOf(kind, config);
      }

      var attrs = {
        class: 'lc-ui lc-ui-stat ' + kind + ' is-tone-' + rootTone(kind, config),
        'data-lc-ui': kind,
        'data-lc-state': state,
        'data-datasource': config.datasource,
        'data-source-bound': source ? 'true' : 'false'
      };
      if (kind === 'ui-kpi') attrs['data-trend'] = rootTrend(kind, config);
      if (kind === 'ui-progress') attrs['data-size'] = config.size;
      return h('div', attrs, [
        h('div', { class: 'lc-ui-stat-body', 'data-lc-stat-body': 'true' }, [body]),
        raw(kit.jsonIsland({
          kind: kind,
          config: config
        }))
      ]);
    };
  }

  function applyRecord(kind, config, record) {
    if (!record || typeof record !== 'object') return config;
    var value = toNum(record[config.valueField]);
    if (value == null && record.value != null) value = toNum(record.value);
    if (value != null) config.value = value;
    if (kind === 'ui-kpi') {
      var comparison = record[config.comparisonField];
      if (comparison == null) comparison = record.delta;
      if (comparison == null) comparison = record.comparison;
      if (toNum(comparison) != null) config.comparison = toNum(comparison);
      if (!config.title) {
        var label = record[config.labelField];
        if (label == null) label = record.title;
        if (label != null) config.title = String(label);
      }
      if (!config.subtitle && record.subtitle != null) config.subtitle = String(record.subtitle);
    } else {
      var max = toNum(record[config.maxField]);
      if (max != null && max > 0) config.max = max;
    }
    return config;
  }

  function makeEnhance(kind) {
    return function (el) {
      var island = kit.readJsonScript(el);
      var config = (island && island.config) || {};
      var datasource = (island && island.datasource) || config.datasource || '';
      if (!island || !datasource) return null;
      var source = resolveStatSource(datasource);
      if (!source) return null;
      var body = el.querySelector('[data-lc-stat-body]');
      if (!body) return null;

      var alive = true;
      var requestId = 0;
      var current = null;

      function paint(state, node) {
        el.setAttribute('data-lc-state', state);
        if (kind === 'ui-kpi') el.setAttribute('data-trend', rootTrend(kind, config));
        body.innerHTML = '';
        var doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (!doc || typeof R.toDom !== 'function') return;
        var domNode = R.toDom(node, doc);
        if (domNode) body.appendChild(domNode);
      }

      function load() {
        requestId += 1;
        var mine = requestId;
        if (current && current.controller) {
          try { current.controller.abort(); } catch (error) { /* 忽略 */ }
        }
        paint('loading', loadingNode(config, '正在从数据源「' + datasource + '」加载…'));
        var started;
        try {
          started = readSource(source);
        } catch (error) {
          paint('error', errorNode(config, error.message));
          kit.emit(el, 'lc:stat-error', { kind: kind, datasource: datasource, message: error.message });
          return;
        }
        current = started;
        started.promise.then(function (result) {
          if (!alive || mine !== requestId) return;
          var record = pickRecord(result);
          if (!record) {
            paint('empty', emptyNode(config, '数据源返回空结果。'));
            kit.emit(el, 'lc:stat-load', { kind: kind, datasource: datasource, empty: true });
            return;
          }
          applyRecord(kind, config, record);
          paint('ready', bodyOf(kind, config));
          kit.emit(el, 'lc:stat-load', { kind: kind, datasource: datasource });
        }).catch(function (error) {
          if (!alive || mine !== requestId) return;
          if (error && error.name === 'AbortError') return;
          var message = String((error && error.message) || error || '未知错误');
          paint('error', errorNode(config, message));
          kit.emit(el, 'lc:stat-error', { kind: kind, datasource: datasource, message: message });
        });
      }

      function onClick(event) {
        var target = event.target;
        if (!target || !target.closest) return;
        if (!target.closest('[data-lc-retry]')) return;
        load();
      }

      el.addEventListener('click', onClick);
      load();

      var handle = {
        reload: load,
        datasource: datasource,
        destroy: function () {
          alive = false;
          if (current && current.controller) {
            try { current.controller.abort(); } catch (error) { /* 忽略 */ }
          }
          el.removeEventListener('click', onClick);
        }
      };
      el.__lcStat = handle;
      return handle;
    };
  }

  /* ---------- 样式 ---------- */

  var STAT_CSS = [
    '/* lc-ui-stats */',
    '.lc-ui-stat { --lc-stat-color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
    '.lc-ui-stat.is-tone-success { --lc-stat-color: var(--lc-color-success, var(--success, #3f7d4f)); }',
    '.lc-ui-stat.is-tone-warn { --lc-stat-color: var(--lc-color-warn, var(--warn, #b07a1e)); }',
    '.lc-ui-stat.is-tone-danger { --lc-stat-color: var(--lc-color-danger, var(--danger, #a4453b)); }',
    '.lc-ui-kpi { padding: var(--lc-space-4) 18px; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, transparent)); }',
    '.lc-ui-kpi-label { margin: 0; font-size: var(--lc-text-sm, 13px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-kpi-value { display: flex; align-items: baseline; gap: var(--lc-space-1); margin: var(--lc-space-2) 0 0; }',
    '.lc-ui-kpi-number { font-family: var(--lc-font-serif, Georgia, serif); font-size: var(--lc-text-2xl, 30px); line-height: 1.15; font-variant-numeric: tabular-nums; color: var(--lc-color-ink, var(--ink, inherit)); }',
    '.lc-ui-kpi-unit { font-size: var(--lc-text-sm, 13px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-kpi-delta { display: inline-flex; align-items: center; gap: var(--lc-space-1); margin: var(--lc-space-2) 0 0; font-size: var(--lc-text-sm, 13px); font-variant-numeric: tabular-nums; }',
    '.lc-ui-kpi-delta.is-good { color: var(--lc-color-success, var(--success, #3f7d4f)); }',
    '.lc-ui-kpi-delta.is-bad { color: var(--lc-color-danger, var(--danger, #a4453b)); }',
    '.lc-ui-kpi-delta.is-flat { color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-kpi-arrow { display: inline-flex; }',
    '.lc-ui-kpi-delta-label { color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-kpi-subtitle { margin: var(--lc-space-2) 0 0; font-size: var(--lc-text-sm, 13px); color: var(--lc-color-ink-2, var(--ink-2, inherit)); }',
    '.lc-ui-kpi-note { margin: var(--lc-space-1) 0 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted-2, var(--muted-2, #888)); }',
    '.lc-ui-progress-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--lc-space-2); margin-bottom: var(--lc-space-1-5); font-size: var(--lc-text-sm, 13px); }',
    '.lc-ui-progress-label { color: var(--lc-color-ink-2, var(--ink-2, inherit)); }',
    '.lc-ui-progress-value { color: var(--lc-color-muted, var(--muted, #666)); font-variant-numeric: tabular-nums; }',
    '.lc-ui-progress-track { position: relative; overflow: hidden; height: 8px; border-radius: var(--lc-radius-full); background: var(--lc-color-surface-3, var(--surface-3, #e7e3d8)); }',
    '.lc-ui-stat.ui-progress[data-size="sm"] .lc-ui-progress-track { height: 5px; }',
    '.lc-ui-stat.ui-progress[data-size="lg"] .lc-ui-progress-track { height: 12px; }',
    '.lc-ui-progress-bar { display: block; height: 100%; border-radius: inherit; background: var(--lc-stat-color); transition: width 0.3s ease; }',
    '.lc-ui-progress-track[data-indeterminate="true"] .lc-ui-progress-bar { animation: lc-ui-progress-slide 1.3s ease-in-out infinite; }',
    '@keyframes lc-ui-progress-slide { 0% { transform: translateX(-110%); } 100% { transform: translateX(310%); } }',
    '.lc-ui-progress-caption { margin: var(--lc-space-1-5) 0 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted-2, var(--muted-2, #888)); }',
    '.lc-ui-ring-inner { display: inline-flex; flex-direction: column; align-items: center; gap: var(--lc-space-1-5); }',
    '.lc-ui-ring-label { margin: 0; font-size: var(--lc-text-sm, 13px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-ring-figure { position: relative; display: inline-flex; align-items: center; justify-content: center; }',
    '.lc-ui-ring-svg { display: block; max-width: 100%; height: auto; }',
    '.lc-ui-ring-bg { stroke: var(--lc-color-surface-3, var(--surface-3, #e7e3d8)); }',
    '.lc-ui-ring-bar { stroke: var(--stat-color, var(--lc-stat-color)); transition: stroke-dashoffset 0.4s ease; }',
    '.lc-ui-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; pointer-events: none; }',
    '.lc-ui-ring-value { font-size: var(--lc-text-lg, 20px); font-weight: var(--lc-weight-semibold, 600); font-variant-numeric: tabular-nums; color: var(--lc-color-ink, var(--ink, inherit)); }',
    '.lc-ui-ring-center-label { font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-ring-caption { margin: var(--lc-space-1-5) 0 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted-2, var(--muted-2, #888)); }',
    '@media (prefers-reduced-motion: reduce) { .lc-ui-progress-bar { transition: none; } .lc-ui-progress-track[data-indeterminate="true"] .lc-ui-progress-bar { animation-duration: 3s; } .lc-ui-ring-bar { transition: none; } }'
  ].join('\n');

  /* ---------- 组件定义 ---------- */

  function schemaOf(type, name, props) {
    var merged = {
      title: { type: 'string', label: '标题', default: '' },
      value: { type: 'number', label: '数值', default: null },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' },
      error: { type: 'string', label: '错误信息', default: '' },
      datasource: { type: 'string', label: '数据源名称', default: '' },
      valueField: { type: 'string', label: '数值字段', default: 'value' },
      emptyText: { type: 'string', label: '空态说明', default: '' },
      loadingText: { type: 'string', label: '加载态说明', default: '' },
      errorText: { type: 'string', label: '错误说明', default: '' }
    };
    Object.keys(props || {}).forEach(function (key) { merged[key] = props[key]; });
    return {
      type: type,
      name: name,
      version: 1,
      states: ['ready', 'loading', 'empty', 'error'],
      events: ['lc:stat-load', 'lc:stat-error'],
      props: merged
    };
  }

  function makeDef(type, name, extraProps, render, kind) {
    return {
      type: type,
      name: name,
      version: 1,
      schema: schemaOf(type, name, extraProps),
      sharedCssId: 'lc-ui-stats',
      sharedCss: STAT_CSS,
      render: render,
      enhance: makeEnhance(kind || type),
      helpers: {
        toNum: toNum,
        formatMetric: formatMetric,
        formatDelta: formatDelta,
        percentOf: percentOf,
        kpiTone: kpiTone
      }
    };
  }

  var defs = {};

  defs['ui-kpi'] = makeDef('ui-kpi', 'KPI 数字卡', {
    label: { type: 'string', label: '指标名（title 别名）', default: '' },
    subtitle: { type: 'string', label: '副标题', default: '' },
    unit: { type: 'string', label: '单位', default: '' },
    prefix: { type: 'string', label: '数值前缀', default: '' },
    suffix: { type: 'string', label: '数值后缀', default: '' },
    decimals: { type: 'number', label: '小数位', default: 0 },
    compact: { type: 'boolean', label: '大数压缩（万/亿）', default: false },
    format: { type: 'enum', label: '数值格式', options: ['number', 'percent'], default: 'number' },
    comparison: { type: 'number', label: '同比/环比（百分比）', default: null },
    comparisonLabel: { type: 'string', label: '对比口径', default: '较上期' },
    comparisonUnit: { type: 'string', label: '对比单位', default: '%' },
    trend: { type: 'enum', label: '趋势方向', options: ['auto', 'up', 'down', 'flat'], default: 'auto' },
    positiveIsGood: { type: 'boolean', label: '上升为正向', default: true },
    labelField: { type: 'string', label: '数据源标题字段', default: 'label' },
    comparisonField: { type: 'string', label: '数据源对比字段', default: 'comparison' },
    note: { type: 'string', label: '底部备注', default: '' }
  }, statRender('ui-kpi'), 'ui-kpi');

  defs['ui-progress'] = makeDef('ui-progress', '进度条', {
    label: { type: 'string', label: '进度名称（title 别名）', default: '' },
    max: { type: 'number', label: '最大值', default: 100 },
    showValue: { type: 'boolean', label: '显示数值', default: true },
    format: { type: 'enum', label: '数值格式', options: ['percent', 'number'], default: 'percent' },
    decimals: { type: 'number', label: '小数位', default: 0 },
    unit: { type: 'string', label: '单位', default: '' },
    tone: { type: 'enum', label: '色调', options: ['accent', 'success', 'warn', 'danger'], default: 'accent' },
    size: { type: 'enum', label: '高度', options: ['sm', 'md', 'lg'], default: 'md' },
    indeterminate: { type: 'boolean', label: '不确定进度', default: false },
    caption: { type: 'string', label: '说明', default: '' },
    maxField: { type: 'string', label: '数据源最大值字段', default: 'max' }
  }, statRender('ui-progress'), 'ui-progress');

  defs['ui-progress-ring'] = makeDef('ui-progress-ring', '环形进度', {
    label: { type: 'string', label: '进度名称（title 别名）', default: '' },
    max: { type: 'number', label: '最大值', default: 100 },
    showValue: { type: 'boolean', label: '显示中心数值', default: true },
    format: { type: 'enum', label: '数值格式', options: ['percent', 'number'], default: 'percent' },
    decimals: { type: 'number', label: '小数位', default: 0 },
    unit: { type: 'string', label: '单位', default: '' },
    tone: { type: 'enum', label: '色调', options: ['accent', 'success', 'warn', 'danger'], default: 'accent' },
    size: { type: 'number', label: '直径（px）', default: 128 },
    thickness: { type: 'number', label: '环宽', default: 12 },
    centerLabel: { type: 'string', label: '中心说明', default: '' },
    caption: { type: 'string', label: '说明', default: '' },
    maxField: { type: 'string', label: '数据源最大值字段', default: 'max' }
  }, statRender('ui-progress-ring'), 'ui-progress-ring');

  if (typeof module === 'object' && module.exports) {
    module.exports = defs;
  } else {
    var components = R.Components;
    Object.keys(defs).forEach(function (type) { components[type] = defs[type]; });
  }

  return defs;
}));
