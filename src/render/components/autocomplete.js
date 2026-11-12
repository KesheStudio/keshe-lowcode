/* 渲染核心 · 内置组件 · 自动补全搜索框
   本地选项与远程数据源两种模式。远程模式不自己发请求，统一调用平台侧注册的数据源
   （R.resolveDataSource(name).search(query, { signal, limit })）。
   远程查询带防抖、取消上一笔、加载态、无结果态与错误态；键盘上下选择、回车选中、Esc 关闭。
   支持多选、显示字段/取值字段配置与最多选中数量限制。 */
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

  function normalizeOption(item, fields) {
    if (item == null) return null;
    if (typeof item === 'string' || typeof item === 'number') {
      return { value: String(item), label: String(item), disabled: false };
    }
    if (typeof item !== 'object') return null;
    var labelField = fields && fields.labelField ? fields.labelField : 'label';
    var valueField = fields && fields.valueField ? fields.valueField : 'value';
    var value = item[valueField];
    var label = item[labelField];
    if (value == null) value = item.value != null ? item.value : item.id;
    if (label == null) label = item.label != null ? item.label : item.name;
    if (value == null) return null;
    return { value: String(value), label: label == null ? String(value) : String(label), disabled: !!item.disabled, raw: item };
  }

  function normalizeOptions(list, fields) {
    return kit.toArray(list).map(function (item) { return normalizeOption(item, fields); }).filter(Boolean);
  }

  function asSelected(value, multiple) {
    if (multiple) {
      return kit.toArray(value).map(function (item) {
        return typeof item === 'object' && item ? String(item.value == null ? item.label : item.value) : String(item);
      }).filter(Boolean);
    }
    if (value == null || value === '') return [];
    if (typeof value === 'object') {
      var single = String(value.value == null ? value.label : value.value);
      return single ? [single] : [];
    }
    return [String(value)];
  }

  function filterOptions(options, query) {
    var text = String(query == null ? '' : query).trim().toLowerCase();
    if (!text) return options.slice();
    return options.filter(function (option) {
      return String(option.label).toLowerCase().indexOf(text) !== -1 || option.value.toLowerCase().indexOf(text) !== -1;
    });
  }

  var SCHEMA = {
    type: 'ui-autocomplete',
    name: '自动补全',
    version: 1,
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:autocomplete-search', 'lc:autocomplete-select', 'lc:autocomplete-remove'],
    props: {
      label: { type: 'string', label: '标签', default: '搜索' },
      name: { type: 'string', label: '字段名', default: '' },
      placeholder: { type: 'string', label: '占位符', default: '输入关键词' },
      mode: { type: 'enum', label: '模式', options: ['auto', 'local', 'remote'], default: 'auto' },
      options: { type: 'array', label: '本地选项', items: { type: 'object', props: {
        label: { type: 'string' }, value: { type: 'string' }, disabled: { type: 'boolean' }
      } }, default: [] },
      datasource: { type: 'string', label: '数据源名称（平台注册）', default: '' },
      labelField: { type: 'string', label: '显示字段', default: 'label' },
      valueField: { type: 'string', label: '取值字段', default: 'value' },
      value: { type: 'string|array', label: '初始值', default: '' },
      multiple: { type: 'boolean', label: '多选', default: false },
      maxSelected: { type: 'number', label: '最多选中数量', default: 0 },
      maxItems: { type: 'number', label: '最多候选条数', default: 8 },
      debounce: { type: 'number', label: '远程防抖毫秒', default: 300 },
      minChars: { type: 'number', label: '最少输入字符', default: 1 },
      emptyText: { type: 'string', label: '无结果文本', default: '无匹配结果' },
      loadingText: { type: 'string', label: '加载文本', default: '正在搜索…' },
      errorText: { type: 'string', label: '错误文本', default: '数据源请求失败，请重试' },
      unconfiguredText: { type: 'string', label: '未配置数据源文本', default: '尚未配置数据源' },
      required: { type: 'boolean', label: '必填', default: false },
      disabled: { type: 'boolean', label: '禁用', default: false },
      help: { type: 'string', label: '帮助文本', default: '' },
      error: { type: 'string', label: '错误文本', default: '' },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    }
  };

  function render(block, ctx) {
    var id = kit.uid('lc-ac');
    var fields = {
      labelField: kit.prop(block, 'labelField', 'label') || 'label',
      valueField: kit.prop(block, 'valueField', 'value') || 'value'
    };
    var options = normalizeOptions(kit.prop(block, 'options', []), fields);
    var datasourceName = String(kit.prop(block, 'datasource', '') || '');
    var mode = String(kit.prop(block, 'mode', 'auto') || 'auto').toLowerCase();
    var remoteRequested = mode === 'remote' || (mode === 'auto' && datasourceName !== '');
    var source = remoteRequested ? datasource.resolveDataSource(datasourceName) : null;
    var remote = remoteRequested && !!source;
    var fallback = remoteRequested && !source;
    var multiple = kit.bool(kit.prop(block, 'multiple', false), false);
    var selected = asSelected(kit.prop(block, 'value', multiple ? [] : ''), multiple);
    var maxSelected = kit.num(kit.prop(block, 'maxSelected', 0), 0);
    var maxItems = kit.num(kit.prop(block, 'maxItems', 8), 8);
    var minChars = kit.num(kit.prop(block, 'minChars', 1), 1);
    var debounce = kit.num(kit.prop(block, 'debounce', 300), 300);
    var label = kit.prop(block, 'label', '搜索');
    var placeholder = kit.prop(block, 'placeholder', '输入关键词');
    var help = kit.prop(block, 'help', '');
    var error = kit.prop(block, 'error', '');
    var state = kit.stateOf(block, true);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false) || state === 'loading' ||
      (fallback && !options.length);
    var emptyText = kit.prop(block, 'emptyText', '无匹配结果');
    var loadingText = kit.prop(block, 'loadingText', '正在搜索…');
    var errorText = kit.prop(block, 'errorText', '数据源请求失败，请重试');
    var unconfiguredText = kit.prop(block, 'unconfiguredText', '尚未配置数据源');
    var errorId = id + '-error';
    var helpId = id + '-help';
    var listId = id + '-list';

    var selectedLabels = selected.map(function (value) {
      var match = options.filter(function (option) { return option.value === value; })[0];
      return { value: value, label: match ? match.label : value };
    });

    var chips = multiple && selectedLabels.length ? h('div', { class: 'lc-ui-ac-chips', 'data-lc-ac-chips': 'true' }, selectedLabels.map(function (item) {
      return h('span', { class: 'lc-ui-ac-chip' }, [
        h('span', null, item.label),
        h('button', {
          type: 'button',
          class: 'lc-ui-ac-chip-remove',
          'data-lc-ac-remove': item.value,
          'aria-label': '移除 ' + item.label
        }, '×')
      ]);
    })) : null;

    var inputAttrs = {
      id: id + '-input',
      type: 'text',
      class: 'lc-ui-ac-input',
      placeholder: placeholder,
      autocomplete: 'off',
      'data-lc-ac-input': 'true',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': listId,
      'aria-autocomplete': 'list',
      'aria-describedby': error && state === 'error' ? errorId : (help ? helpId : null),
      'aria-invalid': state === 'error' ? 'true' : 'false'
    };
    if (block.name) inputAttrs.name = block.name;
    if (required(block)) inputAttrs.required = 'required';
    if (disabled) inputAttrs.disabled = 'disabled';

    var initialOptions = remote ? [] : filterOptions(options, '');
    var list = h('ul', {
      class: 'lc-ui-ac-list',
      id: listId,
      role: 'listbox',
      hidden: 'hidden',
      'data-lc-ac-list': 'true'
    }, initialOptions.map(function (option) { return optionNode(option, selected); }));

    var notice = null;
    if (fallback) {
      var reason = datasourceName
        ? unconfiguredText + '：数据源「' + datasourceName + '」未注册'
        : unconfiguredText + '：请在属性中填写 datasource';
      notice = h('p', { class: 'lc-ui-ac-notice', role: 'status', 'data-lc-ac-notice': 'true' },
        reason + (options.length ? '，已退回静态选项。' : '，暂时无法搜索。'));
    }

    var foot = [];
    if (error && state === 'error') foot.push(h('p', { class: 'lc-ui-ac-error', id: errorId, role: 'alert' }, error));
    else if (help) foot.push(h('p', { class: 'lc-ui-ac-help', id: helpId }, help));

    var actualMode = remote ? 'remote' : (fallback ? 'local-fallback' : 'local');
    var root = h('div', {
      class: 'lc-ui lc-ui-ac' + (fallback ? ' lc-ui-ac-unconfigured' : ''),
      'data-lc-ui': 'ui-autocomplete',
      'data-lc-state': state,
      'data-lc-ac': 'true',
      'data-mode': actualMode,
      'data-datasource': datasourceName,
      'data-unconfigured': fallback ? 'true' : 'false',
      'data-multiple': multiple ? 'true' : 'false',
      'data-max-selected': String(maxSelected),
      'data-max-items': String(maxItems),
      'data-min-chars': String(minChars),
      'data-debounce': String(debounce),
      'data-selected': selected.join(','),
      'data-empty-text': emptyText,
      'data-loading-text': loadingText,
      'data-error-text': errorText,
      'data-unconfigured-text': unconfiguredText
    }, [
      label ? h('label', { class: 'lc-ui-ac-label', for: id + '-input' }, [
        label, required(block) ? h('span', { class: 'lc-ui-ac-required', 'aria-hidden': 'true' }, ' *') : null
      ]) : null,
      chips,
      h('div', { class: 'lc-ui-ac-field' }, [
        h('div', { class: 'lc-ui-ac-box' }, [
          h('input', inputAttrs),
          h('span', { class: 'lc-ui-ac-spinner lc-ui-spinner', hidden: 'hidden', 'data-lc-ac-spinner': 'true' })
        ]),
        list
      ]),
      notice,
      foot.length ? h('div', { class: 'lc-ui-ac-foot' }, foot) : null,
      raw(kit.jsonIsland({
        mode: actualMode,
        datasource: datasourceName,
        options: options.map(function (option) { return { label: option.label, value: option.value, disabled: option.disabled }; }),
        multiple: multiple,
        maxSelected: maxSelected,
        maxItems: maxItems,
        minChars: minChars,
        debounce: debounce,
        selected: selected,
        labelField: fields.labelField,
        valueField: fields.valueField
      }))
    ]);
    return root;
  }

  function required(block) { return kit.bool(kit.prop(block, 'required', false), false); }

  function optionNode(option, selected) {
    var active = selected.indexOf(option.value) !== -1;
    return h('li', {
      class: 'lc-ui-ac-option' + (active ? ' is-selected' : '') + (option.disabled ? ' is-disabled' : ''),
      role: 'option',
      'data-lc-ac-value': option.value,
      'data-lc-ac-label': option.label,
      'aria-selected': active ? 'true' : 'false',
      'aria-disabled': option.disabled ? 'true' : 'false'
    }, option.label);
  }

  function enhance(el) {
    var input = el.querySelector('[data-lc-ac-input]');
    var list = el.querySelector('[data-lc-ac-list]');
    var spinner = el.querySelector('[data-lc-ac-spinner]');
    var chips = el.querySelector('[data-lc-ac-chips]');
    if (!input || !list) return null;

    var config = kit.readJsonScript(el) || {};
    var remote = config.mode === 'remote';
    var source = remote ? datasource.resolveDataSource(config.datasource) : null;
    /* 数据源可能尚未注册：此时退回本地静态选项，不发起任何请求，也不抛错。 */
    if (remote && !source) remote = false;
    var fields = { labelField: config.labelField, valueField: config.valueField };
    var localOptions = normalizeOptions(config.options || [], fields);
    var selected = asSelected(config.selected || [], !!config.multiple);
    var maxSelected = kit.num(config.maxSelected, 0);
    var maxItems = kit.num(config.maxItems, 8);
    var minChars = kit.num(config.minChars, 1);
    var debounce = kit.num(config.debounce, 300);
    var multiple = !!config.multiple;
    var active = -1;
    var currentOptions = [];
    var timer = null;
    var controller = null;
    var seq = 0;
    var loading = false;
    var open = false;

    function selectedValues() { return selected.slice(); }

    function renderOptions(options) {
      currentOptions = options;
      list.innerHTML = '';
      active = -1;
      if (!options.length) {
        list.hidden = true;
        return;
      }
      options.forEach(function (option, index) {
        var node = document.createElement('li');
        node.className = 'lc-ui-ac-option' + (selected.indexOf(option.value) !== -1 ? ' is-selected' : '') +
          (option.disabled ? ' is-disabled' : '');
        node.setAttribute('role', 'option');
        node.setAttribute('data-lc-ac-value', option.value);
        node.setAttribute('data-lc-ac-label', option.label);
        node.setAttribute('data-lc-ac-index', String(index));
        node.setAttribute('aria-selected', selected.indexOf(option.value) !== -1 ? 'true' : 'false');
        node.setAttribute('aria-disabled', option.disabled ? 'true' : 'false');
        node.textContent = option.label;
        list.appendChild(node);
      });
      list.hidden = false;
    }

    function message(text) {
      list.innerHTML = '';
      var node = document.createElement('li');
      node.className = 'lc-ui-ac-message';
      node.textContent = text;
      list.appendChild(node);
      list.hidden = false;
    }

    function setLoading(value) {
      loading = value;
      input.setAttribute('aria-busy', value ? 'true' : 'false');
      if (spinner) spinner.hidden = !value;
      if (value) message(el.getAttribute('data-loading-text') || '正在搜索…');
    }

    function cancelPending() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (controller) { try { controller.abort(); } catch (error) { /* noop */ } controller = null; }
    }

    function finishSearch() {
      setLoading(false);
    }

    function runSearch(query) {
      cancelPending();
      var token = ++seq;
      if (!query || query.length < minChars) {
        list.hidden = true;
        list.innerHTML = '';
        return;
      }
      if (!source || typeof source.search !== 'function') {
        message(el.getAttribute('data-unconfigured-text') || '尚未配置数据源');
        kit.emit(el, 'lc:autocomplete-search', { query: query, ok: false, reason: 'unconfigured' });
        return;
      }
      setLoading(true);
      kit.emit(el, 'lc:autocomplete-search', { query: query, ok: true });
      var context = { signal: null, limit: maxItems, query: query };
      try {
        if (typeof AbortController === 'function') {
          controller = new AbortController();
          context.signal = controller.signal;
        }
      } catch (error) { controller = null; }
      var result;
      try {
        result = source.search(query, context);
      } catch (error) {
        finishSearch();
        if (token === seq) message(el.getAttribute('data-error-text') || '数据源请求失败，请重试');
        return;
      }
      Promise.resolve(result).then(function (items) {
        if (token !== seq) return;
        finishSearch();
        var options = normalizeOptions(items, fields).slice(0, maxItems);
        if (!options.length) message(el.getAttribute('data-empty-text') || '无匹配结果');
        else renderOptions(options);
      }, function (error) {
        if (token !== seq) return;
        if (error && error.name === 'AbortError') return;
        finishSearch();
        message(el.getAttribute('data-error-text') || '数据源请求失败，请重试');
      });
    }

    function schedule(query) {
      cancelPending();
      if (debounce <= 0) { runSearch(query); return; }
      timer = setTimeout(function () { timer = null; runSearch(query); }, debounce);
    }

    function syncChips() {
      if (!multiple) return;
      if (!chips) {
        chips = document.createElement('div');
        chips.className = 'lc-ui-ac-chips';
        chips.setAttribute('data-lc-ac-chips', 'true');
        var labelNode = el.querySelector('.lc-ui-ac-label');
        if (labelNode && labelNode.parentNode) labelNode.parentNode.insertBefore(chips, labelNode.nextSibling);
        else el.insertBefore(chips, el.firstChild);
      }
      chips.innerHTML = '';
      selected.forEach(function (value) {
        var match = localOptions.filter(function (option) { return option.value === value; })[0];
        var label = match ? match.label : value;
        var chip = document.createElement('span');
        chip.className = 'lc-ui-ac-chip';
        var text = document.createElement('span');
        text.textContent = label;
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'lc-ui-ac-chip-remove';
        remove.setAttribute('data-lc-ac-remove', value);
        remove.setAttribute('aria-label', '移除 ' + label);
        remove.textContent = '×';
        chip.appendChild(text);
        chip.appendChild(remove);
        chips.appendChild(chip);
      });
      if (!chips.children.length && chips.parentNode) chips.parentNode.removeChild(chips);
      chips = null;
    }

    function selectOption(value, label) {
      if (multiple) {
        if (selected.indexOf(value) !== -1) { input.value = ''; list.hidden = true; return; }
        if (maxSelected && selected.length >= maxSelected) {
          message('最多只能选择 ' + maxSelected + ' 项');
          kit.emit(el, 'lc:autocomplete-select', { value: value, label: label, ok: false, reason: 'max-selected', selected: selectedValues() });
          return;
        }
        selected.push(value);
        input.value = '';
        syncChips();
        renderOptions(currentOptions.map(function (option) { return option; }));
        kit.emit(el, 'lc:autocomplete-select', { value: value, label: label, ok: true, selected: selectedValues() });
        return;
      }
      selected = [value];
      input.value = label;
      list.hidden = true;
      kit.emit(el, 'lc:autocomplete-select', { value: value, label: label, ok: true, selected: selectedValues() });
    }

    function move(delta) {
      if (!currentOptions.length) return;
      var next = active + delta;
      if (next < 0) next = currentOptions.length - 1;
      if (next >= currentOptions.length) next = 0;
      var guard = 0;
      while (currentOptions[next] && currentOptions[next].disabled && guard < currentOptions.length) {
        next = (next + delta + currentOptions.length) % currentOptions.length;
        guard += 1;
      }
      active = next;
      Array.prototype.slice.call(list.querySelectorAll('[data-lc-ac-value]')).forEach(function (node, index) {
        node.classList.toggle('is-active', index === active);
        node.setAttribute('aria-selected', index === active ? 'true' : 'false');
      });
      var activeNode = list.querySelectorAll('[data-lc-ac-value]')[active];
      if (activeNode && activeNode.scrollIntoView) { try { activeNode.scrollIntoView({ block: 'nearest' }); } catch (error) { /* noop */ } }
    }

    function closeList() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
      open = false;
    }

    function openList() {
      if (list.hidden) return;
      input.setAttribute('aria-expanded', 'true');
      open = true;
    }

    function onInput() {
      var query = String(input.value || '');
      if (!remote) {
        renderOptions(filterOptions(localOptions, query).slice(0, maxItems));
        return;
      }
      if (!query) { list.hidden = true; cancelPending(); return; }
      schedule(query);
    }

    function onKeydown(event) {
      if (event.key === 'ArrowDown') {
        if (list.hidden) { onInput(); if (list.hidden) return; }
        event.preventDefault();
        move(1);
        openList();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
        openList();
      } else if (event.key === 'Enter') {
        if (!list.hidden && active >= 0 && currentOptions[active]) {
          event.preventDefault();
          selectOption(currentOptions[active].value, currentOptions[active].label);
        }
      } else if (event.key === 'Escape') {
        if (!list.hidden) {
          event.preventDefault();
          closeList();
        }
      }
    }

    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var remove = target.closest('[data-lc-ac-remove]');
      if (remove) {
        var value = remove.getAttribute('data-lc-ac-remove');
        selected = selected.filter(function (item) { return item !== value; });
        syncChips();
        renderOptions(currentOptions);
        kit.emit(el, 'lc:autocomplete-remove', { value: value, selected: selectedValues() });
        return;
      }
      var option = target.closest('[data-lc-ac-value]');
      if (option) {
        selectOption(option.getAttribute('data-lc-ac-value'), option.getAttribute('data-lc-ac-label'));
      }
    }

    function onFocus() {
      if (!remote) { renderOptions(filterOptions(localOptions, input.value)); }
      else if (currentOptions.length) { list.hidden = false; }
    }

    function onBlur(event) {
      if (event.relatedTarget && el.contains(event.relatedTarget)) return;
      closeList();
    }

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur, true);
    el.addEventListener('click', onClick);

    var api = {
      value: function () { return multiple ? selectedValues() : (selected[0] || ''); },
      setValue: function (next) {
        selected = asSelected(next, multiple);
        if (!multiple) {
          var match = localOptions.filter(function (option) { return option.value === selected[0]; })[0];
          input.value = match ? match.label : (selected[0] || '');
        }
        syncChips();
        renderOptions(currentOptions);
      },
      search: function (query) { schedule(String(query == null ? '' : query)); },
      focus: function () { try { input.focus(); } catch (error) { /* noop */ } },
      destroy: function () {
        cancelPending();
        input.removeEventListener('input', onInput);
        input.removeEventListener('keydown', onKeydown);
        input.removeEventListener('focus', onFocus);
        el.removeEventListener('blur', onBlur, true);
        el.removeEventListener('click', onClick);
      }
    };
    el.__lcAutocomplete = api;
    return api;
  }

  var def = {
    type: SCHEMA.type,
    name: SCHEMA.name,
    version: SCHEMA.version,
    schema: SCHEMA,
    css: [
      '.lc-ui-ac { position: relative; display: flex; flex-direction: column; gap: var(--lc-space-1-5); }',
      '.lc-ui-ac-label { font-size: var(--lc-text-xs, 12px); font-weight: 600; color: var(--lc-color-ink-2, var(--ink-2, #444)); }',
      '.lc-ui-ac-required { color: var(--lc-color-accent, var(--accent, #b45309)); }',
      '.lc-ui-ac-chips { display: flex; flex-wrap: wrap; gap: 5px; }',
      '.lc-ui-ac-chip { display: inline-flex; align-items: center; gap: var(--lc-space-1); padding: 2px var(--lc-space-1) 2px 9px; border: 1px solid var(--lc-color-accent-line, var(--accent-line, #999)); border-radius: var(--lc-radius-full); background: var(--lc-color-accent-soft, var(--accent-soft, #eef6f2)); color: var(--lc-color-accent, var(--accent, #3e6a56)); font-size: var(--lc-text-xs, 11.5px); }',
      '.lc-ui-ac-chip-remove { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0 3px; line-height: 1; }',
      '.lc-ui-ac-field { position: relative; }',
      '.lc-ui-ac-box { display: flex; align-items: center; gap: var(--lc-space-2); padding: 0 var(--lc-space-2-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, #fff)); }',
      '.lc-ui-ac-box:focus-within { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); box-shadow: 0 0 0 2px var(--lc-color-accent-soft, var(--accent-soft, rgba(62, 106, 86, 0.18))); }',
      '.lc-ui-ac-input { flex: 1; min-width: 0; padding: 9px 0; border: 0; outline: none; background: transparent; color: var(--lc-color-ink, var(--ink, inherit)); font: inherit; font-size: var(--lc-text-sm, 14px); }',
      '.lc-ui-ac-spinner { width: 14px; height: 14px; flex: none; }',
      '.lc-ui-ac-list { position: absolute; z-index: 12; left: 0; right: 0; top: calc(100% + 4px); max-height: 240px; overflow: auto; margin: 0; padding: var(--lc-space-1); list-style: none; border: var(--lc-border-width, 1px) solid var(--lc-color-line-strong, var(--line-strong, #bbb)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, #fff)); box-shadow: var(--lc-shadow-md); }',
      '.lc-ui-ac-list[hidden] { display: none; }',
      '.lc-ui-ac-option { padding: 7px 9px; border-radius: var(--lc-radius-sm, 5px); font-size: var(--lc-text-sm, 13px); color: var(--lc-color-ink-2, var(--ink-2, #444)); cursor: pointer; }',
      '.lc-ui-ac-option:hover, .lc-ui-ac-option.is-active { background: var(--lc-color-accent-soft, var(--accent-soft, #eef6f2)); color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-ac-option.is-selected { font-weight: 600; }',
      '.lc-ui-ac-option.is-disabled { opacity: 0.45; cursor: not-allowed; }',
      '.lc-ui-ac-message { padding: var(--lc-space-2) 9px; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-ac-notice { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-ac-help { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-ac-error { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-danger); }',
      '.lc-ui-ac[data-lc-state="error"] .lc-ui-ac-box { border-color: var(--lc-color-danger-line); }',
      '.lc-ui-ac[data-lc-state="loading"] { opacity: 0.8; }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeOptions: normalizeOptions,
      normalizeOption: normalizeOption,
      asSelected: asSelected,
      filterOptions: filterOptions
    }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = def;
  } else {
    dom.Components['ui-autocomplete'] = def;
  }

  return def;
}));
