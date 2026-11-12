/* 渲染核心 · 内置组件 · 表单
   字段类型、校验规则（必填/长度/正则/数值范围）、错误提示位置、提交状态。
   校验与渲染分离：纯函数 validateField 可在 Node 侧直接测。 */
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
  var escapeHtml = dom.escapeHtml;

  var TYPES = ['text', 'email', 'password', 'number', 'tel', 'url', 'search', 'date', 'textarea', 'select', 'checkbox', 'radio'];

  var SCHEMA = {
    type: 'ui-form',
    name: '表单',
    version: 1,
    description: '字段类型集合、四条校验规则、错误提示位置与提交状态。',
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:form-submit', 'lc:form-invalid', 'lc:form-reset'],
    props: {
      fields: {
        type: 'array',
        label: '字段集合',
        required: true,
        default: [],
        items: {
          type: 'object',
          props: {
            name: { type: 'string', label: '字段名', required: true },
            label: { type: 'string', label: '标签' },
            type: { type: 'enum', label: '类型', options: TYPES, default: 'text' },
            value: { type: 'string', label: '默认值' },
            placeholder: { type: 'string', label: '占位提示' },
            help: { type: 'string', label: '帮助文字' },
            required: { type: 'boolean', label: '必填', default: false },
            minLength: { type: 'number', label: '最小长度' },
            maxLength: { type: 'number', label: '最大长度' },
            pattern: { type: 'string', label: '正则表达式' },
            min: { type: 'number', label: '最小值' },
            max: { type: 'number', label: '最大值' },
            step: { type: 'number', label: '步长' },
            rows: { type: 'number', label: '文本域行数', default: 3 },
            options: {
              type: 'array',
              label: '选项',
              items: { type: 'object', props: { value: { type: 'string' }, label: { type: 'string' } } }
            },
            message: { type: 'string', label: '错误文案', description: '缺省按规则生成。' },
            disabled: { type: 'boolean', label: '禁用', default: false },
            visibleWhen: {
              type: 'object',
              label: '显示条件',
              description: '依赖另一个字段的值；隐藏时不校验、不提交。',
              props: {
                field: { type: 'string', label: '依赖字段' },
                equals: { type: 'string', label: '等于' },
                notEquals: { type: 'string', label: '不等于' },
                notEmpty: { type: 'boolean', label: '非空时显示' },
                in: { type: 'array', label: '属于（数组）' }
              }
            }
          }
        }
      },
      submitLabel: { type: 'string', label: '提交按钮', default: '提交' },
      resetLabel: { type: 'string', label: '重置按钮', default: '重置' },
      endpoint: { type: 'string', label: '提交地址', description: 'POST/GET 目标；留空时只做本地预览。' },
      method: { type: 'enum', label: '提交方式', options: ['POST', 'GET'], default: 'POST' },
      successText: { type: 'string', label: '成功文案', default: '提交成功' },
      errorText: { type: 'string', label: '错误文案', default: '提交失败，请稍后重试' },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'error'], default: 'ready' },
      errors: { type: 'object', label: '初始错误', default: {} }
    }
  };

  function normalizeWhen(rule) {
    if (!rule || typeof rule !== 'object' || !rule.field) return null;
    var has = Object.prototype.hasOwnProperty;
    return {
      field: String(rule.field),
      hasEquals: has.call(rule, 'equals'),
      equals: rule.equals,
      hasNotEquals: has.call(rule, 'notEquals'),
      notEquals: rule.notEquals,
      notEmpty: rule.notEmpty === true,
      'in': Array.isArray(rule['in']) ? rule['in'].map(function (item) { return String(item); }) : null
    };
  }

  function normalizeFields(fields) {
    return (Array.isArray(fields) ? fields : []).filter(function (field) {
      return field && typeof field === 'object';
    }).map(function (field, index) {
      var type = TYPES.indexOf(field.type) === -1 ? 'text' : field.type;
      var options = (Array.isArray(field.options) ? field.options : []).map(function (item) {
        if (item && typeof item === 'object') {
          return { value: String(item.value == null ? item.label == null ? '' : item.label : item.value), label: String(item.label == null ? item.value : item.label) };
        }
        return { value: String(item == null ? '' : item), label: String(item == null ? '' : item) };
      });
      return {
        name: String(field.name == null ? 'field-' + (index + 1) : field.name),
        label: String(field.label == null ? field.name || ('字段 ' + (index + 1)) : field.label),
        type: type,
        value: field.value == null ? '' : field.value,
        placeholder: field.placeholder == null ? '' : String(field.placeholder),
        help: field.help == null ? '' : String(field.help),
        required: field.required === true,
        minLength: field.minLength == null ? null : kit.num(field.minLength, null),
        maxLength: field.maxLength == null ? null : kit.num(field.maxLength, null),
        pattern: field.pattern == null || field.pattern === '' ? null : String(field.pattern),
        min: field.min == null ? null : kit.num(field.min, null),
        max: field.max == null ? null : kit.num(field.max, null),
        step: field.step == null ? null : kit.num(field.step, null),
        rows: kit.num(field.rows, 3),
        options: options,
        message: field.message == null ? null : String(field.message),
        disabled: field.disabled === true,
        visibleWhen: normalizeWhen(field.visibleWhen)
      };
    });
  }

  function isEmptyValue(value) {
    if (Array.isArray(value)) return value.length === 0;
    if (value == null) return true;
    return String(value).trim() === '';
  }

  /* 校验顺序：必填 → 长度 → 正则 → 数值范围。空值只要非必填就直接通过。 */
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

  function visibleFields(fields, values) {
    return (fields || []).filter(function (field) {
      return isFieldVisible(field.visibleWhen, values);
    });
  }

  function validateAll(fields, values) {
    var errors = {};
    visibleFields(fields, values).forEach(function (field) {
      var message = validateField(field, values ? values[field.name] : null);
      if (message) errors[field.name] = message;
    });
    return errors;
  }

  function buildOptions(field, fieldId) {
    return field.options.map(function (option, index) {
      var id = fieldId + '-' + index;
      if (field.type === 'radio') {
        return h('label', { class: 'lc-ui-choice', for: id }, [
          h('input', {
            id: id,
            type: 'radio',
            name: field.name,
            value: option.value,
            'data-lc-control': field.name,
            checked: String(field.value) === option.value ? true : null,
            disabled: field.disabled ? true : null
          }),
          h('span', {}, option.label)
        ]);
      }
      return h('label', { class: 'lc-ui-choice', for: id }, [
        h('input', {
          id: id,
          type: 'checkbox',
          name: field.name,
          value: option.value,
          'data-lc-control': field.name,
          checked: Array.isArray(field.value) && field.value.indexOf(option.value) !== -1 ? true : null,
          disabled: field.disabled ? true : null
        }),
        h('span', {}, option.label)
      ]);
    });
  }

  function buildControl(field, fieldId) {
    var controlAttrs = {
      id: fieldId,
      name: field.name,
      'data-lc-control': field.name,
      'aria-describedby': fieldId + '-help' + (field.help ? '' : ''),
      disabled: field.disabled ? true : null
    };
    if (field.placeholder) controlAttrs.placeholder = field.placeholder;
    if (field.required) controlAttrs.required = true;
    if (field.minLength != null) controlAttrs.minlength = field.minLength;
    if (field.maxLength != null) controlAttrs.maxlength = field.maxLength;
    if (field.pattern) controlAttrs.pattern = field.pattern;
    if (field.min != null) controlAttrs.min = field.min;
    if (field.max != null) controlAttrs.max = field.max;
    if (field.step != null) controlAttrs.step = field.step;

    if (field.type === 'textarea') {
      return h('textarea', controlAttrs, field.value == null ? '' : String(field.value));
    }
    if (field.type === 'select') {
      return h('select', controlAttrs, [
        field.placeholder ? h('option', { value: '' }, field.placeholder) : null,
        field.options.map(function (option) {
          return h('option', {
            value: option.value,
            selected: String(field.value) === option.value ? true : null
          }, option.label);
        })
      ]);
    }
    if (field.type === 'checkbox' || field.type === 'radio') {
      /* 分组控件不再套 label[for]，避免和每个选项的 label 抢焦点。 */
      return h('div', {
        class: 'lc-ui-choice-group',
        role: field.type === 'radio' ? 'radiogroup' : 'group',
        'aria-labelledby': fieldId + '-label'
      }, buildOptions(field, fieldId));
    }
    controlAttrs.type = field.type === 'number' ? 'number' : field.type;
    controlAttrs.value = field.value == null ? '' : String(field.value);
    controlAttrs.autocomplete = field.type === 'password' ? 'current-password' : 'off';
    return h('input', controlAttrs);
  }

  function render(block, ctx) {
    var fields = normalizeFields(kit.prop(block, 'fields', []));
    var state = kit.stateOf(block, fields.length > 0);
    var errors = kit.prop(block, 'errors', {}) || {};
    var submitLabel = kit.prop(block, 'submitLabel', '提交');
    var resetLabel = kit.prop(block, 'resetLabel', '重置');
    var successText = kit.prop(block, 'successText', '提交成功');
    var errorText = kit.prop(block, 'errorText', '提交失败，请稍后重试');
    var endpoint = kit.prop(block, 'endpoint', '');
    var method = String(kit.prop(block, 'method', 'POST')).toUpperCase() === 'GET' ? 'GET' : 'POST';

    var rootAttrs = {
      class: 'lc-ui lc-ui-form',
      'data-lc-ui': 'ui-form',
      'data-lc-state': state
    };

    if (state === 'empty' || fields.length === 0) {
      return h('div', rootAttrs, [
        kit.renderStatus('empty', { title: '表单还没有字段', text: '给 fields 添加至少一项即可开始填写。' }),
        kit.raw(kit.jsonIsland({ fields: fields }))
      ]);
    }

    var statusNode = null;
    if (state === 'loading') {
      statusNode = kit.renderStatus('loading', { title: '正在提交', text: '请稍候，提交完成前不要关闭页面。' });
    } else if (state === 'error') {
      statusNode = kit.renderStatus('error', { title: '提交失败', text: errorText, retry: false });
    } else if (state === 'success') {
      statusNode = h('div', {
        class: 'lc-ui-form-note lc-ui-form-note-ok',
        role: 'status',
        'aria-live': 'polite',
        'data-lc-form-note': 'ok'
      }, [kit.icon('check', 'lc-icon-sm'), h('span', {}, successText)]);
    }

    var initialValues = {};
    fields.forEach(function (field) {
      if (field.type === 'checkbox') {
        initialValues[field.name] = Array.isArray(field.value) ? field.value.map(String) : (field.value ? [String(field.value)] : []);
      } else {
        initialValues[field.name] = field.value == null ? '' : String(field.value);
      }
    });

    var fieldNodes = fields.map(function (field) {
      var fieldId = kit.uid('lc-ui-field');
      var visible = isFieldVisible(field.visibleWhen, initialValues);
      var helpId = fieldId + '-help';
      var errorId = fieldId + '-error';
      var labelNode = h('label', {
        class: 'lc-ui-label',
        id: field.type === 'checkbox' || field.type === 'radio' ? fieldId + '-label' : null,
        for: field.type === 'checkbox' || field.type === 'radio' ? null : fieldId
      }, [
        field.label,
        field.required ? h('span', { class: 'lc-ui-required', 'aria-hidden': 'true' }, ' *') : null
      ]);
      var initialError = errors && errors[field.name] ? String(errors[field.name]) : '';
      var control = buildControl(field, fieldId);
      if (initialError && control && control.attrs) {
        control.attrs['aria-invalid'] = 'true';
        control.attrs['aria-describedby'] = helpId + ' ' + errorId;
      }
      return h('div', {
        class: 'lc-ui-field' + (initialError ? ' has-error' : ''),
        'data-field': field.name,
        'data-visible-when': field.visibleWhen ? JSON.stringify(field.visibleWhen) : null,
        hidden: visible ? null : 'hidden'
      }, [
        labelNode,
        control,
        field.help ? h('p', { class: 'lc-ui-help', id: helpId }, field.help) : null,
        h('p', {
          class: 'lc-ui-error',
          id: errorId,
          role: 'alert',
          'data-lc-error': 'true',
          hidden: initialError ? null : true
        }, initialError)
      ]);
    });

    var children = [statusNode];
    children.push(h('form', { class: 'lc-ui-form-el', 'data-lc-form': 'true', novalidate: true }, [
      h('div', { class: 'lc-ui-fields' }, fieldNodes),
      h('div', { class: 'lc-ui-form-foot' }, [
        h('button', {
          type: 'submit',
          class: 'lc-ui-action lc-ui-action-primary',
          'data-lc-submit': 'true',
          disabled: state === 'loading' ? true : null
        }, submitLabel),
        h('button', { type: 'reset', class: 'lc-ui-action', 'data-lc-reset': 'true' }, resetLabel),
        h('span', { class: 'lc-ui-form-status', 'data-lc-form-status': 'true', role: 'status', 'aria-live': 'polite' })
      ])
    ]));
    children.push(kit.raw(kit.jsonIsland({
      fields: fields,
      state: state,
      endpoint: endpoint,
      method: method,
      successText: successText,
      errorText: errorText
    })));

    return h('div', rootAttrs, children);
  }

  /* ---------------- 运行时增强 ---------------- */

  function controlsFor(form, name) {
    return Array.prototype.slice.call(form.querySelectorAll('input, select, textarea')).filter(function (control) {
      return control.getAttribute('data-lc-control') === name;
    });
  }

  function readValues(form, fields) {
    var values = {};
    fields.forEach(function (field) {
      var controls = controlsFor(form, field.name);
      if (field.type === 'checkbox') {
        values[field.name] = controls.filter(function (control) { return control.checked; })
          .map(function (control) { return control.value; });
      } else if (field.type === 'radio') {
        var hit = controls.filter(function (control) { return control.checked; })[0];
        values[field.name] = hit ? hit.value : '';
      } else {
        values[field.name] = controls.length ? controls[0].value : '';
      }
    });
    return values;
  }

  function setFieldError(fieldBox, message) {
    if (!fieldBox) return;
    var error = fieldBox.querySelector('[data-lc-error]');
    var controls = Array.prototype.slice.call(fieldBox.querySelectorAll('input, select, textarea'));
    if (message) {
      fieldBox.classList.add('has-error');
      if (error) {
        error.textContent = message;
        error.removeAttribute('hidden');
      }
      controls.forEach(function (control) {
        control.setAttribute('aria-invalid', 'true');
      });
    } else {
      fieldBox.classList.remove('has-error');
      if (error) {
        error.textContent = '';
        error.setAttribute('hidden', '');
      }
      controls.forEach(function (control) { control.removeAttribute('aria-invalid'); });
    }
  }

  function enhance(el) {
    if (!el || el.getAttribute('data-lc-enhanced') === 'true') return null;
    var data = kit.readJsonScript(el);
    if (!data || !Array.isArray(data.fields)) return null;
    var fields = data.fields;
    var form = el.querySelector('form') || el.querySelector('[data-lc-form]');
    /* 本组件直接输出字段容器，没有内部 form 元素；找一个包住所有控件的宿主。 */
    if (!form) form = el;
    var statusNode = el.querySelector('[data-lc-form-status]');
    var submit = el.querySelector('[data-lc-submit]');
    var destroyed = false;
    var touched = {};
    var endpoint = String(data.endpoint || '');
    var method = String(data.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
    var successText = String(data.successText || '提交成功');
    var errorText = String(data.errorText || '提交失败，请稍后重试');

    function fieldBox(name) {
      var list = el.querySelectorAll('[data-field]');
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].getAttribute('data-field') === name) return list[i];
      }
      return null;
    }

    function values() { return readValues(form, fields); }

    function applyLinkage() {
      var current = values();
      fields.forEach(function (field) {
        var box = fieldBox(field.name);
        if (!box) return;
        var visible = isFieldVisible(field.visibleWhen, current);
        box.hidden = !visible;
        Array.prototype.slice.call(box.querySelectorAll('input, select, textarea')).forEach(function (control) {
          control.disabled = !visible || field.disabled === true;
        });
      });
    }

    function validateOne(field, silent) {
      var value = values()[field.name];
      var message = isFieldVisible(field.visibleWhen, values()) ? validateField(field, value) : null;
      if (!silent || touched[field.name]) setFieldError(fieldBox(field.name), message);
      return message;
    }

    function setStatus(kind, text) {
      if (!statusNode) return;
      statusNode.className = 'lc-ui-form-status' + (kind ? ' is-' + kind : '');
      statusNode.textContent = text || '';
      if (kind === 'ok' || kind === 'invalid' || kind === 'loading') {
        statusNode.setAttribute('role', 'status');
        statusNode.setAttribute('aria-live', 'polite');
      } else {
        statusNode.setAttribute('role', 'alert');
        statusNode.setAttribute('aria-live', 'assertive');
      }
    }

    function send(current) {
      if (!el.ownerDocument || !el.ownerDocument.defaultView || !el.ownerDocument.defaultView.XMLHttpRequest) {
        setStatus('error', errorText + '：当前环境不支持网络请求。');
        if (submit) submit.disabled = false;
        return;
      }
      var win = el.ownerDocument.defaultView;
      var xhr = new win.XMLHttpRequest();
      xhr.open(method, endpoint, true);
      if (method !== 'GET') xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          setStatus('ok', successText);
          if (submit) submit.disabled = false;
          kit.emit(el, 'lc:form-success', { status: xhr.status, values: current });
        } else {
          setStatus('error', errorText + '（HTTP ' + xhr.status + '）。');
          if (submit) submit.disabled = false;
          kit.emit(el, 'lc:form-error', { status: xhr.status, values: current });
        }
      };
      xhr.onerror = function () {
        setStatus('error', errorText + '：无法连接提交地址。');
        if (submit) submit.disabled = false;
        kit.emit(el, 'lc:form-error', { values: current });
      };
      try {
        xhr.send(method === 'GET' ? null : JSON.stringify(current));
      } catch (error) {
        setStatus('error', errorText + '：请求无法发出。');
        if (submit) submit.disabled = false;
      }
    }

    function onSubmit(event) {
      if (event) event.preventDefault();
      if (!el.isConnected && el.ownerDocument && el.ownerDocument.body && !el.ownerDocument.body.contains(el)) {
        /* 静态离线渲染时 isConnected 可能不可用，继续按本地节点校验。 */
      }
      var current = values();
      applyLinkage();
      var errors = validateAll(fields, current);
      var firstInvalid = null;
      fields.forEach(function (field) {
        var message = errors[field.name] || null;
        setFieldError(fieldBox(field.name), message);
        if (message && !firstInvalid) firstInvalid = field;
      });
      if (firstInvalid) {
        setStatus('invalid', '请检查标红的字段。');
        var box = fieldBox(firstInvalid.name);
        var control = box ? box.querySelector('input, select, textarea') : null;
        if (control) {
          try { control.focus(); } catch (error) { /* 忽略 */ }
        }
        kit.emit(el, 'lc:form-invalid', { values: current, errors: errors });
        return;
      }
      var payload = {};
      visibleFields(fields, current).forEach(function (field) { payload[field.name] = current[field.name]; });
      setStatus('loading', '正在提交…');
      if (submit) submit.disabled = true;
      var outcome = kit.emit(el, 'lc:form-submit', { values: payload, fields: fields });
      /* 外部处理者可以 preventDefault 接管提交；配了地址就真正发送，否则只做本地预览。 */
      if (outcome && outcome.defaultPrevented) {
        setStatus('idle', '已交给外部处理器。');
        if (submit) submit.disabled = false;
        return;
      }
      if (endpoint) {
        send(payload);
      } else {
        setStatus('ok', '提交成功（演示，未发送请求）。');
        if (submit) submit.disabled = false;
      }
    }

    function onChange(event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      var name = target.getAttribute('data-lc-control');
      if (!name) return;
      var field = null;
      fields.forEach(function (item) { if (item.name === name) field = item; });
      if (!field) return;
      touched[name] = true;
      applyLinkage();
      validateOne(field, false);
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
      if (field) validateOne(field, false);
    }

    function onReset() {
      touched = {};
      fields.forEach(function (field) { setFieldError(fieldBox(field.name), null); });
      applyLinkage();
      setStatus('idle', '');
      kit.emit(el, 'lc:form-reset', {});
    }

    el.addEventListener('submit', onSubmit);
    el.addEventListener('change', onChange);
    el.addEventListener('focusout', onBlur);
    el.addEventListener('reset', onReset);
    applyLinkage();

    var api = {
      validate: function () {
        var current = values();
        var errors = validateAll(fields, current);
        fields.forEach(function (field) { setFieldError(fieldBox(field.name), errors[field.name] || null); });
        return errors;
      },
      values: values,
      setStatus: setStatus,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        el.removeEventListener('submit', onSubmit);
        el.removeEventListener('change', onChange);
        el.removeEventListener('focusout', onBlur);
        el.removeEventListener('reset', onReset);
      }
    };
    el.__lcForm = api;
    return api;
  }

  var def = {
    type: 'ui-form',
    name: '表单',
    version: 1,
    schema: SCHEMA,
    sharedCss: kit.css,
    sharedCssId: 'lc-ui-common',
    css: [
      '.lc-ui-form { display: flex; flex-direction: column; gap: var(--lc-space-3-5); }',
      '.lc-ui-form-el { display: flex; flex-direction: column; gap: var(--lc-space-3-5); margin: 0; }',
      '.lc-ui-fields { display: grid; gap: var(--lc-space-3-5); }',
      '.lc-ui-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }',
      '.lc-ui-label { font-size: var(--lc-text-sm, 13px); font-weight: var(--lc-weight-semibold, 600); color: var(--lc-color-ink, var(--ink, inherit)); }',
      '.lc-ui-required { color: var(--lc-color-accent, var(--accent, currentColor)); }',
      '.lc-ui-field input:not([type="checkbox"]):not([type="radio"]), .lc-ui-field select, .lc-ui-field textarea { width: 100%; padding: var(--lc-space-2) var(--lc-space-2-5); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, transparent)); color: var(--lc-color-ink, var(--ink, inherit)); font: inherit; font-size: var(--lc-text-sm, 13px); }',
      '.lc-ui-field textarea { resize: vertical; min-height: 70px; }',
      '.lc-ui-field.has-error input, .lc-ui-field.has-error select, .lc-ui-field.has-error textarea { border-color: var(--lc-color-danger-line); }',
      '.lc-ui-help { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-error { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-danger); }',
      '.lc-ui-choice-group { display: flex; flex-wrap: wrap; gap: var(--lc-space-2) var(--lc-space-4); }',
      '.lc-ui-choice { display: inline-flex; align-items: center; gap: var(--lc-space-1-5); font-size: var(--lc-text-sm, 13px); color: var(--lc-color-ink-2, var(--ink-2, inherit)); }',
      '.lc-ui-choice input { accent-color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-form-foot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lc-space-2-5); }',
      '.lc-ui-form-status { font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-form-status.is-ok { color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-form-status.is-invalid { color: var(--lc-color-danger); }',
      '.lc-ui-form-status.is-error { color: var(--lc-color-danger); }',
      '.lc-ui-field[hidden] { display: none; }',
      '.lc-ui-form-note { display: flex; align-items: center; gap: var(--lc-space-1-5); padding: var(--lc-space-2-5) var(--lc-space-3); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); font-size: var(--lc-text-sm, 13px); }',
      '.lc-ui-form-note-ok { border-color: var(--lc-color-accent-line, var(--accent-line, #999)); background: var(--lc-color-accent-soft, var(--accent-soft, transparent)); color: var(--lc-color-accent, var(--accent, #3e6a56)); }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeFields: normalizeFields,
      validateField: validateField,
      validateAll: validateAll,
      readValues: readValues
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = def;
  else dom.Components['ui-form'] = def;

  return def;
}));
