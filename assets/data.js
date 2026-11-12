/* 数据源管理 · 集合
 *
 * 只调用服务端数据接口；不直连任何外部服务，也不在浏览器里读写 data/ 文件。
 * 字段类型变化由服务端返回 409 + 影响清单，确认后才提交。 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var TOKEN = tokenMeta ? tokenMeta.getAttribute('content') : '';
  var TYPE_LABELS = {
    text: '文本',
    number: '数字',
    boolean: '布尔',
    date: '日期',
    enum: '枚举',
    reference: '引用',
    json: 'JSON'
  };

  var refs = {
    siteSelect: document.querySelector('[data-site-select]'),
    backBuilder: document.querySelector('[data-back-builder]'),
    collectionCount: document.querySelector('[data-collection-count]'),
    collectionList: document.querySelector('[data-collection-list]'),
    newCollection: document.querySelector('[data-new-collection]'),
    editorTitle: document.querySelector('[data-editor-title]'),
    editorMeta: document.querySelector('[data-editor-meta]'),
    editorState: document.querySelector('[data-editor-state]'),
    save: document.querySelector('[data-collection-save]'),
    remove: document.querySelector('[data-collection-delete]'),
    empty: document.querySelector('[data-empty]'),
    editor: document.querySelector('[data-editor]'),
    metaName: document.querySelector('[data-meta-name]'),
    metaId: document.querySelector('[data-meta-id]'),
    metaDescription: document.querySelector('[data-meta-description]'),
    fieldList: document.querySelector('[data-field-list]'),
    addField: document.querySelector('[data-add-field]'),
    indexList: document.querySelector('[data-index-list]'),
    addIndex: document.querySelector('[data-add-index]'),
    rowCount: document.querySelector('[data-row-count]'),
    rowSearch: document.querySelector('[data-row-search]'),
    sampleCount: document.querySelector('[data-sample-count]'),
    generateSample: document.querySelector('[data-generate-sample]'),
    addRow: document.querySelector('[data-add-row]'),
    rowNote: document.querySelector('[data-row-note]'),
    rowTable: document.querySelector('[data-row-table]'),
    rowPager: document.querySelector('[data-row-pager]'),
    rowPageSize: document.querySelector('[data-row-page-size]'),
    rowForm: document.querySelector('[data-row-form]'),
    usagePanel: document.querySelector('[data-usage-panel]'),
    openImport: document.querySelector('[data-open-import]'),
    importPanel: document.querySelector('[data-import]'),
    importTarget: document.querySelector('[data-import-target]'),
    importBack: document.querySelector('[data-import-back]'),
    importFile: document.querySelector('[data-import-file]'),
    importFormat: document.querySelector('[data-import-format]'),
    importError: document.querySelector('[data-import-error]'),
    importPreview: document.querySelector('[data-import-preview]'),
    importSummary: document.querySelector('[data-import-summary]'),
    importWarnings: document.querySelector('[data-import-warnings]'),
    importMapping: document.querySelector('[data-import-mapping]'),
    importModes: document.querySelector('[data-import-modes]'),
    importRows: document.querySelector('[data-import-rows]'),
    importProgress: document.querySelector('[data-import-progress]'),
    importRun: document.querySelector('[data-import-run]'),
    importResult: document.querySelector('[data-import-result]'),
    importResultSummary: document.querySelector('[data-import-result-summary]'),
    importIssues: document.querySelector('[data-import-issues]'),
    importAgain: document.querySelector('[data-import-again]'),
    limitRows: document.querySelector('[data-limit-rows]'),
    limitImport: document.querySelector('[data-limit-import]'),
    sourceCount: document.querySelector('[data-source-count]'),
    sourceList: document.querySelector('[data-source-list]'),
    newSource: document.querySelector('[data-new-source]'),
    sourceEditor: document.querySelector('[data-source-editor]'),
    sourceName: document.querySelector('[data-source-name]'),
    sourceIdInput: document.querySelector('[data-source-id]'),
    sourceDescription: document.querySelector('[data-source-description]'),
    sourceMethod: document.querySelector('[data-source-method]'),
    sourceUrl: document.querySelector('[data-source-url]'),
    sourceTimeout: document.querySelector('[data-source-timeout]'),
    sourceMaxBytes: document.querySelector('[data-source-maxbytes]'),
    sourceContentType: document.querySelector('[data-source-content-type]'),
    headerList: document.querySelector('[data-header-list]'),
    addHeader: document.querySelector('[data-add-header]'),
    queryList: document.querySelector('[data-query-list]'),
    addQuery: document.querySelector('[data-add-query]'),
    sourceBody: document.querySelector('[data-source-body]'),
    sourceTarget: document.querySelector('[data-source-target]'),
    sourceCollection: document.querySelector('[data-source-collection]'),
    sourceComponent: document.querySelector('[data-source-component]'),
    sourceRowsPath: document.querySelector('[data-source-rows-path]'),
    mappingList: document.querySelector('[data-mapping-list]'),
    addMapping: document.querySelector('[data-add-mapping]'),
    sourceTest: document.querySelector('[data-source-test]'),
    sourceTestResult: document.querySelector('[data-source-test-result]'),
    sourceSave: document.querySelector('[data-source-save]'),
    sourceDelete: document.querySelector('[data-source-delete]'),
    sourceStatus: document.querySelector('[data-source-status]'),
    sourceState: document.querySelector('[data-source-state]'),
    projectTypeNote: document.querySelector('[data-project-type-note]'),
    uploadView: document.querySelector('[data-upload-view]'),
    uploadBadge: document.querySelector('[data-upload-badge]'),
    openUpload: document.querySelector('[data-open-upload]'),
    uploadBack: document.querySelector('[data-upload-back]'),
    uploadEnabled: document.querySelector('[data-upload-enabled]'),
    uploadMethod: document.querySelector('[data-upload-method]'),
    uploadTarget: document.querySelector('[data-upload-target]'),
    uploadField: document.querySelector('[data-upload-field]'),
    uploadAccept: document.querySelector('[data-upload-accept]'),
    uploadMax: document.querySelector('[data-upload-max]'),
    uploadHeaders: document.querySelector('[data-upload-headers]'),
    uploadNote: document.querySelector('[data-upload-note]'),
    uploadStatus: document.querySelector('[data-upload-status]'),
    uploadSave: document.querySelector('[data-upload-save]')
  };

  var state = {
    sites: [],
    siteId: '',
    collections: [],
    collection: null,
    rowCount: 0,
    rows: [],
    rowTotal: 0,
    offset: 0,
    limit: 100,
    sort: '',
    order: 'asc',
    rev: null,
    sourcesRev: null,
    search: '',
    usage: [],
    fields: [],
    indexes: [],
    form: { name: '', description: '' },
    editingRowId: '',
    searchTimer: 0,
    createOpen: false,
    importModes: [],
    importOpen: false,
    importContent: '',
    importPreview: null,
    importMapping: {},
    importMode: 'append',
    view: 'collection',
    sources: [],
    sourceMethods: [],
    sourceTargets: [],
    sourceLimits: null,
    source: null,
    sourceTesting: false,
    upload: null,
    uploadSaving: false
  };

  var CATEGORY_LABELS = {
    ok: '成功',
    timeout: '超时',
    network: '网络',
    auth: '认证',
    http: 'HTTP 状态',
    format: '格式',
    'too-large': '响应过大'
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&#39;';
    });
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
          throw error;
        }
        return payload.data;
      });
    });
  }

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'lc-toast' + (kind === 'error' ? ' is-error' : '');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3600);
  }

  function setStatus(textValue, kind) {
    if (!refs.editorState) return;
    refs.editorState.hidden = !textValue;
    refs.editorState.textContent = textValue || '';
    refs.editorState.className = 'lc-badge ' + (kind === 'error' ? 'lc-badge-danger' : kind === 'ok' ? 'lc-badge-success' : '');
  }

  function siteBase() {
    return '/api/sites/' + encodeURIComponent(state.siteId);
  }

  /* 写入时带上当前 rev，另一个标签页先改过就会被服务端以 409 拒绝，而不是静默覆盖。 */
  function revBody() {
    return typeof state.rev === 'number' ? { expectedRev: state.rev } : {};
  }

  function isRevConflict(error) {
    return Boolean(error && error.code === 'LC_E_REV_CONFLICT');
  }

  function handleRevConflict(error, reload) {
    if (!isRevConflict(error)) return false;
    toast('数据已被其它标签页修改，已刷新到最新内容，请重新编辑', 'error');
    if (typeof reload === 'function') reload();
    return true;
  }

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function typeOf(field) {
    return TYPE_LABELS[field.type] || field.type;
  }

  function cellText(field, value) {
    if (value === undefined || value === null || value === '') return '—';
    if (field.type === 'boolean') return value ? '是' : '否';
    if (field.type === 'json') {
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
  }

  /* ---------------- 站点与集合列表 ---------------- */

  function renderSiteSelect() {
    refs.siteSelect.innerHTML =
      (state.siteId ? '' : '<option value="" selected>请选择项目</option>') +
      state.sites.map(function (site) {
        return '<option value="' + esc(site.siteId) + '"' + (site.siteId === state.siteId ? ' selected' : '') + '>' +
          esc(site.name || site.siteId) + '</option>';
      }).join('');
  }

  /* 没有明确的项目上下文时不静默落到第一个站点：列表给出提示，新建/编辑保持禁用。 */
  function showProjectGate() {
    state.siteId = '';
    renderSiteSelect();
    if (refs.backBuilder) refs.backBuilder.href = 'builder.html';
    syncSiteLinks('');
    refs.collectionList.innerHTML = '<div class="lc-data-empty" style="margin:0;padding:var(--lc-space-4)">还没有选择项目。从工作台的项目卡片进入，或在右上角「项目」里选一个项目再编辑。</div>';
    refs.collectionCount.textContent = '0 个';
    [refs.newCollection, refs.newSource, refs.openImport, refs.openUpload].forEach(function (control) {
      if (control) control.disabled = true;
    });
    if (refs.editor) refs.editor.hidden = true;
    if (refs.empty) refs.empty.hidden = true;
    if (refs.usagePanel) refs.usagePanel.hidden = true;
    if (refs.projectTypeNote) refs.projectTypeNote.hidden = true;
    setStatus('未选择项目');
  }

  function loadSites() {
    return api('/api/sites').then(function (sites) {
      state.sites = Array.isArray(sites) ? sites : [];
      if (!state.sites.length) {
        refs.collectionList.innerHTML = '<div class="lc-data-empty" style="margin:0;padding:var(--lc-space-4)">还没有项目，先到 Builder 创建一个项目。</div>';
        refs.collectionCount.textContent = '0 个';
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

  /* 顶栏里的跨功能出口统一带当前站点，避免跳导出时丢失项目上下文。 */
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
    /* 数据页纯静态项目也保留：导出会把集合与接口快照打进 web/data/，不依赖后端服务。 */
    var site = state.sites.find(function (item) { return item.siteId === siteId; });
    if (refs.projectTypeNote) {
      var isStatic = site && site.type !== 'backend';
      refs.projectTypeNote.hidden = !isStatic;
      refs.projectTypeNote.textContent = isStatic
        ? '当前是纯静态项目：集合、接口与上传目标会随导出打进 web/data/ 快照，页面不依赖后端服务。'
        : '';
    }
    [refs.newCollection, refs.newSource, refs.openImport, refs.openUpload].forEach(function (control) {
      if (control) control.disabled = false;
    });
    state.collection = null;
    state.rows = [];
    state.usage = [];
    state.view = 'collection';
    state.source = null;
    if (refs.sourceEditor) refs.sourceEditor.hidden = true;
    if (refs.uploadView) refs.uploadView.hidden = true;
    updateUploadBadge(null);
    refreshUploadBadge();
    renderSiteSelect();
    setStatus('读取集合…');
    return Promise.all([
      api(siteBase() + '/data/meta'),
      api(siteBase() + '/data/sources')
    ]).then(function (results) {
      var meta = results[0];
      var sourceData = results[1];
      state.collections = meta.collections || [];
      state.importModes = meta.importModes || [];
      state.sources = sourceData.sources || [];
      state.sourceMethods = sourceData.methods || [];
      state.sourceTargets = sourceData.targets || ['collection', 'component'];
      state.sourceLimits = sourceData.limits || null;
      if (meta.limits) {
        if (refs.limitRows) refs.limitRows.textContent = String(meta.limits.rowsPerCollection);
        if (refs.limitImport) refs.limitImport.textContent = Math.round(meta.limits.importBytes / (1024 * 1024)) + ' MB';
      }
      renderCollectionList();
      renderSourceList();
      var params = new URLSearchParams(window.location.search);
      if (params.get('site') !== siteId) {
        params.set('site', siteId);
        window.history.replaceState(null, '', 'data.html?' + params.toString());
      }
      if (state.collections.length) return loadCollection(state.collections[0].id);
      renderEmpty();
      setStatus('还没有集合', '');
      return null;
    });
  }

  function renderSourceList() {
    if (!refs.sourceList) return;
    if (refs.sourceCount) refs.sourceCount.textContent = state.sources.length + ' 个';
    if (!state.sources.length) {
      refs.sourceList.innerHTML = '<div class="lc-data-empty" style="margin:0;padding:var(--lc-space-4)">还没有接口，点上方「新建接口」。</div>';
      return;
    }
    refs.sourceList.innerHTML = state.sources.map(function (source) {
      var active = state.view === 'source' && state.source && state.source.id === source.id;
      var mapping = source.mapping || {};
      var target = mapping.target === 'component'
        ? '组件 ' + (mapping.component || '未填')
        : '集合 ' + (mapping.collectionId || '未选');
      var req = source.request || {};
      var secretCount = (req.headers || []).concat(req.query || []).filter(function (item) {
        return item.secret === true;
      }).length;
      return '<button class="lc-data-item' + (active ? ' is-active' : '') + '" type="button" data-select-source="' +
        esc(source.id) + '">' +
        '<strong><span class="lc-data-item-method">' + esc(req.method || 'GET') + '</span> ' + esc(source.name) + '</strong>' +
        '<small>' + esc(target) + ' · ' + esc(req.url || '') + (secretCount ? ' · ' + secretCount + ' 处密钥' : '') + '</small>' +
        '</button>';
    }).join('');
  }

  function renderCollectionList() {
    refs.collectionCount.textContent = state.collections.length + ' 个';
    if (!state.collections.length) {
      refs.collectionList.innerHTML = '<div class="lc-data-empty" style="margin:0;padding:var(--lc-space-4)">还没有集合，点上方「新建集合」。</div>';
      return;
    }
    refs.collectionList.innerHTML = state.collections.map(function (collection) {
      var active = state.view === 'collection' && state.collection && state.collection.id === collection.id;
      return '<button class="lc-data-item' + (active ? ' is-active' : '') + '" type="button" data-select-collection="' +
        esc(collection.id) + '">' +
        '<strong>' + esc(collection.name) + '</strong>' +
        '<small>' + esc(collection.id) + ' · ' + collection.fieldCount + ' 字段 · ' + collection.rowCount + ' 行</small>' +
        '</button>';
    }).join('');
  }

  function renderEmpty() {
    state.view = 'collection';
    if (refs.sourceEditor) refs.sourceEditor.hidden = true;
    if (refs.uploadView) refs.uploadView.hidden = true;
    refs.empty.hidden = false;
    refs.editor.hidden = true;
    refs.editorTitle.textContent = '选择一个集合';
    refs.editorMeta.textContent = '';
    refs.save.disabled = true;
    refs.remove.disabled = true;
    refs.openImport.disabled = true;
    if (refs.importPanel) refs.importPanel.hidden = true;
    if (refs.editor) refs.editor.hidden = true;
    setStatus('');
  }

  /* ---------------- 集合详情 ---------------- */

  function loadCollection(id) {
    closeImportView();
    closeSourceEditor();
    if (refs.uploadView) refs.uploadView.hidden = true;
    /* 切换集合时回到第一页并清空排序；同一集合刷新（保存/冲突重载）保留浏览位置。 */
    var switched = !state.collection || state.collection.id !== id;
    if (switched) {
      state.offset = 0;
      state.sort = '';
      state.order = 'asc';
    }
    setStatus('读取集合…');
    return api(siteBase() + '/data/collections/' + encodeURIComponent(id)).then(function (data) {
      state.collection = data.collection;
      state.rowCount = data.rowCount || 0;
      state.rev = typeof data.rev === 'number' ? data.rev : state.rev;
      state.usage = data.usage || [];
      state.fields = deepCopy(data.collection.fields || []);
      state.indexes = deepCopy(data.collection.indexes || []);
      state.form = { id: data.collection.id, name: data.collection.name, description: data.collection.description || '' };
      state.editingRowId = '';
      renderCollectionList();
      renderEditor();
      hideUsage();
      return loadRows();
    }).catch(function (error) {
      setStatus('读取失败：' + error.message, 'error');
      toast('读取集合失败：' + error.message, 'error');
    });
  }

  function renderEditor() {
    refs.empty.hidden = true;
    refs.editor.hidden = false;
    var collection = state.collection;
    refs.editorTitle.textContent = collection.name;
    refs.editorMeta.textContent = collection.id + ' · ' + state.fields.length + ' 字段 · ' + state.rowCount + ' 行';
    refs.save.disabled = false;
    refs.remove.disabled = false;
    refs.openImport.disabled = false;
    refs.metaName.value = state.form.name;
    refs.metaId.value = state.form.id;
    refs.metaDescription.value = state.form.description;
    refs.rowCount.textContent = String(state.rowCount);
    renderFields();
    renderIndexes();
    setStatus('已加载', 'ok');
  }

  function extraHtml(field, index) {
    if (field.type === 'enum') {
      return '<div class="lc-data-field-extra">' +
        '<label class="lc-field"><span class="lc-label">可选值 <small>逗号分隔</small></span>' +
        '<input class="lc-input" type="text" data-field-extra="enumValues" data-field-idx="' + index + '" value="' +
        esc((field.enumValues || []).join(', ')) + '" placeholder="draft, live"></label></div>';
    }
    if (field.type === 'reference') {
      return '<div class="lc-data-field-extra">' +
        '<label class="lc-field"><span class="lc-label">引用的集合 <small>可留空</small></span>' +
        '<input class="lc-input" type="text" data-field-extra="refCollection" data-field-idx="' + index + '" value="' +
        esc(field.refCollection || '') + '" placeholder="staff"></label>' +
        '<label class="lc-field"><span class="lc-label">引用字段 <small>可留空</small></span>' +
        '<input class="lc-input" type="text" data-field-extra="refField" data-field-idx="' + index + '" value="' +
        esc(field.refField || '') + '" placeholder="id"></label></div>';
    }
    return '';
  }

  function renderFields() {
    if (!state.fields.length) {
      refs.fieldList.innerHTML = '<div class="lc-data-empty" style="margin:0;padding:var(--lc-space-4)">还没有字段，点右上角「添加字段」。</div>';
      return;
    }
    var options = Object.keys(TYPE_LABELS).map(function (type) {
      return '<option value="' + type + '">' + TYPE_LABELS[type] + '</option>';
    }).join('');
    refs.fieldList.innerHTML = state.fields.map(function (field, index) {
      return '<div class="lc-data-field" data-field-row="' + index + '">' +
        '<div class="lc-data-field-main">' +
        '<input class="lc-input" type="text" data-field-key="name" data-field-idx="' + index + '" value="' + esc(field.name) + '" placeholder="字段名" aria-label="字段名">' +
        '<input class="lc-input lc-data-mono" type="text" data-field-key="id" data-field-idx="' + index + '" value="' + esc(field.id) + '" placeholder="字段 ID" aria-label="字段 ID">' +
        '<select class="lc-select" data-field-key="type" data-field-idx="' + index + '" aria-label="字段类型">' +
        options.replace('value="' + field.type + '"', 'value="' + field.type + '" selected') + '</select>' +
        '<label class="lc-data-check"><input type="checkbox" data-field-key="required" data-field-idx="' + index + '"' +
        (field.required ? ' checked' : '') + '><span>必填</span></label>' +
        '<label class="lc-data-check"><input type="checkbox" data-field-key="unique" data-field-idx="' + index + '"' +
        (field.unique ? ' checked' : '') + '><span>唯一</span></label>' +
        '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-remove-field="' + index + '">删除</button>' +
        '</div>' + extraHtml(field, index) +
        '</div>';
    }).join('');
  }

  function renderIndexes() {
    if (!state.indexes.length) {
      refs.indexList.innerHTML = '<div class="lc-data-empty" style="margin:0;padding:var(--lc-space-4)">没有额外索引。字段级「唯一」已自动生效。</div>';
      return;
    }
    refs.indexList.innerHTML = state.indexes.map(function (index, idx) {
      var boxes = state.fields.map(function (field) {
        var checked = (index.fields || []).indexOf(field.id) >= 0;
        return '<label class="lc-data-check"><input type="checkbox" data-index-field="' + idx + '" value="' +
          esc(field.id) + '"' + (checked ? ' checked' : '') + '><span>' + esc(field.name) + '</span></label>';
      }).join('');
      return '<div class="lc-data-index" data-index-row="' + idx + '">' +
        '<div class="lc-data-index-main">' +
        '<input class="lc-input" type="text" data-index-key="name" data-index-idx="' + idx + '" value="' + esc(index.name || '') + '" placeholder="索引名称" aria-label="索引名称">' +
        '<label class="lc-data-check"><input type="checkbox" data-index-key="unique" data-index-idx="' + idx + '"' +
        (index.unique ? ' checked' : '') + '><span>唯一索引</span></label>' +
        '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-remove-index="' + idx + '">删除</button>' +
        '</div>' +
        '<div class="lc-data-index-fields">' + boxes + '</div>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 数据行 ---------------- */

  function loadRows() {
    var params = '?limit=' + state.limit + '&offset=' + state.offset +
      (state.search ? '&q=' + encodeURIComponent(state.search) : '') +
      (state.sort ? '&sort=' + encodeURIComponent(state.sort) + '&order=' + state.order : '');
    return api(siteBase() + '/data/collections/' + encodeURIComponent(state.collection.id) + '/rows' + params).then(function (data) {
      state.rows = data.rows || [];
      state.rowTotal = data.total || 0;
      if (typeof data.rev === 'number') state.rev = data.rev;
      /* 删除/筛选后当前页为空时退回最后一个有效页，避免停在空页。 */
      if (!state.rows.length && state.offset > 0 && state.rowTotal > 0) {
        state.offset = Math.max(0, Math.floor((state.rowTotal - 1) / state.limit) * state.limit);
        return loadRows();
      }
      if (state.search) {
        refs.rowCount.textContent = data.total;
      } else {
        state.rowCount = data.total;
        refs.rowCount.textContent = String(state.rowCount);
      }
      renderRowsTable();
      renderPager();
      refs.rowNote.hidden = true;
      refs.editorMeta.textContent = state.collection.id + ' · ' + state.fields.length + ' 字段 · ' + state.rowCount + ' 行';
    });
  }

  function renderPager() {
    if (!refs.rowPager) return;
    var total = state.rowTotal;
    var from = total ? state.offset + 1 : 0;
    var to = Math.min(state.offset + state.rows.length, total);
    var pages = Math.max(1, Math.ceil(total / state.limit));
    var page = Math.floor(state.offset / state.limit) + 1;
    var sizes = [50, 100, 200, 500];
    refs.rowPager.innerHTML =
      '<span class="lc-data-pager-range">' + (total ? ('第 ' + from + '–' + to + ' 行 / 共 ' + total + ' 行') : '暂无数据') + '</span>' +
      '<span class="lc-data-pager-nav">' +
        '<button class="lc-btn lc-btn-sm" type="button" data-page-prev' + (page <= 1 ? ' disabled' : '') + '>上一页</button>' +
        '<span>第 ' + page + ' / ' + pages + ' 页</span>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-page-next' + (page >= pages ? ' disabled' : '') + '>下一页</button>' +
      '</span>' +
      '<label class="lc-data-pager-size">每页 ' +
        '<select class="lc-select lc-select-sm" data-page-size>' +
          sizes.map(function (size) {
            return '<option value="' + size + '"' + (size === state.limit ? ' selected' : '') + '>' + size + '</option>';
          }).join('') +
        '</select> 行</label>';
    if (refs.rowPageSize) refs.rowPageSize.textContent = String(state.limit);
  }

  function renderRowsTable() {
    var head = '<thead><tr>' + state.fields.map(function (field) {
      var active = state.sort === field.id;
      var arrow = active ? (state.order === 'asc' ? ' ↑' : ' ↓') : '';
      return '<th' + (active ? ' aria-sort="' + (state.order === 'asc' ? 'ascending' : 'descending') + '"' : '') + '>' +
        '<button class="lc-data-sort' + (active ? ' is-active' : '') + '" type="button" data-sort-field="' + esc(field.id) + '" title="按「' + esc(field.name) + '」排序">' +
        esc(field.name) + arrow + '</button>' +
        '<br><small class="lc-data-status">' + esc(field.id) + '</small></th>';
    }).join('') + '<th>操作</th></tr></thead>';
    if (!state.rows.length) {
      refs.rowTable.innerHTML = head + '<tbody><tr><td class="lc-data-status" colspan="' + (state.fields.length + 1) + '">没有数据行。可以「新增一行」或「生成示例数据」。</td></tr></tbody>';
      return;
    }
    var body = '<tbody>' + state.rows.map(function (row) {
      var cells = state.fields.map(function (field) {
        return '<td' + (field.type === 'json' ? ' class="lc-data-cell-json"' : '') + ' title="' +
          esc(cellText(field, row[field.id])) + '">' + esc(cellText(field, row[field.id])) + '</td>';
      }).join('');
      return '<tr data-row-id="' + esc(row.id) + '">' + cells +
        '<td><button class="lc-btn lc-btn-sm" type="button" data-edit-row="' + esc(row.id) + '">编辑</button> ' +
        '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-delete-row="' + esc(row.id) + '">删除</button></td></tr>';
    }).join('') + '</tbody>';
    refs.rowTable.innerHTML = head + body;
  }

  function fieldInputHtml(field, value) {
    var attrs = 'data-row-field="' + esc(field.id) + '"';
    if (field.type === 'boolean') {
      return '<select class="lc-select" ' + attrs + '>' +
        '<option value="true"' + (value === true ? ' selected' : '') + '>是</option>' +
        '<option value="false"' + (value === false ? ' selected' : '') + '>否</option></select>';
    }
    if (field.type === 'enum') {
      return '<select class="lc-select" ' + attrs + '>' +
        (field.enumValues || []).map(function (item) {
          return '<option value="' + esc(item) + '"' + (String(value) === item ? ' selected' : '') + '>' + esc(item) + '</option>';
        }).join('') + '</select>';
    }
    if (field.type === 'json') {
      var text = '';
      if (value !== undefined && value !== null) {
        try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
      }
      return '<textarea class="lc-input lc-data-json" ' + attrs + ' placeholder="{ }">' + esc(text) + '</textarea>';
    }
    if (field.type === 'number') {
      return '<input class="lc-input" type="number" step="any" ' + attrs + ' value="' + esc(value == null ? '' : value) + '">';
    }
    return '<input class="lc-input" type="text" ' + attrs + ' value="' + esc(value == null ? '' : value) + '"' +
      (field.type === 'date' ? ' placeholder="YYYY-MM-DD"' : '') + '>';
  }

  function openRowForm(row) {
    state.editingRowId = row ? row.id : '';
    var values = row || {};
    refs.rowForm.hidden = false;
    refs.rowForm.innerHTML = '<div class="lc-data-grid">' + state.fields.map(function (field) {
      var value = Object.prototype.hasOwnProperty.call(values, field.id) ? values[field.id] : undefined;
      var full = field.type === 'json' ? ' lc-data-span-2' : '';
      return '<label class="lc-field' + full + '"><span class="lc-label">' +
        esc(field.name) + (field.required ? '（必填）' : '') +
        '<small> · ' + typeOf(field) + '</small></span>' + fieldInputHtml(field, value) + '</label>';
    }).join('') + '</div>' +
      '<div class="lc-data-row-form-foot">' +
      '<button class="lc-btn lc-btn-sm" type="button" data-row-cancel>取消</button>' +
      '<button class="lc-btn lc-btn-sm lc-btn-primary" type="button" data-row-save>' +
      (row ? '保存修改' : '新增行') + '</button></div>';
    var first = refs.rowForm.querySelector('[data-row-field]');
    if (first && typeof first.focus === 'function') first.focus();
  }

  function closeRowForm() {
    state.editingRowId = '';
    refs.rowForm.hidden = true;
    refs.rowForm.innerHTML = '';
  }

  function collectRow() {
    var row = {};
    state.fields.forEach(function (field) {
      var input = refs.rowForm.querySelector('[data-row-field="' + field.id.replace(/"/g, '\\"') + '"]');
      if (!input) {
        row[field.id] = undefined;
        return;
      }
      if (field.type === 'boolean') {
        row[field.id] = input.value === 'true';
      } else {
        row[field.id] = input.value;
      }
    });
    return row;
  }

  function saveRow() {
    var row = collectRow();
    var path = siteBase() + '/data/collections/' + encodeURIComponent(state.collection.id) + '/rows';
    var options = state.editingRowId
      ? { method: 'PUT', body: Object.assign({ row: row }, revBody()), path: path + '/' + encodeURIComponent(state.editingRowId) }
      : { method: 'POST', body: Object.assign({ rows: [row] }, revBody()), path: path };
    var requestPath = options.path || path;
    api(requestPath, { method: options.method, body: options.body }).then(function () {
      closeRowForm();
      toast('已保存行', 'ok');
      return loadRows();
    }).then(function () {
      return refreshCollections();
    }).catch(function (error) {
      if (handleRevConflict(error, function () { closeRowForm(); loadCollection(state.collection.id); })) return;
      toast('保存行失败：' + error.message, 'error');
    });
  }

  function deleteRow(rowId) {
    api(siteBase() + '/data/collections/' + encodeURIComponent(state.collection.id) + '/rows/' + encodeURIComponent(rowId) +
      (typeof state.rev === 'number' ? '?expectedRev=' + state.rev : ''), {
      method: 'DELETE'
    }).then(function () {
      toast('已删除行', 'ok');
      return loadRows();
    }).then(refreshCollections).catch(function (error) {
      if (handleRevConflict(error, function () { loadCollection(state.collection.id); })) return;
      toast('删除行失败：' + error.message, 'error');
    });
  }

  function generateSample() {
    var count = Math.max(1, Math.min(100, Number(refs.sampleCount.value) || 10));
    api(siteBase() + '/data/collections/' + encodeURIComponent(state.collection.id) + '/sample', {
      method: 'POST',
      body: Object.assign({ count: count }, revBody())
    }).then(function (data) {
      toast('已生成 ' + data.added + ' 行示例数据' + (data.skipped ? '，跳过 ' + data.skipped + ' 行（唯一约束冲突）' : ''), 'ok');
      return loadRows();
    }).then(refreshCollections).catch(function (error) {
      if (handleRevConflict(error, function () { loadCollection(state.collection.id); })) return;
      toast('生成示例数据失败：' + error.message, 'error');
    });
  }

  /* ---------------- 保存 / 删除 ---------------- */

  function collectPayload() {
    return {
      name: state.form.name,
      description: state.form.description,
      fields: state.fields.map(function (field) {
        var out = {
          id: field.id,
          name: field.name,
          type: field.type,
          required: field.required === true,
          unique: field.unique === true,
          description: field.description || ''
        };
        if (field.type === 'enum') {
          out.enumValues = String(field.enumValuesRaw !== undefined ? field.enumValuesRaw : (field.enumValues || []).join(','))
            .split(/[,，]/).map(function (item) { return item.trim(); }).filter(Boolean);
        }
        if (field.type === 'reference') {
          out.refCollection = field.refCollection || '';
          out.refField = field.refField || '';
        }
        return out;
      }),
      indexes: state.indexes.map(function (index) {
        return { id: index.id, name: index.name, fields: index.fields.slice(), unique: index.unique === true };
      })
    };
  }

  function saveCollection(confirmBreaking) {
    var payload = Object.assign({}, collectPayload(), revBody());
    var previousId = state.collection.id;
    if (confirmBreaking) payload.confirmBreaking = true;
    setStatus('保存中…');
    refs.save.disabled = true;
    api(siteBase() + '/data/collections/' + encodeURIComponent(previousId), { method: 'PUT', body: payload })
      .then(function (data) {
        toast('集合已保存' +
          (data.adjustedRows ? '；' + data.adjustedRows + ' 行数据已按新类型重置' : ''), 'ok');
        return loadCollection(data.collection.id).then(function () {
          setStatus('已保存', 'ok');
        });
      })
      .then(refreshCollections)
      .catch(function (error) {
        refs.save.disabled = false;
        if (error.code === 'LC_E_DATA_SCHEMA_IN_USE' && error.detail) {
          setStatus('需要确认', 'error');
          showUsage(error.detail.usage || [], error.detail.diff, '确认修改并保存', function () {
            saveCollection(true);
          });
        } else if (handleRevConflict(error, function () { loadCollection(previousId); })) {
          refs.save.disabled = false;
        } else {
          setStatus('保存失败：' + error.message, 'error');
          toast('保存失败：' + error.message, 'error');
        }
      });
  }

  function deleteCollection() {
    api(siteBase() + '/data/collections/' + encodeURIComponent(state.collection.id) +
      (typeof state.rev === 'number' ? '?expectedRev=' + state.rev : ''), { method: 'DELETE' })
      .then(function () {
        toast('集合已删除（原文件已进入备份）', 'ok');
        state.collection = null;
        return refreshCollections().then(function () {
          if (state.collections.length) return loadCollection(state.collections[0].id);
          renderEmpty();
          return null;
        });
      })
      .catch(function (error) {
        if (handleRevConflict(error, function () { loadCollection(state.collection.id); })) return;
        if (error.code === 'LC_E_DATA_SCHEMA_IN_USE' && error.detail) {
          showUsage(error.detail.usage || [], null, '确认删除集合', function () {
            api(siteBase() + '/data/collections/' + encodeURIComponent(state.collection.id) + '?confirm=1' +
              (typeof state.rev === 'number' ? '&expectedRev=' + state.rev : ''), { method: 'DELETE' })
              .then(function () {
                toast('集合已删除（原文件已进入备份）', 'ok');
                state.collection = null;
                return refreshCollections().then(function () {
                  if (state.collections.length) return loadCollection(state.collections[0].id);
                  renderEmpty();
                  return null;
                });
              })
              .catch(function (inner) {
                toast('删除失败：' + inner.message, 'error');
              });
          });
        } else {
          toast('删除失败：' + error.message, 'error');
        }
      });
  }

  function showUsage(usage, diff, confirmLabel, onConfirm) {
    var lines = [];
    if (diff) {
      diff.retyped.forEach(function (item) {
        lines.push('字段「' + item.name + '」类型 ' + typeOf({ type: item.from }) + ' → ' + typeOf({ type: item.to }));
      });
      diff.removed.forEach(function (item) {
        lines.push('字段「' + item.name + '」将被删除');
      });
      diff.retargeted.forEach(function (item) {
        lines.push('字段「' + item.name + '」引用目标 ' + (item.from || '（空）') + ' → ' + (item.to || '（空）'));
      });
    }
    var items = usage.map(function (item) {
      return '<li><code>' + esc(item.file) + '</code>' + (item.field ? ' · 字段 <code>' + esc(item.field) + '</code>' : ' · 整个集合') + '</li>';
    }).join('');
    refs.usagePanel.hidden = false;
    refs.usagePanel.innerHTML =
      '<strong>这次改动会影响已绑定的页面/组件</strong>' +
      (lines.length ? '<ul>' + lines.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>' : '') +
      (items ? '<ul>' + items + '</ul>' : '<p>没有扫描到页面/组件引用，但保存后请自行检查数据绑定。</p>') +
      '<div class="lc-data-note-foot">' +
      '<button class="lc-btn lc-btn-sm" type="button" data-usage-cancel>取消</button>' +
      '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-usage-confirm>' + esc(confirmLabel) + '</button>' +
      '</div>';
    refs.usagePanel.querySelector('[data-usage-cancel]').addEventListener('click', hideUsage);
    refs.usagePanel.querySelector('[data-usage-confirm]').addEventListener('click', function () {
      hideUsage();
      onConfirm();
    });
  }

  function hideUsage() {
    refs.usagePanel.hidden = true;
    refs.usagePanel.innerHTML = '';
  }

  /* 引用提示：集合被引用时，保存按钮旁给出常驻说明。 */
  function renderUsageHint() {
    if (!state.usage.length) return;
    refs.editorMeta.textContent = state.collection.id + ' · ' + state.fields.length + ' 字段 · ' + state.rowCount +
      ' 行 · 被 ' + state.usage.length + ' 处引用';
  }

  function refreshCollections() {
    return api(siteBase() + '/data/meta').then(function (meta) {
      state.collections = meta.collections || [];
      renderCollectionList();
      if (state.collection) renderUsageHint();
    });
  }

  /* ---------------- 新建集合 ---------------- */

  function renderCreateForm() {
    if (state.createOpen) {
      refs.collectionList.innerHTML = '<div class="lc-data-note lc-data-note-warn">' +
        '<strong>新建集合</strong>' +
        '<div class="lc-data-field-extra" style="margin-top:var(--lc-space-2)">' +
        '<label class="lc-field"><span class="lc-label">集合名称</span>' +
        '<input class="lc-input" type="text" data-new-name maxlength="64" placeholder="例如：商品"></label></div>' +
        '<div class="lc-data-note-foot">' +
        '<button class="lc-btn lc-btn-sm" type="button" data-new-cancel>取消</button>' +
        '<button class="lc-btn lc-btn-sm lc-btn-primary" type="button" data-new-confirm>创建</button>' +
        '</div></div>';
      var input = refs.collectionList.querySelector('[data-new-name]');
      if (input) input.focus();
      return;
    }
    renderCollectionList();
  }

  function createCollection() {
    var input = refs.collectionList.querySelector('[data-new-name]');
    var name = input ? input.value.trim() : '';
    if (!name) {
      toast('集合名称不能为空', 'error');
      return;
    }
    api(siteBase() + '/data/collections', {
      method: 'POST',
      body: {
        name: name,
        fields: [{ id: 'name', name: '名称', type: 'text', required: true }]
      }
    }).then(function (collection) {
      state.createOpen = false;
      toast('集合已创建', 'ok');
      return refreshCollections().then(function () {
        state.collection = null;
        return loadCollection(collection.id);
      });
    }).catch(function (error) {
      toast('创建失败：' + error.message, 'error');
    });
  }

  /* ---------------- 导入 ---------------- */

  var IMPORT_LIMIT_BYTES = 5 * 1024 * 1024;

  function fmtBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return (value / (1024 * 1024)).toFixed(2) + ' MB';
    if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
    return String(value) + ' B';
  }

  function showImportError(message) {
    refs.importError.hidden = false;
    refs.importError.textContent = message;
  }

  function hideImportError() {
    refs.importError.hidden = true;
    refs.importError.textContent = '';
  }

  function openImportView() {
    if (!state.collection) return;
    state.importOpen = true;
    state.importContent = '';
    state.importPreview = null;
    state.importMapping = {};
    state.importMode = 'append';
    refs.editor.hidden = true;
    if (refs.uploadView) refs.uploadView.hidden = true;
    refs.importPanel.hidden = false;
    refs.importTarget.textContent = state.collection.name + '（' + state.collection.id + '）';
    refs.importFile.value = '';
    refs.importFormat.value = 'auto';
    refs.importPreview.hidden = true;
    refs.importResult.hidden = true;
    refs.importMapping.innerHTML = '';
    refs.importRows.innerHTML = '';
    refs.importModes.innerHTML = '';
    refs.importProgress.textContent = '';
    refs.importRun.disabled = false;
    hideImportError();
    refs.save.disabled = true;
    refs.remove.disabled = true;
    refs.editorTitle.textContent = '导入数据';
    refs.editorMeta.textContent = state.collection.id;
    setStatus('');
  }

  function closeImportView() {
    state.importOpen = false;
    if (refs.importPanel) refs.importPanel.hidden = true;
    if (refs.editor) refs.editor.hidden = false;
  }

  /* ---------------- 站点上传目标 ---------------- */

  function updateUploadBadge(data) {
    if (!refs.uploadBadge) return;
    var configured = data && data.target;
    refs.uploadBadge.textContent = !configured ? '未配置' : (data.enabled === false ? '已停用' : '已配置');
    refs.uploadBadge.className = 'lc-data-count' + (configured && data.enabled !== false ? ' is-ok' : '');
  }

  function refreshUploadBadge() {
    if (!state.siteId) { updateUploadBadge(null); return; }
    api(siteBase() + '/data/upload').then(updateUploadBadge).catch(function () { updateUploadBadge(null); });
  }

  function setUploadStatus(textValue, kind) {
    if (!refs.uploadStatus) return;
    refs.uploadStatus.className = 'lc-data-status' + (kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : '');
    refs.uploadStatus.textContent = textValue || '';
  }

  function setUploadNote(textValue, kind) {
    if (!refs.uploadNote) return;
    refs.uploadNote.hidden = !textValue;
    refs.uploadNote.textContent = textValue || '';
    refs.uploadNote.className = 'lc-data-note' + (kind === 'error' ? ' lc-data-note-warn' : '');
  }

  function renderUploadForm(data) {
    var value = data && typeof data === 'object' ? data : {};
    state.upload = value;
    refs.uploadEnabled.value = value.enabled === false ? 'false' : 'true';
    refs.uploadMethod.value = value.method || 'POST';
    refs.uploadTarget.value = value.target || '';
    refs.uploadField.value = value.fileField || 'file';
    refs.uploadAccept.value = value.accept || '';
    refs.uploadMax.value = String(Number(value.maxBytes) || 0);
    refs.uploadHeaders.value = value.headers && Object.keys(value.headers).length
      ? JSON.stringify(value.headers, null, 2)
      : '';
    updateUploadBadge(value);
    setUploadStatus('');
    setUploadNote('');
  }

  function openUploadView() {
    if (!state.siteId) return;
    state.view = 'upload';
    refs.empty.hidden = true;
    refs.editor.hidden = true;
    if (refs.importPanel) refs.importPanel.hidden = true;
    if (refs.sourceEditor) refs.sourceEditor.hidden = true;
    refs.uploadView.hidden = false;
    hideUsage();
    refs.save.disabled = true;
    refs.remove.disabled = true;
    refs.openImport.disabled = true;
    refs.editorTitle.textContent = '站点上传目标';
    refs.editorMeta.textContent = '上传组件默认继承 · 组件单独填写即覆盖';
    /* 窄屏从抽屉进入表单后收起抽屉，避免遮住工作区。 */
    if (document.body.getAttribute('data-lc-sidebar') === 'open') {
      document.body.setAttribute('data-lc-sidebar', 'closed');
    }
    setStatus('');
    renderCollectionList();
    renderSourceList();
    setUploadNote('');
    setUploadStatus('读取中…');
    api(siteBase() + '/data/upload').then(renderUploadForm).catch(function (error) {
      setUploadStatus('读取失败', 'error');
      setUploadNote(error.message, 'error');
    });
  }

  function closeUploadView() {
    if (state.view === 'upload') state.view = 'collection';
    if (refs.uploadView) refs.uploadView.hidden = true;
    if (state.collection) {
      refs.editor.hidden = false;
      refs.empty.hidden = true;
    } else {
      refs.editor.hidden = true;
      refs.empty.hidden = false;
    }
    refs.openImport.disabled = !state.collection;
    refs.save.disabled = true;
    refs.remove.disabled = true;
    renderCollectionList();
    renderSourceList();
  }

  function saveUpload() {
    if (!state.siteId || state.uploadSaving) return;
    var headersText = refs.uploadHeaders.value.trim();
    var headers = {};
    if (headersText) {
      try {
        headers = JSON.parse(headersText);
      } catch (error) {
        setUploadStatus('保存失败', 'error');
        setUploadNote('请求头必须是合法 JSON 对象，例如 {"Authorization":"Bearer <token>"}。', 'error');
        return;
      }
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        setUploadStatus('保存失败', 'error');
        setUploadNote('请求头必须是 JSON 对象，不能是数组或纯文本。', 'error');
        return;
      }
    }
    var target = refs.uploadTarget.value.trim();
    if (target && !/^(https?:\/\/|\/)/i.test(target)) {
      setUploadStatus('保存失败', 'error');
      setUploadNote('上传地址必须以 / 或 http(s):// 开头。', 'error');
      return;
    }
    var payload = {
      enabled: refs.uploadEnabled.value === 'true',
      target: target,
      method: refs.uploadMethod.value,
      fileField: refs.uploadField.value.trim() || 'file',
      accept: refs.uploadAccept.value.trim(),
      maxBytes: Math.max(0, Math.floor(Number(refs.uploadMax.value) || 0)),
      headers: headers
    };
    state.uploadSaving = true;
    refs.uploadSave.disabled = true;
    setUploadNote('');
    setUploadStatus('保存中…');
    api(siteBase() + '/data/upload', { method: 'PUT', body: payload }).then(function (data) {
      renderUploadForm(data);
      setUploadStatus('已保存', 'ok');
      toast('上传目标已保存');
    }).catch(function (error) {
      setUploadStatus('保存失败', 'error');
      setUploadNote(error.message, 'error');
    }).finally(function () {
      state.uploadSaving = false;
      refs.uploadSave.disabled = false;
    });
  }

  function resetImportView() {
    state.importContent = '';
    state.importPreview = null;
    state.importMapping = {};
    state.importMode = 'append';
    refs.importFile.value = '';
    refs.importPreview.hidden = true;
    refs.importResult.hidden = true;
    refs.importMapping.innerHTML = '';
    refs.importRows.innerHTML = '';
    refs.importModes.innerHTML = '';
    refs.importProgress.textContent = '';
    refs.importRun.disabled = false;
    hideImportError();
  }

  function onImportFile() {
    var file = refs.importFile.files && refs.importFile.files[0];
    if (!file) return;
    hideImportError();
    refs.importPreview.hidden = true;
    refs.importResult.hidden = true;
    refs.importProgress.textContent = '';
    if (file.size > IMPORT_LIMIT_BYTES) {
      state.importContent = '';
      showImportError('文件「' + file.name + '」' + fmtBytes(file.size) + '，超过单次上限 ' +
        fmtBytes(IMPORT_LIMIT_BYTES) + '。请拆分后再导入。');
      return;
    }
    var ext = String(file.name).toLowerCase().split('.').pop();
    var selected = refs.importFormat.value;
    var format = selected === 'auto'
      ? (ext === 'json' ? 'json' : ext === 'csv' ? 'csv' : 'auto')
      : selected;
    file.text().then(function (content) {
      state.importContent = content;
      requestPreview(format);
    }).catch(function (error) {
      state.importContent = '';
      showImportError('读取文件失败：' + error.message);
    });
  }

  function requestPreview(format) {
    if (!state.importContent) return;
    refs.importProgress.textContent = '解析中…';
    hideImportError();
    api(siteBase() + '/data/import/preview', {
      method: 'POST',
      body: { collectionId: state.collection.id, content: state.importContent, format: format || 'auto' }
    }).then(function (preview) {
      state.importPreview = preview;
      state.importMapping = preview.mapping || {};
      state.importMode = 'append';
      refs.importProgress.textContent = '';
      renderImportPreview();
    }).catch(function (error) {
      refs.importProgress.textContent = '';
      showImportError('预览失败：' + error.message +
        (error.detail && error.detail.limitBytes ? '（上限 ' + fmtBytes(error.detail.limitBytes) + '）' : ''));
    });
  }

  function renderImportPreview() {
    var preview = state.importPreview;
    if (!preview) return;
    refs.importSummary.textContent = (preview.format === 'json' ? 'JSON' : 'CSV') +
      ' · 共 ' + preview.totalRows + ' 行 · ' + fmtBytes(preview.sizeBytes) +
      ' · 上限 ' + fmtBytes(preview.limitBytes) + ' / ' + preview.rowLimit + ' 行';
    if (preview.warnings && preview.warnings.length) {
      refs.importWarnings.hidden = false;
      refs.importWarnings.innerHTML = '<ul>' + preview.warnings.map(function (item) {
        return '<li>' + esc(item.message) + '</li>';
      }).join('') + '</ul>';
    } else {
      refs.importWarnings.hidden = true;
      refs.importWarnings.innerHTML = '';
    }

    var options = '<option value="">不导入</option>' + preview.fields.map(function (field) {
      return '<option value="' + esc(field.id) + '">' + esc(field.name) + ' · ' + esc(field.typeLabel) + '</option>';
    }).join('');
    refs.importMapping.innerHTML = '<thead><tr><th>文件列</th><th>推断类型</th><th>样例</th><th>导入到字段</th></tr></thead><tbody>' +
      preview.columns.map(function (column) {
        var selected = state.importMapping[column.name] || '';
        var opts = options.replace('value="' + selected + '"', 'value="' + selected + '" selected');
        return '<tr><td><strong>' + esc(column.name) + '</strong></td><td>' + esc(column.inferredLabel) +
          '</td><td class="lc-data-cell-json">' + esc((column.samples || []).join(' | ')) + '</td>' +
          '<td><select class="lc-select" data-import-map="' + esc(column.name) + '">' + opts + '</select></td></tr>';
      }).join('') + '</tbody>';

    var modes = state.importModes.length ? state.importModes : [
      { value: 'append', label: '追加（冲突行跳过，其余新增）' },
      { value: 'overwrite', label: '覆盖（按唯一键更新已有行，未匹配则新增）' },
      { value: 'skipDuplicates', label: '跳过重复（整行完全相同的记录不导入）' }
    ];
    refs.importModes.innerHTML = modes.map(function (mode) {
      return '<label class="lc-data-mode"><input type="radio" name="lc-import-mode" value="' + esc(mode.value) + '"' +
        (mode.value === state.importMode ? ' checked' : '') + '><span>' + esc(mode.label) + '</span></label>';
    }).join('');

    var headers = preview.columns.map(function (column) { return '<th>' + esc(column.name) + '</th>'; }).join('');
    refs.importRows.innerHTML = '<thead><tr>' + headers + '</tr></thead><tbody>' +
      (preview.rows || []).map(function (row) {
        return '<tr>' + preview.columns.map(function (column) {
          var value = row[column.name];
          var textValue = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value == null ? '' : value);
          return '<td title="' + esc(textValue) + '">' + esc(textValue) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
    refs.importPreview.hidden = false;
  }

  function executeImport() {
    if (!state.importContent || !state.importPreview) return;
    var mapped = Object.keys(state.importMapping).filter(function (key) { return state.importMapping[key]; });
    if (!mapped.length) {
      showImportError('至少需要把一列映射到集合字段');
      return;
    }
    refs.importRun.disabled = true;
    refs.importProgress.textContent = '导入中…';
    api(siteBase() + '/data/import', {
      method: 'POST',
      body: Object.assign({
        collectionId: state.collection.id,
        content: state.importContent,
        format: state.importPreview.format,
        mapping: state.importMapping,
        mode: state.importMode
      }, revBody())
    }).then(function (result) {
      refs.importProgress.textContent = '';
      refs.importRun.disabled = false;
      renderImportResult(result);
      return loadRows().then(refreshCollections);
    }).catch(function (error) {
      refs.importProgress.textContent = '';
      refs.importRun.disabled = false;
      if (handleRevConflict(error, function () {
        closeImportView();
        loadCollection(state.collection.id);
      })) return;
      showImportError('导入失败：' + error.message);
    });
  }

  function renderImportResult(result) {
    refs.importResult.hidden = false;
    refs.importResultSummary.textContent = '新增 ' + result.added + ' 行，更新 ' + result.updated +
      ' 行，跳过 ' + result.skipped + ' 行，失败 ' + result.failed + ' 行；当前集合共 ' + result.rowCount + ' 行。';
    if (result.issues && result.issues.length) {
      refs.importIssues.hidden = false;
      refs.importIssues.innerHTML = '<strong>逐行明细（最多显示 50 条）</strong><ul>' +
        result.issues.map(function (issue) {
          return '<li>第 ' + issue.row + ' 行：' + esc(issue.reason) + '</li>';
        }).join('') + '</ul>' +
        (result.issueCount > result.issues.length ? '<p>另有 ' + (result.issueCount - result.issues.length) + ' 条未显示。</p>' : '');
    } else {
      refs.importIssues.hidden = true;
      refs.importIssues.innerHTML = '';
    }
    if (typeof refs.importResult.scrollIntoView === 'function') {
      refs.importResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /* ---------------- 自定义接口 ---------------- */

  function buildDraft(source) {
    var req = (source && source.request) || {};
    var mapping = (source && source.mapping) || {};
    var limits = state.sourceLimits || {};
    return {
      id: source ? source.id : '',
      name: source ? source.name : '新接口',
      description: source ? (source.description || '') : '',
      method: req.method || 'GET',
      url: req.url || '',
      timeoutMs: req.timeoutMs || limits.requestTimeoutMs || 10000,
      maxResponseBytes: req.maxResponseBytes || limits.responseBytes || 1048576,
      contentType: req.contentType || '',
      body: req.body || '',
      headers: (req.headers || []).map(function (entry) {
        return {
          name: entry.name,
          value: entry.value == null ? '' : entry.value,
          secret: entry.secret === true,
          hasSecret: entry.hasSecret === true
        };
      }),
      query: (req.query || []).map(function (entry) {
        return {
          name: entry.name,
          value: entry.value == null ? '' : entry.value,
          secret: entry.secret === true,
          hasSecret: entry.hasSecret === true
        };
      }),
      target: (!state.collections.length && mapping.target !== 'component') ? 'component'
        : (mapping.target === 'component' ? 'component' : 'collection'),
      collectionId: mapping.collectionId || (state.collections[0] ? state.collections[0].id : ''),
      component: mapping.component || '',
      rowsPath: mapping.rowsPath || '',
      fields: (mapping.fields || []).map(function (item) { return { from: item.from, to: item.to }; })
    };
  }

  function openSourceForm(source) {
    state.source = buildDraft(source);
    showSourceEditor();
    renderSourceForm();
    return state.source;
  }

  function showSourceEditor() {
    state.view = 'source';
    state.importOpen = false;
    if (refs.uploadView) refs.uploadView.hidden = true;
    if (document.body.getAttribute('data-lc-sidebar') === 'open') {
      document.body.setAttribute('data-lc-sidebar', 'closed');
    }
    refs.empty.hidden = true;
    refs.editor.hidden = true;
    if (refs.importPanel) refs.importPanel.hidden = true;
    refs.sourceEditor.hidden = false;
    hideUsage();
    refs.save.disabled = true;
    refs.remove.disabled = true;
    refs.openImport.disabled = true;
    refs.editorTitle.textContent = '自定义接口';
    refs.editorMeta.textContent = '密钥不回显 · 不进导出包 · 不进日志';
    setStatus('');
    renderCollectionList();
    renderSourceList();
  }

  function closeSourceEditor() {
    if (state.view === 'source') state.view = 'collection';
    if (refs.sourceEditor) refs.sourceEditor.hidden = true;
  }

  function setSourceStatus(textValue, kind) {
    if (refs.sourceStatus) {
      refs.sourceStatus.className = 'lc-data-status' + (kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : '');
      refs.sourceStatus.textContent = textValue || '';
    }
    if (refs.sourceState) {
      refs.sourceState.hidden = !textValue;
      refs.sourceState.className = 'lc-badge' + (kind === 'error' ? ' lc-badge-danger' : kind === 'ok' ? ' lc-badge-success' : '');
      refs.sourceState.textContent = textValue || '';
    }
  }

  function renderTarget() {
    var draft = state.source;
    var targets = [
      { value: 'collection', label: '映射到集合（返回数组可直接作为行数据）' },
      { value: 'component', label: '映射到组件（字段结构供图表 / 表格使用）' }
    ];
    refs.sourceTarget.innerHTML = targets.map(function (item) {
      return '<label class="lc-data-mode"><input type="radio" name="lc-source-target" value="' + item.value + '"' +
        (draft.target === item.value ? ' checked' : '') + '><span>' + esc(item.label) + '</span></label>';
    }).join('');
    refs.sourceCollection.disabled = draft.target !== 'collection';
    refs.sourceComponent.disabled = draft.target !== 'component';
  }

  function renderEntries(kind) {
    var container = kind === 'header' ? refs.headerList : refs.queryList;
    var entries = kind === 'header' ? state.source.headers : state.source.query;
    if (!entries.length) {
      container.innerHTML = '<div class="lc-data-entry-empty">没有' +
        (kind === 'header' ? '请求头' : '查询参数') + '，点右上角添加。</div>';
      return;
    }
    container.innerHTML = entries.map(function (entry, index) {
      var placeholder = entry.secret && entry.hasSecret && !entry.value ? '已保存（不回显）' : '值';
      return '<div class="lc-data-entry">' +
        '<input class="lc-input" type="text" data-entry-kind="' + kind + '" data-entry-idx="' + index +
        '" data-entry-key="name" value="' + esc(entry.name) + '" placeholder="' +
        (kind === 'header' ? 'Header 名称' : '参数名') + '" aria-label="名称" autocomplete="off">' +
        '<input class="lc-input' + (entry.secret ? ' lc-data-mono' : '') + '" type="' + (entry.secret ? 'password' : 'text') +
        '" autocomplete="off" data-entry-kind="' + kind + '" data-entry-idx="' + index +
        '" data-entry-key="value" value="' + (entry.secret ? '' : esc(entry.value)) + '" placeholder="' + placeholder + '" aria-label="值">' +
        '<label class="lc-data-check"><input type="checkbox" data-entry-kind="' + kind + '" data-entry-idx="' + index +
        '" data-entry-key="secret"' + (entry.secret ? ' checked' : '') + '><span>密钥</span></label>' +
        '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-entry-remove="' + kind +
        '" data-entry-idx="' + index + '">删除</button>' +
        '</div>';
    }).join('');

    /* 密钥值只通过 DOM 属性外的方法写回，避免明文出现在序列化后的 HTML 里。 */
    container.querySelectorAll('[data-entry-key="value"]').forEach(function (input) {
      var entry = entries[Number(input.getAttribute('data-entry-idx'))];
      if (entry && entry.secret && entry.value) input.value = entry.value;
    });
  }

  function renderMappings() {
    var entries = state.source.fields;
    if (!entries.length) {
      refs.mappingList.innerHTML = '<div class="lc-data-entry-empty">还没有字段映射，点右上角添加；留空时按集合字段同名匹配。</div>';
      return;
    }
    refs.mappingList.innerHTML = entries.map(function (item, index) {
      return '<div class="lc-data-entry is-map">' +
        '<input class="lc-input lc-data-mono" type="text" data-map-idx="' + index +
        '" data-map-key="from" value="' + esc(item.from) + '" placeholder="响应字段，例如 title" aria-label="响应字段" autocomplete="off">' +
        '<span class="lc-data-entry-arrow">→</span>' +
        '<input class="lc-input lc-data-mono" type="text" data-map-idx="' + index +
        '" data-map-key="to" value="' + esc(item.to) + '" placeholder="目标字段，例如 name" aria-label="目标字段" autocomplete="off">' +
        '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-map-remove="' + index + '">删除</button>' +
        '</div>';
    }).join('');
  }

  function renderSourceForm() {
    var draft = state.source;
    if (!draft) return;
    refs.sourceName.value = draft.name;
    refs.sourceIdInput.value = draft.id || '（保存后自动生成）';
    refs.sourceDescription.value = draft.description;
    var methods = state.sourceMethods.length ? state.sourceMethods : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    refs.sourceMethod.innerHTML = methods.map(function (method) {
      return '<option value="' + method + '">' + method + '</option>';
    }).join('');
    refs.sourceMethod.value = draft.method;
    refs.sourceUrl.value = draft.url;
    refs.sourceTimeout.value = String(draft.timeoutMs);
    refs.sourceMaxBytes.value = String(draft.maxResponseBytes);
    refs.sourceContentType.value = draft.contentType;
    refs.sourceBody.value = draft.body;
    refs.sourceBody.disabled = draft.method === 'GET' || draft.method === 'HEAD';
    var options = state.collections.map(function (collection) {
      return '<option value="' + esc(collection.id) + '">' + esc(collection.name) + ' · ' + esc(collection.id) + '</option>';
    }).join('');
    refs.sourceCollection.innerHTML = (state.collections.length ? '' : '<option value="">（还没有集合）</option>') + options;
    refs.sourceCollection.value = draft.collectionId;
    if (state.collections.length && !draft.collectionId && state.collections[0]) {
      draft.collectionId = state.collections[0].id;
      refs.sourceCollection.value = draft.collectionId;
    }
    refs.sourceComponent.value = draft.component;
    refs.sourceRowsPath.value = draft.rowsPath;
    renderTarget();
    renderEntries('header');
    renderEntries('query');
    renderMappings();
    refs.sourceDelete.disabled = !draft.id;
    refs.sourceTestResult.hidden = true;
    refs.sourceTestResult.innerHTML = '';
  }

  function collectSourcePayload() {
    var draft = state.source;
    var cleanEntries = function (entries) {
      return entries.filter(function (item) {
        return String(item.name || '').trim();
      }).map(function (item) {
        var out = { name: String(item.name).trim(), secret: item.secret === true };
        if (out.secret) {
          if (String(item.value == null ? '' : item.value)) out.value = String(item.value);
        } else {
          out.value = String(item.value == null ? '' : item.value);
        }
        return out;
      });
    };
    return {
      name: draft.name,
      description: draft.description,
      request: {
        method: draft.method,
        url: draft.url,
        headers: cleanEntries(draft.headers),
        query: cleanEntries(draft.query),
        body: draft.body,
        contentType: draft.contentType,
        timeoutMs: Number(draft.timeoutMs),
        maxResponseBytes: Number(draft.maxResponseBytes)
      },
      mapping: {
        target: draft.target,
        collectionId: draft.target === 'collection' ? draft.collectionId : '',
        component: draft.target === 'component' ? draft.component : '',
        rowsPath: draft.rowsPath,
        fields: draft.fields.map(function (item) {
          return { from: String(item.from || '').trim(), to: String(item.to || '').trim() };
        }).filter(function (item) { return item.from && item.to; })
      }
    };
  }

  function refreshSources() {
    return api(siteBase() + '/data/sources').then(function (data) {
      state.sources = data.sources || [];
      if (typeof data.rev === 'number') state.sourcesRev = data.rev;
      state.sourceLimits = data.limits || state.sourceLimits;
      if (data.methods && data.methods.length) state.sourceMethods = data.methods;
      renderSourceList();
    });
  }

  function saveSource() {
    var draft = state.source;
    if (!draft) return;
    var payload = collectSourcePayload();
    if (typeof state.sourcesRev === 'number') payload.expectedRev = state.sourcesRev;
    refs.sourceSave.disabled = true;
    setSourceStatus('保存中…');
    var path = draft.id
      ? siteBase() + '/data/sources/' + encodeURIComponent(draft.id)
      : siteBase() + '/data/sources';
    api(path, { method: draft.id ? 'PUT' : 'POST', body: payload }).then(function (saved) {
      state.source = buildDraft(saved);
      toast('接口已保存', 'ok');
      return refreshSources().then(function () {
        renderSourceForm();
        setSourceStatus('已保存', 'ok');
      });
    }).catch(function (error) {
      if (handleRevConflict(error, function () { refreshSources(); })) return;
      setSourceStatus('保存失败：' + error.message, 'error');
      toast('保存接口失败：' + error.message, 'error');
    }).then(function () {
      refs.sourceSave.disabled = false;
    });
  }

  function deleteSource() {
    var draft = state.source;
    if (!draft || !draft.id) return;
    if (!window.confirm('删除接口「' + draft.name + '」？本地保存的密钥会一起清除。')) return;
    api(siteBase() + '/data/sources/' + encodeURIComponent(draft.id) +
      (typeof state.sourcesRev === 'number' ? '?expectedRev=' + state.sourcesRev : ''), { method: 'DELETE' }).then(function () {
      toast('接口已删除', 'ok');
      state.source = null;
      return refreshSources().then(function () {
        closeSourceEditor();
        if (state.collections.length) {
          return loadCollection(state.collection ? state.collection.id : state.collections[0].id);
        }
        renderEmpty();
        return null;
      });
    }).catch(function (error) {
      if (handleRevConflict(error, function () { refreshSources(); })) return;
      toast('删除接口失败：' + error.message, 'error');
    });
  }

  function testSource() {
    if (state.sourceTesting || !state.source) return;
    var payload = collectSourcePayload();
    var body = { source: payload };
    if (state.source.id) body.sourceId = state.source.id;
    state.sourceTesting = true;
    refs.sourceTest.disabled = true;
    setSourceStatus('测试中…');
    refs.sourceTestResult.hidden = false;
    refs.sourceTestResult.innerHTML = '正在请求…';
    api(siteBase() + '/data/sources/test', { method: 'POST', body: body }).then(function (result) {
      renderTestResult(result);
      setSourceStatus(result.success ? '连接成功' : '连接失败', result.success ? 'ok' : 'error');
    }).catch(function (error) {
      refs.sourceTestResult.hidden = false;
      refs.sourceTestResult.innerHTML = '<strong>测试未执行</strong><p>' + esc(error.message) + '</p>';
      setSourceStatus('测试失败：' + error.message, 'error');
    }).then(function () {
      state.sourceTesting = false;
      refs.sourceTest.disabled = false;
    });
  }

  function structureLines(node, prefix, lines) {
    if (!node) return;
    if (node.kind === 'object') {
      (node.fields || []).forEach(function (field) {
        lines.push(prefix + field.name + ': ' + field.type + (field.sample ? '　例：' + field.sample : ''));
      });
      return;
    }
    if (node.kind === 'array') {
      lines.push(prefix + '数组，共 ' + (node.length || 0) + ' 项');
      if (node.item) structureLines(node.item, prefix + '　　', lines);
      return;
    }
    if (node.kind === 'deep') {
      lines.push(prefix + '（层级较深，已省略）');
      return;
    }
    lines.push(prefix + node.kind + (node.sample ? '　例：' + node.sample : ''));
  }

  function renderTestResult(result) {
    var ok = result.success === true;
    var category = CATEGORY_LABELS[result.category] || result.category || '未知';
    var parts = [];
    parts.push('<div class="lc-data-test-head">' +
      '<span class="lc-badge ' + (ok ? 'lc-badge-success' : 'lc-badge-danger') + '">' +
      (ok ? '成功' : '失败') + ' · ' + esc(category) + '</span>' +
      '<span class="lc-data-status">' + esc(result.message || '') + '</span></div>');

    var meta = [];
    if (result.status != null) {
      meta.push('<span>状态码 <code>' + esc(result.status) + ' ' + esc(result.statusText || '') + '</code></span>');
    }
    if (result.elapsedMs != null) meta.push('<span>耗时 <code>' + esc(result.elapsedMs) + ' ms</code></span>');
    if (result.responseBytes != null) meta.push('<span>响应 <code>' + esc(fmtBytes(result.responseBytes)) + '</code></span>');
    if (result.contentType) meta.push('<span>类型 <code>' + esc(result.contentType) + '</code></span>');
    if (result.request && result.request.url) meta.push('<span>地址 <code>' + esc(result.request.url) + '</code></span>');
    if (meta.length) parts.push('<div class="lc-data-test-meta">' + meta.join('') + '</div>');

    if (result.request) {
      var secretBits = [];
      (result.request.headers || []).forEach(function (entry) {
        if (entry.secret) secretBits.push(entry.name + '：' + (entry.present ? '已填入（不回显）' : '未填写'));
      });
      (result.request.query || []).forEach(function (entry) {
        if (entry.secret) secretBits.push(entry.name + '：' + (entry.present ? '已填入（不回显）' : '未填写'));
      });
      if (secretBits.length) {
        parts.push('<div class="lc-data-test-meta">' + secretBits.map(function (textValue) {
          return '<span>' + esc(textValue) + '</span>';
        }).join('') + '</div>');
      }
    }

    if (result.rows != null) {
      parts.push('<div class="lc-data-test-meta"><span>解析到 <code>' + esc(result.rows) + '</code> 行' +
        (result.rowsPath ? '，路径 <code>' + esc(result.rowsPath) + '</code>' : '') + '</span></div>');
    }

    if (result.structure) {
      var lines = [];
      structureLines(result.structure, '', lines);
      parts.push('<div class="lc-data-structure">' +
        (lines.length ? lines.map(function (line) { return esc(line); }).join('<br>') : '（无结构信息）') +
        '</div>');
    }

    if (result.mapped && result.mapped.length) {
      var keys = [];
      result.mapped.forEach(function (row) {
        if (row && typeof row === 'object') {
          Object.keys(row).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); });
        }
      });
      var cell = function (value) {
        if (value === undefined || value === null) return '—';
        if (typeof value === 'object') {
          try { return JSON.stringify(value); } catch { return '[object]'; }
        }
        return String(value);
      };
      parts.push('<div class="lc-data-test-meta"><span>映射样例（前 ' + result.mapped.length + ' 行）</span></div>');
      parts.push('<div class="lc-data-table-wrap" style="max-height:240px"><table class="lc-table"><thead><tr>' +
        keys.map(function (key) { return '<th>' + esc(key) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + result.mapped.map(function (row) {
          return '<tr>' + keys.map(function (key) {
            return '<td title="' + esc(cell(row[key])) + '">' + esc(cell(row[key])) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>');
    }
    if (result.unmapped && result.unmapped.length) {
      parts.push('<p class="lc-data-status">未映射的响应字段：' + esc(result.unmapped.join('、')) + '</p>');
    }
    if (result.bodyPreview) {
      parts.push('<div class="lc-data-structure">响应片段：' + esc(result.bodyPreview) + '</div>');
    }

    refs.sourceTestResult.hidden = false;
    refs.sourceTestResult.innerHTML = parts.join('');
  }

  function bindEntryList(container, kind) {
    container.addEventListener('input', function (event) {
      var idx = event.target.getAttribute('data-entry-idx');
      var key = event.target.getAttribute('data-entry-key');
      if (idx === null || !key) return;
      var entries = kind === 'header' ? state.source.headers : state.source.query;
      var entry = entries[Number(idx)];
      if (!entry) return;
      entry[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    });

    container.addEventListener('change', function (event) {
      var idx = event.target.getAttribute('data-entry-idx');
      var key = event.target.getAttribute('data-entry-key');
      if (idx === null || key !== 'secret') return;
      var entries = kind === 'header' ? state.source.headers : state.source.query;
      var entry = entries[Number(idx)];
      if (!entry) return;
      entry.secret = event.target.checked;
      if (!entry.secret) entry.hasSecret = false;
      renderEntries(kind);
    });

    container.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-entry-remove]');
      if (!remove || remove.getAttribute('data-entry-remove') !== kind) return;
      var entries = kind === 'header' ? state.source.headers : state.source.query;
      entries.splice(Number(remove.getAttribute('data-entry-idx')), 1);
      renderEntries(kind);
    });
  }

  /* ---------------- 绑定 ---------------- */

  function bind() {
    var drawerToggle = document.querySelector('[data-toggle-sidebar]');
    if (drawerToggle) {
      drawerToggle.addEventListener('click', function () {
        var shell = document.body;
        var open = shell.getAttribute('data-lc-sidebar') === 'open';
        shell.setAttribute('data-lc-sidebar', open ? 'closed' : 'open');
        drawerToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    }

    refs.siteSelect.addEventListener('change', function () {
      if (refs.siteSelect.value) loadSite(refs.siteSelect.value).catch(function (error) {
        toast('切换站点失败：' + error.message, 'error');
      });
    });

    refs.newCollection.addEventListener('click', function () {
      state.createOpen = true;
      renderCreateForm();
    });

    refs.collectionList.addEventListener('click', function (event) {
      var select = event.target.closest('[data-select-collection]');
      if (select) {
        loadCollection(select.getAttribute('data-select-collection'));
        return;
      }
      if (event.target.closest('[data-new-cancel]')) {
        state.createOpen = false;
        renderCreateForm();
        return;
      }
      if (event.target.closest('[data-new-confirm]')) createCollection();
    });

    /* 自定义接口 */
    refs.newSource.addEventListener('click', function () {
      openSourceForm(null);
    });

    refs.sourceList.addEventListener('click', function (event) {
      var select = event.target.closest('[data-select-source]');
      if (!select) return;
      var id = select.getAttribute('data-select-source');
      var source = state.sources.filter(function (item) { return item.id === id; })[0];
      if (source) openSourceForm(source);
    });

    refs.sourceName.addEventListener('input', function () { state.source.name = refs.sourceName.value; });
    refs.sourceDescription.addEventListener('input', function () { state.source.description = refs.sourceDescription.value; });
    refs.sourceUrl.addEventListener('input', function () { state.source.url = refs.sourceUrl.value; });
    refs.sourceTimeout.addEventListener('input', function () { state.source.timeoutMs = Number(refs.sourceTimeout.value); });
    refs.sourceMaxBytes.addEventListener('input', function () { state.source.maxResponseBytes = Number(refs.sourceMaxBytes.value); });
    refs.sourceContentType.addEventListener('input', function () { state.source.contentType = refs.sourceContentType.value; });
    refs.sourceBody.addEventListener('input', function () { state.source.body = refs.sourceBody.value; });
    refs.sourceRowsPath.addEventListener('input', function () { state.source.rowsPath = refs.sourceRowsPath.value; });
    refs.sourceComponent.addEventListener('input', function () { state.source.component = refs.sourceComponent.value; });

    refs.sourceMethod.addEventListener('change', function () {
      state.source.method = refs.sourceMethod.value;
      refs.sourceBody.disabled = state.source.method === 'GET' || state.source.method === 'HEAD';
    });

    refs.sourceTarget.addEventListener('change', function (event) {
      if (event.target.name !== 'lc-source-target') return;
      state.source.target = event.target.value;
      renderTarget();
    });

    refs.sourceCollection.addEventListener('change', function () {
      state.source.collectionId = refs.sourceCollection.value;
    });

    refs.addHeader.addEventListener('click', function () {
      state.source.headers.push({ name: '', value: '', secret: false, hasSecret: false });
      renderEntries('header');
    });
    refs.addQuery.addEventListener('click', function () {
      state.source.query.push({ name: '', value: '', secret: false, hasSecret: false });
      renderEntries('query');
    });
    refs.addMapping.addEventListener('click', function () {
      state.source.fields.push({ from: '', to: '' });
      renderMappings();
    });

    refs.mappingList.addEventListener('input', function (event) {
      var idx = event.target.getAttribute('data-map-idx');
      var key = event.target.getAttribute('data-map-key');
      if (idx === null || !key) return;
      var item = state.source.fields[Number(idx)];
      if (item) item[key] = event.target.value;
    });
    refs.mappingList.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-map-remove]');
      if (!remove) return;
      state.source.fields.splice(Number(remove.getAttribute('data-map-remove')), 1);
      renderMappings();
    });

    bindEntryList(refs.headerList, 'header');
    bindEntryList(refs.queryList, 'query');

    refs.sourceTest.addEventListener('click', testSource);
    refs.sourceSave.addEventListener('click', saveSource);
    refs.sourceDelete.addEventListener('click', deleteSource);

    refs.metaName.addEventListener('input', function () {
      state.form.name = refs.metaName.value;
    });
    refs.metaId.addEventListener('input', function () {
      /* 集合 ID 只读：它写进页面绑定与导出快照，改名会断引用。 */
      refs.metaId.value = state.collection ? state.collection.id : '';
    });
    refs.metaDescription.addEventListener('input', function () {
      state.form.description = refs.metaDescription.value;
    });

    refs.fieldList.addEventListener('input', function (event) {
      var idx = event.target.getAttribute('data-field-idx');
      var key = event.target.getAttribute('data-field-key');
      if (idx === null || !key) return;
      var field = state.fields[Number(idx)];
      if (!field) return;
      if (event.target.type === 'checkbox') field[key] = event.target.checked;
      else field[key] = event.target.value;
    });

    refs.fieldList.addEventListener('change', function (event) {
      var idx = event.target.getAttribute('data-field-idx');
      var key = event.target.getAttribute('data-field-key');
      if (idx !== null && key === 'type') {
        var field = state.fields[Number(idx)];
        if (field) {
          field.type = event.target.value;
          if (field.type === 'enum' && !Array.isArray(field.enumValues)) field.enumValues = [];
          renderFields();
          renderIndexes();
        }
      }
    });

    refs.fieldList.addEventListener('input', function (event) {
      var idx = event.target.getAttribute('data-field-idx');
      var extra = event.target.getAttribute('data-field-extra');
      if (idx === null || !extra) return;
      var field = state.fields[Number(idx)];
      if (!field) return;
      if (extra === 'enumValues') {
        field.enumValuesRaw = event.target.value;
        field.enumValues = event.target.value.split(/[,，]/).map(function (item) { return item.trim(); }).filter(Boolean);
      } else {
        field[extra] = event.target.value.trim();
      }
    });

    refs.fieldList.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove-field]');
      if (!remove) return;
      var idx = Number(remove.getAttribute('data-remove-field'));
      state.fields.splice(idx, 1);
      renderFields();
      renderIndexes();
    });

    refs.addField.addEventListener('click', function () {
      var taken = state.fields.map(function (field) { return field.id; });
      var index = 1;
      var id = 'field-' + index;
      while (taken.indexOf(id) >= 0) {
        index += 1;
        id = 'field-' + index;
      }
      state.fields.push({ id: id, name: '新字段 ' + index, type: 'text', required: false, unique: false });
      renderFields();
      renderIndexes();
    });

    refs.indexList.addEventListener('input', function (event) {
      var idx = event.target.getAttribute('data-index-idx');
      var key = event.target.getAttribute('data-index-key');
      if (idx !== null && key) {
        var index = state.indexes[Number(idx)];
        if (index) index[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      }
    });

    refs.indexList.addEventListener('change', function (event) {
      var idx = event.target.getAttribute('data-index-field');
      if (idx === null) return;
      var index = state.indexes[Number(idx)];
      if (!index) return;
      var id = event.target.value;
      index.fields = index.fields || [];
      if (event.target.checked) {
        if (index.fields.indexOf(id) === -1) index.fields.push(id);
      } else {
        index.fields = index.fields.filter(function (item) { return item !== id; });
      }
    });

    refs.indexList.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove-index]');
      if (!remove) return;
      state.indexes.splice(Number(remove.getAttribute('data-remove-index')), 1);
      renderIndexes();
    });

    refs.addIndex.addEventListener('click', function () {
      /* 新索引默认不选字段：由用户显式勾选，避免悄悄变成复合索引（DATA-02）。 */
      state.indexes.push({ id: 'idx-' + (state.indexes.length + 1), name: '索引 ' + (state.indexes.length + 1), fields: [], unique: false });
      renderIndexes();
    });

    refs.save.addEventListener('click', function () { saveCollection(false); });
    refs.remove.addEventListener('click', deleteCollection);
    refs.addRow.addEventListener('click', function () { openRowForm(null); });
    refs.generateSample.addEventListener('click', generateSample);

    refs.openImport.addEventListener('click', openImportView);
    if (refs.openUpload) refs.openUpload.addEventListener('click', openUploadView);
    if (refs.uploadBack) refs.uploadBack.addEventListener('click', closeUploadView);
    if (refs.uploadSave) refs.uploadSave.addEventListener('click', saveUpload);
    refs.importBack.addEventListener('click', closeImportView);
    refs.importAgain.addEventListener('click', resetImportView);
    refs.importFile.addEventListener('change', onImportFile);
    refs.importRun.addEventListener('click', executeImport);
    refs.importMapping.addEventListener('change', function (event) {
      var column = event.target.getAttribute('data-import-map');
      if (column === null) return;
      state.importMapping[column] = event.target.value;
    });
    refs.importModes.addEventListener('change', function (event) {
      if (event.target.name !== 'lc-import-mode') return;
      state.importMode = event.target.value;
    });
    refs.importFormat.addEventListener('change', function () {
      if (state.importContent) requestPreview(refs.importFormat.value);
    });

    refs.rowSearch.addEventListener('input', function () {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(function () {
        state.search = refs.rowSearch.value.trim();
        /* 筛选条件变化时回到第一页，但排序保持不变。 */
        state.offset = 0;
        loadRows().catch(function (error) { toast('搜索失败：' + error.message, 'error'); });
      }, 300);
    });

    refs.rowTable.addEventListener('click', function (event) {
      var sortButton = event.target.closest('[data-sort-field]');
      if (sortButton) {
        var fieldId = sortButton.getAttribute('data-sort-field');
        if (state.sort === fieldId) {
          state.order = state.order === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = fieldId;
          state.order = 'asc';
        }
        state.offset = 0;
        loadRows().catch(function (error) { toast('排序失败：' + error.message, 'error'); });
        return;
      }
      var edit = event.target.closest('[data-edit-row]');
      var remove = event.target.closest('[data-delete-row]');
      if (edit) {
        var rowId = edit.getAttribute('data-edit-row');
        var row = state.rows.filter(function (item) { return item.id === rowId; })[0];
        if (row) openRowForm(row);
      }
      if (remove) deleteRow(remove.getAttribute('data-delete-row'));
    });

    if (refs.rowPager) {
      refs.rowPager.addEventListener('click', function (event) {
        if (event.target.closest('[data-page-prev]') && state.offset > 0) {
          state.offset = Math.max(0, state.offset - state.limit);
          loadRows().catch(function (error) { toast('翻页失败：' + error.message, 'error'); });
        }
        if (event.target.closest('[data-page-next]') && state.offset + state.limit < state.rowTotal) {
          state.offset += state.limit;
          loadRows().catch(function (error) { toast('翻页失败：' + error.message, 'error'); });
        }
      });
      refs.rowPager.addEventListener('change', function (event) {
        if (!event.target.matches('[data-page-size]')) return;
        state.limit = Math.max(1, Math.min(500, Number(event.target.value) || 100));
        state.offset = 0;
        loadRows().catch(function (error) { toast('切换每页条数失败：' + error.message, 'error'); });
      });
    }

    refs.rowForm.addEventListener('click', function (event) {
      if (event.target.closest('[data-row-cancel]')) closeRowForm();
      if (event.target.closest('[data-row-save]')) saveRow();
    });
  }

  bind();
  loadSites().catch(function (error) {
    toast('加载失败：' + error.message, 'error');
    setStatus('加载失败：' + error.message, 'error');
  });
}());
