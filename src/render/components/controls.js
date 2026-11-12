/* 渲染核心 · 内置组件 · 常用表单控件
   下拉选择、多选、单选组、复选组、开关、数字、多行文本、标签输入、级联选择、评分。
   所有控件共用同一套字段外壳（标签、帮助、错误提示位置与状态标记），
   统一通过 lc:field-change 事件对外通信，并通过 data-lc-field 暴露当前值与校验结果。
   不依赖第三方库，键盘交互尽量交给原生控件。 */
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

  function optionsOf(block) {
    return kit.toArray(kit.prop(block, 'options', [])).map(function (item) {
      if (item == null) return null;
      if (typeof item === 'string' || typeof item === 'number') {
        return { value: String(item), label: String(item), disabled: false };
      }
      if (typeof item !== 'object') return null;
      var value = item.value != null ? item.value : item.id;
      if (value == null) return null;
      return {
        value: String(value),
        label: String(item.label != null ? item.label : value),
        disabled: !!item.disabled
      };
    }).filter(Boolean);
  }

  function valuesOf(value) {
    return kit.toArray(value).map(function (item) {
      if (item && typeof item === 'object') return String(item.value == null ? item.label : item.value);
      return String(item);
    }).filter(function (item) { return !!item; });
  }

  function numError(value, props) {
    var opts = props || {};
    if (value === '' || value == null) return opts.required ? '此项为必填。' : '';
    var number = Number(value);
    if (!isFinite(number)) return '请输入有效数字。';
    if (opts.min != null && number < opts.min) return '不能小于 ' + opts.min + '。';
    if (opts.max != null && number > opts.max) return '不能大于 ' + opts.max + '。';
    return '';
  }

  function textError(value, props) {
    var opts = props || {};
    var text = String(value == null ? '' : value);
    if (opts.required && !text.trim()) return '此项为必填。';
    if (opts.minLength && text.length < opts.minLength) return '至少需要 ' + opts.minLength + ' 个字符。';
    if (opts.maxLength && text.length > opts.maxLength) return '最多允许 ' + opts.maxLength + ' 个字符。';
    return '';
  }

  function choiceError(selected, props) {
    var opts = props || {};
    var list = valuesOf(selected);
    if (opts.required && !list.length) return '请至少选择一项。';
    if (opts.minSelected && list.length < opts.minSelected) return '至少选择 ' + opts.minSelected + ' 项。';
    if (opts.maxSelected && list.length > opts.maxSelected) return '最多选择 ' + opts.maxSelected + ' 项。';
    return '';
  }

  function tagsError(tags, props) {
    var opts = props || {};
    var list = valuesOf(tags);
    if (opts.required && !list.length) return '请至少添加一个标签。';
    if (opts.minTags && list.length < opts.minTags) return '至少添加 ' + opts.minTags + ' 个标签。';
    if (opts.maxTags && list.length > opts.maxTags) return '最多添加 ' + opts.maxTags + ' 个标签。';
    return '';
  }

  function fieldShell(block, opts) {
    var state = opts.state || kit.stateOf(block, opts.hasData !== false);
    var error = opts.error != null ? opts.error : kit.prop(block, 'error', '');
    var help = kit.prop(block, 'help', '');
    var required = kit.bool(kit.prop(block, 'required', false), false);
    var id = opts.id;
    var showError = !!error && state === 'error';
    var described = showError ? id + '-error' : (help ? id + '-help' : '');
    var children = [];
    if (opts.label !== false) {
      /* 单选组、复选组、开关、级联、评分没有单一输入控件，标签不能指向不存在的 id，
         所以这些类型传 labelFor:false，渲染成不带 for 的文本标签。 */
      var labelTag = opts.labelFor === false ? 'div' : 'label';
      var labelAttrs = { class: 'lc-ui-field-label' };
      if (labelTag === 'label') labelAttrs.for = opts.labelFor || (id + '-input');
      children.push(h(labelTag, labelAttrs, [
        opts.label != null ? opts.label : kit.prop(block, 'label', ''),
        required ? h('span', { class: 'lc-ui-field-required', 'aria-hidden': 'true' }, ' *') : null
      ]));
    }
    children.push(opts.control);
    var foot = [];
    if (showError) foot.push(h('p', { class: 'lc-ui-field-error', id: id + '-error', role: 'alert' }, error));
    else if (help) foot.push(h('p', { class: 'lc-ui-field-help', id: id + '-help' }, help));
    if (foot.length) children.push(h('div', { class: 'lc-ui-field-foot' }, foot));
    var island = { required: required, name: kit.prop(block, 'name', '') };
    Object.keys(opts.data || {}).forEach(function (key) { island[key] = opts.data[key]; });
    children.push(raw(kit.jsonIsland(island)));
    return h('div', {
      class: 'lc-ui lc-ui-field lc-ui-' + opts.type,
      'data-lc-ui': opts.type,
      'data-lc-state': state,
      'data-lc-field': opts.type,
      'data-describedby': described || ''
    }, children);
  }

  /* ---------- 下拉选择 ---------- */
  var selectSchema = {
    type: 'ui-select',
    name: '下拉选择',
    version: 1,
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:field-change'],
    props: {
      label: { type: 'string', default: '选择' }, name: { type: 'string', default: '' },
      options: { type: 'array', items: { type: 'object', props: { label: { type: 'string' }, value: { type: 'string' }, disabled: { type: 'boolean' } } }, default: [] },
      value: { type: 'string', default: '' }, placeholder: { type: 'string', default: '请选择' },
      required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false },
      help: { type: 'string', default: '' }, error: { type: 'string', default: '' },
      state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    }
  };

  function renderSelect(block) {
    var id = kit.uid('lc-select');
    var options = optionsOf(block);
    var value = kit.prop(block, 'value', '');
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var placeholder = kit.prop(block, 'placeholder', '请选择');
    var attrs = { id: id + '-input', class: 'lc-ui-field-input', 'data-lc-select': 'true', 'data-name': kit.prop(block, 'name', '') };
    if (disabled) attrs.disabled = 'disabled';
    var children = [h('option', { value: '' }, placeholder)];
    options.forEach(function (option) {
      children.push(h('option', { value: option.value, disabled: option.disabled ? 'disabled' : null, selected: option.value === String(value) ? 'selected' : null }, option.label));
    });
    return fieldShell(block, {
      type: 'ui-select', id: id, hasData: options.length > 0,
      data: { options: options.map(function (option) { return { label: option.label, value: option.value, disabled: option.disabled }; }) },
      control: h('div', { class: 'lc-ui-field-control' }, [h('select', attrs, children),
        options.length ? null : h('p', { class: 'lc-ui-field-empty', role: 'status' }, '暂无可选项')]
      )
    });
  }

  function enhanceSelect(el) {
    var select = el.querySelector('[data-lc-select]');
    if (!select) return null;
    var config = kit.readJsonScript(el) || {};
    function sync() {
      var value = select.value;
      var problem = choiceError(value ? [value] : [], { required: !!config.required });
      kit.emit(el, 'lc:field-change', { type: 'select', name: config.name || select.getAttribute('data-name') || '', value: value, valid: !problem, error: problem });
    }
    select.addEventListener('change', sync);
    return { value: function () { return select.value; }, setValue: function (value) { select.value = value; sync(); }, destroy: function () { select.removeEventListener('change', sync); } };
  }

  /* ---------- 多选 / 单选组 / 复选组 ---------- */
  function renderChoices(block, single, overrideType) {
    var type = overrideType || (single ? 'ui-radio-group' : 'ui-checkbox-group');
    var id = kit.uid(single ? 'lc-radio' : 'lc-checks');
    var options = optionsOf(block);
    var selected = valuesOf(kit.prop(block, 'value', single ? '' : []));
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var name = kit.prop(block, 'name', '') || id;
    var items = options.map(function (option) {
      var checked = selected.indexOf(option.value) !== -1;
      var attrs = {
        type: single ? 'radio' : 'checkbox',
        name: name,
        value: option.value,
        'data-lc-choice': 'true',
        class: 'lc-ui-field-choice-input'
      };
      if (checked) attrs.checked = 'checked';
      if (disabled || option.disabled) attrs.disabled = 'disabled';
      return h('label', { class: 'lc-ui-field-choice' }, [h('input', attrs), h('span', null, option.label)]);
    });
    return fieldShell(block, {
      type: type, id: id, label: kit.prop(block, 'label', single ? '单选' : '多选'), labelFor: false,
      hasData: options.length > 0,
      data: {
        single: single,
        options: options.map(function (option) { return { label: option.label, value: option.value, disabled: option.disabled }; }),
        minSelected: kit.num(kit.prop(block, 'minSelected', 0), 0),
        maxSelected: kit.num(kit.prop(block, 'maxSelected', 0), 0)
      },
      control: h('div', { class: 'lc-ui-field-control', role: single ? 'radiogroup' : 'group', 'data-lc-choices': single ? 'single' : 'multiple' },
        items.length ? [h('div', { class: 'lc-ui-choices' + (single ? ' is-single' : '') }, items)] : h('p', { class: 'lc-ui-field-empty', role: 'status' }, '暂无可选项'))
    });
  }

  function enhanceChoices(el) {
    var inputs = Array.prototype.slice.call(el.querySelectorAll('[data-lc-choice]'));
    if (!inputs.length) return null;
    var config = kit.readJsonScript(el) || {};
    var single = el.querySelector('[data-lc-choices]').getAttribute('data-lc-choices') === 'single';
    function values() {
      return inputs.filter(function (input) { return input.checked; }).map(function (input) { return input.value; });
    }
    function sync() {
      var value = single ? (values()[0] || '') : values();
      var problem = choiceError(single ? (value ? [value] : []) : value, {
        required: !!config.required,
        minSelected: config.minSelected,
        maxSelected: config.maxSelected
      });
      kit.emit(el, 'lc:field-change', { type: single ? 'radio' : 'checkbox', name: inputs[0].name, value: value, valid: !problem, error: problem });
    }
    inputs.forEach(function (input) { input.addEventListener('change', sync); });
    return {
      value: function () { return single ? (values()[0] || '') : values(); },
      setValue: function (value) {
        var wanted = valuesOf(single ? [value] : value);
        inputs.forEach(function (input) { input.checked = wanted.indexOf(input.value) !== -1; });
      },
      destroy: function () { inputs.forEach(function (input) { input.removeEventListener('change', sync); }); }
    };
  }

  /* ---------- 开关 ---------- */
  var switchSchema = {
    type: 'ui-switch', name: '开关', version: 1,
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:field-change'],
    props: {
      label: { type: 'string', default: '开关' }, name: { type: 'string', default: '' },
      value: { type: 'boolean', default: false }, required: { type: 'boolean', default: false },
      disabled: { type: 'boolean', default: false }, onLabel: { type: 'string', default: '开' },
      offLabel: { type: 'string', default: '关' }, help: { type: 'string', default: '' },
      error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    }
  };

  function renderSwitch(block) {
    var id = kit.uid('lc-switch');
    var value = kit.bool(kit.prop(block, 'value', false), false);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var onLabel = kit.prop(block, 'onLabel', '开');
    var offLabel = kit.prop(block, 'offLabel', '关');
    var attrs = {
      type: 'button', role: 'switch', class: 'lc-ui-switch-btn',
      'data-lc-switch-btn': 'true', 'aria-checked': value ? 'true' : 'false',
      'data-on-label': onLabel, 'data-off-label': offLabel, 'data-name': kit.prop(block, 'name', '')
    };
    if (disabled) attrs.disabled = 'disabled';
    return fieldShell(block, {
      type: 'ui-switch', id: id, labelFor: false,
      control: h('div', { class: 'lc-ui-field-control lc-ui-switch-control' }, [
        h('button', attrs, [h('span', { class: 'lc-ui-switch-track', 'aria-hidden': 'true' }, [h('span', { class: 'lc-ui-switch-thumb' })])]),
        h('span', { class: 'lc-ui-switch-text', 'data-lc-switch-text': 'true' }, value ? onLabel : offLabel)
      ])
    });
  }

  function enhanceSwitch(el) {
    var button = el.querySelector('[data-lc-switch-btn]');
    var text = el.querySelector('[data-lc-switch-text]');
    if (!button) return null;
    function sync(force) {
      var value = force == null ? button.getAttribute('aria-checked') !== 'true' : !!force;
      button.setAttribute('aria-checked', value ? 'true' : 'false');
      if (text) text.textContent = value ? (button.getAttribute('data-on-label') || '开') : (button.getAttribute('data-off-label') || '关');
      kit.emit(el, 'lc:field-change', { type: 'switch', name: button.getAttribute('data-name') || '', value: value, valid: true, error: '' });
    }
    button.addEventListener('click', function () { sync(); });
    return {
      value: function () { return button.getAttribute('aria-checked') === 'true'; },
      setValue: function (value) { sync(!!value); },
      destroy: function () { }
    };
  }

  /* ---------- 数字 ---------- */
  function renderNumber(block) {
    var id = kit.uid('lc-num');
    var value = kit.prop(block, 'value', '');
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var min = kit.prop(block, 'min', null);
    var max = kit.prop(block, 'max', null);
    var step = kit.prop(block, 'step', 1);
    var unit = kit.prop(block, 'unit', '');
    var attrs = {
      id: id + '-input', type: 'number', class: 'lc-ui-field-input',
      value: value == null ? '' : String(value), 'data-lc-number': 'true',
      'data-min': min == null ? '' : String(min), 'data-max': max == null ? '' : String(max),
      'data-step': step == null ? '' : String(step), 'data-name': kit.prop(block, 'name', '')
    };
    if (min != null) attrs.min = String(min);
    if (max != null) attrs.max = String(max);
    if (step != null) attrs.step = String(step);
    if (disabled) attrs.disabled = 'disabled';
    return fieldShell(block, {
      type: 'ui-number', id: id,
      control: h('div', { class: 'lc-ui-field-control' }, [
        h('div', { class: 'lc-ui-number-box' }, [h('input', attrs), unit ? h('span', { class: 'lc-ui-number-unit' }, unit) : null])
      ])
    });
  }

  function enhanceNumber(el) {
    var input = el.querySelector('[data-lc-number]');
    if (!input) return null;
    var config = kit.readJsonScript(el) || {};
    function props() {
      return {
        required: !!config.required,
        min: input.getAttribute('data-min') === '' ? null : Number(input.getAttribute('data-min')),
        max: input.getAttribute('data-max') === '' ? null : Number(input.getAttribute('data-max'))
      };
    }
    function sync() {
      var problem = numError(input.value, props());
      kit.emit(el, 'lc:field-change', { type: 'number', name: input.getAttribute('data-name') || '', value: input.value, valid: !problem, error: problem });
    }
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    return {
      value: function () { return input.value; },
      setValue: function (value) { input.value = value; sync(); },
      destroy: function () { input.removeEventListener('input', sync); input.removeEventListener('change', sync); }
    };
  }

  /* ---------- 多行文本 ---------- */
  function renderTextarea(block) {
    var id = kit.uid('lc-ta');
    var value = kit.prop(block, 'value', '');
    var maxLength = kit.num(kit.prop(block, 'maxLength', 0), 0);
    var rows = kit.num(kit.prop(block, 'rows', 4), 4);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var readonly = kit.bool(kit.prop(block, 'readonly', false), false);
    var attrs = {
      id: id + '-input', class: 'lc-ui-field-input lc-ui-field-textarea', rows: String(rows),
      placeholder: kit.prop(block, 'placeholder', ''), 'data-lc-textarea': 'true',
      'data-name': kit.prop(block, 'name', ''), 'data-max-length': String(maxLength)
    };
    if (disabled) attrs.disabled = 'disabled';
    if (readonly) attrs.readonly = 'readonly';
    if (maxLength > 0) attrs.maxlength = String(maxLength);
    return fieldShell(block, {
      type: 'ui-textarea', id: id,
      data: { minLength: kit.num(kit.prop(block, 'minLength', 0), 0), maxLength: maxLength, rows: rows },
      control: h('div', { class: 'lc-ui-field-control' }, [
        h('textarea', attrs, value == null ? '' : String(value)),
        maxLength > 0 ? h('p', { class: 'lc-ui-field-count', 'data-lc-textarea-count': 'true' }, String(value || '').length + ' / ' + maxLength) : null
      ])
    });
  }

  function enhanceTextarea(el) {
    var input = el.querySelector('[data-lc-textarea]');
    var count = el.querySelector('[data-lc-textarea-count]');
    if (!input) return null;
    var config = kit.readJsonScript(el) || {};
    function sync() {
      if (count) count.textContent = String(input.value || '').length + ' / ' + input.getAttribute('data-max-length');
      var problem = textError(input.value, {
        required: !!config.required,
        minLength: kit.num(config.minLength, 0),
        maxLength: Number(input.getAttribute('data-max-length')) || null
      });
      kit.emit(el, 'lc:field-change', { type: 'textarea', name: input.getAttribute('data-name') || '', value: input.value, valid: !problem, error: problem });
    }
    input.addEventListener('input', sync);
    return {
      value: function () { return input.value; },
      setValue: function (value) { input.value = value; sync(); },
      destroy: function () { input.removeEventListener('input', sync); }
    };
  }

  /* ---------- 标签输入 ---------- */
  function renderTags(block) {
    var id = kit.uid('lc-tags');
    var value = valuesOf(kit.prop(block, 'value', []));
    var placeholder = kit.prop(block, 'placeholder', '输入后回车添加');
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var maxTags = kit.num(kit.prop(block, 'maxTags', 0), 0);
    var chips = value.map(function (item) {
      return h('span', { class: 'lc-ui-tags-chip' }, [
        h('span', null, item),
        h('button', { type: 'button', class: 'lc-ui-tags-remove', 'data-lc-tag-remove': item, 'aria-label': '移除 ' + item }, '×')
      ]);
    });
    return fieldShell(block, {
      type: 'ui-tags', id: id, label: kit.prop(block, 'label', '标签'),
      data: {
        maxTags: maxTags,
        minTags: kit.num(kit.prop(block, 'minTags', 0), 0),
        value: value
      },
      control: h('div', { class: 'lc-ui-field-control', 'data-lc-tags': 'true', 'data-max-tags': String(maxTags) }, [
        h('div', { class: 'lc-ui-tags-box' }, [
          h('div', { class: 'lc-ui-tags-list', 'data-lc-tags-list': 'true' }, chips),
          h('input', {
            id: id + '-input', type: 'text', class: 'lc-ui-tags-input', placeholder: placeholder,
            'data-lc-tag-input': 'true', 'aria-label': '添加标签', disabled: disabled ? 'disabled' : null
          })
        ])
      ])
    });
  }

  function enhanceTags(el) {
    var input = el.querySelector('[data-lc-tag-input]');
    var list = el.querySelector('[data-lc-tags-list]');
    if (!input || !list) return null;
    var config = kit.readJsonScript(el) || {};
    var maxTags = kit.num(el.querySelector('[data-lc-tags]').getAttribute('data-max-tags'), 0);
    function tags() {
      return Array.prototype.slice.call(list.querySelectorAll('.lc-ui-tags-chip')).map(function (chip) {
        var text = chip.querySelector('span');
        return text ? text.textContent : '';
      }).filter(Boolean);
    }
    function renderChips() {
      var values = tags();
      list.innerHTML = '';
      values.forEach(function (value) {
        var chip = document.createElement('span');
        chip.className = 'lc-ui-tags-chip';
        var text = document.createElement('span');
        text.textContent = value;
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'lc-ui-tags-remove';
        remove.setAttribute('data-lc-tag-remove', value);
        remove.setAttribute('aria-label', '移除 ' + value);
        remove.textContent = '×';
        chip.appendChild(text);
        chip.appendChild(remove);
        list.appendChild(chip);
      });
    }
    function sync() {
      var values = tags();
      var problem = tagsError(values, {
        required: !!config.required,
        minTags: kit.num(config.minTags, 0),
        maxTags: maxTags
      });
      kit.emit(el, 'lc:field-change', { type: 'tags', value: values, valid: !problem, error: problem });
    }
    function add() {
      var rawValue = String(input.value || '').trim();
      if (!rawValue) return;
      var values = tags();
      if (maxTags && values.length >= maxTags) {
        kit.emit(el, 'lc:field-change', { type: 'tags', value: values, valid: false, error: '最多添加 ' + maxTags + ' 个标签。' });
        input.value = '';
        return;
      }
      if (values.indexOf(rawValue) === -1) values.push(rawValue);
      renderChips();
      input.value = '';
      sync();
    }
    function onKeydown(event) {
      if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); }
      else if (event.key === 'Backspace' && !input.value) {
        var chips = Array.prototype.slice.call(list.querySelectorAll('.lc-ui-tags-chip'));
        if (chips.length) {
          list.removeChild(chips[chips.length - 1]);
          sync();
        }
      }
    }
    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var remove = target.closest('[data-lc-tag-remove]');
      if (!remove) return;
      var value = remove.getAttribute('data-lc-tag-remove');
      var chips = Array.prototype.slice.call(list.querySelectorAll('.lc-ui-tags-chip')).filter(function (chip) {
        var text = chip.querySelector('span');
        return text && text.textContent === value;
      });
      if (chips[0]) list.removeChild(chips[0]);
      sync();
    }
    input.addEventListener('keydown', onKeydown);
    el.addEventListener('click', onClick);
    renderChips();
    return {
      value: tags,
      setValue: function (next) {
        list.innerHTML = '';
        valuesOf(next).forEach(function (value) {
          var chip = document.createElement('span');
          chip.className = 'lc-ui-tags-chip';
          var text = document.createElement('span');
          text.textContent = value;
          chip.appendChild(text);
          list.appendChild(chip);
        });
        renderChips();
        sync();
      },
      destroy: function () { input.removeEventListener('keydown', onKeydown); el.removeEventListener('click', onClick); }
    };
  }

  /* ---------- 级联选择 ---------- */
  function cascadeLevels(options, value, levels) {
    var list = options.slice();
    levels = levels || [];
    var current = list;
    var depth = 0;
    while (current && current.length && depth <= value.length) {
      var selected = value[depth];
      var match = current.filter(function (item) { return item.value === selected; })[0];
      levels.push({ options: current, value: selected || '' });
      if (!match || !match.children || !match.children.length) break;
      current = match.children;
      depth += 1;
    }
    if (!levels.length) levels.push({ options: list, value: '' });
    return levels;
  }

  function normalizeCascade(list) {
    return kit.toArray(list).map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var value = item.value != null ? item.value : item.id;
      if (value == null) return null;
      return {
        value: String(value),
        label: String(item.label != null ? item.label : value),
        children: normalizeCascade(item.children)
      };
    }).filter(Boolean);
  }

  function renderCascader(block) {
    var id = kit.uid('lc-cascade');
    var options = normalizeCascade(kit.prop(block, 'options', []));
    var value = valuesOf(kit.prop(block, 'value', []));
    var levels = cascadeLevels(options, value, []);
    var placeholder = kit.prop(block, 'placeholder', '请选择');
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var selects = levels.map(function (level, index) {
      var attrs = {
        class: 'lc-ui-field-input lc-ui-cascade-select', 'data-lc-cascade-select': String(index),
        'data-level': String(index), 'aria-label': '第 ' + (index + 1) + ' 级'
      };
      if (disabled) attrs.disabled = 'disabled';
      var children = [h('option', { value: '' }, placeholder)];
      level.options.forEach(function (option) {
        children.push(h('option', { value: option.value, selected: option.value === level.value ? 'selected' : null }, option.label));
      });
      return h('select', attrs, children);
    });
    return fieldShell(block, {
      type: 'ui-cascader', id: id, label: kit.prop(block, 'label', '级联选择'), labelFor: false,
      hasData: options.length > 0,
      data: { options: options, value: value, placeholder: placeholder },
      control: h('div', { class: 'lc-ui-field-control lc-ui-cascade' }, selects.length ? selects : h('p', { class: 'lc-ui-field-empty', role: 'status' }, '暂无可选项'))
    });
  }

  function enhanceCascader(el) {
    var container = el.querySelector('.lc-ui-cascade');
    if (!container) return null;
    var config = kit.readJsonScript(el) || {};
    /* 渲染期已把完整选项树放进数据岛；enhance 直接读它，不从 DOM 反推。 */
    var seedOptions = normalizeCascade(config.options || []);
    var placeholder = String(config.placeholder || '请选择');
    if (!seedOptions.length) {
      return { value: function () { return []; }, setValue: function () { }, destroy: function () { } };
    }
    function currentValue() {
      return Array.prototype.slice.call(container.querySelectorAll('[data-lc-cascade-select]')).map(function (select) {
        return select.value;
      }).filter(Boolean);
    }
    function rebuild(value) {
      var levels = cascadeLevels(seedOptions, value, []);
      container.innerHTML = '';
      levels.forEach(function (level, index) {
        var select = document.createElement('select');
        select.className = 'lc-ui-field-input lc-ui-cascade-select';
        select.setAttribute('data-lc-cascade-select', String(index));
        select.setAttribute('data-level', String(index));
        select.setAttribute('aria-label', '第 ' + (index + 1) + ' 级');
        if (config.disabled) select.disabled = true;
        var placeholderNode = document.createElement('option');
        placeholderNode.value = '';
        placeholderNode.textContent = placeholder;
        select.appendChild(placeholderNode);
        level.options.forEach(function (option) {
          var node = document.createElement('option');
          node.value = option.value;
          node.textContent = option.label;
          if (option.value === level.value) node.selected = true;
          select.appendChild(node);
        });
        container.appendChild(select);
      });
    }
    function onChange() {
      var value = currentValue();
      rebuild(value);
      var problem = choiceError(value, { required: !!config.required });
      kit.emit(el, 'lc:field-change', { type: 'cascader', value: value, valid: !problem, error: problem });
      /* 重新建过 DOM 后焦点会丢，交给用户下一个动作或下一次点击，不强行抢焦点。 */
    }
    container.addEventListener('change', onChange);
    return {
      value: currentValue,
      setValue: function (value) { rebuild(valuesOf(value)); },
      destroy: function () { container.removeEventListener('change', onChange); }
    };
  }

  /* ---------- 评分 ---------- */
  function renderRating(block) {
    var id = kit.uid('lc-star');
    var max = kit.clamp(kit.num(kit.prop(block, 'max', 5), 5), 1, 10);
    var value = kit.clamp(kit.num(kit.prop(block, 'value', 0), 0), 0, max);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var readonly = kit.bool(kit.prop(block, 'readonly', false), false);
    var name = kit.prop(block, 'name', '') || id;
    var stars = [];
    for (var i = 1; i <= max; i += 1) {
      var attrs = {
        type: 'radio', name: name, value: String(i), class: 'lc-ui-rating-input',
        'data-lc-rating-input': 'true', 'aria-label': i + ' 星'
      };
      if (i === value) attrs.checked = 'checked';
      if (disabled || readonly) attrs.disabled = 'disabled';
      stars.push(h('label', { class: 'lc-ui-rating-star' + (i <= value ? ' is-filled' : '') }, [
        h('input', attrs),
        h('span', { 'aria-hidden': 'true' }, '★')
      ]));
    }
    return fieldShell(block, {
      type: 'ui-rating', id: id, label: kit.prop(block, 'label', '评分'), labelFor: false,
      control: h('div', { class: 'lc-ui-field-control' }, [
        h('div', { class: 'lc-ui-rating', role: 'radiogroup', 'data-lc-rating': 'true' }, stars)
      ])
    });
  }

  function enhanceRating(el) {
    var inputs = Array.prototype.slice.call(el.querySelectorAll('[data-lc-rating-input]'));
    if (!inputs.length) return null;
    var config = kit.readJsonScript(el) || {};
    var starNodes = Array.prototype.slice.call(el.querySelectorAll('.lc-ui-rating-star'));
    function sync() {
      var checked = inputs.filter(function (input) { return input.checked; })[0];
      var value = checked ? Number(checked.value) : 0;
      starNodes.forEach(function (node, index) {
        node.classList.toggle('is-filled', index < value);
      });
      var problem = config.required && !value ? '请选择评分。' : '';
      kit.emit(el, 'lc:field-change', { type: 'rating', value: value, valid: !problem, error: problem });
    }
    inputs.forEach(function (input) { input.addEventListener('change', sync); });
    return {
      value: function () { var checked = inputs.filter(function (input) { return input.checked; })[0]; return checked ? Number(checked.value) : 0; },
      setValue: function (value) {
        inputs.forEach(function (input) { input.checked = Number(input.value) === Number(value); });
        sync();
      },
      destroy: function () { inputs.forEach(function (input) { input.removeEventListener('change', sync); }); }
    };
  }

  var CONTROL_CSS = [
    '.lc-ui-field { display: flex; flex-direction: column; gap: var(--lc-space-1-5); }',
    '.lc-ui-field-label { font-size: var(--lc-text-xs, 12px); font-weight: 600; color: var(--lc-color-ink-2); }',
    '.lc-ui-field-required { color: var(--lc-color-accent); }',
    '.lc-ui-field-control { min-width: 0; }',
    '.lc-ui-field-input { width: 100%; padding: var(--lc-space-2) var(--lc-space-2-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); color: var(--lc-color-ink); font: inherit; font-size: var(--lc-text-sm, 14px); outline: none; }',
    '.lc-ui-field-input:focus { border-color: var(--lc-color-accent); box-shadow: 0 0 0 2px var(--lc-color-accent-soft); }',
    '.lc-ui-field-input:disabled { cursor: not-allowed; opacity: 0.65; }',
    '.lc-ui-field-textarea { min-height: 72px; resize: vertical; }',
    '.lc-ui-field-help { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted); }',
    '.lc-ui-field-error { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-danger); }',
    '.lc-ui-field-count { margin: var(--lc-space-1) 0 0; text-align: right; font-size: var(--lc-text-xs, 11px); color: var(--lc-color-muted-2); font-variant-numeric: tabular-nums; }',
    '.lc-ui-field-empty { margin: 0; padding: var(--lc-space-2) var(--lc-space-2-5); border: 1px dashed var(--lc-color-line-strong, #bbb); border-radius: var(--lc-radius-sm, 5px); font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted); }',
    '.lc-ui-field[data-lc-state="error"] .lc-ui-field-input { border-color: var(--lc-color-danger-line); }',
    '.lc-ui-field[data-lc-state="loading"] { opacity: 0.75; }',
    '.lc-ui-choices { display: flex; flex-direction: column; gap: var(--lc-space-1-5); }',
    '.lc-ui-choices.is-single { flex-direction: row; flex-wrap: wrap; gap: var(--lc-space-3-5); }',
    '.lc-ui-field-choice { display: inline-flex; align-items: center; gap: var(--lc-space-1-5); font-size: var(--lc-text-sm, 13.5px); color: var(--lc-color-ink-2); cursor: pointer; }',
    '.lc-ui-field-choice-input { accent-color: var(--lc-color-accent); }',
    '.lc-ui-switch-control { display: flex; align-items: center; gap: var(--lc-space-2); }',
    '.lc-ui-switch-btn { display: inline-flex; align-items: center; padding: 0; border: 0; background: transparent; cursor: pointer; }',
    '.lc-ui-switch-track { display: inline-flex; align-items: center; width: 40px; height: 22px; padding: 2px; border-radius: var(--lc-radius-full); background: var(--lc-color-line-strong); transition: background 140ms ease; }',
    '.lc-ui-switch-thumb { width: 18px; height: 18px; border-radius: 50%; background: var(--lc-color-surface, #fff); box-shadow: var(--lc-shadow-xs); transition: transform 140ms ease; }',
    '.lc-ui-switch-btn[aria-checked="true"] .lc-ui-switch-track { background: var(--lc-color-accent); }',
    '.lc-ui-switch-btn[aria-checked="true"] .lc-ui-switch-thumb { transform: translateX(18px); }',
    '.lc-ui-switch-text { font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted); }',
    '.lc-ui-number-box { display: flex; align-items: center; gap: var(--lc-space-2); }',
    '.lc-ui-number-unit { font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted); }',
    '.lc-ui-tags-box { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lc-space-1-5); padding: var(--lc-space-1-5) var(--lc-space-2); border: var(--lc-border-width, 1px) solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); }',
    '.lc-ui-tags-box:focus-within { border-color: var(--lc-color-accent); box-shadow: 0 0 0 2px var(--lc-color-accent-soft); }',
    '.lc-ui-tags-list { display: contents; }',
    '.lc-ui-tags-chip { display: inline-flex; align-items: center; gap: var(--lc-space-1); padding: 2px var(--lc-space-1) 2px 9px; border: 1px solid var(--lc-color-accent-line); border-radius: var(--lc-radius-full); background: var(--lc-color-accent-soft); color: var(--lc-color-accent); font-size: var(--lc-text-xs, 11.5px); }',
    '.lc-ui-tags-remove { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0 3px; line-height: 1; }',
    '.lc-ui-tags-input { flex: 1; min-width: 120px; padding: 3px 2px; border: 0; outline: none; background: transparent; color: var(--lc-color-ink); font: inherit; font-size: var(--lc-text-sm, 13px); }',
    '.lc-ui-cascade { display: flex; flex-wrap: wrap; gap: var(--lc-space-1-5); }',
    '.lc-ui-cascade-select { flex: 1; min-width: 120px; }',
    '.lc-ui-rating { display: inline-flex; gap: 2px; }',
    '.lc-ui-rating-star { position: relative; display: inline-flex; cursor: pointer; color: var(--lc-color-line-strong); font-size: 24px; line-height: 1; }',
    '.lc-ui-rating-star.is-filled { color: var(--lc-color-accent); }',
    '.lc-ui-rating-input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }',
    '.lc-ui-rating-star:focus-within { outline: 2px solid var(--lc-color-accent-line); outline-offset: 2px; border-radius: var(--lc-radius-sm); }',
    '.lc-ui-rating-input:disabled { cursor: not-allowed; }'
  ].join('\n');

  function defOf(type, name, schema, renderFn, enhanceFn) {
    return {
      type: type,
      name: name,
      version: 1,
      schema: schema,
      sharedCss: CONTROL_CSS,
      sharedCssId: 'lc-ui-controls',
      css: '',
      render: renderFn,
      enhance: enhanceFn,
      helpers: { optionsOf: optionsOf, valuesOf: valuesOf, numError: numError, textError: textError, choiceError: choiceError, tagsError: tagsError, normalizeCascade: normalizeCascade, cascadeLevels: cascadeLevels }
    };
  }

  var defs = {
    'ui-select': defOf('ui-select', '下拉选择', selectSchema, renderSelect, enhanceSelect),
    'ui-radio-group': defOf('ui-radio-group', '单选组', {
      type: 'ui-radio-group', name: '单选组', version: 1,
      states: ['ready', 'loading', 'empty', 'error'], events: ['lc:field-change'],
      props: { label: { type: 'string', default: '单选' }, name: { type: 'string', default: '' }, options: { type: 'array', default: [] }, value: { type: 'string', default: '' }, required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false }, help: { type: 'string', default: '' }, error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' } }
    }, function (block) { return renderChoices(block, true); }, enhanceChoices),
    'ui-checkbox-group': defOf('ui-checkbox-group', '复选组', {
      type: 'ui-checkbox-group', name: '复选组', version: 1,
      states: ['ready', 'loading', 'empty', 'error'], events: ['lc:field-change'],
      props: { label: { type: 'string', default: '多选' }, name: { type: 'string', default: '' }, options: { type: 'array', default: [] }, value: { type: 'array', default: [] }, minSelected: { type: 'number', default: 0 }, maxSelected: { type: 'number', default: 0 }, required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false }, help: { type: 'string', default: '' }, error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' } }
    }, function (block) { return renderChoices(block, false); }, enhanceChoices),
    'ui-switch': defOf('ui-switch', '开关', switchSchema, renderSwitch, enhanceSwitch),
    'ui-number': defOf('ui-number', '数字输入', {
      type: 'ui-number', name: '数字输入', version: 1,
      states: ['ready', 'loading', 'empty', 'error'], events: ['lc:field-change'],
      props: { label: { type: 'string', default: '数字' }, name: { type: 'string', default: '' }, value: { type: 'number', default: '' }, min: { type: 'number', default: null }, max: { type: 'number', default: null }, step: { type: 'number', default: 1 }, unit: { type: 'string', default: '' }, required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false }, help: { type: 'string', default: '' }, error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' } }
    }, renderNumber, enhanceNumber),
    'ui-textarea': defOf('ui-textarea', '多行文本', {
      type: 'ui-textarea', name: '多行文本', version: 1,
      states: ['ready', 'loading', 'empty', 'error'], events: ['lc:field-change'],
      props: { label: { type: 'string', default: '多行文本' }, name: { type: 'string', default: '' }, value: { type: 'string', default: '' }, rows: { type: 'number', default: 4 }, placeholder: { type: 'string', default: '' }, minLength: { type: 'number', default: 0 }, maxLength: { type: 'number', default: 0 }, required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false }, readonly: { type: 'boolean', default: false }, help: { type: 'string', default: '' }, error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' } }
    }, renderTextarea, enhanceTextarea),
    'ui-tags': defOf('ui-tags', '标签输入', {
      type: 'ui-tags', name: '标签输入', version: 1,
      states: ['ready', 'loading', 'empty', 'error'], events: ['lc:field-change'],
      props: { label: { type: 'string', default: '标签' }, name: { type: 'string', default: '' }, value: { type: 'array', default: [] }, placeholder: { type: 'string', default: '输入后回车添加' }, minTags: { type: 'number', default: 0 }, maxTags: { type: 'number', default: 0 }, required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false }, help: { type: 'string', default: '' }, error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' } }
    }, renderTags, enhanceTags),
    'ui-cascader': defOf('ui-cascader', '级联选择', {
      type: 'ui-cascader', name: '级联选择', version: 1,
      states: ['ready', 'loading', 'empty', 'error'], events: ['lc:field-change'],
      props: { label: { type: 'string', default: '级联选择' }, name: { type: 'string', default: '' }, options: { type: 'array', default: [] }, value: { type: 'array', default: [] }, placeholder: { type: 'string', default: '请选择' }, required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false }, help: { type: 'string', default: '' }, error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' } }
    }, renderCascader, enhanceCascader),
    'ui-rating': defOf('ui-rating', '评分', {
      type: 'ui-rating', name: '评分', version: 1,
      states: ['ready', 'loading', 'empty', 'error'], events: ['lc:field-change'],
      props: { label: { type: 'string', default: '评分' }, name: { type: 'string', default: '' }, value: { type: 'number', default: 0 }, max: { type: 'number', default: 5 }, required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false }, readonly: { type: 'boolean', default: false }, help: { type: 'string', default: '' }, error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' } }
    }, renderRating, enhanceRating)
  };

  // 多选组件独立声明（缺少一个值数组兜底）
  defs['ui-multiselect'] = defOf('ui-multiselect', '多选', {
    type: 'ui-multiselect', name: '多选', version: 1,
    states: ['ready', 'loading', 'empty', 'error'], events: ['lc:field-change'],
    props: { label: { type: 'string', default: '多选' }, name: { type: 'string', default: '' }, options: { type: 'array', default: [] }, value: { type: 'array', default: [] }, minSelected: { type: 'number', default: 0 }, maxSelected: { type: 'number', default: 0 }, required: { type: 'boolean', default: false }, disabled: { type: 'boolean', default: false }, help: { type: 'string', default: '' }, error: { type: 'string', default: '' }, state: { type: 'enum', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' } }
  }, function (block) { return renderChoices(block, false, 'ui-multiselect'); }, enhanceChoices);

  if (typeof module === 'object' && module.exports) {
    module.exports = defs;
  } else {
    Object.keys(defs).forEach(function (type) { dom.Components[type] = defs[type]; });
  }

  return defs;
}));
