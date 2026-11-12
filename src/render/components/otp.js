/* 渲染核心 · 内置组件 · 多位验证码
   逐格输入、自动前进/后退、方向键、退格；粘贴按字符从当前格开始往后铺。
   规则：超出剩余位数的字符截断；不足位数的保留空格子、不自动补齐；
   非允许字符（含空格、换行、中文）过滤并提示。 */
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

  var MODES = { numeric: 1, alphanumeric: 1 };

  function normalizeMode(value) {
    var mode = String(value == null ? '' : value).toLowerCase();
    return MODES[mode] ? mode : 'numeric';
  }

  function normalizeLength(value) {
    return kit.clamp(kit.num(value, 6), 4, 8);
  }

  function sanitize(text, mode) {
    var source = String(text == null ? '' : text);
    return mode === 'alphanumeric' ? source.replace(/[^0-9a-zA-Z]/g, '') : source.replace(/[^0-9]/g, '');
  }

  /* 把任意文本拆成固定长度的字符数组：超出截断，不足补空字符串。 */
  function splitPaste(text, mode, length) {
    var chars = sanitize(text, mode).slice(0, length).split('');
    var cells = [];
    for (var i = 0; i < length; i += 1) cells.push(chars[i] || '');
    return cells;
  }

  /* 过滤结果带明细：removed 为被过滤掉的字符数（空格、换行、中文等）。 */
  function filterText(text, mode) {
    var source = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var clean = sanitize(source, mode);
    return { text: clean, removed: source.length - clean.length };
  }

  /* 粘贴计划：从 startIndex 开始逐格向后铺，返回新格子、焦点位置、截断与过滤数量。
     纯函数，便于自检覆盖「中间粘贴 / 长度不足 / 含空格换行 / 中文输入法」四种情况。 */
  function pastePlan(cells, text, startIndex, mode, length) {
    var list = Array.isArray(cells) ? cells.slice() : [];
    while (list.length < length) list.push('');
    list = list.slice(0, length);
    var start = kit.clamp(kit.num(startIndex, 0), 0, Math.max(0, length - 1));
    var info = filterText(text, mode);
    var capacity = Math.max(0, length - start);
    var chars = info.text.slice(0, capacity).split('');
    for (var i = 0; i < chars.length; i += 1) list[start + i] = chars[i];
    return {
      cells: list,
      startIndex: start,
      filled: chars.length,
      removed: info.removed,
      truncated: Math.max(0, info.text.length - capacity),
      focusIndex: Math.min(start + chars.length, length - 1)
    };
  }

  var SCHEMA = {
    type: 'ui-otp',
    name: '多位验证码',
    version: 1,
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:otp-change', 'lc:otp-complete', 'lc:otp-copy', 'lc:otp-reject'],
    props: {
      label: { type: 'string', label: '标签', default: '验证码' },
      length: { type: 'number', label: '位数（4–8）', default: 6 },
      mode: { type: 'enum', label: '字符模式', options: ['numeric', 'alphanumeric'], default: 'numeric' },
      value: { type: 'string', label: '初始值', default: '' },
      name: { type: 'string', label: '字段名', default: '' },
      disabled: { type: 'boolean', label: '禁用', default: false },
      readonly: { type: 'boolean', label: '只读', default: false },
      error: { type: 'string', label: '错误文本', default: '' },
      help: { type: 'string', label: '帮助文本', default: '' },
      copyable: { type: 'boolean', label: '显示整体复制', default: true },
      autofocus: { type: 'boolean', label: '自动聚焦首格', default: false },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    }
  };

  function render(block, ctx) {
    var id = kit.uid('lc-otp');
    var length = normalizeLength(kit.prop(block, 'length', 6));
    var mode = normalizeMode(kit.prop(block, 'mode', 'numeric'));
    var value = kit.prop(block, 'value', '');
    var chars = splitPaste(value, mode, length);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var readonly = kit.bool(kit.prop(block, 'readonly', false), false);
    var autofocus = kit.bool(kit.prop(block, 'autofocus', false), false);
    var copyable = kit.bool(kit.prop(block, 'copyable', true), true);
    var state = kit.stateOf(block, true);
    var error = kit.prop(block, 'error', '');
    var help = kit.prop(block, 'help', '');
    var label = kit.prop(block, 'label', '验证码');
    var helpId = id + '-help';
    var errorId = id + '-error';
    var noticeId = id + '-notice';
    var described = [];
    if (error && state === 'error') described.push(errorId);
    else if (help) described.push(helpId);
    described.push(noticeId);

    var cells = [];
    for (var i = 0; i < length; i += 1) {
      var attrs = {
        type: 'text',
        class: 'lc-ui-otp-cell',
        value: chars[i] || '',
        maxlength: '1',
        inputmode: mode === 'numeric' ? 'numeric' : 'text',
        pattern: mode === 'numeric' ? '[0-9]*' : '[0-9A-Za-z]*',
        autocomplete: i === 0 ? 'one-time-code' : 'off',
        'data-lc-otp-cell': String(i),
        'aria-label': '验证码第 ' + (i + 1) + ' 位'
      };
      if (i === 0 && autofocus) attrs.autofocus = 'autofocus';
      if (disabled || state === 'loading') attrs.disabled = 'disabled';
      if (readonly) attrs.readonly = 'readonly';
      if (state === 'error') attrs['aria-invalid'] = 'true';
      attrs['aria-describedby'] = described.join(' ');
      cells.push(h('input', attrs));
    }

    var foot = [];
    if (error && state === 'error') {
      foot.push(h('p', { class: 'lc-ui-otp-error', id: errorId, role: 'alert' }, error));
    } else if (help) {
      foot.push(h('p', { class: 'lc-ui-otp-help', id: helpId }, help));
    }
    foot.push(h('p', {
      class: 'lc-ui-otp-notice',
      id: noticeId,
      role: 'status',
      'aria-live': 'polite',
      'data-lc-otp-notice': 'true',
      hidden: 'hidden'
    }));
    if (copyable) {
      foot.push(h('button', {
        type: 'button',
        class: 'lc-ui-action lc-ui-otp-copy',
        'data-lc-otp-copy': 'true'
      }, [kit.icon('copy', 'lc-icon-sm'), '复制整体']));
    }

    return h('div', {
      class: 'lc-ui lc-ui-otp',
      'data-lc-ui': 'ui-otp',
      'data-lc-state': state,
      'data-mode': mode,
      'data-length': String(length),
      'data-lc-otp': 'true'
    }, [
      label ? h('p', { class: 'lc-ui-otp-label', id: id + '-label' }, [
        label,
        kit.bool(kit.prop(block, 'required', false), false) ? h('span', { class: 'lc-ui-otp-required', 'aria-hidden': 'true' }, ' *') : null
      ]) : null,
      h('div', {
        class: 'lc-ui-otp-group',
        role: 'group',
        'aria-labelledby': label ? id + '-label' : null,
        'aria-describedby': described.length ? described.join(' ') : null
      }, cells),
      foot.length ? h('div', { class: 'lc-ui-otp-foot' }, foot) : null,
      raw(kit.jsonIsland({ mode: mode, length: length, name: kit.prop(block, 'name', '') }))
    ]);
  }

  function enhance(el) {
    var cells = Array.prototype.slice.call(el.querySelectorAll('[data-lc-otp-cell]'));
    if (!cells.length) return null;
    var mode = normalizeMode(el.getAttribute('data-mode'));
    var length = cells.length;
    var copyButton = el.querySelector('[data-lc-otp-copy]');
    var notice = el.querySelector('[data-lc-otp-notice]');
    var isComplete = false;
    var composing = false;
    var skipNextInput = false;

    function readCells() {
      return cells.map(function (cell) { return String(cell.value || ''); });
    }

    function readValue() {
      return readCells().join('');
    }

    function notify(plan) {
      if (!notice) return;
      if (!plan || (!plan.removed && !plan.truncated)) {
        notice.hidden = true;
        notice.textContent = '';
        return;
      }
      var parts = [];
      if (plan.removed) parts.push('已忽略 ' + plan.removed + ' 个非允许字符');
      if (plan.truncated) parts.push('超出位数的 ' + plan.truncated + ' 个字符已截断');
      notice.textContent = parts.join('；') + '。';
      notice.hidden = false;
      kit.emit(el, 'lc:otp-reject', {
        removed: plan.removed,
        truncated: plan.truncated,
        mode: mode,
        length: length,
        value: readValue()
      });
    }

    function applyPlan(plan) {
      for (var i = 0; i < length; i += 1) cells[i].value = plan.cells[i] || '';
      var target = Math.min(Math.max(plan.focusIndex, 0), length - 1);
      try { cells[target].focus(); } catch (error) { /* noop */ }
      try { cells[target].select && cells[target].select(); } catch (error) { /* noop */ }
      emitChange();
      notify(plan);
    }

    function emitChange() {
      var value = readValue();
      var complete = value.length === length && cells.every(function (cell) { return !!cell.value; });
      if (complete !== isComplete) {
        isComplete = complete;
        kit.emit(el, complete ? 'lc:otp-complete' : 'lc:otp-change', { value: value, complete: complete, length: length });
        if (complete) return;
      }
      kit.emit(el, 'lc:otp-change', { value: value, complete: complete, length: length });
    }

    function fill(chars, focusIndex) {
      for (var i = 0; i < length; i += 1) cells[i].value = chars[i] || '';
      var target = Math.min(Math.max(focusIndex, 0), length - 1);
      try { cells[target].focus(); } catch (error) { /* noop */ }
      try { cells[target].select && cells[target].select(); } catch (error) { /* noop */ }
      emitChange();
    }

    function indexOf(cell) {
      return cells.indexOf(cell);
    }

    function handleCell(cell) {
      if (!cell || !cell.getAttribute('data-lc-otp-cell')) return;
      var index = indexOf(cell);
      if (index < 0) return;
      var value = String(cell.value == null ? '' : cell.value);
      if (!value) {
        cell.value = '';
        emitChange();
        return;
      }
      var plan = pastePlan(readCells(), value, index, mode, length);
      if (!plan.filled) {
        cell.value = '';
        emitChange();
        notify(plan);
        return;
      }
      applyPlan(plan);
    }

    function onInput(event) {
      /* 输入法组合期间不打断：等 compositionend 拿到最终文本再处理。 */
      if (composing) return;
      /* compositionend 之后浏览器可能再补一个 input，避免重复处理。 */
      if (skipNextInput) {
        skipNextInput = false;
        return;
      }
      handleCell(event.target);
    }

    function onCompositionStart() {
      composing = true;
    }

    function onCompositionEnd(event) {
      composing = false;
      skipNextInput = true;
      handleCell(event.target);
      /* 只吞掉组合结束后紧跟的那一次 input，之后的正常输入不受影响。 */
      setTimeout(function () { skipNextInput = false; }, 0);
    }

    function onKeydown(event) {
      var cell = event.target;
      if (!cell || !cell.getAttribute('data-lc-otp-cell')) return;
      var index = indexOf(cell);
      if (event.key === 'Backspace' && !cell.value) {
        if (index > 0) {
          cells[index - 1].value = '';
          try { cells[index - 1].focus(); } catch (error) { /* noop */ }
          emitChange();
        }
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        try { cells[index - 1].focus(); } catch (error) { /* noop */ }
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowRight' && index < length - 1) {
        try { cells[index + 1].focus(); } catch (error) { /* noop */ }
        event.preventDefault();
        return;
      }
      if (event.key === 'Home') {
        try { cells[0].focus(); } catch (error) { /* noop */ }
        event.preventDefault();
        return;
      }
      if (event.key === 'End') {
        try { cells[length - 1].focus(); } catch (error) { /* noop */ }
        event.preventDefault();
      }
    }

    function onPaste(event) {
      var cell = event.target;
      if (!cell || !cell.getAttribute('data-lc-otp-cell')) return;
      var data = null;
      try {
        data = (event.clipboardData || event.originalEvent && event.originalEvent.clipboardData || {}).getData('text');
      } catch (error) { data = ''; }
      var plan = pastePlan(readCells(), data, indexOf(cell), mode, length);
      if (!plan.filled && !plan.removed && !plan.truncated) return;
      /* 粘贴一律拦截，避免浏览器把整串塞进单格。 */
      event.preventDefault();
      if (!plan.filled) {
        notify(plan);
        return;
      }
      applyPlan(plan);
    }

    function onCopy() {
      var value = readValue();
      function done() { kit.emit(el, 'lc:otp-copy', { value: value, ok: true }); }
      function fail() { kit.emit(el, 'lc:otp-copy', { value: value, ok: false }); }
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done, fail);
          return;
        }
      } catch (error) { /* 回退 */ }
      try {
        var area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(area);
        ok ? done() : fail();
      } catch (error) { fail(); }
    }

    cells.forEach(function (cell) {
      cell.addEventListener('input', onInput);
      cell.addEventListener('keydown', onKeydown);
      cell.addEventListener('paste', onPaste);
      cell.addEventListener('compositionstart', onCompositionStart);
      cell.addEventListener('compositionend', onCompositionEnd);
    });
    if (copyButton) copyButton.addEventListener('click', onCopy);

    var api = {
      value: readValue,
      setValue: function (next) { fill(splitPaste(next, mode, length), length - 1); },
      focus: function () { try { cells[0].focus(); } catch (error) { /* noop */ } },
      destroy: function () {
        cells.forEach(function (cell) {
          cell.removeEventListener('input', onInput);
          cell.removeEventListener('keydown', onKeydown);
          cell.removeEventListener('paste', onPaste);
          cell.removeEventListener('compositionstart', onCompositionStart);
          cell.removeEventListener('compositionend', onCompositionEnd);
        });
        if (copyButton) copyButton.removeEventListener('click', onCopy);
      }
    };
    el.__lcOtp = api;
    return api;
  }

  var def = {
    type: SCHEMA.type,
    name: SCHEMA.name,
    version: SCHEMA.version,
    schema: SCHEMA,
    css: [
      '.lc-ui-otp { display: flex; flex-direction: column; gap: var(--lc-space-2); }',
      '.lc-ui-otp-label { margin: 0; font-size: var(--lc-text-xs, 12px); font-weight: 600; color: var(--lc-color-ink-2, var(--ink-2, #444)); }',
      '.lc-ui-otp-required { color: var(--lc-color-accent, var(--accent, #b45309)); }',
      '.lc-ui-otp-group { display: flex; flex-wrap: wrap; gap: var(--lc-space-2); }',
      '.lc-ui-otp-cell { width: 40px; height: 44px; padding: 0; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, #fff)); color: var(--lc-color-ink, var(--ink, inherit)); font-family: var(--lc-font-mono); font-size: var(--lc-text-lg, 18px); text-align: center; caret-color: var(--lc-color-accent, var(--accent, #3e6a56)); outline: none; }',
      '.lc-ui-otp-cell:focus { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); box-shadow: 0 0 0 2px var(--lc-color-accent-soft, var(--accent-soft, rgba(62, 106, 86, 0.18))); }',
      '.lc-ui-otp-cell:disabled { cursor: not-allowed; -webkit-text-fill-color: var(--lc-color-decor, #888); }',
      '.lc-ui-otp-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-2-5); flex-wrap: wrap; }',
      '.lc-ui-otp-help { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-otp-error { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-danger); }',
      '.lc-ui-otp-notice { margin: 0; flex-basis: 100%; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-warn, #a15c00); }',
      '.lc-ui-otp-notice[hidden] { display: none; }',
      '.lc-ui-otp-copy { margin-left: auto; padding: 3px var(--lc-space-2-5); }',
      '.lc-ui-otp[data-lc-state="error"] .lc-ui-otp-cell { border-color: var(--lc-color-danger-line); }',
      '.lc-ui-otp[data-lc-state="loading"] { opacity: 0.75; }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeMode: normalizeMode,
      normalizeLength: normalizeLength,
      sanitize: sanitize,
      splitPaste: splitPaste,
      filterText: filterText,
      pastePlan: pastePlan
    }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = def;
  } else {
    dom.Components['ui-otp'] = def;
  }

  return def;
}));
