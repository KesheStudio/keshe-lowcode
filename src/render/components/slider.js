/* 渲染核心 · 内置组件 · 滑块
   单值与双值范围；步长、刻度、数值输入框联动、键盘微调（原生 range 自带）。
   双值手柄永不交叉：低值不得超过高值，高值不得低于低值。
   格式化支持 number / percent / unit，也允许通过实例 API 注入自定义函数。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../dom.js'), require('../datasource.js'), require('./common.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    root.LC.Render.Components = root.LC.Render.Components || {};
    factory(root.LC.Render, root.LC.Render, root.LC.Render.ComponentsCommon);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (dom, datasource, kit) {
  'use strict';

  var h = dom.h;
  var raw = dom.raw;

  function normalizeValue(value, range, min, max) {
    if (range) {
      var list = kit.toArray(value);
      var low = kit.clamp(kit.num(list[0], min), min, max);
      var high = kit.clamp(kit.num(list[1], max), min, max);
      return low <= high ? [low, high] : [high, low];
    }
    return kit.clamp(kit.num(Array.isArray(value) ? value[0] : value, min), min, max);
  }

  function formatValue(value, options) {
    var opts = options || {};
    if (typeof opts.format === 'function') {
      try { return String(opts.format(value)); } catch (error) { /* 回退 */ }
    }
    if (opts.percent) return String(value) + '%';
    if (opts.unit) return String(value) + String(opts.unit);
    return String(value);
  }

  function percentOf(value, min, max) {
    if (max === min) return 0;
    return Math.round(((value - min) / (max - min)) * 10000) / 100;
  }

  var SCHEMA = {
    type: 'ui-slider',
    name: '滑块',
    version: 1,
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:slider-change', 'lc:slider-source'],
    props: {
      label: { type: 'string', label: '标签', default: '滑块' },
      min: { type: 'number', label: '最小值', default: 0 },
      max: { type: 'number', label: '最大值', default: 100 },
      step: { type: 'number', label: '步长', default: 1 },
      datasource: { type: 'string', label: '数据源名称（平台注册）', default: '' },
      sourceMode: { type: 'enum', label: '数据源取值方式', options: [
        { value: 'range', label: '区间取值（min/max）' },
        { value: 'stops', label: '按档位取值（候选值）' }
      ], default: 'range' },
      sourceErrorText: { type: 'string', label: '数据源失败文本', default: '数据源请求失败，请重试' },
      sourceEmptyText: { type: 'string', label: '数据源空结果文本', default: '数据源没有可用取值' },
      sourceUnconfiguredText: { type: 'string', label: '数据源未注册文本', default: '数据源尚未注册，已使用静态取值' },
      sourceLoadingText: { type: 'string', label: '数据源加载中文本', default: '正在加载数据源…' },
      value: { type: 'number|array', label: '值（数字或 [低, 高]）', default: 0 },
      range: { type: 'boolean', label: '双值范围', default: false },
      marks: { type: 'array', label: '刻度', items: { type: 'object', props: {
        value: { type: 'number' }, label: { type: 'string' }
      } }, default: [] },
      showInput: { type: 'boolean', label: '显示数值输入框', default: true },
      unit: { type: 'string', label: '单位后缀', default: '' },
      percent: { type: 'boolean', label: '按百分比显示', default: false },
      name: { type: 'string', label: '字段名', default: '' },
      required: { type: 'boolean', label: '必填', default: false },
      disabled: { type: 'boolean', label: '禁用', default: false },
      help: { type: 'string', label: '帮助文本', default: '' },
      error: { type: 'string', label: '错误文本', default: '' },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    }
  };

  function render(block, ctx) {
    var id = kit.uid('lc-slider');
    var range = kit.bool(kit.prop(block, 'range', false), false);
    var min = kit.num(kit.prop(block, 'min', 0), 0);
    var max = kit.num(kit.prop(block, 'max', 100), 100);
    if (max <= min) max = min + 1;
    var step = kit.num(kit.prop(block, 'step', 1), 1);
    if (step <= 0) step = 1;
    var datasourceName = String(kit.prop(block, 'datasource', '') || '').trim();
    var sourceMode = kit.prop(block, 'sourceMode', 'range') === 'stops' ? 'stops' : 'range';
    var sourceErrorText = kit.prop(block, 'sourceErrorText', '数据源请求失败，请重试');
    var sourceEmptyText = kit.prop(block, 'sourceEmptyText', '数据源没有可用取值');
    var sourceUnconfiguredText = kit.prop(block, 'sourceUnconfiguredText', '数据源尚未注册，已使用静态取值');
    var sourceLoadingText = kit.prop(block, 'sourceLoadingText', '正在加载数据源…');
    var value = normalizeValue(kit.prop(block, 'value', range ? [min, max] : min), range, min, max);
    var marks = kit.toArray(kit.prop(block, 'marks', [])).filter(function (mark) {
      return mark && typeof mark === 'object' && mark.value != null;
    });
    var showInput = kit.bool(kit.prop(block, 'showInput', true), true);
    var unit = kit.prop(block, 'unit', '');
    var percent = kit.bool(kit.prop(block, 'percent', false), false);
    var label = kit.prop(block, 'label', '滑块');
    var help = kit.prop(block, 'help', '');
    var error = kit.prop(block, 'error', '');
    var state = kit.stateOf(block, true);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false) || state === 'loading';
    var errorId = id + '-error';
    var helpId = id + '-help';

    function rangeInput(nodeValue, className, ariaLabel) {
      var attrs = {
        type: 'range',
        class: className,
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(nodeValue),
        'data-lc-slider-range': 'true',
        'aria-label': ariaLabel,
        'aria-valuemin': String(min),
        'aria-valuemax': String(max)
      };
      if (block.name) attrs.name = block.name;
      if (disabled) attrs.disabled = 'disabled';
      return h('input', attrs);
    }

    function numberInput(nodeValue, index, ariaLabel) {
      var attrs = {
        type: 'number',
        class: 'lc-ui-slider-number',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(nodeValue),
        'data-lc-slider-number': String(index),
        'aria-label': ariaLabel
      };
      if (disabled) attrs.disabled = 'disabled';
      return h('input', attrs);
    }

    var track;
    if (range) {
      track = h('div', { class: 'lc-ui-slider-track lc-ui-slider-track-range' }, [
        rangeInput(value[0], 'lc-ui-slider-input lc-ui-slider-input-low', '最小值'),
        rangeInput(value[1], 'lc-ui-slider-input lc-ui-slider-input-high', '最大值')
      ]);
    } else {
      track = h('div', { class: 'lc-ui-slider-track' }, [rangeInput(value, 'lc-ui-slider-input', label)]);
    }

    var readout = range
      ? formatValue(value[0], { unit: unit, percent: percent }) + ' – ' + formatValue(value[1], { unit: unit, percent: percent })
      : formatValue(value, { unit: unit, percent: percent });

    var markNodes = h('div', {
      class: 'lc-ui-slider-marks',
      'data-lc-slider-marks': 'true',
      'aria-hidden': 'true',
      hidden: marks.length ? null : 'hidden'
    }, marks.map(function (mark) {
      var at = percentOf(kit.num(mark.value, min), min, max);
      return h('span', { class: 'lc-ui-slider-mark', style: 'left:' + at + '%' }, String(mark.label == null ? mark.value : mark.label));
    }));

    var inputs = [];
    if (showInput) {
      if (range) {
        inputs.push(numberInput(value[0], 0, '最小值输入'));
        inputs.push(h('span', { class: 'lc-ui-slider-dash', 'aria-hidden': 'true' }, '–'));
        inputs.push(numberInput(value[1], 1, '最大值输入'));
      } else {
        inputs.push(numberInput(value, 0, '数值输入'));
      }
    }

    var foot = [];
    if (error && state === 'error') foot.push(h('p', { class: 'lc-ui-slider-error', id: errorId, role: 'alert' }, error));
    else if (help) foot.push(h('p', { class: 'lc-ui-slider-help', id: helpId }, help));

    return h('div', {
      class: 'lc-ui lc-ui-slider',
      'data-lc-ui': 'ui-slider',
      'data-lc-state': state,
      'data-range': range ? 'true' : 'false',
      'data-lc-slider': 'true',
      'data-min': String(min),
      'data-max': String(max),
      'data-step': String(step),
      'data-unit': String(unit),
      'data-percent': percent ? 'true' : 'false',
      'data-datasource': datasourceName,
      'data-source-mode': sourceMode,
      'data-source-error-text': String(sourceErrorText),
      'data-source-empty-text': String(sourceEmptyText),
      'data-source-unconfigured-text': String(sourceUnconfiguredText),
      'data-source-loading-text': String(sourceLoadingText),
      'data-required': kit.bool(kit.prop(block, 'required', false), false) ? 'true' : 'false'
    }, [
      label ? h('p', { class: 'lc-ui-slider-label' }, [
        label, kit.bool(kit.prop(block, 'required', false), false) ? h('span', { class: 'lc-ui-slider-required', 'aria-hidden': 'true' }, ' *') : null
      ]) : null,
      h('div', { class: 'lc-ui-slider-head' }, [
        h('span', { class: 'lc-ui-slider-value', 'data-lc-slider-value': 'true' }, readout),
        inputs.length ? h('div', { class: 'lc-ui-slider-inputs' }, inputs) : null
      ]),
      track,
      markNodes,
      h('p', { class: 'lc-ui-slider-source-note', 'data-lc-slider-source-note': 'true', role: 'status', hidden: 'hidden' }, ''),
      foot.length ? h('div', { class: 'lc-ui-slider-foot' }, foot) : null,
      raw(kit.jsonIsland({ min: min, max: max, step: step, range: range, unit: unit, percent: percent, datasource: datasourceName, sourceMode: sourceMode }))
    ]);
  }

  function enhance(el) {
    var min = kit.num(el.getAttribute('data-min'), 0);
    var max = kit.num(el.getAttribute('data-max'), 100);
    var step = kit.num(el.getAttribute('data-step'), 1);
    var range = el.getAttribute('data-range') === 'true';
    var unit = el.getAttribute('data-unit') || '';
    var percent = el.getAttribute('data-percent') === 'true';
    var sliders = Array.prototype.slice.call(el.querySelectorAll('[data-lc-slider-range]'));
    var numbers = Array.prototype.slice.call(el.querySelectorAll('[data-lc-slider-number]'));
    var readout = el.querySelector('[data-lc-slider-value]');
    var markBox = el.querySelector('[data-lc-slider-marks]');
    var note = el.querySelector('[data-lc-slider-source-note]');
    var format = null;
    var stops = null;
    var datasourceName = String(el.getAttribute('data-datasource') || '').trim();
    var sourceMode = el.getAttribute('data-source-mode') === 'stops' ? 'stops' : 'range';
    var sourceErrorText = el.getAttribute('data-source-error-text') || '数据源请求失败，请重试';
    var sourceEmptyText = el.getAttribute('data-source-empty-text') || '数据源没有可用取值';
    var sourceUnconfiguredText = el.getAttribute('data-source-unconfigured-text') || '数据源尚未注册，已使用静态取值';
    var sourceLoadingText = el.getAttribute('data-source-loading-text') || '正在加载数据源…';
    var controller = null;
    var sourceSeq = 0;

    function snap(value) {
      var clamped = kit.clamp(kit.num(value, min), min, max);
      if (min !== max) {
        var offset = (clamped - min) / step;
        clamped = min + Math.round(offset) * step;
      }
      return kit.clamp(clamped, min, max);
    }

    /* 档位模式的内部值是候选下标，普通模式直接是数值。 */
    function clampInternal(value) {
      if (!stops || !stops.length) return snap(value);
      return kit.clamp(Math.round(kit.num(value, 0)), 0, stops.length - 1);
    }

    function nearestIndex(value) {
      if (!stops || !stops.length) return snap(value);
      var target = kit.num(value, stops[0].value);
      var best = 0;
      for (var i = 1; i < stops.length; i += 1) {
        if (Math.abs(stops[i].value - target) <= Math.abs(stops[best].value - target)) best = i;
      }
      return best;
    }

    function toInternal(value) {
      return stops && stops.length ? nearestIndex(value) : snap(value);
    }

    function stopAt(value) {
      if (!stops || !stops.length) return null;
      return stops[clampInternal(value)] || null;
    }

    function actual(value) {
      if (!stops || !stops.length) return kit.num(value, min);
      var item = stopAt(value);
      return item ? item.value : kit.num(value, min);
    }

    function displayOf(value) {
      if (stops && stops.length) {
        var item = stopAt(value);
        if (!item) return '';
        if (!format && item.label != null) return String(item.label);
        return formatValue(item.value, { unit: unit, percent: percent, format: format });
      }
      return formatValue(value, { unit: unit, percent: percent, format: format });
    }

    function show(value) {
      if (readout) {
        readout.textContent = Array.isArray(value)
          ? displayOf(value[0]) + ' – ' + displayOf(value[1])
          : displayOf(value);
      }
      sliders.forEach(function (input, index) {
        var at = Array.isArray(value) ? value[index] : value;
        input.setAttribute('aria-valuetext', displayOf(at));
      });
    }

    function emit(value) {
      kit.emit(el, 'lc:slider-change', { value: Array.isArray(value) ? value.map(actual) : actual(value) });
    }

    function currentInternal() {
      if (range) {
        return [clampInternal(sliders[0] ? sliders[0].value : min), clampInternal(sliders[1] ? sliders[1].value : max)];
      }
      return clampInternal(sliders[0] ? sliders[0].value : min);
    }

    function currentActual() {
      var value = currentInternal();
      return Array.isArray(value) ? value.map(actual) : actual(value);
    }

    function write(value) {
      if (range) {
        var low = clampInternal(value[0]);
        var high = clampInternal(value[1]);
        if (low > high) low = high;
        if (sliders[0]) sliders[0].value = String(low);
        if (sliders[1]) sliders[1].value = String(high);
        if (numbers[0]) numbers[0].value = String(actual(low));
        if (numbers[1]) numbers[1].value = String(actual(high));
        show([low, high]);
      } else {
        var at = clampInternal(value);
        if (sliders[0]) sliders[0].value = String(at);
        if (numbers[0]) numbers[0].value = String(actual(at));
        show(at);
      }
    }

    function emitSource() {
      kit.emit(el, 'lc:slider-source', {
        mode: stops && stops.length ? 'stops' : 'range',
        min: min,
        max: max,
        step: step,
        stops: stops ? stops.map(function (item) { return { value: item.value, label: item.label }; }) : null,
        value: currentActual()
      });
    }

    function syncFromInputs() {
      var value = currentInternal();
      write(value);
      emit(value);
      return value;
    }

    function onRange() { syncFromInputs(); }

    function onNumber(event) {
      var target = event.target;
      var index = kit.num(target.getAttribute('data-lc-slider-number'), 0);
      var next = toInternal(target.value);
      var value = currentInternal();
      if (range) {
        value[index] = next;
        if (value[0] > value[1]) {
          if (index === 0) value[0] = value[1];
          else value[1] = value[0];
        }
      } else {
        value = next;
      }
      write(value);
      emit(value);
    }

    /* 数据源：只改本实例的边界/刻度，不触碰同类型其它实例。 */
    function setNote(text, kind) {
      if (!note) return;
      if (text) {
        note.hidden = false;
        note.textContent = String(text);
        note.setAttribute('data-kind', kind || '');
      } else {
        note.hidden = true;
        note.textContent = '';
        note.removeAttribute('data-kind');
      }
    }

    function setBounds(nextMin, nextMax, nextStep, useStops) {
      min = nextMin;
      max = nextMax;
      step = nextStep;
      el.setAttribute('data-min', String(min));
      el.setAttribute('data-max', String(max));
      el.setAttribute('data-step', String(step));
      sliders.forEach(function (input) {
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.setAttribute('aria-valuemin', String(min));
        input.setAttribute('aria-valuemax', String(max));
      });
      numbers.forEach(function (input) {
        if (useStops && stops && stops.length) {
          input.min = String(stops[0].value);
          input.max = String(stops[stops.length - 1].value);
          input.step = 'any';
        } else {
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
        }
      });
    }

    function renderMarks(list) {
      if (!markBox) return;
      var items = (list || []).filter(function (item) { return item && item.value != null; });
      while (markBox.firstChild) markBox.removeChild(markBox.firstChild);
      items.forEach(function (item) {
        var mark = document.createElement('span');
        mark.className = 'lc-ui-slider-mark';
        mark.style.left = percentOf(kit.num(item.value, min), min, max) + '%';
        mark.textContent = String(item.label == null
          ? formatValue(item.value, { unit: unit, percent: percent, format: format })
          : item.label);
        markBox.appendChild(mark);
      });
      if (items.length) markBox.removeAttribute('hidden');
      else markBox.setAttribute('hidden', 'hidden');
    }

    function stopList(payload) {
      var list = Array.isArray(payload) ? payload
        : payload && Array.isArray(payload.stops) ? payload.stops
        : payload && Array.isArray(payload.values) ? payload.values
        : payload && Array.isArray(payload.items) ? payload.items
        : [];
      var out = [];
      var seen = {};
      list.forEach(function (item) {
        var rawValue = item && typeof item === 'object' ? (item.value != null ? item.value : item.id) : item;
        var rawLabel = item && typeof item === 'object' ? (item.label != null ? item.label : item.name) : null;
        var number = Number(rawValue);
        if (!isFinite(number)) return;
        var key = String(number);
        if (seen[key]) return;
        seen[key] = true;
        out.push({ value: number, label: rawLabel == null ? null : String(rawLabel) });
      });
      out.sort(function (a, b) { return a.value - b.value; });
      return out;
    }

    function rangeSpec(payload) {
      var spec = null;
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.min != null && payload.max != null) {
        spec = { min: kit.num(payload.min, min), max: kit.num(payload.max, max), step: payload.step, marks: payload.marks };
      } else {
        var list = Array.isArray(payload) ? payload
          : payload && Array.isArray(payload.items) ? payload.items
          : payload && Array.isArray(payload.values) ? payload.values
          : [];
        var nums = [];
        list.forEach(function (item) {
          var rawValue = item && typeof item === 'object' ? (item.value != null ? item.value : item.id) : item;
          var number = Number(rawValue);
          if (isFinite(number)) nums.push(number);
        });
        if (nums.length) {
          spec = { min: Math.min.apply(Math, nums), max: Math.max.apply(Math, nums), step: step, marks: null };
        }
      }
      if (!spec) return null;
      if (spec.max <= spec.min) spec.max = spec.min + (step > 0 ? step : 1);
      var nextStep = kit.num(spec.step, step);
      if (nextStep <= 0) nextStep = 1;
      spec.step = nextStep;
      return spec;
    }

    function applyRange(spec) {
      var before = currentActual();
      stops = null;
      setBounds(spec.min, spec.max, spec.step, false);
      if (spec.marks) renderMarks(spec.marks);
      var next = Array.isArray(before) ? [snap(before[0]), snap(before[1])] : snap(before);
      if (Array.isArray(next) && next[0] > next[1]) next[0] = next[1];
      write(next);
    }

    function applyStops(list) {
      var before = currentActual();
      stops = list;
      setBounds(0, list.length - 1, 1, true);
      if (range) {
        var low = nearestIndex(Array.isArray(before) ? before[0] : before);
        var high = nearestIndex(Array.isArray(before) ? before[1] : before);
        if (low > high) low = high;
        write([low, high]);
      } else {
        write(nearestIndex(before));
      }
      renderMarks(list.map(function (item, index) {
        return {
          value: index,
          label: item.label == null ? formatValue(item.value, { unit: unit, percent: percent, format: format }) : item.label
        };
      }));
    }

    function sourceFailed(error) {
      if (error && error.name === 'AbortError') return;
      el.setAttribute('data-lc-state', 'error');
      el.removeAttribute('aria-busy');
      setNote(sourceErrorText, 'error');
      if (typeof console !== 'undefined' && console.warn) console.warn('[lc] 滑块数据源请求失败', error);
    }

    function loadSource() {
      var source = datasource && typeof datasource.resolveDataSource === 'function'
        ? datasource.resolveDataSource(datasourceName)
        : null;
      if (!source) {
        setNote(sourceUnconfiguredText, 'notice');
        return;
      }
      var token = (sourceSeq += 1);
      if (controller && typeof controller.abort === 'function') controller.abort();
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      el.setAttribute('data-lc-state', 'loading');
      el.setAttribute('aria-busy', 'true');
      setNote(sourceLoadingText, 'loading');

      var context = { signal: controller ? controller.signal : undefined, limit: 1000 };
      var pending = null;
      try {
        if (sourceMode === 'stops') {
          if (typeof source.stops === 'function') pending = source.stops(context);
          else if (typeof source.search === 'function') pending = source.search('', context);
          else if (typeof source.load === 'function') pending = source.load(context);
        } else {
          if (typeof source.range === 'function') pending = source.range(context);
          else if (typeof source.search === 'function') pending = source.search('', context);
          else if (typeof source.load === 'function') pending = source.load(context);
        }
        if (pending == null) throw new Error('数据源未提供 range / stops / search / load');
      } catch (error) {
        sourceFailed(error);
        return;
      }

      Promise.resolve(pending).then(function (payload) {
        if (token !== sourceSeq) return;
        el.removeAttribute('aria-busy');
        if (sourceMode === 'stops') {
          var list = stopList(payload);
          if (!list.length) {
            el.setAttribute('data-lc-state', 'empty');
            setNote(sourceEmptyText, 'empty');
            return;
          }
          applyStops(list);
        } else {
          var spec = rangeSpec(payload);
          if (!spec) {
            el.setAttribute('data-lc-state', 'empty');
            setNote(sourceEmptyText, 'empty');
            return;
          }
          applyRange(spec);
        }
        el.setAttribute('data-lc-state', 'ready');
        setNote('', '');
        emitSource();
      }, function (error) {
        if (token !== sourceSeq) return;
        sourceFailed(error);
      });
    }

    sliders.forEach(function (input) { input.addEventListener('input', onRange); });
    numbers.forEach(function (input) {
      input.addEventListener('change', onNumber);
      input.addEventListener('input', onNumber);
    });

    var api = {
      value: currentActual,
      setValue: function (next) {
        var value = range ? (Array.isArray(next) ? next : [next, next]) : next;
        var internalValue = range
          ? [toInternal(value[0]), toInternal(value[1])]
          : toInternal(value);
        if (range && internalValue[0] > internalValue[1]) internalValue[0] = internalValue[1];
        write(internalValue);
        emit(internalValue);
      },
      setFormat: function (fn) {
        format = typeof fn === 'function' ? fn : null;
        show(currentInternal());
      },
      stops: function () {
        return stops ? stops.map(function (item) { return { value: item.value, label: item.label }; }) : null;
      },
      destroy: function () {
        sourceSeq += 1;
        if (controller && typeof controller.abort === 'function') controller.abort();
        sliders.forEach(function (input) { input.removeEventListener('input', onRange); });
        numbers.forEach(function (input) {
          input.removeEventListener('change', onNumber);
          input.removeEventListener('input', onNumber);
        });
      }
    };
    el.__lcSlider = api;
    if (datasourceName && el.getAttribute('data-lc-state') !== 'error') loadSource();
    return api;
  }

  var def = {
    type: SCHEMA.type,
    name: SCHEMA.name,
    version: SCHEMA.version,
    schema: SCHEMA,
    css: [
      '.lc-ui-slider { display: flex; flex-direction: column; gap: var(--lc-space-2); }',
      '.lc-ui-slider-label { margin: 0; font-size: var(--lc-text-xs, 12px); font-weight: 600; color: var(--lc-color-ink-2, var(--ink-2, #444)); }',
      '.lc-ui-slider-required { color: var(--lc-color-accent, var(--accent, #b45309)); }',
      '.lc-ui-slider-head { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-2-5); flex-wrap: wrap; }',
      '.lc-ui-slider-value { font-size: var(--lc-text-sm, 13px); font-variant-numeric: tabular-nums; color: var(--lc-color-accent, var(--accent, #3e6a56)); font-weight: 600; }',
      '.lc-ui-slider-inputs { display: flex; align-items: center; gap: 5px; }',
      '.lc-ui-slider-number { width: 68px; padding: 3px var(--lc-space-1-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-sm, 5px); background: var(--lc-color-surface, var(--surface, #fff)); color: var(--lc-color-ink, var(--ink, inherit)); font: inherit; font-size: var(--lc-text-xs, 12px); }',
      '.lc-ui-slider-dash { color: var(--lc-color-decor, #888); }',
      '.lc-ui-slider-track { position: relative; display: flex; align-items: center; min-height: 28px; }',
      '.lc-ui-slider-input { width: 100%; height: 28px; margin: 0; appearance: none; -webkit-appearance: none; background: transparent; }',
      '.lc-ui-slider-input::-webkit-slider-runnable-track { height: 4px; border-radius: var(--lc-radius-full); background: var(--lc-color-line, var(--line, #ddd)); }',
      '.lc-ui-slider-input::-moz-range-track { height: 4px; border-radius: var(--lc-radius-full); background: var(--lc-color-line, var(--line, #ddd)); }',
      '.lc-ui-slider-input::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 50%; border: 2px solid var(--lc-color-surface, #fff); background: var(--lc-color-accent, var(--accent, #3e6a56)); cursor: pointer; }',
      '.lc-ui-slider-input::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--lc-color-surface, #fff); background: var(--lc-color-accent, var(--accent, #3e6a56)); cursor: pointer; }',
      '.lc-ui-slider-input:focus-visible { outline: 2px solid var(--lc-color-accent-line, var(--accent-line, #999)); outline-offset: 3px; }',
      '.lc-ui-slider-track-range .lc-ui-slider-input { position: absolute; left: 0; top: 0; pointer-events: none; }',
      '.lc-ui-slider-track-range .lc-ui-slider-input::-webkit-slider-thumb { pointer-events: auto; }',
      '.lc-ui-slider-track-range .lc-ui-slider-input::-moz-range-thumb { pointer-events: auto; }',
      '.lc-ui-slider-track-range .lc-ui-slider-input-low { z-index: 2; }',
      '.lc-ui-slider-track-range .lc-ui-slider-input-high { z-index: 3; }',
      '.lc-ui-slider-marks { position: relative; height: 18px; margin-top: 2px; }',
      '.lc-ui-slider-marks[hidden] { display: none; }',
      '.lc-ui-slider-mark { position: absolute; transform: translateX(-50%); font-size: var(--lc-text-xs, 10.5px); color: var(--lc-color-muted-2, var(--muted-2, #888)); white-space: nowrap; }',
      '.lc-ui-slider-source-note { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-slider-source-note[hidden] { display: none; }',
      '.lc-ui-slider-source-note[data-kind="error"] { color: var(--lc-color-danger); }',
      '.lc-ui-slider-help { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-slider-error { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-danger); }',
      '.lc-ui-slider[data-lc-state="error"] .lc-ui-slider-track { outline: 1px dashed var(--lc-color-danger-line); outline-offset: 3px; border-radius: var(--lc-radius-full); }',
      '.lc-ui-slider[data-lc-state="loading"] { opacity: 0.7; }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeValue: normalizeValue,
      formatValue: formatValue,
      percentOf: percentOf
    }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = def;
  } else {
    dom.Components['ui-slider'] = def;
  }

  return def;
}));
