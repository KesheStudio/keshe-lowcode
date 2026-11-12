/* 渲染核心 · 内置组件 · 拖拽上传
   上传地址、请求方法、请求头与字段名全部由使用者配置；没有配置时不发请求，
   并在界面上明确提示「未配置上传地址」，不伪造成功。
   没有真实接口时可切到本地预览模式（mode: 'preview'）：只展示已选文件与大小，不发起上传。
   文件校验（类型/单文件与总大小/数量）、进度、重试、取消、移除都在本组件内完成，且不依赖第三方库。 */
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

  var STATUS = { pending: 1, uploading: 1, success: 1, error: 1, preview: 1 };

  function normalizeHeaders(value) {
    var headers = {};
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        if (item && item.name) headers[String(item.name)] = String(item.value == null ? '' : item.value);
      });
    } else if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { headers[key] = String(value[key]); });
    }
    return headers;
  }

  function hasEndpoint(value) {
    return !!String(value == null ? '' : value).trim();
  }

  /* 站点级上传目标（project.upload）：组件没填的字段继承它，组件填了就覆盖。 */
  function siteUploadOf(ctx) {
    var raw = ctx && ctx.project && ctx.project.upload;
    if (!raw || typeof raw !== 'object' || raw.enabled === false) return null;
    return hasEndpoint(raw.target) ? raw : null;
  }

  function mergeHeaders(base, extra) {
    var out = normalizeHeaders(base);
    var over = normalizeHeaders(extra);
    Object.keys(over).forEach(function (key) { out[key] = over[key]; });
    return out;
  }

  function formatSize(bytes) {
    var size = kit.num(bytes, 0);
    if (!size || size < 0) return '0 B';
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* 已选文件总大小：错误项不计入，避免校验失败的文件持续占额度。 */
  function totalSizeOf(files) {
    return kit.toArray(files).reduce(function (sum, item) {
      if (!item) return sum;
      if ((item.status || 'pending') === 'error') return sum;
      return sum + Math.max(0, kit.num(item.size, 0));
    }, 0);
  }

  function acceptMatch(file, accept) {
    var pattern = String(accept == null ? '' : accept).trim();
    if (!pattern) return true;
    var name = String(file && file.name || '').toLowerCase();
    var type = String(file && file.type || '').toLowerCase();
    var rules = pattern.split(',').map(function (item) { return item.trim().toLowerCase(); }).filter(Boolean);
    return rules.some(function (rule) {
      if (rule.charAt(0) === '.') return name.slice(-rule.length) === rule;
      if (rule === '*/*') return true;
      if (rule.slice(-2) === '/*') return type.indexOf(rule.slice(0, -2) + '/') === 0;
      return type === rule;
    });
  }

  function normalizeFiles(value) {
    var list = kit.toArray(value).filter(function (item) { return item && typeof item === 'object'; });
    return list.map(function (item, index) {
      var status = STATUS[item.status] ? item.status : 'success';
      return {
        id: String(item.id || ('f-' + (index + 1))),
        name: String(item.name || ('文件 ' + (index + 1))),
        size: kit.num(item.size, 0),
        type: String(item.type || ''),
        status: status,
        progress: kit.clamp(kit.num(item.progress, status === 'success' ? 100 : 0), 0, 100),
        url: String(item.url || ''),
        error: String(item.error || '')
      };
    });
  }

  var SCHEMA = {
    type: 'ui-upload',
    name: '拖拽上传',
    version: 1,
    states: ['ready', 'loading', 'empty', 'error'],
    events: ['lc:upload-add', 'lc:upload-progress', 'lc:upload-success', 'lc:upload-error',
      'lc:upload-cancel', 'lc:upload-remove', 'lc:upload-retry'],
    props: {
      endpoint: { type: 'string', label: '上传地址（相对路径或绝对 URL）', default: '' },
      method: { type: 'enum', label: '请求方法', options: ['POST', 'PUT', 'PATCH'], default: 'POST' },
      headers: { type: 'object', label: '自定义请求头', default: {} },
      fieldName: { type: 'string', label: '文件字段名', default: 'file' },
      accept: { type: 'string', label: '接受的文件类型', default: '' },
      multiple: { type: 'boolean', label: '允许多文件', default: true },
      maxFiles: { type: 'number', label: '最多文件数', default: 5 },
      maxSize: { type: 'number', label: '单文件大小上限（字节，0 为不限）', default: 0 },
      maxTotalSize: { type: 'number', label: '总大小上限（字节，0 为不限）', default: 0 },
      mode: { type: 'enum', label: '模式', options: ['upload', 'preview'], default: 'upload' },
      autoUpload: { type: 'boolean', label: '选择后自动上传', default: true },
      files: { type: 'array', label: '已有文件', items: {
        type: 'object', props: {
          name: { type: 'string' }, size: { type: 'number' }, status: { type: 'enum', options: ['pending', 'uploading', 'success', 'error', 'preview'] },
          progress: { type: 'number' }, url: { type: 'string' }, error: { type: 'string' }
        }
      } },
      title: { type: 'string', label: '提示标题', default: '' },
      hint: { type: 'string', label: '提示说明', default: '' },
      disabled: { type: 'boolean', label: '禁用', default: false },
      state: { type: 'enum', label: '状态', options: ['ready', 'loading', 'empty', 'error'], default: 'ready' }
    }
  };

  var DEFAULT_LABELS = {
    title: '拖拽文件到这里，或点击选择',
    hint: '支持多文件；上传地址由使用者配置',
    unconfigured: '未配置上传地址',
    preview: '本地预览',
    previewHint: '本地预览模式：只显示已选文件与大小，不会上传。',
    retry: '重试',
    cancel: '取消',
    remove: '移除',
    uploading: '上传中',
    pending: '待上传',
    success: '已完成',
    error: '上传失败'
  };

  function itemNode(item, labels, configured, preview, scopeId) {
    var meta = formatSize(item.size) + (item.status === 'uploading' ? ' · ' + item.progress + '%' : '');
    var actions = [];
    if (item.status === 'error' && configured && !preview) {
      actions.push(h('button', { type: 'button', class: 'lc-ui-upload-action', 'data-lc-upload-action': 'retry', 'data-lc-file': item.id }, labels.retry));
    }
    if (item.status === 'uploading') {
      actions.push(h('button', { type: 'button', class: 'lc-ui-upload-action', 'data-lc-upload-action': 'cancel', 'data-lc-file': item.id }, labels.cancel));
    }
    actions.push(h('button', { type: 'button', class: 'lc-ui-upload-action', 'data-lc-upload-action': 'remove', 'data-lc-file': item.id }, labels.remove));

    var errorId = (scopeId || 'lc-upload') + '-error-' + item.id;
    var itemAttrs = {
      class: 'lc-ui-upload-item',
      'data-lc-file': item.id,
      'data-status': item.status
    };
    if (item.error) itemAttrs['aria-describedby'] = errorId;

    var statusText = labels[item.status] || item.status;

    var children = [
      h('p', { class: 'lc-ui-upload-name' }, item.name),
      h('p', { class: 'lc-ui-upload-meta' }, meta),
      item.error ? h('p', { class: 'lc-ui-upload-error', id: errorId, role: 'alert' }, item.error) : null
    ];
    if (item.status === 'uploading') {
      children.push(h('div', {
        class: 'lc-ui-upload-progress',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(item.progress),
        'aria-label': item.name + ' 上传进度'
      }, [h('span', { class: 'lc-ui-upload-bar', style: 'width:' + item.progress + '%' })]));
    }
    children.push(h('p', { class: 'lc-ui-upload-status' }, statusText));

    return h('li', itemAttrs, [
      h('div', { class: 'lc-ui-upload-item-main' }, children),
      h('div', { class: 'lc-ui-upload-actions' }, actions)
    ]);
  }

  function render(block, ctx) {
    var id = kit.uid('lc-upload');
    var site = siteUploadOf(ctx);
    var endpoint = kit.prop(block, 'endpoint', '') || (site ? site.target : '');
    var configured = hasEndpoint(endpoint);
    var disabled = kit.bool(kit.prop(block, 'disabled', false), false);
    var state = kit.stateOf(block, true);
    var multiple = kit.bool(kit.prop(block, 'multiple', true), true);
    var accept = kit.prop(block, 'accept', '') || (site ? String(site.accept || '') : '');
    var maxFiles = kit.num(kit.prop(block, 'maxFiles', 5), 5);
    var maxSize = kit.num(kit.prop(block, 'maxSize', 0), 0);
    if (!maxSize && site) maxSize = Math.max(0, kit.num(site.maxBytes, 0));
    var maxTotalSize = kit.num(kit.prop(block, 'maxTotalSize', 0), 0);
    var preview = String(kit.prop(block, 'mode', 'upload') || 'upload') === 'preview';
    var title = kit.prop(block, 'title', '') || DEFAULT_LABELS.title;
    var hint = kit.prop(block, 'hint', '') || (preview
      ? DEFAULT_LABELS.previewHint
      : (configured ? (multiple ? '可一次选择多个文件' : '一次选择一个文件') : DEFAULT_LABELS.unconfigured));
    var files = normalizeFiles(kit.prop(block, 'files', []));
    var labels = {
      retry: kit.prop(block, 'retryLabel', DEFAULT_LABELS.retry),
      cancel: kit.prop(block, 'cancelLabel', DEFAULT_LABELS.cancel),
      remove: kit.prop(block, 'removeLabel', DEFAULT_LABELS.remove),
      pending: DEFAULT_LABELS.pending,
      uploading: DEFAULT_LABELS.uploading,
      success: DEFAULT_LABELS.success,
      error: DEFAULT_LABELS.error,
      preview: DEFAULT_LABELS.preview
    };
    var noticeId = id + '-notice';
    var summaryId = id + '-summary';

    var inputAttrs = {
      type: 'file',
      class: 'lc-ui-upload-input',
      'data-lc-upload-input': 'true',
      tabindex: '-1',
      'aria-hidden': 'true'
    };
    if (multiple) inputAttrs.multiple = 'multiple';
    if (accept) inputAttrs.accept = accept;

    var zone = h('div', {
      class: 'lc-ui-upload-zone',
      role: 'button',
      tabindex: disabled || state === 'loading' ? '-1' : '0',
      'data-lc-upload-zone': 'true',
      'aria-disabled': disabled || state === 'loading' ? 'true' : 'false',
      'aria-describedby': noticeId + ' ' + summaryId
    }, [
      h('span', { class: 'lc-ui-upload-icon', 'aria-hidden': 'true' }, [kit.icon('chevron-up')]),
      h('p', { class: 'lc-ui-upload-title' }, title),
      h('p', { class: 'lc-ui-upload-hint' }, hint),
      h('input', inputAttrs)
    ]);

    var notice = preview
      ? h('div', {
        class: 'lc-ui-upload-notice',
        id: noticeId,
        role: 'status',
        'data-lc-upload-notice': 'true',
        'data-lc-upload-preview': 'true'
      }, [kit.icon('info', 'lc-icon-sm'), h('span', null, DEFAULT_LABELS.previewHint)])
      : (configured ? h('p', { id: noticeId, hidden: 'hidden', 'data-lc-upload-notice': 'true' }, '')
        : h('div', {
          class: 'lc-ui-upload-notice',
          id: noticeId,
          role: 'status',
          'data-lc-upload-notice': 'true'
        }, [kit.icon('warning', 'lc-icon-sm'), h('span', null, DEFAULT_LABELS.unconfigured + '：请在属性中填写 endpoint。')]));

    var summary = h('p', {
      class: 'lc-ui-upload-summary',
      id: summaryId,
      role: 'alert',
      'aria-live': 'assertive',
      'data-lc-upload-summary': 'true',
      hidden: 'hidden'
    });

    var list = files.length ? h('ul', { class: 'lc-ui-upload-list', 'data-lc-upload-list': 'true' },
      files.map(function (item) { return itemNode(item, labels, configured && !preview, preview, id); }))
      : null;

    return h('div', {
      id: id,
      class: 'lc-ui lc-ui-upload' + (configured ? '' : ' lc-ui-upload-unconfigured') + (preview ? ' lc-ui-upload-preview' : ''),
      'data-lc-ui': 'ui-upload',
      'data-lc-state': disabled ? 'error' : state,
      'data-lc-upload': 'true',
      'data-lc-upload-mode': preview ? 'preview' : 'upload',
      'data-endpoint': configured ? 'true' : 'false'
    }, [
      zone,
      notice,
      summary,
      list,
      raw(kit.jsonIsland({
        endpoint: String(endpoint || ''),
        method: String(kit.prop(block, 'method', '') || (site ? site.method : '') || 'POST').toUpperCase(),
        headers: mergeHeaders(site ? site.headers : {}, kit.prop(block, 'headers', {})),
        fieldName: String(kit.prop(block, 'fieldName', '') || (site ? site.fileField : '') || 'file'),
        accept: String(accept || ''),
        multiple: multiple,
        maxFiles: maxFiles,
        maxSize: maxSize,
        maxTotalSize: maxTotalSize,
        mode: preview ? 'preview' : 'upload',
        preview: preview,
        autoUpload: kit.bool(kit.prop(block, 'autoUpload', true), true),
        disabled: disabled,
        labels: labels,
        files: files
      }))
    ]);
  }

  function enhance(el) {
    var rootId = el.id || kit.uid('lc-upload');
    var config = kit.readJsonScript(el) || {};
    var input = el.querySelector('[data-lc-upload-input]');
    var zone = el.querySelector('[data-lc-upload-zone]');
    var listNode = el.querySelector('[data-lc-upload-list]');
    if (!zone) return null;

    var items = normalizeFiles(config.files || []);
    var xhrs = {};
    var seq = 0;
    var labels = config.labels || DEFAULT_LABELS;
    var preview = config.preview === true || config.mode === 'preview';
    var summaryNode = el.querySelector('[data-lc-upload-summary]');

    /* 校验失败的错误既有可见文本（每条 error / 汇总），也通过 role=alert 的汇总区播报。 */
    function announce(text) {
      if (!summaryNode) return;
      if (!text) {
        summaryNode.hidden = true;
        summaryNode.textContent = '';
        return;
      }
      summaryNode.textContent = String(text);
      summaryNode.hidden = false;
    }

    function syncList() {
      if (!items.length) {
        if (listNode && listNode.parentNode) listNode.parentNode.removeChild(listNode);
        listNode = null;
        return;
      }
      if (!listNode) {
        listNode = document.createElement('ul');
        listNode.className = 'lc-ui-upload-list';
        listNode.setAttribute('data-lc-upload-list', 'true');
        el.appendChild(listNode);
      }
      listNode.innerHTML = '';
      items.forEach(function (item) {
        var node = itemNode(item, labels, hasEndpoint(config.endpoint) && !preview, preview, rootId);
        listNode.appendChild(node);
      });
    }

    function emit(name, item, extra) {
      var detail = { id: item.id, name: item.name, size: item.size, type: item.type, status: item.status };
      if (extra) Object.keys(extra).forEach(function (key) { detail[key] = extra[key]; });
      kit.emit(el, name, detail);
    }

    function setState(item, status, patch) {
      item.status = status;
      if (patch) Object.keys(patch).forEach(function (key) { item[key] = patch[key]; });
      syncList();
    }

    function start(item) {
      if (preview) {
        setState(item, 'preview', { progress: 0, error: '' });
        return false;
      }
      if (!hasEndpoint(config.endpoint)) {
        var missing = labels.unconfigured || DEFAULT_LABELS.unconfigured;
        setState(item, 'error', { error: missing + '，无法上传。' });
        announce(missing + '：请在属性中填写 endpoint。');
        emit('lc:upload-error', item, { reason: 'unconfigured' });
        return false;
      }
      if (!item.file) {
        setState(item, 'error', { error: '缺少文件内容，无法重试。' });
        emit('lc:upload-error', item, { reason: 'missing-file' });
        return false;
      }
      var xhr = typeof XMLHttpRequest === 'function' ? new XMLHttpRequest() : null;
      if (!xhr) {
        setState(item, 'error', { error: '当前环境不支持上传请求。' });
        emit('lc:upload-error', item, { reason: 'unsupported' });
        return false;
      }
      xhrs[item.id] = xhr;
      setState(item, 'uploading', { progress: 0, error: '' });
      emit('lc:upload-add', item, { auto: true });
      try {
        xhr.open(config.method || 'POST', config.endpoint, true);
        var headers = config.headers || {};
        Object.keys(headers).forEach(function (name) { xhr.setRequestHeader(name, headers[name]); });
        if (xhr.upload) {
          xhr.upload.onprogress = function (event) {
            if (!event || !event.lengthComputable) return;
            var percent = Math.round((event.loaded / event.total) * 100);
            item.progress = kit.clamp(percent, 0, 100);
            setState(item, 'uploading');
            emit('lc:upload-progress', item, { progress: item.progress });
          };
        }
        xhr.onload = function () {
          delete xhrs[item.id];
          var ok = xhr.status >= 200 && xhr.status < 300;
          if (ok) {
            var url = '';
            try {
              var data = JSON.parse(xhr.responseText || '{}');
              url = String(data.url || data.path || '');
            } catch (error) { url = ''; }
            setState(item, 'success', { progress: 100, url: url, error: '' });
            emit('lc:upload-success', item, { url: url, response: xhr.responseText });
          } else {
            setState(item, 'error', { error: '上传失败（HTTP ' + xhr.status + '）。' });
            emit('lc:upload-error', item, { reason: 'http', status: xhr.status });
          }
        };
        xhr.onerror = function () {
          delete xhrs[item.id];
          setState(item, 'error', { error: '网络错误，上传失败。' });
          emit('lc:upload-error', item, { reason: 'network' });
        };
        xhr.onabort = function () {
          delete xhrs[item.id];
        };
        var form = new FormData();
        form.append(config.fieldName || 'file', item.file, item.name);
        xhr.send(form);
      } catch (error) {
        delete xhrs[item.id];
        setState(item, 'error', { error: '上传请求无法发起：' + (error && error.message ? error.message : '未知错误') });
        emit('lc:upload-error', item, { reason: 'exception' });
      }
      return true;
    }

    function addFiles(fileList) {
      var incoming = Array.prototype.slice.call(fileList || []);
      if (!config.multiple) incoming = incoming.slice(0, 1);
      incoming.forEach(function (file) {
        if (!file) return;
        seq += 1;
        var id = 'f-' + seq + '-' + String(file.name || 'file').replace(/[^\w.-]+/g, '-');
        var base = {
          id: id,
          name: String(file.name || '未命名文件'),
          size: kit.num(file.size, 0),
          type: String(file.type || ''),
          status: preview ? 'preview' : 'pending',
          progress: 0,
          url: '',
          error: ''
        };
        function reject(reason, message) {
          base.status = 'error';
          base.error = message;
          items.push(base);
          announce('「' + base.name + '」' + message);
          emit('lc:upload-error', base, { reason: reason });
        }
        if (items.filter(function (entry) { return entry.status !== 'error'; }).length >= config.maxFiles) {
          reject('max-files', '最多允许 ' + config.maxFiles + ' 个文件。');
          return;
        }
        if (config.maxSize && base.size > config.maxSize) {
          reject('max-size', '文件超过大小上限（' + formatSize(config.maxSize) + '）。');
          return;
        }
        if (config.maxTotalSize && totalSizeOf(items) + base.size > config.maxTotalSize) {
          reject('max-total-size', '已选文件总大小将超过上限（' + formatSize(config.maxTotalSize) + '）。');
          return;
        }
        if (!acceptMatch(file, config.accept)) {
          reject('accept', '文件类型不符合要求（' + config.accept + '）。');
          return;
        }
        base.file = file;
        items.push(base);
        announce('');
        emit('lc:upload-add', base, { auto: false, mode: preview ? 'preview' : 'upload' });
        if (config.autoUpload && !preview) start(base);
      });
      syncList();
    }

    function findItem(id) {
      for (var i = 0; i < items.length; i += 1) if (items[i].id === id) return items[i];
      return null;
    }

    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var action = target.closest('[data-lc-upload-action]');
      if (action) {
        var item = findItem(action.getAttribute('data-lc-file'));
        if (!item) return;
        var kind = action.getAttribute('data-lc-upload-action');
        if (kind === 'retry') {
          if (preview) return;
          emit('lc:upload-retry', item, {});
          start(item);
        } else if (kind === 'remove') {
          var xhr = xhrs[item.id];
          if (xhr) { try { xhr.abort(); } catch (error) { /* noop */ } delete xhrs[item.id]; }
          items = items.filter(function (entry) { return entry.id !== item.id; });
          syncList();
          emit('lc:upload-remove', item, {});
        } else if (kind === 'cancel') {
          var current = xhrs[item.id];
          if (current) {
            try { current.abort(); } catch (error) { /* noop */ }
            delete xhrs[item.id];
          }
          setState(item, 'error', { error: '已取消上传。' });
          emit('lc:upload-cancel', item, {});
        }
        return;
      }
      if (target.closest('[data-lc-upload-zone]') && input) {
        if (target === input) return;
        input.click();
      }
    }

    function onKeydown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!event.target || !event.target.closest || !event.target.closest('[data-lc-upload-zone]')) return;
      event.preventDefault();
      if (input) input.click();
    }

    function onChange() {
      addFiles(input.files);
      try { input.value = ''; } catch (error) { /* noop */ }
    }

    var dragging = 0;
    function onDragEnter() { dragging += 1; el.classList.add('is-dragging'); }
    function onDragLeave() { dragging = Math.max(0, dragging - 1); if (!dragging) el.classList.remove('is-dragging'); }
    function onDragOver(event) { event.preventDefault(); el.classList.add('is-dragging'); }
    function onDrop(event) {
      event.preventDefault();
      dragging = 0;
      el.classList.remove('is-dragging');
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) addFiles(files);
    }

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    if (input) input.addEventListener('change', onChange);

    var api = {
      addFiles: addFiles,
      uploadAll: function () {
        if (preview) return 0;
        var started = 0;
        items.forEach(function (item) { if (item.status === 'pending' && start(item)) started += 1; });
        return started;
      },
      mode: function () { return preview ? 'preview' : 'upload'; },
      getItems: function () {
        return items.map(function (item) {
          return { id: item.id, name: item.name, size: item.size, status: item.status, progress: item.progress, error: item.error };
        });
      },
      destroy: function () {
        el.removeEventListener('click', onClick);
        el.removeEventListener('keydown', onKeydown);
        el.removeEventListener('dragenter', onDragEnter);
        el.removeEventListener('dragleave', onDragLeave);
        el.removeEventListener('dragover', onDragOver);
        el.removeEventListener('drop', onDrop);
        if (input) input.removeEventListener('change', onChange);
        Object.keys(xhrs).forEach(function (id) { try { xhrs[id].abort(); } catch (error) { /* noop */ } });
        xhrs = {};
      }
    };
    el.__lcUpload = api;
    return api;
  }

  var def = {
    type: SCHEMA.type,
    name: SCHEMA.name,
    version: SCHEMA.version,
    schema: SCHEMA,
    css: [
      '.lc-ui-upload { display: flex; flex-direction: column; gap: var(--lc-space-2-5); }',
      '.lc-ui-upload-zone { position: relative; display: flex; flex-direction: column; align-items: center; gap: var(--lc-space-1); padding: 22px var(--lc-space-4); border: 2px dashed var(--lc-color-line-strong, var(--line-strong, #bbb)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface-2, var(--surface-2, #f6f4ec)); text-align: center; cursor: pointer; transition: border-color 140ms ease, background 140ms ease; }',
      '.lc-ui-upload-zone:hover, .lc-ui-upload-zone:focus-visible { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); background: var(--lc-color-surface, var(--surface, #fff)); }',
      '.lc-ui-upload.is-dragging .lc-ui-upload-zone { border-color: var(--lc-color-accent, var(--accent, #3e6a56)); background: var(--lc-color-accent-soft, var(--accent-soft, #eef6f2)); }',
      '.lc-ui-upload-zone[aria-disabled="true"] { cursor: not-allowed; opacity: 0.6; }',
      '.lc-ui-upload-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--lc-color-accent-soft, var(--accent-soft, #e2efe8)); color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-upload-title { margin: var(--lc-space-1-5) 0 0; font-size: var(--lc-text-sm, 14px); font-weight: 600; color: var(--lc-color-ink, var(--ink, inherit)); }',
      '.lc-ui-upload-hint { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-upload-input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
      '.lc-ui-upload-notice { display: flex; align-items: center; gap: var(--lc-space-1-5); padding: var(--lc-space-2) var(--lc-space-2-5); border: 1px dashed var(--lc-color-line-strong, #bbb); border-radius: var(--lc-radius-sm, 5px); background: var(--lc-color-surface-3, var(--surface-3, #eee)); font-size: var(--lc-text-xs, 12px); color: var(--lc-color-muted, var(--muted, #666)); }',
      '.lc-ui-upload-summary { margin: 0; font-size: var(--lc-text-xs, 12px); color: var(--lc-color-danger); }',
      '.lc-ui-upload-summary[hidden] { display: none; }',
      '.lc-ui-upload-item[data-status="preview"] { border-style: dashed; }',
      '.lc-ui-upload-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--lc-space-2); }',
      '.lc-ui-upload-item { display: flex; align-items: flex-start; gap: var(--lc-space-2-5); padding: 9px 11px; border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-md, var(--radius, 8px)); background: var(--lc-color-surface, var(--surface, #fff)); }',
      '.lc-ui-upload-item[data-status="error"] { border-color: var(--lc-color-danger-line); }',
      '.lc-ui-upload-item-main { flex: 1; min-width: 0; }',
      '.lc-ui-upload-name { margin: 0; font-size: var(--lc-text-sm, 13px); font-weight: 600; color: var(--lc-color-ink, var(--ink, inherit)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.lc-ui-upload-meta { margin: 1px 0 0; font-size: var(--lc-text-xs, 11px); color: var(--lc-color-muted-2, var(--muted-2, #888)); font-variant-numeric: tabular-nums; }',
      '.lc-ui-upload-error { margin: 3px 0 0; font-size: var(--lc-text-xs, 11px); color: var(--lc-color-danger); }',
      '.lc-ui-upload-progress { height: 4px; margin-top: var(--lc-space-1-5); border-radius: var(--lc-radius-full); background: var(--lc-color-line, var(--line, #ddd)); overflow: hidden; }',
      '.lc-ui-upload-bar { display: block; height: 100%; width: 0; background: var(--lc-color-accent, var(--accent, #3e6a56)); transition: width 120ms linear; }',
      '.lc-ui-upload-status { margin: 3px 0 0; font-size: var(--lc-text-xs, 11px); color: var(--lc-color-muted, var(--muted, #777)); }',
      '.lc-ui-upload-actions { display: flex; gap: var(--lc-space-1-5); flex: none; }',
      '.lc-ui-upload-action { padding: 2px var(--lc-space-2); border: var(--lc-border-width, 1px) solid var(--lc-color-line, var(--line, #ddd)); border-radius: var(--lc-radius-sm, 5px); background: var(--lc-color-surface-2, var(--surface-2, #fff)); color: var(--lc-color-ink-2, var(--ink-2, #444)); font: inherit; font-size: var(--lc-text-xs, 11px); cursor: pointer; }',
      '.lc-ui-upload-action:hover { border-color: var(--lc-color-accent-line, var(--accent-line, #999)); color: var(--lc-color-accent, var(--accent, #3e6a56)); }',
      '.lc-ui-upload-unconfigured .lc-ui-upload-zone { border-style: dotted; }'
    ].join('\n'),
    render: render,
    enhance: enhance,
    helpers: {
      normalizeHeaders: normalizeHeaders,
      normalizeFiles: normalizeFiles,
      hasEndpoint: hasEndpoint,
      formatSize: formatSize,
      totalSizeOf: totalSizeOf,
      acceptMatch: acceptMatch,
      splitAccept: function (accept) { return String(accept || '').split(',').map(function (item) { return item.trim(); }).filter(Boolean); }
    }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = def;
  } else {
    dom.Components['ui-upload'] = def;
  }

  return def;
}));
