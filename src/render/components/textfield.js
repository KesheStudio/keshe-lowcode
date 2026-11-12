/* 渲染核心 · 内置组件 · 文本框
   同一组件靠 floating 属性切换「浮动标签」与「普通占位符」两种形态；
   两种形态都保留 label[for] 关联，占位符只作提示、不替代标签。
   错误、禁用、只读、前后缀图标、字数计数与省略状态都在本组件内闭环。 */
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

  var TYPES = { text: 1, email: 1, password: 1, tel: 1, url: 1, search: 1, date: 1, number: 1 };

  function normalizeType(value) {
    var type = String(value == null ? '' : value).toLowerCase();
    return TYPES[type] ? type : 'text';
  }

  function iconName(value) {
    var name = String(value == null ? '' : value).trim();
    return /^[a-z0-9][a-z0-9-]*$/i.test(name) ? name : '';
  }

  function countText(value, maxLength) {
    var length = String(value == null ? '' : value).length;
    if (!maxLength) return String(length);
    return length + ' / ' + maxLength;
  }

  var SCHEMA = {
    type: 'ui-textfield',
    name: '文本框',
    version: 1,
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:textfield-input', 'lc:textfield-change', 'lc:textfield-clear'],
    props: {
      label: { type: 'string', label: '标签', default: '' },
      name: { type: 'string', label: '字段名', default: '' },
      value: { type: 'string', label: '初始值', default: '' },
      placeholder: { type: 'string', label: '占位符', default: '' },
      floating: { type: 'boolean', label: '浮动标签', default: false },
      type: { type: 'enum', label: '输入类型', options: Object.keys(TYPES), default: 'text' },
      required: { type: 'boolean', label: '必填', default: false },
      disabled: { type: 'boolean', label: '禁用', default: false },
      readonly: { type: 'boolean', label: '只读', default: false },
      help: { type: 'string', label: '帮助文本', default: '' },
      error: { type: 'string', label: '错误文本', default: '' },
      maxLength: { type: 'number', label: '最大长度', default: 0 },
      showCount: { type: 'boolean', label: '显示字数', default: true },
      prefixIcon: { type: 'string', label: '前缀图标 id', default: '' },
      suffixIcon: { type: 'string', label: '后缀图标 id', default: '' },
      prefixText: { type: 'string', label: '前缀文本/单位', default: '' },
      suffixText: { type: 'string', label: '后缀文本/单位', default: '' },
      clearable: { type: 'boolean', label: '显示清除按钮', default: false },
      autocomplete: { type: 'string', label: '自动完成', default: 'off' },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    }
  };

  function render(block, ctx) {
    var id = kit.uid('lc-tf');
    var inputId = id + '-input';
    var helpId = id + '-help';
    var errorId = id + '-error';
    var countId = id + '-count';
    var label = kit.prop(block, 'label', '');
    var value = kit.prop(block, 'value', '');
    var placeholder = kit.prop(block, 'placeholder', '');
    var type = normalizeType(kit.prop(block, 'type', 'text'));
    var floating = kit.bool(kit.prop(block, 'floating', false), false);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var readonly = kit.bool(kit.prop(block, 'readonly', false), false);
    var required = kit.bool(kit.prop(block, 'required', false), false);
    var maxLength = kit.num(kit.prop(block, 'maxLength', 0), 0);
    var showCount = kit.bool(kit.prop(block, 'showCount', true), true) && maxLength > 0;
    var help = kit.prop(block, 'help', '');
    var error = kit.prop(block, 'error', '');
    var state = kit.stateOf(block, true);
    var prefixIcon = iconName(kit.prop(block, 'prefixIcon', ''));
    var suffixIcon = iconName(kit.prop(block, 'suffixIcon', ''));
    var prefixText = kit.prop(block, 'prefixText', '');
    var suffixText = kit.prop(block, 'suffixText', '');
    var clearable = kit.bool(kit.prop(block, 'clearable', false), false) &&
      !disabled && !readonly && state !== 'loading';
    var autocomplete = kit.prop(block, 'autocomplete', 'off');

    var describedBy = [];
    if (error && state === 'error') describedBy.push(errorId);
    else if (help) describedBy.push(helpId);
    if (showCount) describedBy.push(countId);

    var inputAttrs = {
      id: inputId,
      class: 'lc-ui-textfield-input',
      type: type,
      name: kit.prop(block, 'name', '') || inputId,
      value: value,
      placeholder: floating ? ' ' : (placeholder || ' '),
      autocomplete: autocomplete,
      'data-lc-textfield-input': 'true',
      'aria-invalid': state === 'error' ? 'true' : 'false'
    };
    if (describedBy.length) inputAttrs['aria-describedby'] = describedBy.join(' ');
    if (required) inputAttrs.required = 'required';
    if (maxLength > 0) inputAttrs.maxlength = String(maxLength);
    if (disabled || state === 'loading') inputAttrs.disabled = 'disabled';
    if (readonly) inputAttrs.readonly = 'readonly';

    var boxChildren = [];
    if (prefixIcon) boxChildren.push(kit.icon(prefixIcon, 'lc-ui-textfield-affix'));
    if (prefixText) boxChildren.push(h('span', { class: 'lc-ui-textfield-text' }, prefixText));
    boxChildren.push(h('input', inputAttrs));
    if (clearable) {
      boxChildren.push(h('button', {
        type: 'button',
        class: 'lc-ui-textfield-clear',
        'data-lc-textfield-clear': 'true',
        'aria-label': '清除输入',
        title: '清除输入',
        hidden: String(value == null ? '' : value) === '' ? 'hidden' : null
      }, [kit.icon('close', 'lc-icon-sm')]));
    }
    if (floating && label) {
      boxChildren.push(h('label', {
        class: 'lc-ui-textfield-float',
        for: inputId
      }, label));
    }
    if (state === 'loading') {
      boxChildren.push(h('span', { class: 'lc-ui-spinner lc-ui-textfield-spinner', 'aria-hidden': 'true' }));
    } else if (suffixIcon) {
      boxChildren.push(kit.icon(suffixIcon, 'lc-ui-textfield-affix'));
    }
    if (suffixText) boxChildren.push(h('span', { class: 'lc-ui-textfield-text' }, suffixText));

    var head = null;
    if (label && !floating) {
      head = h('label', { class: 'lc-ui-textfield-label', for: inputId }, [
        label,
        required ? h('span', { class: 'lc-ui-textfield-required', 'aria-hidden': 'true' }, ' *') : null
      ]);
    }

    var foot = [];
    if (error && state === 'error') {
      foot.push(h('p', { class: 'lc-ui-textfield-error', id: errorId, role: 'alert' }, error));
    } else if (help) {
      foot.push(h('p', { class: 'lc-ui-textfield-help', id: helpId }, help));
    }
    if (showCount) {
      foot.push(h('p', { class: 'lc-ui-textfield-count', id: countId }, countText(value, maxLength)));
    }

    return h('div', {
      class: 'lc-ui lc-ui-textfield',
      'data-lc-ui': 'ui-textfield',
      'data-lc-state': state,
      'data-floating': floating ? 'true' : 'false',
      'data-lc-textfield': 'true',
      'data-max-length': String(maxLength)
    }, [
      head,
      h('div', { class: 'lc-ui-textfield-box' }, boxChildren),
      foot.length ? h('div', { class: 'lc-ui-textfield-foot' }, foot) : null,
      raw(kit.jsonIsland({ maxLength: maxLength, showCount: showCount }))
    ]);
  }

  function enhance(el) {
    var input = el.querySelector('[data-lc-textfield-input]');
    if (!input) return null;
    var clearButton = el.querySelector('[data-lc-textfield-clear]');

    function current() {
      return String(input.value == null ? '' : input.value);
    }

    function syncCount() {
      var count = el.querySelector('.lc-ui-textfield-count');
      if (!count) return;
      var maxLength = kit.num(el.getAttribute('data-max-length'), 0);
      count.textContent = countText(current(), maxLength);
    }

    function syncClear() {
      if (!clearButton) return;
      if (current()) clearButton.removeAttribute('hidden');
      else clearButton.setAttribute('hidden', 'hidden');
    }

    function onInput() {
      syncCount();
      syncClear();
      kit.emit(el, 'lc:textfield-input', { value: current(), name: input.name });
    }

    function onChange() {
      kit.emit(el, 'lc:textfield-change', { value: current(), name: input.name });
    }

    function onClear() {
      input.value = '';
      syncCount();
      syncClear();
      kit.emit(el, 'lc:textfield-clear', { value: '', name: input.name });
      kit.emit(el, 'lc:textfield-input', { value: '', name: input.name });
      try { input.focus(); } catch (error) { /* noop */ }
    }

    input.addEventListener('input', onInput);
    input.addEventListener('change', onChange);
    if (clearButton) clearButton.addEventListener('click', onClear);
    syncCount();
    syncClear();

    var api = {
      focus: function () { try { input.focus(); } catch (error) { /* noop */ } },
      value: function () { return current(); },
      setValue: function (next) {
        input.value = next == null ? '' : String(next);
        syncCount();
        syncClear();
      },
      clear: onClear,
      destroy: function () {
        input.removeEventListener('input', onInput);
        input.removeEventListener('change', onChange);
        if (clearButton) clearButton.removeEventListener('click', onClear);
      }
    };
    el.__lcTextfield = api;
    return api;
  }

  var def = {
    type: SCHEMA.type,
    name: SCHEMA.name,
    version: SCHEMA.version,
    schema: SCHEMA,
    css: [
      '.lc-ui-textfield { display: flex; flex-direction: column; gap: var(--lc-space-1-5); }',
      '.lc-ui-textfield-label { font-size: var(--lc-text-xs, 12px); font-weight: 600; color: var(--lc-color-ink-2, var(--ink-2, #444)); }',
      '.lc-ui-textfield-required { color: var(--lc-color-accent, var(--accent, #b45309)); }',
      '.lc-ui-textfield-box { position: relative; display: flex; align-items: center; gap: var(--lc-space-2); min-height: 40px; padding: 0 11px; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, #fff)); transition: border-color 140ms ease, box-shadow 140ms ease; }',
      '.lc-ui-textfield-box:focus-within { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); box-shadow: 0 0 0 2px var(--lc-color-accent-soft, var(--accent-soft, rgba(62, 106, 86, 0.18))); }',
      '.lc-ui-textfield-input { flex: 1; min-width: 0; padding: var(--lc-space-2-5) 0; border: 0; outline: none; background: transparent; color: var(--lc-color-ink, var(--ink, inherit)); font: inherit; font-size: var(--lc-text-sm, 14px); }',
      '.lc-ui-textfield-input:disabled { cursor: not-allowed; color: var(--lc-color-disabled-ink, #888); -webkit-text-fill-color: var(--lc-color-disabled-ink, #888); }',
      '.lc-ui-textfield-input[readonly] { cursor: default; }',
      '.lc-ui-textfield-affix { width: 16px; height: 16px; flex: none; color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-textfield-text { flex: none; font-size: var(--lc-text-sm, 14px); color: var(--lc-color-muted, var(--muted, #777)); white-space: nowrap; }',
      '.lc-ui-textfield-clear { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--lc-color-muted, var(--muted, #777)); cursor: pointer; }',
      '.lc-ui-textfield-clear:hover { background: var(--lc-color-surface-2, var(--surface-2, #f1efe7)); color: var(--lc-color-ink, var(--ink, inherit)); }',
      '.lc-ui-textfield-clear[hidden] { display: none; }',
      '.lc-ui-textfield-spinner { width: 14px; height: 14px; flex: none; }',
      '.lc-ui-textfield[data-floating="true"] .lc-ui-textfield-box { padding-top: 7px; }',
      '.lc-ui-textfield-float { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); font-size: var(--lc-text-sm, 14px); color: var(--lc-color-muted, var(--muted, #777)); pointer-events: none; transition: top 140ms ease, font-size 140ms ease, transform 140ms ease, color 140ms ease; }',
      '.lc-ui-textfield-box:focus-within .lc-ui-textfield-float, .lc-ui-textfield-input:not(:placeholder-shown) ~ .lc-ui-textfield-float { top: 4px; transform: none; font-size: var(--lc-text-xs, 11px); color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-textfield[data-floating="true"] .lc-ui-textfield-input { padding: var(--lc-space-4) 0 var(--lc-space-1-5); }',
      '.lc-ui-textfield-foot { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--lc-space-2-5); min-height: 16px; }',
      '.lc-ui-textfield-help { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-textfield-error { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-danger); }',
      '.lc-ui-textfield-count { margin: 0 0 0 auto; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted-2, var(--muted-2, #888)); font-variant-numeric: tabular-nums; }',
      '.lc-ui-textfield[data-lc-state="error"] .lc-ui-textfield-box { border-color: var(--lc-color-danger-line); }',
      '.lc-ui-textfield[data-lc-state="loading"] { opacity: 0.75; }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeType: normalizeType,
      countText: countText,
      iconName: iconName
    }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = def;
  } else {
    dom.Components['ui-textfield'] = def;
  }

  return def;
}));
