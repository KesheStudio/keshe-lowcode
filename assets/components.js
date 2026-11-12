/*
 * 组件库管理页。
 *
 * 只调用服务端组件接口；预览由服务端统一套用 CSS 作用域后再塞进 sandbox iframe。
 * 保存前服务端会拦截 document.write / innerHTML 拼接；字段破坏性改动返回 409 + 影响页面。 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var TOKEN = tokenMeta ? tokenMeta.getAttribute('content') : '';

  var FIELD_LABELS = {
    text: '文本',
    textarea: '多行文本',
    number: '数字',
    boolean: '布尔',
    color: '颜色',
    enum: '枚举',
    datasource: '数据源引用',
    image: '图片'
  };

  var ICON_PATHS = {
    box: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>',
    layout: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M9 10h11"/>',
    text: '<path d="M5 7h14M5 12h14M5 17h9"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l5-5 4 4 3-2 2 2"/>',
    table: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 4v16M14 4v16"/>',
    form: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5M8 17h3"/>',
    chart: '<path d="M4 19V5M4 19h16"/><path d="M7 16l4-5 4 3 4-7"/>',
    star: '<path d="M12 4l2.4 5 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.8l5.4-.8z"/>',
    code: '<path d="M9 6L4 12l5 6M15 6l5 6-5 6"/>',
    bolt: '<path d="M13 3L5 14h5l-1 7 8-11h-5z"/>'
  };

  var refs = {
    siteSelect: document.querySelector('[data-site-select]'),
    backBuilder: document.querySelector('[data-back-builder]'),
    search: document.querySelector('[data-search]'),
    categoryFilter: document.querySelector('[data-category-filter]'),
    tagFilter: document.querySelector('[data-tag-filter]'),
    newComponent: document.querySelector('[data-new-component]'),
    componentCount: document.querySelector('[data-component-count]'),
    componentList: document.querySelector('[data-component-list]'),
    trashCount: document.querySelector('[data-trash-count]'),
    trashList: document.querySelector('[data-trash-list]'),
    importOpen: document.querySelector('[data-import-open]'),
    importFile: document.querySelector('[data-import-file]'),
    limitFields: document.querySelector('[data-limit-fields]'),
    limitTemplate: document.querySelector('[data-limit-template]'),
    editorTitle: document.querySelector('[data-editor-title]'),
    editorMeta: document.querySelector('[data-editor-meta]'),
    editorState: document.querySelector('[data-editor-state]'),
    copy: document.querySelector('[data-copy-component]'),
    duplicate: document.querySelector('[data-duplicate-component]'),
    export: document.querySelector('[data-export-component]'),
    remove: document.querySelector('[data-delete-component]'),
    save: document.querySelector('[data-save-component]'),
    empty: document.querySelector('[data-empty]'),
    editor: document.querySelector('[data-editor]'),
    builtinBadge: document.querySelector('[data-builtin-badge]'),
    metaName: document.querySelector('[data-meta-name]'),
    metaId: document.querySelector('[data-meta-id]'),
    metaCategory: document.querySelector('[data-meta-category]'),
    metaIcon: document.querySelector('[data-meta-icon]'),
    metaTags: document.querySelector('[data-meta-tags]'),
    metaDescription: document.querySelector('[data-meta-description]'),
    fieldList: document.querySelector('[data-field-list]'),
    addField: document.querySelector('[data-add-field]'),
    tabs: Array.prototype.slice.call(document.querySelectorAll('[data-tab]')),
    codePanels: Array.prototype.slice.call(document.querySelectorAll('[data-code-panel]')),
    codeHtml: document.querySelector('[data-code-html]'),
    codeCss: document.querySelector('[data-code-css]'),
    codeJs: document.querySelector('[data-code-js]'),
    codeStatus: document.querySelector('[data-code-status]'),
    codeError: document.querySelector('[data-code-error]'),
    scopePrefix: document.querySelector('[data-scope-prefix]'),
    scopeCss: document.querySelector('[data-scope-css]'),
    scopeJs: document.querySelector('[data-scope-js]'),
    scopeJsNotes: document.querySelector('[data-scope-js-notes]'),
    usagePanel: document.querySelector('[data-usage-panel]'),
    dangerPanel: document.querySelector('[data-danger-panel]'),
    previewFrame: document.querySelector('[data-preview-frame]'),
    previewCard: document.querySelector('.lc-comp-preview'),
    previewStatus: document.querySelector('[data-preview-status]'),
    previewErrors: document.querySelector('[data-preview-errors]'),
    previewModes: Array.prototype.slice.call(document.querySelectorAll('[data-preview-mode]')),
    sampleFields: document.querySelector('[data-sample-fields]'),
    trashPanel: document.querySelector('[data-trash-panel]'),
    trashBack: document.querySelector('[data-trash-back]'),
    trashDetail: document.querySelector('[data-trash-detail]')
  };

  var state = {
    sites: [],
    siteId: '',
    items: [],
    tags: [],
    trash: [],
    meta: null,
    selected: null,
    draft: null,
    dirty: false,
    readOnly: false,
    isNew: false,
    idGenerated: false,
    activeTab: 'html',
    previewMode: 'light',
    sample: {},
    previewTimer: 0,
    previewSeq: 0,
    previewRuntimeSeen: {},
    saving: false,
    confirmMode: '',
    tokensCss: ''
  };

  /* ---------------- 基础工具 ---------------- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&#39;';
    });
  }

  function attr(value) {
    return esc(value);
  }

  function api(path, options) {
    var opts = options || {};
    var headers = { 'x-lc-token': TOKEN };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store'
    }).catch(function (error) {
      throw error && error.name === 'TypeError' ? new Error('无法连接本地服务，请确认应用仍在运行后重试') : error;
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || payload.ok === false) {
          var error = new Error((payload.error && payload.error.message) || ('请求失败（' + response.status + '）'));
          error.code = payload.error && payload.error.code;
          error.detail = payload.error && payload.error.detail;
          error.status = response.status;
          throw error;
        }
        return payload.data;
      });
    });
  }

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'lc-toast' + (kind === 'error' ? ' is-error' : kind === 'warn' ? ' is-warn' : kind === 'ok' ? ' is-success' : '');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3800);
  }

  function siteBase() {
    return '/api/sites/' + encodeURIComponent(state.siteId);
  }

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function iconSvg(name) {
    var path = ICON_PATHS[name] || ICON_PATHS.box;
    return '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">' + path + '</svg>';
  }

  function categoryLabel(value) {
    var cats = (state.meta && state.meta.categories) || [];
    var found = cats.find(function (item) { return item.value === value; });
    return found ? found.label : (value || '其他');
  }

  function fieldLabel(type) {
    return FIELD_LABELS[type] || type;
  }

  function stateBadge(text, kind) {
    if (!refs.editorState) return;
    refs.editorState.hidden = !text;
    refs.editorState.textContent = text || '';
    refs.editorState.className = 'lc-badge ' + (kind === 'error' ? 'lc-badge-danger' : kind === 'ok' ? 'lc-badge-success' : 'lc-badge-accent');
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    if (!state.selected) return;
    if (state.readOnly) {
      stateBadge('内置 · 只读');
    } else {
      stateBadge(state.dirty ? '未保存' : '已保存', state.dirty ? 'accent' : 'ok');
    }
  }

  function hideDanger() {
    state.confirmMode = '';
    refs.dangerPanel.hidden = true;
    refs.dangerPanel.innerHTML = '';
  }

  function resetToolbar() {
    [refs.copy, refs.duplicate, refs.export, refs.remove, refs.save].forEach(function (button) {
      if (button) button.disabled = true;
    });
    stateBadge('');
  }

  function hideCodeError() {
    refs.codeError.hidden = true;
    refs.codeError.textContent = '';
    if (refs.codeStatus) refs.codeStatus.textContent = '';
  }

  function showCodeError(message) {
    refs.codeError.hidden = false;
    refs.codeError.textContent = message;
  }

  /* ---------------- 站点与列表 ---------------- */

  function renderSiteSelect() {
    refs.siteSelect.innerHTML =
      (state.siteId ? '' : '<option value="" selected>请选择项目</option>') +
      state.sites.map(function (site) {
        return '<option value="' + attr(site.siteId) + '"' + (site.siteId === state.siteId ? ' selected' : '') + '>' +
          esc(site.name || site.siteId) + '</option>';
      }).join('');
  }

  /* 未明确项目时不落到第一个站点：组件库只读提示，新建/导入禁用。 */
  function showProjectGate() {
    state.siteId = '';
    state.items = [];
    renderSiteSelect();
    if (refs.backBuilder) refs.backBuilder.href = 'builder.html';
    syncSiteLinks('');
    refs.componentList.innerHTML = '<div class="lc-comp-section-note">还没有选择项目。从工作台的项目卡片进入，或在右上角「项目」里选一个项目后再编辑。</div>';
    refs.componentCount.textContent = '0 个';
    [refs.newComponent, refs.importOpen].forEach(function (control) {
      if (control) control.disabled = true;
    });
    if (refs.empty) refs.empty.hidden = true;
    if (refs.editor) refs.editor.hidden = true;
  }

  function loadSites() {
    return api('/api/sites').then(function (sites) {
      state.sites = Array.isArray(sites) ? sites : [];
      if (!state.sites.length) {
        refs.componentList.innerHTML = '<div class="lc-comp-section-note">还没有项目，先到 Builder 创建一个项目。</div>';
        refs.componentCount.textContent = '0 个';
        return;
      }
      var params = new URLSearchParams(window.location.search);
      var requested = params.get('site') || '';
      if (!requested || !state.sites.some(function (site) { return site.siteId === requested; })) {
        showProjectGate();
        return;
      }
      return loadSite(requested);
    });
  }

  /* 顶栏里的跨功能出口统一带当前站点，避免跳到模板库/数据源/导出时丢失项目上下文。 */
  function syncSiteLinks(siteId) {
    Array.prototype.forEach.call(document.querySelectorAll('a[data-site-link]'), function (link) {
      var base = link.getAttribute('data-site-link');
      link.href = siteId ? base + '?site=' + encodeURIComponent(siteId) : base;
    });
  }

  function loadSite(siteId) {
    state.siteId = siteId;
    if (refs.backBuilder) refs.backBuilder.href = 'builder.html?site=' + encodeURIComponent(siteId);
    syncSiteLinks(siteId);
    [refs.newComponent, refs.importOpen].forEach(function (control) {
      if (control) control.disabled = false;
    });
    state.selected = null;
    state.draft = null;
    state.items = [];
    state.trash = [];
    state.sample = {};
    hideDanger();
    hideCodeError();
    refs.trashPanel.hidden = true;
    refs.editor.hidden = true;
    refs.empty.hidden = false;
    refs.editorTitle.textContent = '读取中…';
    resetToolbar();
    renderSiteSelect();
    return Promise.all([
      api(siteBase() + '/components/meta'),
      api(siteBase() + '/components'),
      api(siteBase() + '/components/trash')
    ]).then(function (results) {
      state.meta = results[0];
      state.items = (results[1] && results[1].items) || [];
      state.tags = (results[1] && results[1].tags) || [];
      state.trash = (results[2] && results[2].items) || [];
      applyMeta();
      renderFilters();
      renderList();
      renderTrash();
      refs.editorTitle.textContent = '选择一个组件';
      var firstCustom = state.items.find(function (item) { return !item.builtin; });
      var first = firstCustom || state.items[0];
      if (first) return selectComponent(first.id);
    }).catch(function (error) {
      toast(error.message, 'error');
      refs.componentList.innerHTML = '<div class="lc-comp-section-note">读取失败：' + esc(error.message) + '</div>';
    });
  }

  function applyMeta() {
    if (!state.meta) return;
    refs.limitFields.textContent = String(state.meta.limits.fieldsPerComponent);
    refs.limitTemplate.textContent = Math.round(state.meta.limits.templateBytes / 1024) + ' KB';

    refs.metaCategory.innerHTML = (state.meta.categories || []).map(function (item) {
      return '<option value="' + attr(item.value) + '">' + esc(item.label) + '</option>';
    }).join('');
    refs.metaIcon.innerHTML = (state.meta.icons || []).map(function (item) {
      return '<option value="' + attr(item.value) + '">' + esc(item.label) + '</option>';
    }).join('');
  }

  function renderFilters() {
    var cats = (state.meta && state.meta.categories) || [];
    var current = refs.categoryFilter.value;
    refs.categoryFilter.innerHTML = '<option value="">全部类别</option>' + cats.map(function (item) {
      return '<option value="' + attr(item.value) + '">' + esc(item.label) + '</option>';
    }).join('');
    refs.categoryFilter.value = current && cats.some(function (item) { return item.value === current; }) ? current : '';

    var tags = state.tags.slice();
    var currentTag = refs.tagFilter.value;
    refs.tagFilter.innerHTML = '<option value="">全部标签</option>' + tags.map(function (tag) {
      return '<option value="' + attr(tag) + '">' + esc(tag) + '</option>';
    }).join('');
    refs.tagFilter.value = currentTag && tags.indexOf(currentTag) !== -1 ? currentTag : '';
  }

  function renderList() {
    var items = state.items.slice();
    var query = String(refs.search.value || '').trim().toLowerCase();
    var category = refs.categoryFilter.value;
    var tag = refs.tagFilter.value;
    if (query) {
      items = items.filter(function (item) {
        var haystack = [item.name, item.id, item.description].concat(item.tags || []).join(' ').toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }
    if (category) items = items.filter(function (item) { return item.category === category; });
    if (tag) items = items.filter(function (item) { return (item.tags || []).indexOf(tag) !== -1; });

    var custom = items.filter(function (item) { return !item.builtin; });
    var builtins = items.filter(function (item) { return item.builtin; });
    refs.componentCount.textContent = custom.length + ' 自定义 · ' + builtins.length + ' 内置';

    if (!items.length) {
      refs.componentList.innerHTML = '<div class="lc-comp-section-note">没有匹配的组件。</div>';
      return;
    }

    refs.componentList.innerHTML = items.map(function (item) {
      var active = state.selected && state.selected.id === item.id ? ' is-active' : '';
      var builtinClass = item.builtin ? ' is-builtin' : '';
      var usage = item.builtin
        ? '内置'
        : (item.usageCount ? ('使用 ' + item.usageCount + ' 次 · ' + (item.usagePages || []).length + ' 页') : '未使用');
      return '<button class="lc-comp-item' + active + builtinClass + '" type="button" data-component-id="' + attr(item.id) + '">' +
        '<span class="lc-comp-icon">' + iconSvg(item.icon) + '</span>' +
        '<span class="lc-comp-item-body">' +
          '<span class="lc-comp-item-name">' + esc(item.name) +
            (item.builtin ? ' <span class="lc-badge">内置</span>' : '') +
          '</span>' +
          '<span class="lc-comp-item-meta">' + esc(categoryLabel(item.category)) + ' · ' + esc(item.id) + '</span>' +
        '</span>' +
        '<span class="lc-comp-item-use">' + esc(usage) + '</span>' +
      '</button>';
    }).join('');
  }

  function renderTrash() {
    refs.trashCount.textContent = state.trash.length + ' 个';
    if (!state.trash.length) {
      refs.trashList.innerHTML = '<div class="lc-comp-section-note">回收站为空。</div>';
      refs.trashDetail.innerHTML = '<p class="lc-comp-section-note">回收站为空。</p>';
      return;
    }
    refs.trashList.innerHTML = state.trash.map(function (item) {
      return '<div class="lc-comp-item is-builtin">' +
        '<span class="lc-comp-icon">' + iconSvg('box') + '</span>' +
        '<span class="lc-comp-item-body">' +
          '<span class="lc-comp-item-name">' + esc(item.name) + '</span>' +
          '<span class="lc-comp-item-meta">删除于 ' + esc(formatTime(item.deletedAt)) + '</span>' +
        '</span>' +
        '<button class="lc-comp-item-restore" type="button" data-restore-trash="' + attr(item.trashId) + '">恢复</button>' +
      '</div>';
    }).join('');
    refs.trashDetail.innerHTML = state.trash.map(function (item) {
      return '<div class="lc-comp-trash-row">' +
        '<div><strong>' + esc(item.name) + '</strong><p>' + esc(item.originalId) + ' · 删除于 ' + esc(formatTime(item.deletedAt)) + '</p></div>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-restore-trash="' + attr(item.trashId) + '">恢复</button>' +
      '</div>';
    }).join('');
  }

  function formatTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    try {
      return date.toLocaleString('zh-CN', { hour12: false });
    } catch {
      return String(value);
    }
  }

  /* ---------------- 选中与编辑器 ---------------- */

  function selectComponent(id) {
    if (state.dirty && !window.confirm('当前组件有未保存修改，切换会丢失，继续？')) return Promise.resolve();
    hideDanger();
    hideCodeError();
    refs.trashPanel.hidden = true;
    return api(siteBase() + '/components/' + encodeURIComponent(id)).then(function (component) {
      state.selected = component;
      state.readOnly = Boolean(component.readOnly || component.builtin);
      state.isNew = false;
      state.idGenerated = false;
      state.draft = deepCopy(component);
      state.sample = {};
      (state.draft.fields || []).forEach(function (field) {
        state.sample[field.id] = field.defaultValue === '' || field.defaultValue === undefined ? sampleOf(field) : field.defaultValue;
      });
      refs.empty.hidden = true;
      refs.editor.hidden = false;
      renderList();
      renderEditor();
      setDirty(false);
      schedulePreview();
    }).catch(function (error) {
      toast(error.message, 'error');
    });
  }

  function sampleOf(field) {
    switch (field.type) {
      case 'number': return 12;
      case 'boolean': return true;
      case 'textarea': return '第一行示例文本\n第二行示例文本';
      case 'color': return '#3e6a56';
      case 'enum': return (field.options && field.options[0]) || '选项一';
      case 'datasource': return 'orders';
      case 'image': return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#d8d2c4"/></svg>');
      default: return '示例文本';
    }
  }

  function renderEditor() {
    var component = state.draft;
    if (!component) return;
    refs.editorTitle.textContent = component.name || '未命名组件';
    refs.editorMeta.textContent = component.id + ' · ' + categoryLabel(component.category) + (component.builtin ? ' · 内置' : '');
    refs.builtinBadge.hidden = !component.builtin;
    refs.metaName.value = component.name || '';
    refs.metaId.value = component.id || '';
    refs.metaCategory.value = component.category || 'other';
    refs.metaIcon.value = component.icon || 'box';
    refs.metaTags.value = (component.tags || []).join(', ');
    refs.metaDescription.value = component.description || '';
    refs.codeHtml.value = component.template || '';
    refs.codeCss.value = component.css || '';
    refs.codeJs.value = component.js || '';
    refs.metaName.readOnly = state.readOnly;
    refs.metaId.readOnly = state.readOnly || (!state.isNew && Boolean(component.id));
    refs.metaCategory.disabled = state.readOnly;
    refs.metaIcon.disabled = state.readOnly;
    refs.metaTags.readOnly = state.readOnly;
    refs.metaDescription.readOnly = state.readOnly;
    refs.codeHtml.readOnly = state.readOnly;
    refs.codeCss.readOnly = state.readOnly;
    refs.codeJs.readOnly = state.readOnly;
    refs.addField.disabled = state.readOnly;
    renderFields();
    renderSampleFields();
    renderScope();
    renderUsage();
    syncToolbar();
    updateCodeStatus();
    switchTab(state.activeTab);
  }

  function syncToolbar() {
    var builtin = Boolean(state.draft && state.draft.builtin);
    refs.save.disabled = state.readOnly;
    refs.remove.disabled = state.readOnly;
    refs.export.disabled = state.readOnly;
    refs.copy.disabled = false;
    refs.duplicate.disabled = false;
    refs.copy.textContent = builtin ? '复制为自定义' : '复制一份';
    refs.duplicate.textContent = builtin ? '复制一份' : '复制一份';
  }

  function renderFields() {
    var fields = (state.draft && state.draft.fields) || [];
    if (!fields.length) {
      refs.fieldList.innerHTML = '<p class="lc-comp-section-note">还没有字段。先添加字段，再在 HTML 里用 <code>{{字段 ID}}</code> 取值。</p>';
      return;
    }
    refs.fieldList.innerHTML = fields.map(function (field, index) {
      var enumHidden = field.type === 'enum' ? '' : ' hidden';
      return '<div class="lc-comp-field-row" data-field-row>' +
        '<label class="lc-field"><span class="lc-label">名称</span><input class="lc-input" type="text" data-field-label value="' + attr(field.label) + '"' + (state.readOnly ? ' readonly' : '') + '></label>' +
        '<label class="lc-field"><span class="lc-label">ID（占位符）</span><input class="lc-input lc-comp-mono" type="text" data-field-id value="' + attr(field.id) + '"' + (state.readOnly ? ' readonly' : '') + '></label>' +
        '<label class="lc-field"><span class="lc-label">类型</span><select class="lc-select" data-field-type' + (state.readOnly ? ' disabled' : '') + '>' +
          (state.meta.fieldTypes || []).map(function (item) {
            return '<option value="' + attr(item.value) + '"' + (item.value === field.type ? ' selected' : '') + '>' + esc(item.label) + '</option>';
          }).join('') +
        '</select></label>' +
        '<label class="lc-comp-field-required"><input type="checkbox" data-field-required' + (field.required ? ' checked' : '') + (state.readOnly ? ' disabled' : '') + '> 必填</label>' +
        '<label class="lc-field"><span class="lc-label">默认值</span><input class="lc-input" type="text" data-field-default value="' + attr(field.defaultValue == null ? '' : field.defaultValue) + '"' + (state.readOnly ? ' readonly' : '') + ' placeholder="可留空"></label>' +
        '<button class="lc-comp-field-remove" type="button" data-remove-field="' + index + '" title="删除字段"' + (state.readOnly ? ' disabled' : '') + '>×</button>' +
        '<label class="lc-field lc-comp-field-options" data-field-options-wrap' + enumHidden + '><span class="lc-label">枚举选项 <small>逗号分隔</small></span><input class="lc-input" type="text" data-field-options value="' + attr((field.options || []).join(', ')) + '"' + (state.readOnly ? ' readonly' : '') + '></label>' +
      '</div>';
    }).join('');
  }

  function renderSampleFields() {
    var fields = (state.draft && state.draft.fields) || [];
    if (!fields.length) {
      refs.sampleFields.innerHTML = '<p class="lc-comp-section-note">暂无字段，预览将使用空数据。</p>';
      return;
    }
    refs.sampleFields.innerHTML = fields.map(function (field) {
      var value = state.sample[field.id];
      if (field.type === 'boolean') {
        return '<label class="lc-field"><span class="lc-label">' + esc(field.label) + '</span><select class="lc-select" data-sample="' + attr(field.id) + '">' +
          '<option value="true"' + (value ? ' selected' : '') + '>true</option>' +
          '<option value="false"' + (!value ? ' selected' : '') + '>false</option>' +
        '</select></label>';
      }
      if (field.type === 'enum') {
        var options = field.options && field.options.length ? field.options : ['选项一'];
        return '<label class="lc-field"><span class="lc-label">' + esc(field.label) + '</span><select class="lc-select" data-sample="' + attr(field.id) + '">' +
          options.map(function (option) {
            return '<option value="' + attr(option) + '"' + (String(value) === String(option) ? ' selected' : '') + '>' + esc(option) + '</option>';
          }).join('') +
        '</select></label>';
      }
      return '<label class="lc-field"><span class="lc-label">' + esc(field.label) + '</span><input class="lc-input" type="text" data-sample="' + attr(field.id) + '" value="' + attr(value == null ? '' : value) + '"></label>';
    }).join('');
  }

  function renderScope() {
    var id = (state.draft && state.draft.id) || 'my-card';
    var scope = (state.selected && state.selected.scope) || {
      cssPrefix: '[data-lc-comp="' + id + '"]',
      css: [
        '组件中的每个选择器都会自动加上 [data-lc-comp="' + id + '"] 前缀。',
        ':root / html / body 会映射到组件根节点，不会影响整页。',
        '@import 会被丢弃；@keyframes 名称不改。'
      ],
      js: [
        '每段 JS 都包在独立 IIFE 中执行，root 指向当前实例根节点。',
        '不要写 window.xxx = ... 这样的全局赋值。',
        '禁止 document.write / document.writeln 与 innerHTML 拼接。'
      ]
    };
    refs.scopePrefix.textContent = scope.cssPrefix || ('[data-lc-comp="' + id + '"]');
    refs.scopeCss.innerHTML = (scope.css || []).map(function (textValue) {
      return '<li>' + esc(textValue) + '</li>';
    }).join('');
    refs.scopeJs.textContent = scope.instancePrefix || '[data-lc-instance="<区块 ID>"]';
    refs.scopeJsNotes.innerHTML = (scope.js || []).map(function (textValue) {
      return '<li>' + esc(textValue) + '</li>';
    }).join('');
  }

  function renderUsage() {
    var usagePages = (state.selected && state.selected.usagePages) || [];
    var total = (state.selected && state.selected.usageCount) || 0;
    if (!state.selected) {
      refs.usagePanel.hidden = true;
      return;
    }
    if (state.selected.builtin) {
      refs.usagePanel.hidden = true;
      return;
    }
    refs.usagePanel.hidden = false;
    if (!usagePages.length) {
      refs.usagePanel.innerHTML = '<h4>使用情况</h4><p>当前没有被任何页面引用；删除会进回收站，可恢复。</p>';
      return;
    }
    refs.usagePanel.innerHTML = '<h4>被 ' + usagePages.length + ' 个页面使用，共 ' + total + ' 次</h4><ul>' +
      usagePages.map(function (page) {
        return '<li>' + esc(page.pageTitle) + ' <code>' + esc(page.pagePath || page.pageId) + '</code> · ' + page.count + ' 次</li>';
      }).join('') +
    '</ul>';
  }

  function switchTab(tab) {
    state.activeTab = tab;
    refs.tabs.forEach(function (button) {
      var active = button.getAttribute('data-tab') === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    refs.codePanels.forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-code-panel') !== tab;
    });
  }

  function updateCodeStatus() {
    if (!refs.codeStatus || !state.draft) return;
    refs.codeStatus.textContent = 'HTML ' + (state.draft.template || '').length + ' · CSS ' + (state.draft.css || '').length + ' · JS ' + (state.draft.js || '').length;
  }

  /* ---------------- 表单同步 ---------------- */

  function collectFields() {
    var rows = Array.prototype.slice.call(refs.fieldList.querySelectorAll('[data-field-row]'));
    return rows.map(function (row, index) {
      var optionsInput = row.querySelector('[data-field-options]');
      var options = optionsInput ? optionsInput.value.split(/[,，;；\n]+/).map(function (item) { return item.trim(); }).filter(Boolean) : [];
      return {
        id: row.querySelector('[data-field-id]').value.trim(),
        label: row.querySelector('[data-field-label]').value.trim(),
        type: row.querySelector('[data-field-type]').value,
        required: row.querySelector('[data-field-required]').checked,
        options: options,
        defaultValue: row.querySelector('[data-field-default]').value
      };
    });
  }

  function collectMeta() {
    return {
      name: refs.metaName.value.trim(),
      category: refs.metaCategory.value,
      icon: refs.metaIcon.value,
      tags: refs.metaTags.value.split(/[,，;；\s]+/).map(function (tag) { return tag.trim(); }).filter(Boolean),
      description: refs.metaDescription.value.trim()
    };
  }

  function syncDraftFromForm(markDirty) {
    if (!state.draft || state.readOnly) return;
    Object.assign(state.draft, collectMeta());
    state.draft.id = refs.metaId.value.trim();
    state.draft.fields = collectFields();
    state.draft.template = refs.codeHtml.value;
    state.draft.css = refs.codeCss.value;
    state.draft.js = refs.codeJs.value;
    if (markDirty) setDirty(true);
    refs.editorTitle.textContent = state.draft.name || '未命名组件';
    updateCodeStatus();
    schedulePreview();
  }

  function onFormEdit(options) {
    syncDraftFromForm(true);
    if (options && options.fieldsChanged) {
      renderSampleFields();
    }
  }

  /* ---------------- 实时预览 ---------------- */

  function schedulePreview() {
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(runPreview, 140);
  }

  function loadTokensCss() {
    return fetch('assets/css/lc-tokens.css', { cache: 'no-store' })
      .then(function (response) { return response.text(); })
      .catch(function () {
        return ':root{--lc-color-bg:#f7f4ec;--lc-color-surface:#fffdf8;--lc-color-ink:#262421;--lc-color-ink-2:#4c4842;--lc-color-muted:#6e6a63;--lc-color-line:#ded8c8;--lc-color-accent:#3e6a56;--lc-space-1:4px;--lc-space-2:8px;--lc-space-3:12px;--lc-space-4:16px;--lc-space-5:24px;--lc-space-6:32px;--lc-radius-sm:6px;--lc-radius-md:10px;--lc-font-sans:system-ui,sans-serif;--lc-font-serif:Georgia,serif;--lc-text-xs:12px;--lc-text-sm:13px;--lc-text-base:15px;--lc-text-lg:18px;--lc-leading-base:1.6;}';
      });
  }

  function runPreview() {
    if (!state.draft) return;
    var seq = (state.previewSeq += 1);
    clearPreviewRuntimeState();
    syncDraftFromForm(false);
    var payload = {
      component: {
        id: state.draft.id || 'preview',
        fields: state.draft.fields || [],
        template: state.draft.template || '',
        css: state.draft.css || '',
        js: state.draft.js || ''
      },
      sample: state.sample
    };
    if (typeof payload.component.id === 'string') {
      payload.component.id = payload.component.id.replace(/^builtin:/, '').replace(/[^a-z0-9_-]/gi, '-');
    }
    api(siteBase() + '/components/preview', { method: 'POST', body: payload }).then(function (result) {
      if (seq !== state.previewSeq) return;
      renderPreviewErrors(result);
      if (!state.tokensCss) state.tokensCss = loadTokensCss();
      Promise.resolve(state.tokensCss).then(function (tokens) {
        if (seq !== state.previewSeq) return;
        var doc = buildPreviewDoc(result, tokens || '', seq);
        refs.previewFrame.srcdoc = doc;
      });
    }).catch(function (error) {
      if (seq !== state.previewSeq) return;
      refs.previewErrors.hidden = false;
      refs.previewErrors.innerHTML = '<strong>预览失败</strong>' + esc(error.message);
    });
  }

  function renderPreviewErrors(result) {
    var errors = (result && result.errors) || [];
    if (!errors.length) {
      refs.previewErrors.hidden = true;
      refs.previewErrors.innerHTML = '';
      clearPreviewStatus();
      showCodeErrorIfBlocked(result);
      return;
    }
    markPreviewError();
    refs.previewErrors.hidden = false;
    refs.previewErrors.innerHTML = '<strong>预览提示</strong>' + errors.map(function (item) {
      var where = item.line ? '第 ' + item.line + ' 行' + (item.column ? '第 ' + item.column + ' 列' : '') + '：' : '';
      return '<div>' + esc(where + item.message) + '</div>';
    }).join('');
    showCodeErrorIfBlocked(result);
  }

  function markPreviewError() {
    if (refs.previewCard) refs.previewCard.classList.add('has-preview-error');
    if (refs.previewStatus) {
      refs.previewStatus.hidden = false;
      refs.previewStatus.textContent = '脚本错误';
    }
  }

  function clearPreviewStatus() {
    if (refs.previewCard) refs.previewCard.classList.remove('has-preview-error');
    if (refs.previewStatus) {
      refs.previewStatus.hidden = true;
      refs.previewStatus.textContent = '';
    }
  }

  /* 新一次预览开始：清掉上一份文档的提示，语法错误会随新结果重新绘制。 */
  function clearPreviewRuntimeState() {
    state.previewRuntimeSeen = {};
    refs.previewErrors.hidden = true;
    refs.previewErrors.innerHTML = '';
    clearPreviewStatus();
  }

  /* iframe 无 allow-same-origin，父页读不到 DOM；错误由文档内桥脚本 postMessage 上报。 */
  function showPreviewRuntimeError(message) {
    var text = String(message == null ? '' : message);
    if (!text || state.previewRuntimeSeen[text]) return;
    state.previewRuntimeSeen[text] = true;
    markPreviewError();
    refs.previewErrors.hidden = false;
    var line = document.createElement('div');
    line.setAttribute('data-preview-runtime-error', '');
    line.textContent = '脚本运行错误：' + text;
    refs.previewErrors.appendChild(line);
    if (typeof console !== 'undefined' && console.error) {
      console.error('[lc] 组件预览脚本错误：' + text);
    }
  }

  function showCodeErrorIfBlocked(result) {
    var blocked = result && result.blocked;
    if (!blocked) return;
    showCodeError('保存会被拦截：' + blocked.message + '（第 ' + blocked.line + ' 行）');
  }

  function previewErrorBridge(seq) {
    return '<script>(function(){' +
      'var seen={};' +
      'function report(message){message=String(message==null?"":message);if(!message||seen[message])return;seen[message]=true;' +
      'try{parent.postMessage({source:"lc-component-preview",seq:' + Number(seq) + ',message:message},"*");}catch(e){}}' +
      'window.__lcPreviewReport=report;' +
      'window.addEventListener("error",function(event){' +
      'if(!event||!event.message||event.target!==window)return;' +
      'report(event.message+(event.lineno?"（第 "+event.lineno+" 行）":""));' +
      '});' +
      'window.addEventListener("unhandledrejection",function(event){' +
      'var reason=event&&event.reason;report("未处理的 Promise 拒绝："+((reason&&reason.message)||reason||"未知错误"));' +
      '});' +
      '})();</script>';
  }

  function buildPreviewDoc(result, tokensCss, seq) {
    var id = (state.draft.id || 'preview').replace(/[^a-z0-9_-]/gi, '-');
    var js = String((result && result.js) || '');
    var wrapped = '(function(){var root=document.querySelector(\'[data-lc-instance="preview"]\');if(!root)return;try{\n' + js + '\n}catch(e){console.error(e);if(window.__lcPreviewReport)window.__lcPreviewReport("组件 JS 运行错误："+(e&&e.message?e.message:String(e)));}})();';
    wrapped = wrapped.replace(/<\/script/gi, '<\\/script');
    var mode = state.previewMode === 'dark' ? 'dark' : 'light';
    var themeId = document.documentElement.getAttribute('data-lc-theme') || 'ink-green';
    return '<!doctype html><html lang="zh-CN" data-lc-theme="' + attr(themeId) + '" data-lc-mode="' + mode + '"><head><meta charset="utf-8">' +
      previewErrorBridge(seq) +
      '<style>' + tokensCss + '</style>' +
      '<style>html{background:var(--lc-color-bg,#f4f0e6);color-scheme:' + mode + '}html,body{margin:0}body{padding:16px;background:var(--lc-color-bg,#f4f0e6);color:var(--lc-color-ink,#1d2320);font-family:var(--lc-font-sans);font-size:var(--lc-text-sm);line-height:var(--lc-leading-base);}' +
      '*,*::before,*::after{box-sizing:border-box}img{max-width:100%;height:auto}' + (result ? result.css : '') + '</style>' +
      '</head><body><div data-lc-comp="' + attr(id) + '" data-lc-instance="preview">' + ((result && result.html) || '') + '</div>' +
      '<script>' + wrapped + '</script></body></html>';
  }

  /* ---------------- 保存 / 删除 / 复制 / 导出 / 导入 ---------------- */

  function saveComponent(confirmed) {
    if (!state.draft || state.readOnly || state.saving) return;
    syncDraftFromForm(false);
    if (!state.draft.name) {
      toast('组件名称不能为空', 'warn');
      refs.metaName.focus();
      return;
    }
    state.saving = true;
    refs.save.disabled = true;
    stateBadge('保存中…');
    var body = deepCopy(state.draft);
    delete body.usagePages;
    delete body.usageCount;
    delete body.readOnly;
    delete body.scope;
    if (confirmed) body.confirm = true;
    var isNew = state.isNew || !state.draft.id;
    var url = isNew
      ? siteBase() + '/components'
      : siteBase() + '/components/' + encodeURIComponent(state.draft.id);
    api(url, { method: isNew ? 'POST' : 'PUT', body: body }).then(function (component) {
      state.saving = false;
      refs.save.disabled = false;
      state.isNew = false;
      state.idGenerated = false;
      hideDanger();
      hideCodeError();
      state.selected = Object.assign({}, component, { readOnly: false });
      state.draft = deepCopy(component);
      renderEditor();
      setDirty(false);
      toast('已保存「' + component.name + '」', 'ok');
      return reloadListOnly();
    }).catch(function (error) {
      state.saving = false;
      refs.save.disabled = false;
      handleEditorError(error, 'save');
    });
  }

  function handleEditorError(error, action) {
    if (error.code === 'LC_E_COMPONENT_FIELDS' || error.code === 'LC_E_COMPONENT_IN_USE') {
      renderConfirmPanel(error, action);
      return;
    }
    var detail = error.detail || {};
    var where = detail.line ? '（第 ' + detail.line + ' 行' + (detail.column ? '，第 ' + detail.column + ' 列' : '') + '）' : '';
    var message = error.message + where;
    if (detail.snippet) message += '\n' + detail.snippet;
    if (detail.line || detail.snippet || /LC_E_COMPONENT_(HTML|CSS|JS)/.test(error.code || '')) {
      showCodeError(message);
    }
    stateBadge('保存失败', 'error');
    toast(message, 'error');
    if (detail.line) {
      switchTab(error.code && error.code.indexOf('CSS') !== -1 ? 'css' : error.code && error.code.indexOf('JS') !== -1 ? 'js' : 'html');
      focusCodeAtLine(detail.line);
    }
  }

  function focusCodeAtLine(line) {
    var textarea = state.activeTab === 'css' ? refs.codeCss : state.activeTab === 'js' ? refs.codeJs : refs.codeHtml;
    if (!textarea) return;
    var lines = textarea.value.split('\n');
    var offset = 0;
    for (var i = 0; i < Math.min(line - 1, lines.length); i += 1) offset += lines[i].length + 1;
    textarea.focus();
    textarea.setSelectionRange(offset, offset + (lines[line - 1] || '').length);
  }

  function renderConfirmPanel(error, action) {
    var detail = error.detail || {};
    var usage = detail.usage || [];
    var isDelete = action === 'delete';
    state.confirmMode = isDelete ? 'delete' : 'save';
    refs.dangerPanel.hidden = false;
    refs.dangerPanel.innerHTML =
      '<h4>' + (isDelete ? '确认删除？' : '字段改动会影响这些页面') + '</h4>' +
      '<p>' + esc(error.message) + '</p>' +
      (usage.length
        ? '<ul>' + usage.map(function (page) {
            return '<li>' + esc(page.pageTitle) + ' <code>' + esc(page.pagePath || page.pageId) + '</code> · ' + page.count + ' 次</li>';
          }).join('') + '</ul>'
        : '<p>当前没有被页面引用。</p>') +
      (detail.diff && detail.diff.length
        ? '<ul>' + detail.diff.map(function (item) {
            return '<li>' + esc(item.message) + '</li>';
          }).join('') + '</ul>'
        : '') +
      '<div class="lc-comp-danger-actions">' +
        '<button class="lc-btn lc-btn-sm lc-btn-primary" type="button" data-confirm-run>' + (isDelete ? '确认移入回收站' : '确认保存') + '</button>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-confirm-cancel>取消</button>' +
      '</div>';
    stateBadge(isDelete ? '等待确认删除' : '等待确认字段改动', 'error');
  }

  function deleteComponent(confirmed) {
    if (!state.draft || state.readOnly) return;
    var url = siteBase() + '/components/' + encodeURIComponent(state.draft.id) + (confirmed ? '?confirm=1' : '');
    api(url, { method: 'DELETE' }).then(function (result) {
      hideDanger();
      toast('已移入回收站：' + result.name + '（可恢复）', 'ok');
      state.selected = null;
      state.draft = null;
      state.dirty = false;
      refs.editor.hidden = true;
      refs.empty.hidden = false;
      refs.editorTitle.textContent = '选择一个组件';
      refs.editorMeta.textContent = '';
      resetToolbar();
      reloadListOnly();
    }).catch(function (error) {
      if (error.code === 'LC_E_COMPONENT_IN_USE') {
        renderConfirmPanel(error, 'delete');
        return;
      }
      toast(error.message, 'error');
    });
  }

  function requestDelete() {
    if (!state.draft || state.readOnly) return;
    var usagePages = (state.selected && state.selected.usagePages) || [];
    var fake = {
      message: usagePages.length
        ? '组件正被 ' + usagePages.length + ' 个页面使用；删除后这些引用会变成占位，需先确认。'
        : '组件将移入回收站，可随时恢复。',
      detail: { usage: usagePages }
    };
    renderConfirmPanel(fake, 'delete');
  }

  function duplicateComponent() {
    if (!state.draft) return;
    api(siteBase() + '/components/' + encodeURIComponent(state.draft.id) + '/duplicate', { method: 'POST' }).then(function (copy) {
      toast((copy.notices && copy.notices[0]) || ('已复制「' + copy.name + '」'), 'ok');
      return reloadListOnly().then(function () { return selectComponent(copy.id); });
    }).catch(function (error) {
      toast(error.message, 'error');
    });
  }

  function exportComponent() {
    if (!state.draft || state.readOnly) return;
    fetch(siteBase() + '/components/' + encodeURIComponent(state.draft.id) + '/export', {
      headers: { 'x-lc-token': TOKEN },
      cache: 'no-store'
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          throw new Error((payload.error && payload.error.message) || ('导出失败（' + response.status + '）'));
        });
      }
      return response.blob().then(function (blob) {
        var link = document.createElement('a');
        var url = URL.createObjectURL(blob);
        link.href = url;
        link.download = state.draft.id + '.component.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
        toast('已导出「' + state.draft.name + '」', 'ok');
      });
    }).catch(function (error) {
      toast(error.message, 'error');
    });
  }

  function importComponent(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      api(siteBase() + '/components/import', {
        method: 'POST',
        body: { filename: file.name, content: String(reader.result || '') }
      }).then(function (component) {
        toast((component.notices && component.notices.join('；')) || ('已导入「' + component.name + '」'), 'ok');
        state.dirty = false;
        return reloadListOnly().then(function () { return selectComponent(component.id); });
      }).catch(function (error) {
        toast(error.message, 'error');
      });
    };
    reader.onerror = function () { toast('读取文件失败', 'error'); };
    reader.readAsText(file, 'utf-8');
  }

  function newComponent() {
    if (state.dirty && !window.confirm('当前组件有未保存修改，新建会丢失，继续？')) return;
    var draft = {
      id: '',
      name: '',
      category: 'content',
      icon: 'box',
      tags: [],
      description: '',
      fields: [{ id: 'title', label: '标题', type: 'text', required: true, options: [], defaultValue: '示例标题' }],
      template: '<div class="my-component">\n  <h3 class="my-title">{{title}}</h3>\n</div>',
      css: '.my-component {\n  padding: var(--lc-space-4);\n  border: 1px solid var(--lc-color-line);\n  border-radius: var(--lc-radius-md);\n  background: var(--lc-color-surface);\n}\n\n.my-title {\n  margin: 0;\n  font-family: var(--lc-font-serif);\n  font-size: var(--lc-text-lg);\n}',
      js: ''
    };
    state.selected = null;
    state.draft = deepCopy(draft);
    state.readOnly = false;
    state.isNew = true;
    state.sample = { title: '示例标题' };
    state.idGenerated = true;
    refs.empty.hidden = true;
    refs.editor.hidden = false;
    refs.trashPanel.hidden = true;
    refs.metaId.value = '';
    renderEditor();
    setDirty(true);
    refs.metaName.focus();
    schedulePreview();
    toast('填写名称与 ID 后保存；保存即入库', 'ok');
  }

  function reloadListOnly() {
    return Promise.all([
      api(siteBase() + '/components'),
      api(siteBase() + '/components/trash'),
      api(siteBase() + '/components/meta')
    ]).then(function (results) {
      state.items = (results[0] && results[0].items) || [];
      state.tags = (results[0] && results[0].tags) || [];
      state.trash = (results[1] && results[1].items) || [];
      state.meta = results[2];
      applyMeta();
      renderFilters();
      renderList();
      renderTrash();
    }).catch(function (error) {
      toast(error.message, 'error');
    });
  }

  function restoreTrash(trashId) {
    api(siteBase() + '/components/trash/' + encodeURIComponent(trashId) + '/restore', { method: 'POST' }).then(function (component) {
      toast('已恢复「' + component.name + '」', 'ok');
      return reloadListOnly().then(function () { return selectComponent(component.id); });
    }).catch(function (error) {
      toast(error.message, 'error');
    });
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    refs.siteSelect.addEventListener('change', function () {
      if (!refs.siteSelect.value) { showProjectGate(); return; }
      loadSite(refs.siteSelect.value);
    });

    refs.search.addEventListener('input', renderList);
    refs.categoryFilter.addEventListener('change', renderList);
    refs.tagFilter.addEventListener('change', renderList);

    refs.componentList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-component-id]');
      if (!button) return;
      selectComponent(button.getAttribute('data-component-id'));
    });

    refs.trashList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-restore-trash]');
      if (!button) return;
      restoreTrash(button.getAttribute('data-restore-trash'));
    });

    refs.trashDetail.addEventListener('click', function (event) {
      var button = event.target.closest('[data-restore-trash]');
      if (!button) return;
      restoreTrash(button.getAttribute('data-restore-trash'));
    });

    refs.trashBack.addEventListener('click', function () {
      refs.trashPanel.hidden = true;
      refs.empty.hidden = Boolean(state.draft);
      refs.editor.hidden = !state.draft;
    });

    refs.newComponent.addEventListener('click', newComponent);
    refs.duplicate.addEventListener('click', duplicateComponent);
    refs.copy.addEventListener('click', duplicateComponent);
    refs.export.addEventListener('click', exportComponent);
    refs.remove.addEventListener('click', requestDelete);
    refs.save.addEventListener('click', function () { saveComponent(false); });

    refs.importOpen.addEventListener('click', function () { refs.importFile.click(); });
    refs.importFile.addEventListener('change', function () {
      var file = refs.importFile.files && refs.importFile.files[0];
      importComponent(file);
      refs.importFile.value = '';
    });

    refs.metaName.addEventListener('input', function () {
      if (!state.draft) return;
      if (!state.draft.id && refs.metaId.value === '') {
        draftIdFromName(refs.metaName.value);
      }
      onFormEdit();
    });
    refs.metaId.addEventListener('input', function () {
      if (!state.draft) return;
      state.draft.id = refs.metaId.value;
      onFormEdit();
    });
    refs.metaCategory.addEventListener('change', function () { onFormEdit(); });
    refs.metaIcon.addEventListener('change', function () { onFormEdit(); });
    refs.metaTags.addEventListener('input', function () { onFormEdit(); });
    refs.metaDescription.addEventListener('input', function () { onFormEdit(); });

    refs.addField.addEventListener('click', function () {
      if (!state.draft || state.readOnly) return;
      syncDraftFromForm();
      var nextIndex = state.draft.fields.length + 1;
      var id = 'field' + nextIndex;
      while (state.draft.fields.some(function (field) { return field.id === id; })) {
        nextIndex += 1;
        id = 'field' + nextIndex;
      }
      state.draft.fields.push({ id: id, label: '字段 ' + nextIndex, type: 'text', required: false, options: [], defaultValue: '' });
      state.sample[id] = '';
      renderFields();
      renderSampleFields();
      setDirty(true);
      schedulePreview();
    });

    refs.fieldList.addEventListener('input', function (event) {
      var row = event.target.closest('[data-field-row]');
      if (!row) return;
      if (event.target.matches('[data-field-type]')) {
        var wrap = row.querySelector('[data-field-options-wrap]');
        if (wrap) wrap.hidden = event.target.value !== 'enum';
      }
      onFormEdit();
    });
    refs.fieldList.addEventListener('change', function (event) {
      var row = event.target.closest('[data-field-row]');
      if (!row) return;
      if (event.target.matches('[data-field-type]')) {
        var wrap = row.querySelector('[data-field-options-wrap]');
        if (wrap) wrap.hidden = event.target.value !== 'enum';
      }
      if (event.target.matches('[data-field-required]') || event.target.matches('[data-field-type]')) {
        onFormEdit({ fieldsChanged: true });
      } else {
        onFormEdit();
      }
    });
    refs.fieldList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-remove-field]');
      if (!button || !state.draft || state.readOnly) return;
      var index = Number(button.getAttribute('data-remove-field'));
      var removed = state.draft.fields[index];
      state.draft.fields.splice(index, 1);
      if (removed) delete state.sample[removed.id];
      renderFields();
      renderSampleFields();
      setDirty(true);
      schedulePreview();
    });

    refs.tabs.forEach(function (button) {
      button.addEventListener('click', function () { switchTab(button.getAttribute('data-tab')); });
    });

    [refs.codeHtml, refs.codeCss, refs.codeJs].forEach(function (textarea) {
      textarea.addEventListener('input', function () {
        onFormEdit();
        hideCodeError();
      });
    });

    /* 预览 iframe 无 allow-same-origin，只能通过 postMessage 收到它内部的运行错误。 */
    window.addEventListener('message', function (event) {
      var data = event && event.data;
      if (!data || data.source !== 'lc-component-preview') return;
      if (event.source !== refs.previewFrame.contentWindow) return;
      if (data.seq !== state.previewSeq) return;
      showPreviewRuntimeError(data.message);
    });

    refs.sampleFields.addEventListener('input', function (event) {
      var input = event.target.closest('[data-sample]');
      if (!input) return;
      var key = input.getAttribute('data-sample');
      state.sample[key] = input.type === 'checkbox' ? input.checked : input.value;
      schedulePreview();
    });
    refs.sampleFields.addEventListener('change', function (event) {
      var input = event.target.closest('[data-sample]');
      if (!input) return;
      var key = input.getAttribute('data-sample');
      state.sample[key] = input.tagName === 'SELECT' ? (input.value === 'true' ? true : input.value === 'false' ? false : input.value) : input.value;
      schedulePreview();
    });

    refs.previewModes.forEach(function (button) {
      button.addEventListener('click', function () {
        state.previewMode = button.getAttribute('data-preview-mode');
        refs.previewModes.forEach(function (item) { item.classList.toggle('is-active', item === button); });
        schedulePreview();
      });
    });

    refs.dangerPanel.addEventListener('click', function (event) {
      if (event.target.closest('[data-confirm-cancel]')) {
        hideDanger();
        setDirty(state.dirty);
        return;
      }
      if (event.target.closest('[data-confirm-run]')) {
        var mode = state.confirmMode;
        hideDanger();
        if (mode === 'delete') deleteComponent(true);
        else saveComponent(true);
      }
    });

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!refs.save.disabled) saveComponent(false);
      }
    });

    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
  }

  function draftIdFromName(name) {
    var slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    refs.metaId.value = slug;
    if (state.draft) state.draft.id = slug;
  }

  function init() {
    state.tokensCss = loadTokensCss();
    bindEvents();
    loadSites();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
