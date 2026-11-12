/* 渲染核心 · 图表组件（折线 / 柱状 / 饼图 / 环形 / 迷你走势）
   全部手写 SVG，不依赖任何图表库；颜色只取主题变量，不写死色值。
   数据来源：内联 props.data / props.series，或平台注册的数据源（只读，不发请求）。 */
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

  /* 只读解析平台注册的数据源；解析不到返回 null，由调用方降级为空态。 */
  function resolveChartSource(name) {
    var key = String(name == null ? '' : name).trim();
    if (!key) return null;
    var resolver = (dsSource && dsSource.resolveDataSource) || (R && R.resolveDataSource);
    if (typeof resolver !== 'function') return null;
    try { return resolver(key) || null; } catch (error) { return null; }
  }

  /* ---------- 基础数值工具 ---------- */

  function safeNum(value) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(n) ? n : null;
  }

  function r2(value) {
    return Math.round(value * 100) / 100;
  }

  function thousands(value) {
    var text = String(value);
    var parts = text.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function formatFull(value) {
    var n = safeNum(value);
    if (n == null) return '—';
    return thousands(Math.round(n * 100) / 100);
  }

  /* 坐标轴数字：极大值必须压缩，否则刻度文字会溢出画布。 */
  function formatAxisNumber(value) {
    var n = safeNum(value);
    if (n == null) return '';
    var abs = Math.abs(n);
    if (abs >= 1e8) return r2(n / 1e8) + '亿';
    if (abs >= 1e4) return r2(n / 1e4) + '万';
    if (abs >= 1e3) return r2(n / 1e3) + 'k';
    return String(r2(n));
  }

  /* ---------- 数据归一化 ---------- */

  function toNumberList(values) {
    return kit.toArray(values).map(function (value) { return safeNum(value); });
  }

  /* 支持两种输入：
     1) data: [{ label, value }, ...]
     2) labels: [...] + series: [{ name, values: [...] }, ...]
     统一成 { labels, series: [{ name, values }] }，长度对齐、缺值补 null。 */
  function normalizeDataset(block) {
    var labels = kit.toArray(kit.prop(block, 'labels', [])).map(function (label) { return String(label); });
    var series = [];

    kit.toArray(kit.prop(block, 'series', [])).forEach(function (item, index) {
      if (!item) return;
      var values = null;
      if (Array.isArray(item)) values = toNumberList(item);
      else if (Array.isArray(item.values)) values = toNumberList(item.values);
      else if (Array.isArray(item.data)) values = toNumberList(item.data.map(function (point) {
        return point && typeof point === 'object' ? point.value : point;
      }));
      if (!values) return;
      series.push({ name: String((item && item.name) || ('系列 ' + (index + 1))), values: values });
    });

    var data = kit.toArray(kit.prop(block, 'data', []));
    if (!series.length && data.length) {
      var dataLabels = [];
      var dataValues = [];
      data.forEach(function (item, index) {
        if (item && typeof item === 'object') {
          dataLabels.push(String(item.label != null ? item.label : (item.name != null ? item.name : (index + 1))));
          dataValues.push(safeNum(item.value != null ? item.value : item.y));
        } else {
          dataLabels.push(String(index + 1));
          dataValues.push(safeNum(item));
        }
      });
      if (!labels.length) labels = dataLabels;
      var seriesName = kit.prop(block, 'seriesName', null);
      series.push({ name: seriesName == null ? '数值' : String(seriesName), values: dataValues });
    }

    if (!labels.length && series.length) {
      var longest = 0;
      series.forEach(function (item) { longest = Math.max(longest, item.values.length); });
      for (var i = 0; i < longest; i += 1) labels.push(String(i + 1));
    }

    series.forEach(function (item) {
      if (item.values.length > labels.length) item.values = item.values.slice(0, labels.length);
      while (item.values.length < labels.length) item.values.push(null);
    });

    return { labels: labels, series: series };
  }

  function hasData(model) {
    if (!model || !model.series) return false;
    return model.series.some(function (item) {
      return item.values.some(function (value) { return value != null; });
    });
  }

  function countPoints(model) {
    var count = 0;
    (model.series || []).forEach(function (item) {
      item.values.forEach(function (value) { if (value != null) count += 1; });
    });
    return count;
  }

  /* 数据源返回数组时，按字段名映射成 data 模型。 */
  function datasetFromRecords(records, config) {
    var labelField = String((config && config.labelField) || 'label');
    var valueField = String((config && config.valueField) || 'value');
    var labels = [];
    var values = [];
    kit.toArray(records).forEach(function (item) {
      if (item == null) return;
      if (typeof item !== 'object') {
        labels.push(String(labels.length + 1));
        values.push(safeNum(item));
        return;
      }
      var label = item[labelField];
      if (label == null) label = item.name != null ? item.name : (item.date != null ? item.date : item.month);
      if (label == null) label = String(labels.length + 1);
      var value = item[valueField];
      if (value == null) value = item.count != null ? item.count : item.total;
      labels.push(String(label));
      values.push(safeNum(value));
    });
    return {
      labels: labels,
      series: [{ name: String((config && config.seriesName) || '数值'), values: values }]
    };
  }

  function normalizeResult(result, config) {
    if (result == null) return { labels: [], series: [] };
    if (Array.isArray(result)) return datasetFromRecords(result, config);
    if (typeof result !== 'object') return { labels: [], series: [] };
    if (Array.isArray(result.series) || Array.isArray(result.data)) {
      return normalizeDataset({ props: {
        labels: result.labels,
        series: result.series,
        data: result.data,
        seriesName: (config && config.seriesName) || result.seriesName
      } });
    }
    if (Array.isArray(result.items)) return datasetFromRecords(result.items, config);
    if (Array.isArray(result.records)) return datasetFromRecords(result.records, config);
    return { labels: [], series: [] };
  }

  /* ---------- 坐标与比例 ---------- */

  function niceStep(span, count) {
    var target = Math.max(1e-9, span / Math.max(1, count));
    var power = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
    var norm = target / power;
    var step;
    if (norm <= 1) step = 1;
    else if (norm <= 2) step = 2;
    else if (norm <= 5) step = 5;
    else step = 10;
    return step * power;
  }

  function niceTicks(min, max, count) {
    var lo = safeNum(min);
    var hi = safeNum(max);
    if (lo == null) lo = 0;
    if (hi == null) hi = 0;
    if (lo > hi) { var swap = lo; lo = hi; hi = swap; }
    if (lo === hi) {
      if (lo === 0) { lo = 0; hi = 1; }
      else if (lo > 0) { lo = 0; }
      else { hi = 0; }
    }
    var step = niceStep(hi - lo, count || 4);
    if (!isFinite(step) || step <= 0) step = 1;
    var start = Math.floor(lo / step) * step;
    var end = Math.ceil(hi / step) * step;
    if (end - start < step) end = start + step;
    var ticks = [];
    for (var value = start; value <= end + step / 2 && ticks.length < 24; value += step) {
      ticks.push(r2(value));
    }
    if (!ticks.length) ticks.push(start);
    return { min: start, max: end, step: step, ticks: ticks };
  }

  /* 值域：包含 0（有正有负时），全正从 0 起，全负到 0 止。 */
  function valueDomain(model) {
    var min = null;
    var max = null;
    var count = 0;
    (model.series || []).forEach(function (item) {
      item.values.forEach(function (value) {
        if (value == null) return;
        count += 1;
        if (min == null || value < min) min = value;
        if (max == null || value > max) max = value;
      });
    });
    if (!count) return null;
    if (min > 0) min = 0;
    if (max < 0) max = 0;
    if (min === max) {
      if (min === 0) max = 1;
      else if (min > 0) min = 0;
      else max = 0;
    }
    return { min: min, max: max, count: count };
  }

  var VIEW_W = 640;

  function geometry(model, config) {
    var height = kit.clamp(kit.num(config.height, 240), 120, 720);
    var left = 54;
    var right = 20;
    var top = 18;
    var bottom = 34;
    var domain = valueDomain(model) || { min: 0, max: 1 };
    var ticks = niceTicks(domain.min, domain.max, 4);
    return {
      width: VIEW_W,
      height: height,
      left: left,
      right: right,
      top: top,
      bottom: bottom,
      innerW: Math.max(10, VIEW_W - left - right),
      innerH: Math.max(10, height - top - bottom),
      ticks: ticks
    };
  }

  function yOf(value, g) {
    var span = g.ticks.max - g.ticks.min || 1;
    return g.top + ((g.ticks.max - value) / span) * g.innerH;
  }

  function xOf(index, count, g) {
    if (count <= 1) return g.left + g.innerW / 2;
    return g.left + (g.innerW * index) / (count - 1);
  }

  function colorOf(index) {
    return 'var(--lc-chart-' + ((index % 8) + 1) + ')';
  }

  function pointList(values, g) {
    return values.map(function (value, index) {
      if (value == null) return null;
      return { x: xOf(index, values.length, g), y: yOf(value, g) };
    });
  }

  function segments(points) {
    var out = [];
    var current = [];
    points.forEach(function (point) {
      if (!point) {
        if (current.length) out.push(current);
        current = [];
        return;
      }
      current.push(point);
    });
    if (current.length) out.push(current);
    return out;
  }

  /* 贝塞尔平滑：控制点纵向夹在相邻两点之间，避免曲线冲出数据范围。 */
  function smoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return 'M' + r2(points[0].x) + ' ' + r2(points[0].y);
    var d = 'M' + r2(points[0].x) + ' ' + r2(points[0].y);
    for (var i = 0; i < points.length - 1; i += 1) {
      var p0 = points[i - 1] || points[i];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6;
      var c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6;
      var c2y = p2.y - (p3.y - p1.y) / 6;
      var low = Math.min(p1.y, p2.y);
      var high = Math.max(p1.y, p2.y);
      c1y = Math.min(high, Math.max(low, c1y));
      c2y = Math.min(high, Math.max(low, c2y));
      d += ' C' + r2(c1x) + ' ' + r2(c1y) + ' ' + r2(c2x) + ' ' + r2(c2y) +
        ' ' + r2(p2.x) + ' ' + r2(p2.y);
    }
    return d;
  }

  function linearPath(points) {
    if (!points.length) return '';
    return points.map(function (point, index) {
      return (index === 0 ? 'M' : 'L') + r2(point.x) + ' ' + r2(point.y);
    }).join(' ');
  }

  function areaPath(points, baseline) {
    if (points.length < 2) return '';
    return smoothPath(points) +
      ' L' + r2(points[points.length - 1].x) + ' ' + r2(baseline) +
      ' L' + r2(points[0].x) + ' ' + r2(baseline) + ' Z';
  }

  function barRects(model, g) {
    var count = Math.max(1, model.labels.length);
    var seriesCount = Math.max(1, model.series.length);
    var slot = g.innerW / count;
    var groupWidth = slot * 0.68;
    var barWidth = Math.max(2, groupWidth / seriesCount - 2);
    var zeroY = yOf(0, g);
    var rects = [];
    model.series.forEach(function (item, seriesIndex) {
      item.values.forEach(function (value, index) {
        if (value == null) return;
        var x = g.left + slot * index + (slot - groupWidth) / 2 + (barWidth + 2) * seriesIndex;
        var valueY = yOf(value, g);
        var y = value >= 0 ? valueY : zeroY;
        var height = Math.abs(valueY - zeroY);
        if (height < 1) height = 1;
        rects.push({
          x: x,
          y: y,
          width: barWidth,
          height: height,
          series: seriesIndex,
          index: index,
          value: value
        });
      });
    });
    return rects;
  }

  function polar(cx, cy, radius, angle) {
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  }

  function pieSlices(model) {
    var values = model.series.length ? model.series[0].values : [];
    var total = 0;
    var items = [];
    values.forEach(function (value, index) {
      if (value == null || value <= 0) return;
      total += value;
      items.push({ label: model.labels[index] || String(index + 1), value: value, index: index });
    });
    if (!total) return { total: 0, items: [], slices: [] };
    var angle = -Math.PI / 2;
    var slices = items.map(function (item, index) {
      var sweep = (item.value / total) * Math.PI * 2;
      var slice = { start: angle, end: angle + sweep, item: item, index: index, percent: item.value / total };
      angle += sweep;
      return slice;
    });
    return { total: total, items: items, slices: slices };
  }

  function arcPath(cx, cy, radius, start, end) {
    var s = polar(cx, cy, radius, start);
    var e = polar(cx, cy, radius, end);
    var large = end - start > Math.PI ? 1 : 0;
    return 'M' + r2(cx) + ' ' + r2(cy) +
      ' L' + r2(s.x) + ' ' + r2(s.y) +
      ' A' + r2(radius) + ' ' + r2(radius) + ' 0 ' + large + ' 1 ' + r2(e.x) + ' ' + r2(e.y) + ' Z';
  }

  function donutArc(cx, cy, outer, inner, start, end) {
    var large = end - start > Math.PI ? 1 : 0;
    var os = polar(cx, cy, outer, start);
    var oe = polar(cx, cy, outer, end);
    var is = polar(cx, cy, inner, start);
    var ie = polar(cx, cy, inner, end);
    return 'M' + r2(os.x) + ' ' + r2(os.y) +
      ' A' + r2(outer) + ' ' + r2(outer) + ' 0 ' + large + ' 1 ' + r2(oe.x) + ' ' + r2(oe.y) +
      ' L' + r2(ie.x) + ' ' + r2(ie.y) +
      ' A' + r2(inner) + ' ' + r2(inner) + ' 0 ' + large + ' 0 ' + r2(is.x) + ' ' + r2(is.y) + ' Z';
  }

  /* ---------- 无障碍摘要 ---------- */

  function summaryText(kind, model) {
    var label = { line: '折线图', bar: '柱状图', pie: '饼图', donut: '环形图', sparkline: '迷你走势图' }[kind] || '图表';
    if (kind === 'pie' || kind === 'donut') {
      var data = pieSlices(model);
      if (!data.items.length) return label + '：暂无正数数据。';
      var top = data.items.slice().sort(function (a, b) { return b.value - a.value; })[0];
      return label + '：共 ' + data.items.length + ' 项，合计 ' + formatFull(data.total) +
        '；最大项 ' + top.label + '（' + formatFull(top.value) + '，占 ' +
        (Math.round((top.value / data.total) * 1000) / 10) + '%）。';
    }
    var domain = valueDomain(model);
    if (!domain) return label + '：暂无可用数据。';
    var parts = [];
    model.series.forEach(function (item) {
      var finite = item.values.filter(function (value) { return value != null; });
      if (!finite.length) return;
      var max = Math.max.apply(null, finite);
      var min = Math.min.apply(null, finite);
      parts.push((model.series.length > 1 ? item.name + '：' : '') +
        '最高 ' + formatFull(max) + '，最低 ' + formatFull(min) + '，最新 ' + formatFull(finite[finite.length - 1]));
    });
    return label + '：共 ' + domain.count + ' 个数据点；' + parts.join('；') + '。';
  }

  /* ---------- SVG 绘制 ---------- */

  function axisNodes(g, model, config) {
    var nodes = [];
    var grid = [];
    g.ticks.ticks.forEach(function (tick) {
      var y = yOf(tick, g);
      grid.push(h('line', { x1: g.left, y1: r2(y), x2: g.left + g.innerW, y2: r2(y) }));
      nodes.push(h('text', {
        x: g.left - 8,
        y: r2(y),
        'text-anchor': 'end',
        'dominant-baseline': 'middle'
      }, formatAxisNumber(tick)));
    });
    var groups = [h('g', { class: 'lc-ui-chart-grid', 'aria-hidden': 'true' }, grid)];
    if (g.ticks.min < 0 && g.ticks.max > 0) {
      groups.push(h('line', {
        class: 'lc-ui-chart-zero',
        x1: g.left,
        y1: r2(yOf(0, g)),
        x2: g.left + g.innerW,
        y2: r2(yOf(0, g)),
        'aria-hidden': 'true'
      }));
    }
    groups.push(h('g', { class: 'lc-ui-chart-axis', 'aria-hidden': 'true' }, nodes));

    var labels = [];
    var step = Math.max(1, Math.ceil(model.labels.length / 8));
    model.labels.forEach(function (label, index) {
      if (index % step !== 0 && index !== model.labels.length - 1) return;
      labels.push(h('text', {
        x: r2(xOf(index, model.labels.length, g)),
        y: g.height - 10,
        'text-anchor': 'middle'
      }, String(label)));
    });
    groups.push(h('g', { class: 'lc-ui-chart-axis lc-ui-chart-xaxis', 'aria-hidden': 'true' }, labels));
    return groups;
  }

  function svgNode(height, children, extraAttrs) {
    var attrs = {
      class: 'lc-ui-chart-svg',
      viewBox: '0 0 ' + VIEW_W + ' ' + height,
      xmlns: 'http://www.w3.org/2000/svg',
      role: 'presentation',
      focusable: 'false',
      'aria-hidden': 'true',
      preserveAspectRatio: 'xMidYMid meet'
    };
    Object.keys(extraAttrs || {}).forEach(function (key) { attrs[key] = extraAttrs[key]; });
    return h('svg', attrs, children);
  }

  function lineSvg(model, config) {
    var g = geometry(model, config);
    var children = axisNodes(g, model, config);
    var smooth = kit.bool(config.smooth, true);
    var baseline = g.ticks.min < 0 && g.ticks.max > 0 ? yOf(0, g) : yOf(g.ticks.min, g);

    model.series.forEach(function (item, seriesIndex) {
      segments(pointList(item.values, g)).forEach(function (points) {
        if (config.area) {
          var area = areaPath(points, baseline);
          if (area) {
            children.push(h('path', {
              d: area, fill: colorOf(seriesIndex), 'fill-opacity': '0.12', stroke: 'none'
            }));
          }
        }
        children.push(h('path', {
          d: smooth ? smoothPath(points) : linearPath(points),
          fill: 'none',
          stroke: colorOf(seriesIndex),
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        }));
        if (config.showDots || points.length === 1) {
          points.forEach(function (point) {
            children.push(h('circle', {
              cx: r2(point.x), cy: r2(point.y), r: '3', fill: colorOf(seriesIndex),
              stroke: 'var(--lc-color-surface, var(--surface, transparent))', 'stroke-width': '1.5'
            }));
          });
        }
      });
    });
    return svgNode(g.height, children);
  }

  function barSvg(model, config) {
    var g = geometry(model, config);
    var children = axisNodes(g, model, config);
    barRects(model, g).forEach(function (rect) {
      children.push(h('rect', {
        x: r2(rect.x), y: r2(rect.y), width: r2(rect.width), height: r2(rect.height),
        rx: '2', fill: colorOf(rect.series)
      }));
    });
    return svgNode(g.height, children);
  }

  function pieSvg(kind, model, config) {
    var size = 240;
    var cx = size / 2;
    var cy = size / 2;
    var outer = 100;
    var inner = kind === 'donut' ? Math.max(20, kit.clamp(kit.num(config.thickness, 34), 8, 90)) : 0;
    var data = pieSlices(model);
    var children = [];
    if (data.slices.length === 1) {
      if (kind === 'donut') {
        var mid = (outer + inner) / 2;
        children.push(h('circle', {
          cx: cx, cy: cy, r: r2(mid), fill: 'none', stroke: colorOf(0), 'stroke-width': r2(outer - inner)
        }));
      } else {
        children.push(h('circle', { cx: cx, cy: cy, r: outer, fill: colorOf(0) }));
      }
    } else {
      data.slices.forEach(function (slice) {
        children.push(h('path', {
          d: kind === 'donut'
            ? donutArc(cx, cy, outer, inner, slice.start, slice.end)
            : arcPath(cx, cy, outer, slice.start, slice.end),
          fill: colorOf(slice.index),
          stroke: 'var(--lc-color-surface, var(--surface, transparent))',
          'stroke-width': '1'
        }));
      });
    }
    if (kind === 'donut') {
      var center = config.centerValue == null ? '' : String(config.centerValue);
      if (center !== '') {
        children.push(h('text', {
          x: cx, y: cy - 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          class: 'lc-ui-chart-center-value'
        }, center));
      }
      if (config.centerLabel) {
        children.push(h('text', {
          x: cx, y: cy + 20, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          class: 'lc-ui-chart-center-label'
        }, String(config.centerLabel)));
      }
    }
    return h('svg', {
      class: 'lc-ui-chart-svg lc-ui-chart-pie-svg',
      viewBox: '0 0 ' + size + ' ' + size,
      xmlns: 'http://www.w3.org/2000/svg',
      role: 'presentation',
      focusable: 'false',
      'aria-hidden': 'true',
      preserveAspectRatio: 'xMidYMid meet'
    }, children);
  }

  function sparklineSvg(model, config) {
    var width = kit.clamp(kit.num(config.width, 120), 24, 480);
    var height = kit.clamp(kit.num(config.height, 32), 16, 160);
    var pad = 2;
    var values = model.series.length ? model.series[0].values : [];
    var finite = values.filter(function (value) { return value != null; });
    var children = [];
    var color = 'var(--lc-spark-color)';
    if (!finite.length) {
      return h('svg', {
        class: 'lc-ui-chart-svg lc-ui-sparkline-svg',
        viewBox: '0 0 ' + width + ' ' + height,
        width: String(width),
        height: String(height),
        xmlns: 'http://www.w3.org/2000/svg',
        role: 'presentation',
        'aria-hidden': 'true'
      });
    }
    var min = Math.min.apply(null, finite);
    var max = Math.max.apply(null, finite);
    if (min === max) { min -= 1; max += 1; }
    var innerW = width - pad * 2;
    var innerH = height - pad * 2;
    function sx(index) {
      return values.length <= 1 ? pad + innerW / 2 : pad + (innerW * index) / (values.length - 1);
    }
    function sy(value) {
      return pad + ((max - value) / (max - min)) * innerH;
    }
    if (config.sparkType === 'bar') {
      var slot = innerW / Math.max(1, values.length);
      values.forEach(function (value, index) {
        if (value == null) return;
        var y = sy(value);
        var barHeight = Math.max(1, height - pad - y);
        children.push(h('rect', {
          x: r2(pad + slot * index + slot * 0.15),
          y: r2(y),
          width: r2(Math.max(1, slot * 0.7)),
          height: r2(barHeight),
          rx: '1',
          fill: color
        }));
      });
    } else {
      var points = [];
      values.forEach(function (value, index) {
        if (value == null) return;
        points.push({ x: sx(index), y: sy(value) });
      });
      segments(points).forEach(function (part) {
        var d = config.smooth === false ? linearPath(part) : smoothPath(part);
        if (config.area && part.length > 1) {
          children.push(h('path', {
            d: areaPath(part, height - pad),
            fill: color,
            'fill-opacity': '0.14',
            stroke: 'none'
          }));
        }
        children.push(h('path', {
          d: d,
          fill: 'none',
          stroke: color,
          'stroke-width': '1.5',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'vector-effect': 'non-scaling-stroke'
        }));
      });
    }
    return h('svg', {
      class: 'lc-ui-chart-svg lc-ui-sparkline-svg',
      viewBox: '0 0 ' + width + ' ' + height,
      width: String(width),
      height: String(height),
      xmlns: 'http://www.w3.org/2000/svg',
      role: 'presentation',
      focusable: 'false',
      'aria-hidden': 'true',
      preserveAspectRatio: 'none'
    }, children);
  }

  function legendNode(kind, model, config) {
    var items = [];
    if (kind === 'pie' || kind === 'donut') {
      pieSlices(model).items.forEach(function (item) {
        items.push({ index: item.index, name: item.label, value: formatFull(item.value) });
      });
    } else {
      model.series.forEach(function (item, index) {
        items.push({ index: index, name: item.name });
      });
    }
    if (config.legend === false || !items.length) return null;
    return h('ul', { class: 'lc-ui-chart-legend', 'aria-hidden': 'true' }, items.map(function (item) {
      return h('li', { class: 'lc-ui-chart-legend-item' }, [
        h('span', {
          class: 'lc-ui-chart-swatch',
          style: 'background:' + colorOf(item.index)
        }),
        h('span', null, item.name + (item.value != null ? ' · ' + item.value : ''))
      ]);
    }));
  }

  function tableNode(kind, model, config) {
    if (config.showTable === false) return null;
    var head;
    var rows = [];
    if (kind === 'pie' || kind === 'donut') {
      var data = pieSlices(model);
      head = ['项目', '数值', '占比'];
      rows = data.items.map(function (item) {
        return [item.label, formatFull(item.value), (Math.round((item.value / data.total) * 1000) / 10) + '%'];
      });
    } else {
      head = ['项目'].concat(model.series.map(function (item) { return item.name; }));
      rows = model.labels.map(function (label, index) {
        return [label].concat(model.series.map(function (item) { return formatFull(item.values[index]); }));
      });
    }
    if (!rows.length) return null;
    return h('details', { class: 'lc-ui-chart-data' }, [
      h('summary', { class: 'lc-ui-chart-summary' }, String(config.tableLabel || '查看数据表')),
      h('div', { class: 'lc-ui-chart-table-wrap' }, [
        h('table', { class: 'lc-ui-chart-table' }, [
          h('caption', { class: 'lc-ui-visually-hidden' }, summaryText(kind, model)),
          h('thead', null, [h('tr', null, head.map(function (label) {
            return h('th', { scope: 'col' }, String(label));
          }))]),
          h('tbody', null, rows.map(function (row) {
            return h('tr', null, row.map(function (cell, cellIndex) {
              return cellIndex === 0
                ? h('th', { scope: 'row' }, String(cell))
                : h('td', null, String(cell));
            }));
          }))
        ])
      ])
    ]);
  }

  /* ---------- 状态与整体结构 ---------- */

  function emptyNode(config, text, title) {
    return kit.renderStatus('empty', {
      title: title || config.emptyTitle || '暂无数据',
      text: text || config.emptyText || '没有可绘制的数据点。'
    });
  }

  function loadingNode(config, text) {
    return kit.renderStatus('loading', {
      title: config.loadingTitle || '正在加载图表数据',
      text: text || config.loadingText || '',
      variant: 'skeleton',
      lines: 3
    });
  }

  function errorNode(config, message) {
    return kit.renderStatus('error', {
      title: config.errorTitle || '图表加载失败',
      text: message || config.errorText || '请稍后重试。',
      retryLabel: config.retryLabel || '重试'
    });
  }

  function figureNode(kind, model, config) {
    var aria = config.ariaLabel || summaryText(kind, model);
    var svg;
    if (kind === 'bar') svg = barSvg(model, config);
    else if (kind === 'pie' || kind === 'donut') svg = pieSvg(kind, model, config);
    else if (kind === 'sparkline') svg = sparklineSvg(model, config);
    else svg = lineSvg(model, config);

    var nodes = [];
    if (config.title || config.subtitle) {
      nodes.push(h('div', { class: 'lc-ui-chart-head' }, [
        config.title ? h('p', { class: 'lc-ui-chart-title' }, String(config.title)) : null,
        config.subtitle ? h('p', { class: 'lc-ui-chart-subtitle' }, String(config.subtitle)) : null
      ]));
    }
    if (kind !== 'sparkline') {
      var legend = legendNode(kind, model, config);
      if (legend) nodes.push(legend);
    }
    var canvasAttrs = {
      class: 'lc-ui-chart-canvas' + (kind === 'sparkline' ? ' is-sparkline' : ''),
      'data-lc-chart-canvas': 'true'
    };
    if (kind === 'sparkline') {
      /* 迷你图整体由根节点充当 role="img"，画布本身对辅助技术隐藏，避免重复播报。 */
      canvasAttrs['aria-hidden'] = 'true';
    } else {
      canvasAttrs.role = 'img';
      canvasAttrs['aria-label'] = aria;
    }
    nodes.push(h('div', canvasAttrs, [svg]));
    if (config.caption) nodes.push(h('p', { class: 'lc-ui-chart-caption' }, String(config.caption)));
    if (kind !== 'sparkline') {
      var table = tableNode(kind, model, config);
      if (table) nodes.push(table);
    }
    return h('div', { class: 'lc-ui-chart-inner' }, nodes);
  }

  /* ---------- 属性与配置 ---------- */

  var BASE_PROPS = {
    title: { type: 'string', label: '标题', default: '' },
    subtitle: { type: 'string', label: '副标题', default: '' },
    caption: { type: 'string', label: '图表说明', default: '' },
    data: { type: 'array', label: '数据（[{label,value}]）', default: [] },
    labels: { type: 'array', label: '分类标签', default: [] },
    series: { type: 'array', label: '系列（[{name,values}]）', default: [] },
    seriesName: { type: 'string', label: '单系列名称', default: '数值' },
    datasource: { type: 'string', label: '数据源名称', default: '' },
    labelField: { type: 'string', label: '数据源分类字段', default: 'label' },
    valueField: { type: 'string', label: '数据源数值字段', default: 'value' },
    limit: { type: 'number', label: '数据源条数上限', default: 0 },
    height: { type: 'number', label: '画布高度', default: 240 },
    showTable: { type: 'boolean', label: '显示数据表替代', default: true },
    tableLabel: { type: 'string', label: '数据表展开文案', default: '查看数据表' },
    legend: { type: 'boolean', label: '显示图例', default: true },
    ariaLabel: { type: 'string', label: '无障碍摘要（留空自动生成）', default: '' },
    emptyText: { type: 'string', label: '空态说明', default: '' },
    loadingText: { type: 'string', label: '加载态说明', default: '' },
    errorText: { type: 'string', label: '错误说明', default: '' },
    state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' },
    error: { type: 'string', label: '错误信息', default: '' }
  };

  function mergeProps(extra) {
    var props = {};
    Object.keys(BASE_PROPS).forEach(function (key) { props[key] = BASE_PROPS[key]; });
    Object.keys(extra || {}).forEach(function (key) { props[key] = extra[key]; });
    return props;
  }

  function schemaOf(type, name, extra) {
    return {
      type: type,
      name: name,
      version: 1,
      states: ['ready', 'loading', 'empty', 'error'],
      events: ['lc:chart-load', 'lc:chart-error', 'lc:chart-retry'],
      props: mergeProps(extra)
    };
  }

  /* ---------- 渲染 ---------- */

  function chartConfig(kind, block) {
    return {
      chart: kind,
      title: String(kit.prop(block, 'title', '') || ''),
      subtitle: String(kit.prop(block, 'subtitle', '') || ''),
      caption: String(kit.prop(block, 'caption', '') || ''),
      datasource: String(kit.prop(block, 'datasource', '') || ''),
      labelField: String(kit.prop(block, 'labelField', 'label') || 'label'),
      valueField: String(kit.prop(block, 'valueField', 'value') || 'value'),
      limit: kit.num(kit.prop(block, 'limit', 0), 0),
      seriesName: String(kit.prop(block, 'seriesName', '数值') || '数值'),
      height: kit.num(kit.prop(block, 'height', 240), 240),
      smooth: kit.bool(kit.prop(block, 'smooth', true), true),
      area: kit.bool(kit.prop(block, 'area', false), false),
      showDots: kit.bool(kit.prop(block, 'showDots', false), false),
      showTable: kit.bool(kit.prop(block, 'showTable', true), true),
      tableLabel: String(kit.prop(block, 'tableLabel', '查看数据表') || '查看数据表'),
      legend: kit.bool(kit.prop(block, 'legend', true), true),
      ariaLabel: String(kit.prop(block, 'ariaLabel', '') || ''),
      emptyText: String(kit.prop(block, 'emptyText', '') || ''),
      emptyTitle: String(kit.prop(block, 'emptyTitle', '') || ''),
      loadingText: String(kit.prop(block, 'loadingText', '') || ''),
      loadingTitle: String(kit.prop(block, 'loadingTitle', '') || ''),
      errorText: String(kit.prop(block, 'errorText', '') || ''),
      errorTitle: String(kit.prop(block, 'errorTitle', '') || ''),
      retryLabel: String(kit.prop(block, 'retryLabel', '重试') || '重试'),
      centerValue: kit.prop(block, 'centerValue', ''),
      centerLabel: String(kit.prop(block, 'centerLabel', '') || ''),
      thickness: kit.num(kit.prop(block, 'thickness', 34), 34),
      sparkType: String(kit.prop(block, 'sparkType', 'line') || 'line'),
      width: kit.num(kit.prop(block, 'width', 120), 120),
      positiveIsGood: kit.bool(kit.prop(block, 'positiveIsGood', true), true)
    };
  }

  function chartRender(kind) {
    return function (block) {
      var config = chartConfig(kind, block);
      var model = normalizeDataset(block);
      var explicit = String(kit.prop(block, 'state', '') || '');
      var source = config.datasource ? resolveChartSource(config.datasource) : null;
      var state;
      var body;

      if (explicit === 'error') {
        state = 'error';
        body = errorNode(config, String(kit.prop(block, 'error', '') || ''));
      } else if (explicit === 'loading') {
        state = 'loading';
        body = loadingNode(config);
      } else if (explicit === 'empty') {
        state = 'empty';
        body = emptyNode(config);
      } else if (config.datasource && !source) {
        /* 数据源没注册：明确说明，绝不画一张假图。 */
        state = 'empty';
        body = emptyNode(
          config,
          '数据源「' + config.datasource + '」未注册，暂不绘制图表。',
          '数据源不可用'
        );
      } else if (config.datasource) {
        state = 'loading';
        body = loadingNode(config, '正在从数据源「' + config.datasource + '」加载…');
      } else if ((kind === 'pie' || kind === 'donut') && !pieSlices(model).items.length) {
        /* 饼图/环形只接受正数；全是 0 或负数时明确进入空态，不画一张空盘子。 */
        state = 'empty';
        body = emptyNode(config, '没有可用于饼图的正数数据。', '暂无可用数据');
      } else if (!hasData(model)) {
        state = 'empty';
        body = emptyNode(config);
      } else {
        state = 'ready';
        body = figureNode(kind, model, config);
      }

      return h('div', {
        class: 'lc-ui lc-ui-chart lc-ui-chart-' + kind,
        'data-lc-ui': 'ui-chart-' + kind,
        'data-lc-state': state,
        'data-chart': kind,
        'data-datasource': config.datasource,
        'data-source-bound': source ? 'true' : 'false'
      }, [
        h('div', { class: 'lc-ui-chart-body', 'data-lc-chart-body': 'true' }, [body]),
        raw(kit.jsonIsland({
          chart: kind,
          datasource: config.datasource,
          labelField: config.labelField,
          valueField: config.valueField,
          limit: config.limit,
          seriesName: config.seriesName,
          title: config.title,
          subtitle: config.subtitle,
          caption: config.caption,
          height: config.height,
          smooth: config.smooth,
          area: config.area,
          showDots: config.showDots,
          showTable: config.showTable,
          tableLabel: config.tableLabel,
          legend: config.legend,
          ariaLabel: config.ariaLabel,
          emptyText: config.emptyText,
          emptyTitle: config.emptyTitle,
          loadingText: config.loadingText,
          loadingTitle: config.loadingTitle,
          errorText: config.errorText,
          errorTitle: config.errorTitle,
          retryLabel: config.retryLabel,
          centerValue: config.centerValue,
          centerLabel: config.centerLabel,
          thickness: config.thickness,
          sparkType: config.sparkType,
          width: config.width,
          positiveIsGood: config.positiveIsGood,
          hasInline: hasData(model)
        }))
      ]);
    };
  }

  /* ---------- 数据源绑定（只读消费，不写请求） ---------- */

  function readSource(source, config) {
    var options = { limit: kit.num(config.limit, 0) || undefined };
    if (typeof AbortController === 'function') {
      options.controller = new AbortController();
      options.signal = options.controller.signal;
    }
    var promise;
    if (typeof source.load === 'function') promise = source.load(options);
    else if (typeof source.fetchData === 'function') promise = source.fetchData(options);
    else if (typeof source.search === 'function') promise = source.search('', options);
    else throw new Error('数据源缺少 load / fetchData / search 方法');
    return { promise: Promise.resolve(promise), controller: options.controller };
  }

  function enhance(el) {
    var config = kit.readJsonScript(el);
    if (!config || !config.datasource || config.chart === 'sparklineRemoteDisabled') return null;
    var source = resolveChartSource(config.datasource);
    if (!source) return null;
    var body = el.querySelector('[data-lc-chart-body]');
    if (!body) return null;

    var kind = config.chart || 'line';
    var alive = true;
    var requestId = 0;
    var current = null;

    function paint(state, node) {
      el.setAttribute('data-lc-state', state);
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
      paint('loading', loadingNode(config, '正在从数据源「' + config.datasource + '」加载…'));
      var started;
      try {
        started = readSource(source, config);
      } catch (error) {
        paint('error', errorNode(config, error.message));
        kit.emit(el, 'lc:chart-error', { chart: kind, datasource: config.datasource, message: error.message });
        return;
      }
      current = started;
      started.promise.then(function (result) {
        if (!alive || mine !== requestId) return;
        var model = normalizeResult(result, config);
        if (!hasData(model)) {
          paint('empty', emptyNode(config, config.emptyText || '数据源返回空结果。', '暂无数据'));
          kit.emit(el, 'lc:chart-load', { chart: kind, datasource: config.datasource, points: 0, empty: true });
          return;
        }
        if (kind === 'sparkline' && el.setAttribute) {
          /* 远程数据回来后同步更新根节点的无障碍摘要，避免仍播报空态文案。 */
          el.setAttribute('aria-label', config.ariaLabel || summaryText(kind, model));
        }
        paint('ready', figureNode(kind, model, config));
        kit.emit(el, 'lc:chart-load', { chart: kind, datasource: config.datasource, points: countPoints(model) });
      }).catch(function (error) {
        if (!alive || mine !== requestId) return;
        if (error && error.name === 'AbortError') return;
        var message = String((error && error.message) || error || '未知错误');
        paint('error', errorNode(config, message));
        kit.emit(el, 'lc:chart-error', { chart: kind, datasource: config.datasource, message: message });
      });
    }

    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (!target.closest('[data-lc-retry]')) return;
      kit.emit(el, 'lc:chart-retry', { chart: kind, datasource: config.datasource });
      load();
    }

    el.addEventListener('click', onClick);
    load();

    var handle = {
      reload: load,
      datasource: config.datasource,
      destroy: function () {
        alive = false;
        if (current && current.controller) {
          try { current.controller.abort(); } catch (error) { /* 忽略 */ }
        }
        el.removeEventListener('click', onClick);
      }
    };
    el.__lcChart = handle;
    return handle;
  }

  /* ---------- 迷你走势图 ---------- */

  function sparklineRender(block) {
    var model = normalizeDataset(block);
    var config = chartConfig('sparkline', block);
    var explicit = String(kit.prop(block, 'state', '') || '');
    var values = model.series.length ? model.series[0].values : [];
    var finite = values.filter(function (value) { return value != null; });
    var source = config.datasource ? resolveChartSource(config.datasource) : null;
    var trend = 'flat';
    if (finite.length > 1) {
      var change = finite[finite.length - 1] - finite[0];
      trend = change > 0 ? 'up' : (change < 0 ? 'down' : 'flat');
    }
    var good = trend === 'flat' ? 'flat' : ((trend === 'up') === config.positiveIsGood ? 'good' : 'bad');
    var state = 'ready';
    var body;

    if (explicit === 'error') {
      state = 'error';
      body = errorNode(config, String(kit.prop(block, 'error', '') || ''));
    } else if (explicit === 'loading') {
      state = 'loading';
      body = loadingNode(config, config.loadingText || '');
    } else if (explicit === 'empty') {
      state = 'empty';
      body = emptyNode(config, config.emptyText || '暂无数值。');
    } else if (config.datasource && !source) {
      state = 'empty';
      body = emptyNode(config, '数据源「' + config.datasource + '」未注册，暂不绘制走势。', '数据源不可用');
    } else if (config.datasource) {
      state = 'loading';
      body = loadingNode(config, '正在加载走势…');
    } else if (!finite.length) {
      state = 'empty';
      body = emptyNode(config, config.emptyText || '暂无数值。');
    } else {
      body = figureNode('sparkline', model, config);
    }

    var label = config.ariaLabel || summaryText('sparkline', model);
    return h('div', {
      class: 'lc-ui lc-ui-sparkline lc-ui-sparkline-' + trend + ' is-' + good,
      'data-lc-ui': 'ui-sparkline',
      'data-lc-state': state,
      'data-trend': trend,
      'data-tone': good,
      'data-datasource': config.datasource,
      role: 'img',
      'aria-label': label
    }, [
      h('div', { class: 'lc-ui-chart-body', 'data-lc-chart-body': 'true' }, [body]),
      raw(kit.jsonIsland({
        chart: 'sparkline',
        datasource: config.datasource,
        labelField: config.labelField,
        valueField: config.valueField,
        seriesName: config.seriesName,
        title: config.title,
        width: config.width,
        height: config.height,
        smooth: config.smooth,
        area: config.area,
        sparkType: config.sparkType,
        showTable: false,
        legend: false,
        trend: trend,
        positiveIsGood: config.positiveIsGood
      }))
    ]);
  }

  /* ---------- 共享样式 ---------- */

  var CHART_CSS = [
    '/* lc-ui-charts */',
    '.lc-ui-chart { --lc-chart-1: var(--lc-color-accent, var(--accent, #3e6a56));',
    '  --lc-chart-2: var(--lc-color-info, var(--info, #3a6ea5));',
    '  --lc-chart-3: var(--lc-color-warn, var(--warn, #b07a1e));',
    '  --lc-chart-4: var(--lc-color-success, var(--success, #3f7d4f));',
    '  --lc-chart-5: var(--lc-color-danger, var(--danger, #a4453b));',
    '  --lc-chart-6: var(--lc-color-accent-line, var(--accent-line, #8fa79b));',
    '  --lc-chart-7: var(--lc-color-decor, #888);',
    '  --lc-chart-8: var(--lc-color-info-line, var(--info-line, #9bb4cf)); }',
    '.lc-ui-chart-inner { min-width: 0; }',
    '.lc-ui-chart-head { margin-bottom: var(--lc-space-2); }',
    '.lc-ui-chart-title { margin: 0; font-size: var(--lc-text-md, 15px); font-weight: var(--lc-weight-semibold, 600); color: var(--lc-color-ink, var(--ink, inherit)); }',
    '.lc-ui-chart-subtitle { margin: var(--lc-space-1) 0 0; font-size: var(--lc-text-sm, 13px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-chart-legend { display: flex; flex-wrap: wrap; gap: var(--lc-space-1-5) var(--lc-space-3-5); margin: 0 0 var(--lc-space-2); padding: 0; list-style: none; font-size: var(--lc-text-sm, 13px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-chart-legend-item { display: inline-flex; align-items: center; gap: var(--lc-space-1-5); }',
    '.lc-ui-chart-swatch { display: inline-block; width: 10px; height: 10px; border-radius: var(--lc-radius-xs); flex: none; }',
    '.lc-ui-chart-canvas { min-width: 0; }',
    '.lc-ui-chart-svg { display: block; width: 100%; height: auto; overflow: visible; }',
    '.lc-ui-chart-pie-svg { max-width: 280px; margin: 0 auto; }',
    '.lc-ui-chart-grid line { stroke: var(--lc-color-line, var(--line, #ddd)); stroke-width: 1; stroke-dasharray: 3 4; }',
    '.lc-ui-chart-zero { stroke: var(--lc-color-muted, var(--muted, #666)); stroke-width: 1; opacity: 0.6; }',
    '.lc-ui-chart-axis text { fill: var(--lc-color-muted, var(--muted, #666)); font-size: 11px; }',
    '.lc-ui-chart-center-value { fill: var(--lc-color-ink, var(--ink, inherit)); font-size: 22px; font-weight: var(--lc-weight-semibold, 600); }',
    '.lc-ui-chart-center-label { fill: var(--lc-color-muted, var(--muted, #666)); font-size: var(--lc-text-xs); }',
    '.lc-ui-chart-caption { margin: var(--lc-space-1-5) 0 0; font-size: var(--lc-text-sm, 13px); color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-chart-data { margin-top: var(--lc-space-2-5); font-size: var(--lc-text-sm, 13px); }',
    '.lc-ui-chart-summary { cursor: pointer; color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-chart-table-wrap { overflow-x: auto; margin-top: var(--lc-space-2); }',
    '.lc-ui-chart-table { width: 100%; border-collapse: collapse; }',
    '.lc-ui-chart-table th, .lc-ui-chart-table td { padding: var(--lc-space-1-5) var(--lc-space-2); text-align: left; border-bottom: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); white-space: nowrap; }',
    '.lc-ui-chart-table th { font-weight: var(--lc-weight-semibold, 600); color: var(--lc-color-ink, var(--ink, inherit)); }',
    '.lc-ui-chart-table td { color: var(--lc-color-muted, var(--muted, #666)); }',
    '.lc-ui-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
    '.lc-ui-sparkline { display: inline-flex; align-items: center; gap: var(--lc-space-2); vertical-align: middle; }',
    '.lc-ui-sparkline .lc-ui-chart-body { display: inline-flex; }',
    '.lc-ui-sparkline .lc-ui-chart-canvas { width: auto; }',
    '.lc-ui-sparkline .lc-ui-chart-svg { display: block; width: auto; height: auto; }',
    '.lc-ui-sparkline.is-good { --lc-spark-color: var(--lc-color-success, var(--success, #3f7d4f)); }',
    '.lc-ui-sparkline.is-bad { --lc-spark-color: var(--lc-color-danger, var(--danger, #a4453b)); }',
    '.lc-ui-sparkline.is-flat { --lc-spark-color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
    '.lc-ui-sparkline-label { font-size: var(--lc-text-sm, 13px); color: var(--lc-color-muted, var(--muted, #666)); }'
  ].join('\n');

  /* ---------- 组件定义 ---------- */

  var helpers = {
    safeNum: safeNum,
    normalizeDataset: normalizeDataset,
    normalizeResult: normalizeResult,
    datasetFromRecords: datasetFromRecords,
    hasData: hasData,
    countPoints: countPoints,
    niceTicks: niceTicks,
    valueDomain: valueDomain,
    smoothPath: smoothPath,
    linearPath: linearPath,
    barRects: barRects,
    pieSlices: pieSlices,
    formatAxisNumber: formatAxisNumber,
    formatFull: formatFull,
    summaryText: summaryText,
    resolveChartSource: resolveChartSource
  };

  function makeDef(type, name, kind, extraProps, render) {
    return {
      type: type,
      name: name,
      version: 1,
      schema: schemaOf(type, name, extraProps),
      sharedCssId: 'lc-ui-charts',
      sharedCss: CHART_CSS,
      render: render || chartRender(kind),
      enhance: enhance,
      helpers: helpers
    };
  }

  var defs = {};

  defs['ui-chart-line'] = makeDef('ui-chart-line', '折线图', 'line', {
    smooth: { type: 'boolean', label: '贝塞尔平滑', default: true },
    area: { type: 'boolean', label: '面积填充', default: false },
    showDots: { type: 'boolean', label: '显示数据点', default: false }
  });

  defs['ui-chart-bar'] = makeDef('ui-chart-bar', '柱状图', 'bar', {});

  defs['ui-chart-pie'] = makeDef('ui-chart-pie', '饼图', 'pie', {
    showTable: { type: 'boolean', label: '显示数据表替代', default: true }
  });

  defs['ui-chart-donut'] = makeDef('ui-chart-donut', '环形图', 'donut', {
    thickness: { type: 'number', label: '环宽', default: 34 },
    centerValue: { type: 'string', label: '中心数值', default: '' },
    centerLabel: { type: 'string', label: '中心说明', default: '' }
  });

  defs['ui-sparkline'] = {
    type: 'ui-sparkline',
    name: '迷你走势图',
    version: 1,
    schema: schemaOf('ui-sparkline', '迷你走势图', {
      width: { type: 'number', label: '宽度', default: 120 },
      sparkType: { type: 'enum', label: '形态', options: ['line', 'bar'], default: 'line' },
      positiveIsGood: { type: 'boolean', label: '上升为正向', default: true },
      height: { type: 'number', label: '高度', default: 32 }
    }),
    sharedCssId: 'lc-ui-charts',
    sharedCss: CHART_CSS,
    render: sparklineRender,
    enhance: enhance,
    helpers: helpers
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = defs;
  } else {
    var components = R.Components;
    Object.keys(defs).forEach(function (type) { components[type] = defs[type]; });
  }

  return defs;
}));
