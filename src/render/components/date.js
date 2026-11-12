/* 渲染核心 · 内置组件 · 日期
   单日期与日期范围两种形态；手动输入与日历面板并存。
   输入非法、超出范围、命中禁用日期都会给出人话提示；范围开始晚于结束会自动交换并标注 corrected。
   日期面板由 enhance 生成；没有 JS 时手动输入仍然可用。 */
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

  function pad(value) { return value < 10 ? '0' + value : String(value); }
  function formatDate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function parseDate(text) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text == null ? '' : text).trim());
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    var date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return formatDate(date);
  }
  function compare(a, b) {
    var left = parseDate(a);
    var right = parseDate(b);
    if (!left || !right) return 0;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  /* 范围纠正：两端都合法且开始晚于结束时交换，返回 corrected 标记；
     任一端非法时原样返回，交给 dateError 提示，不静默改成合法值。 */
  function correctRange(start, end) {
    var left = String(start == null ? '' : start).trim();
    var right = String(end == null ? '' : end).trim();
    if (parseDate(left) && parseDate(right) && compare(left, right) > 0) {
      return { start: right, end: left, corrected: true };
    }
    return { start: left, end: right, corrected: false };
  }
  function today() { return formatDate(new Date()); }
  function offset(days) {
    var date = new Date();
    date.setDate(date.getDate() + days);
    return formatDate(date);
  }
  function monthStart() {
    var date = new Date();
    return formatDate(new Date(date.getFullYear(), date.getMonth(), 1));
  }
  function resolveRange(source, mode) {
    var value = source == null ? '' : source;
    if (mode === 'range') {
      if (Array.isArray(value)) return { start: parseDate(value[0]) || String(value[0] || ''), end: parseDate(value[1]) || String(value[1] || '') };
      if (value && typeof value === 'object') return { start: parseDate(value.start) || String(value.start || ''), end: parseDate(value.end) || String(value.end || '') };
      return { start: '', end: '' };
    }
    return { start: parseDate(value) || String(value || ''), end: '' };
  }
  function dateError(value, opts) {
    var iso = parseDate(value);
    if (!iso) return '请按 YYYY-MM-DD 格式输入有效日期。';
    if (opts.min && compare(iso, opts.min) < 0) return '日期不能早于 ' + opts.min + '。';
    if (opts.max && compare(iso, opts.max) > 0) return '日期不能晚于 ' + opts.max + '。';
    if (Array.isArray(opts.disabledDates) && opts.disabledDates.indexOf(iso) !== -1) return '该日期已被禁用。';
    return '';
  }

  var SCHEMA = {
    type: 'ui-date',
    name: '日期',
    version: 1,
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:date-change', 'lc:date-open', 'lc:date-close'],
    props: {
      label: { type: 'string', label: '标签', default: '日期' },
      mode: { type: 'enum', label: '形态', options: ['single', 'range'], default: 'single' },
      value: { type: 'string|object|array', label: '值（单日期字符串或范围）', default: '' },
      name: { type: 'string', label: '字段名', default: '' },
      min: { type: 'string', label: '最小日期', default: '' },
      max: { type: 'string', label: '最大日期', default: '' },
      disabledDates: { type: 'array', label: '禁用日期（YYYY-MM-DD）', items: { type: 'string' }, default: [] },
      shortcuts: { type: 'array', label: '快捷项', items: { type: 'enum', options: ['today', 'month', 'last7'] }, default: ['today', 'month', 'last7'] },
      required: { type: 'boolean', label: '必填', default: false },
      disabled: { type: 'boolean', label: '禁用', default: false },
      readonly: { type: 'boolean', label: '只读', default: false },
      help: { type: 'string', label: '帮助文本', default: '' },
      error: { type: 'string', label: '错误文本', default: '' },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    }
  };

  function inputNode(id, name, value, placeholder, disabled, readonly, forceError) {
    var attrs = {
      type: 'text',
      class: 'lc-ui-date-input',
      id: id,
      value: value || '',
      placeholder: placeholder,
      autocomplete: 'off',
      'data-lc-date-input': 'true',
      'aria-invalid': forceError ? 'true' : 'false'
    };
    if (name) attrs.name = name;
    if (disabled) attrs.disabled = 'disabled';
    if (readonly) attrs.readonly = 'readonly';
    return h('input', attrs);
  }

  function render(block, ctx) {
    var id = kit.uid('lc-date');
    var mode = kit.prop(block, 'mode', 'single') === 'range' ? 'range' : 'single';
    var range = resolveRange(kit.prop(block, 'value', ''), mode);
    var min = parseDate(kit.prop(block, 'min', '')) || '';
    var max = parseDate(kit.prop(block, 'max', '')) || '';
    var disabledDates = kit.toArray(kit.prop(block, 'disabledDates', [])).map(function (item) { return parseDate(item) || ''; }).filter(Boolean);
    var label = kit.prop(block, 'label', '日期');
    var help = kit.prop(block, 'help', '');
    var error = kit.prop(block, 'error', '');
    var state = kit.stateOf(block, true);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var readonly = kit.bool(kit.prop(block, 'readonly', false), false);
    var shortcuts = kit.toArray(kit.prop(block, 'shortcuts', ['today', 'month', 'last7'])).filter(function (item) {
      return item === 'today' || item === 'month' || item === 'last7';
    });
    var errorId = id + '-error';
    var helpId = id + '-help';
    var described = error && state === 'error' ? errorId : (help ? helpId : '');
    var forceError = state === 'error';

    var inputs = [];
    if (mode === 'range') {
      inputs.push(inputNode(id + '-start', '', range.start, '开始日期 YYYY-MM-DD', disabled, readonly, forceError));
      inputs.push(h('span', { class: 'lc-ui-date-sep', 'aria-hidden': 'true' }, '→'));
      inputs.push(inputNode(id + '-end', '', range.end, '结束日期 YYYY-MM-DD', disabled, readonly, forceError));
    } else {
      inputs.push(inputNode(id, kit.prop(block, 'name', ''), range.start, 'YYYY-MM-DD', disabled, readonly, forceError));
    }
    if (described) {
      inputs.forEach(function (node) { if (node && node.attrs) node.attrs['aria-describedby'] = described; });
    }

    var toggle = h('button', {
      type: 'button',
      class: 'lc-ui-icon-btn lc-ui-date-toggle',
      'data-lc-date-toggle': 'true',
      'aria-expanded': 'false',
      'aria-label': '打开日历'
    }, [kit.icon('chevron-down')]);

    var shortcutNodes = shortcuts.map(function (key) {
      var text = { today: '今天', month: '本月', last7: '最近七天' }[key];
      return h('button', {
        type: 'button',
        class: 'lc-ui-date-shortcut',
        'data-lc-date-shortcut': key
      }, text);
    });

    var foot = [];
    if (error && state === 'error') foot.push(h('p', { class: 'lc-ui-date-error', id: errorId, role: 'alert' }, error));
    else if (help) foot.push(h('p', { class: 'lc-ui-date-help', id: helpId }, help));

    return h('div', {
      class: 'lc-ui lc-ui-date',
      'data-lc-ui': 'ui-date',
      'data-lc-state': state,
      'data-mode': mode,
      'data-lc-date': 'true',
      'data-min': min,
      'data-max': max,
      'data-disabled-dates': disabledDates.join(','),
      'data-required': kit.bool(kit.prop(block, 'required', false), false) ? 'true' : 'false'
    }, [
      label ? h('label', { class: 'lc-ui-date-label', for: mode === 'range' ? id + '-start' : id }, [
        label, kit.bool(kit.prop(block, 'required', false), false) ? h('span', { class: 'lc-ui-date-required', 'aria-hidden': 'true' }, ' *') : null
      ]) : null,
      h('div', { class: 'lc-ui-date-field' }, [h('div', { class: 'lc-ui-date-box' }, inputs), toggle]),
      shortcutNodes.length ? h('div', { class: 'lc-ui-date-shortcuts' }, shortcutNodes) : null,
      h('div', { class: 'lc-ui-date-pop', hidden: 'hidden', 'data-lc-date-pop': 'true' }),
      foot.length ? h('div', { class: 'lc-ui-date-foot' }, foot) : null,
      raw(kit.jsonIsland({ mode: mode, min: min, max: max, disabledDates: disabledDates }))
    ]);
  }

  function enhance(el) {
    var inputs = Array.prototype.slice.call(el.querySelectorAll('[data-lc-date-input]'));
    var toggle = el.querySelector('[data-lc-date-toggle]');
    var pop = el.querySelector('[data-lc-date-pop]');
    var errorNode = el.querySelector('.lc-ui-date-error');
    var helpNode = el.querySelector('.lc-ui-date-help');
    if (!inputs.length || !pop) return null;
    var mode = el.getAttribute('data-mode') === 'range' ? 'range' : 'single';
    var min = el.getAttribute('data-min') || '';
    var max = el.getAttribute('data-max') || '';
    var disabledDates = (el.getAttribute('data-disabled-dates') || '').split(',').filter(Boolean);
    var view = new Date();
    var pending = '';
    var open = false;

    function showMessage(text) {
      if (!errorNode) {
        errorNode = document.createElement('p');
        errorNode.className = 'lc-ui-date-error';
        errorNode.setAttribute('role', 'alert');
        var foot = el.querySelector('.lc-ui-date-foot');
        if (!foot) {
          foot = document.createElement('div');
          foot.className = 'lc-ui-date-foot';
          el.appendChild(foot);
        }
        foot.appendChild(errorNode);
      }
      errorNode.hidden = false;
      errorNode.textContent = text || '';
      if (helpNode) helpNode.hidden = !!text;
      inputs.forEach(function (input) {
        input.setAttribute('aria-invalid', text ? 'true' : 'false');
        if (text) input.setAttribute('aria-describedby', errorNode.id || (errorNode.id = 'lc-date-error'));
      });
    }

    function valid(value) {
      return dateError(value, { min: min, max: max, disabledDates: disabledDates });
    }

    function read() {
      var start = String(inputs[0].value || '').trim();
      var end = mode === 'range' && inputs[1] ? String(inputs[1].value || '').trim() : '';
      return { start: start, end: end };
    }

    function commit(corrected) {
      var value = read();
      var problem = valid(value.start);
      if (!problem && mode === 'range') problem = valid(value.end);
      if (problem) {
        showMessage(problem);
        kit.emit(el, 'lc:date-change', { value: value.start, start: value.start, end: value.end, ok: false });
        return false;
      }
      if (mode === 'range' && value.start && value.end) {
        var pair = correctRange(value.start, value.end);
        if (pair.corrected) {
          inputs[0].value = pair.start;
          inputs[1].value = pair.end;
          showMessage('');
          kit.emit(el, 'lc:date-change', { value: pair.start, start: pair.start, end: pair.end, ok: true, corrected: true });
          return true;
        }
      }
      showMessage('');
      kit.emit(el, 'lc:date-change', { value: value.start, start: value.start, end: value.end, ok: true, corrected: !!corrected });
      return true;
    }

    function buildCalendar() {
      var year = view.getFullYear();
      var month = view.getMonth();
      var first = new Date(year, month, 1);
      var startWeekday = first.getDay();
      var days = new Date(year, month + 1, 0).getDate();
      var todayText = formatDate(new Date());
      var selected = read();

      var head = h('div', { class: 'lc-ui-date-cal-head' }, [
        h('button', { type: 'button', class: 'lc-ui-icon-btn', 'data-lc-date-nav': 'prev', 'aria-label': '上个月' }, [kit.icon('chevron-right', 'lc-ui-flip')]),
        h('p', { class: 'lc-ui-date-cal-title' }, year + ' 年 ' + (month + 1) + ' 月'),
        h('button', { type: 'button', class: 'lc-ui-icon-btn', 'data-lc-date-nav': 'next', 'aria-label': '下个月' }, [kit.icon('chevron-right')])
      ]);

      var week = h('div', { class: 'lc-ui-date-cal-week' }, ['日', '一', '二', '三', '四', '五', '六'].map(function (label) {
        return h('span', { class: 'lc-ui-date-cal-weekday' }, label);
      }));

      var grid = [];
      for (var i = 0; i < startWeekday; i += 1) grid.push(h('span', { class: 'lc-ui-date-cal-empty' }));
      for (var day = 1; day <= days; day += 1) {
        var iso = formatDate(new Date(year, month, day));
        var isSelected = selected.start === iso || selected.end === iso;
        var isToday = todayText === iso;
        var isDisabled = (min && compare(iso, min) < 0) || (max && compare(iso, max) > 0) || disabledDates.indexOf(iso) !== -1;
        grid.push(h('button', {
          type: 'button',
          class: 'lc-ui-date-cal-day' + (isSelected ? ' is-selected' : '') + (isToday ? ' is-today' : ''),
          'data-lc-date-day': iso,
          disabled: isDisabled ? 'disabled' : null,
          'aria-pressed': isSelected ? 'true' : 'false'
        }, String(day)));
      }

      pop.innerHTML = '';
      /* head / week / grid 都是渲染虚拟节点（dom.h 的产物），必须先转成真实 DOM 才能挂载；
         直接 appendChild 会抛 "parameter 1 is not of type 'Node'"，导致日历面板渲染不出来。 */
      pop.appendChild(dom.toDom(head));
      pop.appendChild(dom.toDom(week));
      pop.appendChild(dom.toDom(h('div', { class: 'lc-ui-date-cal-grid' }, grid)));
    }

    function setOpen(next) {
      open = next;
      pop.hidden = !next;
      if (toggle) toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (next) {
        buildCalendar();
        kit.emit(el, 'lc:date-open', {});
      } else {
        kit.emit(el, 'lc:date-close', {});
      }
    }

    function pick(iso) {
      if (mode === 'range') {
        if (!pending || (pending && read().end)) {
          pending = iso;
          inputs[0].value = iso;
          inputs[1].value = '';
        } else {
          inputs[1].value = iso;
          pending = '';
          commit();
          setOpen(false);
          if (toggle) { try { toggle.focus(); } catch (error) { /* noop */ } }
          return;
        }
        buildCalendar();
        return;
      }
      inputs[0].value = iso;
      commit();
      setOpen(false);
      if (toggle) { try { toggle.focus(); } catch (error) { /* noop */ } }
    }

    function applyShortcut(key) {
      var value = '';
      if (key === 'today') value = today();
      else if (key === 'month') value = monthStart();
      else if (key === 'last7') value = offset(-6);
      if (mode === 'range') {
        inputs[0].value = key === 'today' ? value : value;
        inputs[1].value = today();
        commit();
      } else {
        inputs[0].value = value;
        commit();
      }
      if (pop.hidden === false) buildCalendar();
    }

    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var day = target.closest('[data-lc-date-day]');
      if (day) { pick(day.getAttribute('data-lc-date-day')); return; }
      var nav = target.closest('[data-lc-date-nav]');
      if (nav) {
        var delta = nav.getAttribute('data-lc-date-nav') === 'prev' ? -1 : 1;
        view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
        buildCalendar();
        return;
      }
      var shortcut = target.closest('[data-lc-date-shortcut]');
      if (shortcut) { applyShortcut(shortcut.getAttribute('data-lc-date-shortcut')); return; }
      if (toggle && toggle.contains(target)) { setOpen(pop.hidden); return; }
    }

    function onKeydown(event) {
      if (event.key === 'Escape' && !pop.hidden) {
        event.preventDefault();
        setOpen(false);
        if (toggle) { try { toggle.focus(); } catch (error) { /* noop */ } }
      }
    }

    function onBlur(event) {
      if (!event.target || !event.target.getAttribute('data-lc-date-input')) return;
      if (!event.relatedTarget || !el.contains(event.relatedTarget)) commit();
    }

    function onEnter(event) {
      if (event.key !== 'Enter' || !event.target || !event.target.getAttribute('data-lc-date-input')) return;
      event.preventDefault();
      commit();
    }

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('focusout', onBlur);
    el.addEventListener('keydown', onEnter);

    var api = {
      value: function () { var value = read(); return mode === 'range' ? value : value.start; },
      setValue: function (next) { var range = resolveRange(next, mode); inputs[0].value = range.start; if (inputs[1]) inputs[1].value = range.end; commit(); },
      open: function () { setOpen(true); },
      close: function () { setOpen(false); },
      destroy: function () {
        el.removeEventListener('click', onClick);
        el.removeEventListener('keydown', onKeydown);
        el.removeEventListener('focusout', onBlur);
        el.removeEventListener('keydown', onEnter);
      }
    };
    el.__lcDate = api;
    return api;
  }

  var def = {
    type: SCHEMA.type,
    name: SCHEMA.name,
    version: SCHEMA.version,
    schema: SCHEMA,
    css: [
      '.lc-ui-date { position: relative; display: flex; flex-direction: column; gap: var(--lc-space-1-5); }',
      '.lc-ui-date-label { font-size: var(--lc-text-xs, 12px); font-weight: 600; color: var(--lc-color-ink-2, var(--ink-2, #444)); }',
      '.lc-ui-date-required { color: var(--lc-color-accent, var(--accent, #b45309)); }',
      '.lc-ui-date-field { display: flex; align-items: stretch; gap: var(--lc-space-1-5); }',
      '.lc-ui-date-box { flex: 1; display: flex; align-items: center; gap: var(--lc-space-1-5); padding: 0 var(--lc-space-2-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, #fff)); }',
      '.lc-ui-date-box:focus-within { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); box-shadow: 0 0 0 2px var(--lc-color-accent-soft, var(--accent-soft, rgba(62, 106, 86, 0.18))); }',
      '.lc-ui-date-input { flex: 1; min-width: 0; padding: 9px 0; border: 0; outline: none; background: transparent; color: var(--lc-color-ink, var(--ink, inherit)); font: inherit; font-size: var(--lc-text-sm, 14px); }',
      '.lc-ui-date-sep { color: var(--lc-color-decor, #888); }',
      '.lc-ui-date-toggle { flex: none; width: 34px; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface-2, var(--surface-2, #f6f4ec)); }',
      '.lc-ui-date-shortcuts { display: flex; flex-wrap: wrap; gap: var(--lc-space-1-5); }',
      '.lc-ui-date-shortcut { padding: 2px 9px; border: 1px dashed var(--lc-color-line-strong, var(--line-strong, #bbb)); border-radius: var(--lc-radius-full); background: transparent; color: var(--lc-color-muted, var(--muted, #666)); font: inherit; font-size: var(--lc-text-xs, 11px); cursor: pointer; }',
      '.lc-ui-date-shortcut:hover { color: var(--lc-color-accent, var(--accent, #3e6a56)); border-color: var(--lc-color-accent-line, var(--accent-line, #999)); }',
      '.lc-ui-date-pop { position: absolute; z-index: 12; top: 100%; left: 0; margin-top: var(--lc-space-1-5); width: 264px; padding: var(--lc-space-2-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line-strong, var(--line-strong, #bbb)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, #fff)); box-shadow: var(--lc-shadow-md); }',
      '.lc-ui-date-pop[hidden] { display: none; }',
      '.lc-ui-date-cal-head { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-2); margin-bottom: var(--lc-space-1-5); }',
      '.lc-ui-date-cal-title { margin: 0; font-size: var(--lc-text-sm, 13px); font-weight: 600; color: var(--lc-color-ink, var(--ink, inherit)); }',
      '.lc-ui-date-cal-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 2px; }',
      '.lc-ui-date-cal-weekday { padding: var(--lc-space-1) 0; text-align: center; font-size: var(--lc-text-xs, 11px); color: var(--lc-color-muted-2, var(--muted-2, #888)); }',
      '.lc-ui-date-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }',
      '.lc-ui-date-cal-day, .lc-ui-date-cal-empty { min-height: 30px; padding: var(--lc-space-1) 0; border: 0; border-radius: var(--lc-radius-sm, 5px); background: transparent; color: var(--lc-color-ink-2, var(--ink-2, #444)); font: inherit; font-size: var(--lc-text-sm, 12px); }',
      '.lc-ui-date-cal-day { cursor: pointer; }',
      '.lc-ui-date-cal-day:hover:not(:disabled) { background: var(--lc-color-accent-soft, var(--accent-soft, #eef6f2)); }',
      '.lc-ui-date-cal-day.is-today { box-shadow: inset 0 0 0 1px var(--lc-color-accent-line, var(--accent-line, #999)); }',
      '.lc-ui-date-cal-day.is-selected { background: var(--lc-color-accent, var(--accent, #3e6a56)); color: var(--lc-color-on-accent, #fff); }',
      '.lc-ui-date-cal-day:disabled { cursor: not-allowed; opacity: 0.4; }',
      '.lc-ui-date-foot { display: flex; flex-direction: column; gap: 2px; }',
      '.lc-ui-date-help { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-date-error { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-danger); }',
      '.lc-ui-date[data-lc-state="error"] .lc-ui-date-box { border-color: var(--lc-color-danger-line); }',
      '.lc-ui-date[data-lc-state="loading"] { opacity: 0.75; }',
      '.lc-ui-date-box input:disabled { cursor: not-allowed; color: var(--lc-color-decor, #888); -webkit-text-fill-color: var(--lc-color-decor, #888); }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      parseDate: parseDate,
      formatDate: formatDate,
      compare: compare,
      correctRange: correctRange,
      today: today,
      offset: offset,
      monthStart: monthStart,
      dateError: dateError,
      resolveRange: resolveRange
    }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = def;
  } else {
    dom.Components['ui-date'] = def;
  }

  return def;
}));
