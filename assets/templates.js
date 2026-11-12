/**
 * 模板库管理页。
 *
 * 模板保存在站点 templates/ 目录；页面模板带走单页内容，站点模板带走全部页面与内容层配置。
 * 删除进回收站；覆盖现有页面必须二次确认，服务端会先备份。
 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var TOKEN = tokenMeta ? tokenMeta.getAttribute('content') : '';

  var refs = {
    siteSelect: document.querySelector('[data-site-select]'),
    backBuilder: document.querySelector('[data-back-builder]'),
    search: document.querySelector('[data-search]'),
    kindFilter: document.querySelector('[data-kind-filter]'),
    categoryFilter: document.querySelector('[data-category-filter]'),
    tagFilter: document.querySelector('[data-tag-filter]'),
    templateCount: document.querySelector('[data-template-count]'),
    templateList: document.querySelector('[data-template-list]'),
    starterList: document.querySelector('[data-starter-list]'),
    starterResult: document.querySelector('[data-starter-result]'),
    trashCount: document.querySelector('[data-trash-count]'),
    trashList: document.querySelector('[data-trash-list]'),
    limitName: document.querySelector('[data-limit-name]'),
    limitTags: document.querySelector('[data-limit-tags]'),
    createPage: document.querySelector('[data-create-page]'),
    createSite: document.querySelector('[data-create-site]'),
    importOpen: document.querySelector('[data-import-open]'),
    importFile: document.querySelector('[data-import-file]'),
    editorTitle: document.querySelector('[data-editor-title]'),
    editorMeta: document.querySelector('[data-editor-meta]'),
    editorState: document.querySelector('[data-editor-state]'),
    export: document.querySelector('[data-export-template]'),
    remove: document.querySelector('[data-delete-template]'),
    saveMeta: document.querySelector('[data-save-meta]'),
    empty: document.querySelector('[data-empty]'),
    editor: document.querySelector('[data-editor]'),
    createPanel: document.querySelector('[data-create-panel]'),
    createTitle: document.querySelector('[data-create-title]'),
    createNote: document.querySelector('[data-create-note]'),
    createKindBadge: document.querySelector('[data-create-kind-badge]'),
    createPageRow: document.querySelector('[data-create-page-row]'),
    createPageSelect: document.querySelector('[data-create-source]'),
    createName: document.querySelector('[data-create-name]'),
    createCategory: document.querySelector('[data-create-category]'),
    createTags: document.querySelector('[data-create-tags]'),
    createDescription: document.querySelector('[data-create-description]'),
    createSubmit: document.querySelector('[data-create-submit]'),
    createCancel: document.querySelector('[data-create-cancel]'),
    kindBadge: document.querySelector('[data-kind-badge]'),
    metaName: document.querySelector('[data-meta-name]'),
    metaId: document.querySelector('[data-meta-id]'),
    metaCategory: document.querySelector('[data-meta-category]'),
    metaTags: document.querySelector('[data-meta-tags]'),
    metaDescription: document.querySelector('[data-meta-description]'),
    sourceInfo: document.querySelector('[data-source-info]'),
    structure: document.querySelector('[data-structure]'),
    dangerPanel: document.querySelector('[data-danger-panel]'),
    dangerText: document.querySelector('[data-danger-text]'),
    confirmDelete: document.querySelector('[data-confirm-delete]'),
    confirmCancel: document.querySelector('[data-confirm-cancel]'),
    applyModes: Array.prototype.slice.call(document.querySelectorAll('[data-apply-mode]')),
    applyNew: document.querySelector('[data-apply-new]'),
    applyOverwrite: document.querySelector('[data-apply-overwrite]'),
    applyTitle: document.querySelector('[data-apply-title]'),
    applySlug: document.querySelector('[data-apply-slug]'),
    applyPath: document.querySelector('[data-apply-path]'),
    applyPage: document.querySelector('[data-apply-page]'),
    applyConfigRow: document.querySelector('[data-apply-config-row]'),
    applyConfig: document.querySelector('[data-apply-config]'),
    applySubmit: document.querySelector('[data-apply-submit]'),
    overwriteConfirm: document.querySelector('[data-overwrite-confirm]'),
    overwriteMessage: document.querySelector('[data-overwrite-message]'),
    applyConfirm: document.querySelector('[data-apply-confirm]'),
    applyResult: document.querySelector('[data-apply-result]')
  };

  var state = {
    sites: [],
    siteId: '',
    items: [],
    tags: [],
    starters: [],
    tree: { pages: [], templates: [] },
    meta: null,
    trash: [],
    template: null,
    info: null,
    view: 'browse',
    createKind: 'page',
    applyMode: 'new',
    dirty: false,
    busy: false,
    pendingOverwrite: null,
    deleteTarget: null
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

  function categoryLabel(value) {
    var cats = (state.meta && state.meta.categories) || [];
    var found = cats.find(function (item) { return item.value === value; });
    return found ? found.label : (value || '其他');
  }

  function kindLabel(value) {
    return value === 'site' ? '站点模板' : '页面模板';
  }

  function formatTime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0') + ' ' +
      String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function setBadge(text, kind) {
    if (!refs.editorState) return;
    refs.editorState.hidden = !text;
    refs.editorState.textContent = text || '';
    refs.editorState.className = 'lc-badge ' + (kind === 'error' ? 'lc-badge-danger' : kind === 'ok' ? 'lc-badge-success' : 'lc-badge-accent');
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    if (state.view !== 'browse' || !state.template) return;
    setBadge(state.dirty ? '未保存' : '已保存', state.dirty ? 'accent' : 'ok');
  }

  function resetToolbar() {
    [refs.export, refs.remove, refs.saveMeta].forEach(function (button) {
      if (button) button.disabled = true;
    });
    setBadge('');
  }

  function hideDanger() {
    state.deleteTarget = null;
    refs.dangerPanel.hidden = true;
  }

  function hideOverwriteConfirm() {
    state.pendingOverwrite = null;
    refs.overwriteConfirm.hidden = true;
  }

  function hideApplyResult() {
    refs.applyResult.hidden = true;
    refs.applyResult.innerHTML = '';
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

  /* 未明确项目时不落到第一个站点：模板新建/导入禁用，并提示先选项目。 */
  function showProjectGate() {
    state.siteId = '';
    state.items = [];
    state.template = null;
    renderSiteSelect();
    if (refs.backBuilder) refs.backBuilder.href = 'builder.html';
    syncSiteLinks('');
    refs.templateList.innerHTML = '<div class="lc-comp-section-note">还没有选择项目。从工作台的项目卡片进入，或在右上角「站点」里选一个项目后再编辑。</div>';
    refs.templateCount.textContent = '0 个模板';
    if (refs.starterList) refs.starterList.innerHTML = '<div class="lc-comp-section-note">选择项目后可以套用起始模板。</div>';
    [refs.createPage, refs.createSite, refs.importOpen].forEach(function (control) {
      if (control) control.disabled = true;
    });
    if (refs.empty) refs.empty.hidden = true;
    if (refs.editor) refs.editor.hidden = true;
  }

  function loadSites() {
    return api('/api/sites').then(function (sites) {
      state.sites = Array.isArray(sites) ? sites : [];
      if (!state.sites.length) {
        refs.templateList.innerHTML = '<div class="lc-comp-section-note">还没有站点，先到 Builder 创建站点。</div>';
        refs.templateCount.textContent = '0 个模板';
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

  /* 顶栏里的跨功能出口统一带当前站点，避免跳到组件库/数据源/导出时丢失项目上下文。 */
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
    [refs.createPage, refs.createSite, refs.importOpen].forEach(function (control) {
      if (control) control.disabled = false;
    });
    state.template = null;
    state.info = null;
    state.items = [];
    state.trash = [];
    state.starters = [];
    state.tree = { pages: [], templates: [] };
    state.view = 'browse';
    hideDanger();
    hideOverwriteConfirm();
    hideApplyResult();
    refs.editor.hidden = true;
    refs.createPanel.hidden = true;
    refs.empty.hidden = false;
    refs.editorTitle.textContent = '读取中…';
    refs.editorMeta.textContent = '';
    resetToolbar();
    renderSiteSelect();
    return Promise.all([
      api(siteBase() + '/templates/meta'),
      api(siteBase() + '/templates'),
      api(siteBase() + '/templates/trash'),
      api(siteBase() + '/builder/site'),
      api(siteBase() + '/templates/starters')
    ]).then(function (results) {
      state.meta = results[0];
      state.items = (results[1] && results[1].items) || [];
      state.tags = (results[1] && results[1].tags) || [];
      state.trash = (results[2] && results[2].items) || [];
      state.starters = (results[4] && results[4].items) || [];
      renderStarters();
      state.tree = {
        pages: (results[3] && results[3].pages) || [],
        templates: (results[3] && results[3].templates) || []
      };
      applyMeta();
      renderFilters();
      renderList();
      renderTrash();
      refs.editorTitle.textContent = '选择一个模板';
      refs.editorMeta.textContent = state.items.length ? state.items.length + ' 个模板可选' : '还没有模板';
      if (state.items.length) return selectTemplate(state.items[0].id);
    }).catch(function (error) {
      toast(error.message, 'error');
      refs.templateList.innerHTML = '<div class="lc-comp-section-note">读取失败：' + esc(error.message) + '</div>';
    });
  }

  function applyMeta() {
    if (!state.meta) return;
    refs.limitName.textContent = String(state.meta.limits.nameLength);
    refs.limitTags.textContent = String(state.meta.limits.tagsMax);

    var options = (state.meta.categories || []).map(function (item) {
      return '<option value="' + attr(item.value) + '">' + esc(item.label) + '</option>';
    }).join('');
    refs.categoryFilter.innerHTML = '<option value="">全部分类</option>' + options;
    refs.metaCategory.innerHTML = options;
    refs.createCategory.innerHTML = options;
  }

  function renderFilters() {
    var category = refs.categoryFilter.value;
    var tag = refs.tagFilter.value;
    var cats = (state.meta && state.meta.categories) || [];
    refs.categoryFilter.innerHTML = '<option value="">全部分类</option>' + cats.map(function (item) {
      return '<option value="' + attr(item.value) + '"' + (item.value === category ? ' selected' : '') + '>' + esc(item.label) + '</option>';
    }).join('');
    refs.tagFilter.innerHTML = '<option value="">全部标签</option>' + state.tags.map(function (item) {
      return '<option value="' + attr(item) + '"' + (item === tag ? ' selected' : '') + '>' + esc(item) + '</option>';
    }).join('');
  }

  function matches(item) {
    var query = refs.search.value.trim().toLowerCase();
    var kind = refs.kindFilter.value;
    var category = refs.categoryFilter.value;
    var tag = refs.tagFilter.value;
    if (kind && item.kind !== kind) return false;
    if (category && item.category !== category) return false;
    if (tag && item.tags.indexOf(tag) === -1) return false;
    if (!query) return true;
    var haystack = [item.name, item.id, item.description, item.tags.join(' '), item.pageTitles.join(' ')].join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function renderList() {
    var items = state.items.filter(matches);
    refs.templateCount.textContent = items.length + ' / ' + state.items.length + ' 个模板';
    if (!items.length) {
      refs.templateList.innerHTML = '<div class="lc-comp-section-note">' +
        (state.items.length ? '没有符合筛选条件的模板。' : '还没有模板，先点上方按钮创建。') + '</div>';
      return;
    }
    refs.templateList.innerHTML = items.map(function (item) {
      var tags = item.tags.map(function (tag) {
        return '<span class="lc-tpl-chip">' + esc(tag) + '</span>';
      }).join('');
      return '<button class="lc-comp-item' + (state.template && state.template.id === item.id ? ' is-active' : '') + '" type="button" data-template-id="' + attr(item.id) + '">' +
        '<span class="lc-comp-icon" aria-hidden="true">' + (item.kind === 'site' ? '站' : '页') + '</span>' +
        '<span class="lc-comp-item-body">' +
        '<span class="lc-comp-item-name">' + esc(item.name) + '</span>' +
        '<span class="lc-comp-item-meta">' + esc(categoryLabel(item.category)) + ' · ' + item.pageCount + ' 页 · ' + item.blockCount + ' 区块</span>' +
        (tags ? '<span class="lc-tpl-item-badges">' + tags + '</span>' : '') +
        '</span>' +
        '<span class="lc-comp-item-use">' + esc(formatTime(item.updatedAt)) + '</span>' +
        '</button>';
    }).join('');
  }

  function renderStarters() {
    if (!refs.starterList) return;
    if (!state.starters.length) {
      refs.starterList.innerHTML = '<p class="lc-comp-section-note">没有可用的起步模板。</p>';
      return;
    }
    refs.starterList.innerHTML = state.starters.map(function (item) {
      var tags = (item.tags || []).map(function (tag) {
        return '<span class="lc-tpl-chip">' + esc(tag) + '</span>';
      }).join('');
      return '<article class="lc-tpl-starter-card">' +
        '<h4>' + esc(item.name) + '</h4>' +
        '<p>' + esc(item.description) + '</p>' +
        '<div class="lc-tpl-starter-tags">' + tags + '</div>' +
        '<div class="lc-tpl-starter-foot">' +
        '<span class="lc-comp-count">' + esc(String(item.pageCount)) + ' 个页面</span>' +
        '<button class="lc-btn lc-btn-sm lc-btn-primary" type="button" data-apply-starter="' + attr(item.id) + '">套用</button>' +
        '</div>' +
        '</article>';
    }).join('');
  }

  function applyStarter(id) {
    if (state.busy) return;
    var starter = state.starters.find(function (item) { return item.id === id; });
    if (!starter) return;
    if (!window.confirm('套用「' + starter.name + '」会新建 ' + starter.pageCount + ' 个页面，并替换当前站点的导航、页脚与侧栏。继续？')) return;
    state.busy = true;
    api(siteBase() + '/templates/starters/' + encodeURIComponent(id) + '/apply', { method: 'POST' })
      .then(function (data) {
        var pages = (data.pages || []).map(function (page) { return page.title + '（' + page.path + '）'; });
        refs.starterResult.hidden = false;
        refs.starterResult.innerHTML = '已套用「' + esc(starter.name) + '」，新建 ' + pages.length +
          ' 个页面：' + esc(pages.join('、')) + '。 <a href="builder.html?site=' + encodeURIComponent(state.siteId) + '">打开建站编辑器</a>';
        toast('起步模板已套用：' + starter.name, 'ok');
        return loadSite(state.siteId);
      })
      .catch(function (error) {
        toast(error.message, 'error');
      })
      .then(function () {
        state.busy = false;
      });
  }

  function renderTrash() {
    refs.trashCount.textContent = state.trash.length + ' 个';
    if (!state.trash.length) {
      refs.trashList.innerHTML = '<div class="lc-comp-section-note">回收站是空的。</div>';
      return;
    }
    refs.trashList.innerHTML = state.trash.map(function (entry) {
      return '<div class="lc-comp-trash-row">' +
        '<div><strong>' + esc(entry.template.name || entry.originalId) + '</strong>' +
        '<p>' + esc(kindLabel(entry.template.kind)) + ' · 删除于 ' + esc(formatTime(entry.deletedAt)) + '</p></div>' +
        '<button class="lc-comp-item-restore" type="button" data-restore-trash="' + attr(entry.trashId) + '">恢复</button>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 详情与编辑 ---------------- */

  function selectTemplate(id) {
    if (state.dirty && state.template && state.template.id !== id) {
      setDirty(false);
    }
    return api(siteBase() + '/templates/' + encodeURIComponent(id)).then(function (data) {
      state.template = data.template;
      state.info = data.info;
      state.view = 'browse';
      state.applyMode = data.template.kind === 'site' ? 'new' : 'new';
      refs.createPanel.hidden = true;
      refs.empty.hidden = true;
      refs.editor.hidden = false;
      hideDanger();
      hideOverwriteConfirm();
      hideApplyResult();
      renderEditor();
      renderList();
    }).catch(function (error) {
      toast(error.message, 'error');
    });
  }

  function renderEditor() {
    var template = state.template;
    var info = state.info;
    if (!template) return;
    refs.editorTitle.textContent = template.name;
    refs.editorMeta.textContent = kindLabel(template.kind) + ' · ' + info.pageCount + ' 页 · ' + info.blockCount + ' 区块';
    refs.kindBadge.textContent = kindLabel(template.kind);
    refs.metaName.value = template.name;
    refs.metaId.value = template.id;
    refs.metaCategory.value = template.category || 'other';
    refs.metaTags.value = (template.tags || []).join(', ');
    refs.metaDescription.value = template.description || '';
    var source = template.source || {};
    var pieces = [];
    if (source.siteName) pieces.push('来源站点：' + source.siteName);
    if (source.pageTitle) pieces.push('来源页面：' + source.pageTitle);
    if (source.savedAt) pieces.push('保存于 ' + formatTime(source.savedAt));
    if (source.importedAt) pieces.push('导入于 ' + formatTime(source.importedAt));
    refs.sourceInfo.textContent = pieces.join(' · ') || '本机创建的模板';
    renderStructure();
    renderApplyPanel();
    resetToolbar();
    [refs.export, refs.remove, refs.saveMeta].forEach(function (button) {
      button.disabled = false;
    });
    setDirty(false);
    refs.export.disabled = false;
  }

  function renderStructure() {
    var info = state.info;
    if (!info) return;
    var groups = [];
    if (info.kind === 'site') {
      groups.push('<div class="lc-tpl-structure-group"><h4>页面（' + info.pageCount + '）</h4>' +
        info.pageTitles.map(function (title, index) {
          return '<div class="lc-tpl-page-row"><strong>' + esc(title) + '</strong><span>#' + (index + 1) + '</span></div>';
        }).join('') + '</div>');
    } else {
      groups.push('<div class="lc-tpl-structure-group"><h4>页面</h4>' +
        info.pageTitles.map(function (title) {
          return '<div class="lc-tpl-page-row"><strong>' + esc(title) + '</strong><span>单页模板</span></div>';
        }).join('') + '</div>');
    }
    if (info.componentNames.length) {
      groups.push('<div class="lc-tpl-structure-group"><h4>包含组件（' + info.componentCount + '）</h4>' +
        '<div class="lc-tpl-chips">' + info.componentNames.map(function (name) {
          return '<span class="lc-tpl-chip">' + esc(name) + '</span>';
        }).join('') + '</div></div>');
    } else {
      groups.push('<div class="lc-tpl-structure-group"><h4>包含组件</h4><p class="lc-tpl-empty-line">没有引用自定义组件。</p></div>');
    }
    groups.push('<div class="lc-tpl-structure-group"><h4>内容规模</h4><p class="lc-tpl-empty-line">' +
      esc(String(info.blockCount)) + ' 个区块，' + esc(String(info.pageCount)) + ' 个页面。</p></div>');
    refs.structure.innerHTML = groups.join('');
  }

  function renderApplyPanel() {
    var template = state.template;
    if (!template) return;

    /* 站点模板只能新建页面。 */
    refs.applyModes.forEach(function (button) {
      var mode = button.getAttribute('data-apply-mode');
      button.disabled = template.kind === 'site' && mode === 'overwrite';
      button.classList.toggle('is-active', mode === state.applyMode);
      button.setAttribute('aria-pressed', mode === state.applyMode ? 'true' : 'false');
    });
    var isOverwrite = state.applyMode === 'overwrite' && template.kind !== 'site';
    refs.applyNew.hidden = isOverwrite;
    refs.applyOverwrite.hidden = !isOverwrite;
    refs.applyConfigRow.hidden = template.kind !== 'site';

    var def = template.kind === 'site' ? null : template.page;
    refs.applyTitle.value = (def && def.title) || '';
    refs.applySlug.value = (def && (def.slug || def.id)) || '';
    refs.applyPath.value = (def && def.path) || '';

    var pages = state.tree.pages || [];
    refs.applyPage.innerHTML = pages.map(function (page) {
      return '<option value="' + attr(page.id) + '">' + esc((page.title || page.id) + ' · ' + (page.path || page.id + '.html')) + '</option>';
    }).join('');
    if (!pages.length) {
      refs.applyPage.innerHTML = '<option value="">当前站点还没有页面</option>';
    }
  }

  function openCreate(kind) {
    state.createKind = kind === 'site' ? 'site' : 'page';
    state.view = 'create';
    state.template = null;
    state.info = null;
    refs.editor.hidden = true;
    refs.empty.hidden = true;
    refs.createPanel.hidden = false;
    hideDanger();
    hideApplyResult();
    hideOverwriteConfirm();
    refs.editorTitle.textContent = state.createKind === 'site' ? '整站存为模板' : '页面存为模板';
    refs.editorMeta.textContent = state.siteId;
    resetToolbar();
    refs.createTitle.textContent = state.createKind === 'site' ? '把整个站点存为模板' : '把页面存为模板';
    refs.createNote.textContent = state.createKind === 'site'
      ? '会带走全部页面、组件、主题、导航与页脚；数据源与密钥不会进模板。'
      : '只保存这个页面的内容、布局与引用到的自定义组件。';
    refs.createKindBadge.textContent = kindLabel(state.createKind);
    refs.createPageRow.hidden = state.createKind === 'site';
    var pages = state.tree.pages || [];
    refs.createPageSelect.innerHTML = pages.map(function (page) {
      return '<option value="' + attr(page.id) + '">' + esc((page.title || page.id) + ' · ' + (page.path || page.id + '.html')) + '</option>';
    }).join('');
    if (!pages.length) refs.createPageSelect.innerHTML = '<option value="">当前站点还没有页面</option>';
    var first = pages[0];
    refs.createName.value = state.createKind === 'site'
      ? (state.sites.find(function (site) { return site.siteId === state.siteId; }) || {}).name || state.siteId
      : (first ? first.title : '');
    refs.createCategory.value = state.createKind === 'site' ? 'content' : 'landing';
    refs.createTags.value = '';
    refs.createDescription.value = '';
    refs.createName.focus();
  }

  function createTemplate() {
    if (state.busy) return;
    var body = {
      kind: state.createKind,
      name: refs.createName.value.trim(),
      category: refs.createCategory.value,
      tags: refs.createTags.value,
      description: refs.createDescription.value.trim()
    };
    if (!body.name) {
      toast('请填写模板名称', 'warn');
      refs.createName.focus();
      return;
    }
    if (state.createKind === 'page') {
      body.pageId = refs.createPageSelect.value;
      if (!body.pageId) {
        toast('当前站点还没有页面可以存成模板', 'warn');
        return;
      }
    }
    state.busy = true;
    refs.createSubmit.disabled = true;
    api(siteBase() + '/templates', { method: 'POST', body: body }).then(function (data) {
      toast('模板已创建：' + data.template.name, 'ok');
      refs.createPanel.hidden = true;
      return loadSite(state.siteId).then(function () {
        var target = data.template.id;
        if (state.items.some(function (item) { return item.id === target; })) return selectTemplate(target);
        return undefined;
      });
    }).catch(function (error) {
      toast(error.message, 'error');
    }).then(function () {
      state.busy = false;
      refs.createSubmit.disabled = false;
    });
  }

  function saveMeta() {
    if (state.busy || !state.template) return;
    state.busy = true;
    refs.saveMeta.disabled = true;
    api(siteBase() + '/templates/' + encodeURIComponent(state.template.id), {
      method: 'PUT',
      body: {
        name: refs.metaName.value.trim(),
        category: refs.metaCategory.value,
        tags: refs.metaTags.value,
        description: refs.metaDescription.value.trim()
      }
    }).then(function (data) {
      state.template = data.template;
      state.info = data.info;
      setDirty(false);
      refs.editorTitle.textContent = data.template.name;
      toast('模板信息已保存', 'ok');
      return loadSite(state.siteId).then(function () { return selectTemplate(data.template.id); });
    }).catch(function (error) {
      toast(error.message, 'error');
    }).then(function () {
      state.busy = false;
      refs.saveMeta.disabled = false;
    });
  }

  function deleteTemplate() {
    if (!state.template) return;
    state.deleteTarget = state.template;
    refs.dangerText.textContent = '「' + state.template.name + '」会移入回收站，页面内容不受影响；需要时可以恢复。';
    refs.dangerPanel.hidden = false;
    refs.confirmDelete.focus();
  }

  function confirmDelete() {
    if (!state.deleteTarget || state.busy) return;
    var target = state.deleteTarget;
    state.busy = true;
    api(siteBase() + '/templates/' + encodeURIComponent(target.id), { method: 'DELETE' }).then(function () {
      toast('已移入回收站：' + target.name, 'ok');
      state.template = null;
      state.info = null;
      hideDanger();
      refs.editor.hidden = true;
      refs.empty.hidden = false;
      resetToolbar();
      refs.editorTitle.textContent = '选择一个模板';
      refs.editorMeta.textContent = '';
      return loadSite(state.siteId);
    }).catch(function (error) {
      toast(error.message, 'error');
    }).then(function () {
      state.busy = false;
    });
  }

  function restoreTrash(trashId) {
    if (state.busy) return;
    state.busy = true;
    api(siteBase() + '/templates/trash/' + encodeURIComponent(trashId) + '/restore', { method: 'POST' }).then(function (data) {
      var notices = data.notices || [];
      toast('已恢复模板：' + data.template.name + (notices.length ? '（' + notices.join('；') + '）' : ''), 'ok');
      return loadSite(state.siteId).then(function () { return selectTemplate(data.template.id); });
    }).catch(function (error) {
      toast(error.message, 'error');
    }).then(function () {
      state.busy = false;
    });
  }

  function exportTemplate() {
    if (!state.template) return;
    var id = state.template.id;
    fetch(siteBase() + '/templates/' + encodeURIComponent(id) + '/export', { headers: { 'x-lc-token': TOKEN }, cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('导出失败（' + response.status + '）');
        return response.json();
      })
      .then(function (payload) {
        var text = JSON.stringify(payload, null, 2);
        var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = id + '.template.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast('已导出模板 JSON', 'ok');
      })
      .catch(function (error) {
        toast(error.message, 'error');
      });
  }

  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var content = String(reader.result || '');
      state.busy = true;
      api(siteBase() + '/templates/import', { method: 'POST', body: { filename: file.name, content: content } })
        .then(function (data) {
          var notices = data.notices || [];
          toast('已导入模板：' + data.template.name + (notices.length ? '（' + notices.join('；') + '）' : ''), notices.length ? 'warn' : 'ok');
          return loadSite(state.siteId).then(function () { return selectTemplate(data.template.id); });
        })
        .catch(function (error) {
          toast(error.message, 'error');
        })
        .then(function () {
          state.busy = false;
          refs.importFile.value = '';
        });
    };
    reader.readAsText(file, 'utf-8');
  }

  function setApplyMode(mode) {
    state.applyMode = mode;
    hideOverwriteConfirm();
    hideApplyResult();
    renderApplyPanel();
  }

  function applyTemplate(confirmOverwrite) {
    if (!state.template || state.busy) return;
    var template = state.template;
    var body = { mode: state.applyMode };
    if (state.applyMode === 'overwrite') {
      body.pageId = refs.applyPage.value;
      if (confirmOverwrite) body.confirm = true;
      if (!body.pageId) {
        toast('请选择要覆盖的页面', 'warn');
        return;
      }
    } else if (template.kind === 'site') {
      body.applyConfig = Boolean(refs.applyConfig.checked);
    } else {
      body.title = refs.applyTitle.value.trim();
      body.slug = refs.applySlug.value.trim();
      body.path = refs.applyPath.value.trim();
    }
    state.busy = true;
    refs.applySubmit.disabled = true;
    api(siteBase() + '/templates/' + encodeURIComponent(template.id) + '/apply', { method: 'POST', body: body })
      .then(function (data) {
        hideOverwriteConfirm();
        showApplyResult(data);
        toast(data.mode === 'overwrite' ? '页面已覆盖，原内容已备份' : '模板已套用', 'ok');
        return loadSite(state.siteId).then(function () { return selectTemplate(template.id); }).then(function () {
          showApplyResult(data);
        });
      })
      .catch(function (error) {
        if (error.code === 'LC_E_TEMPLATE_OVERWRITE') {
          var detail = error.detail || {};
          var page = detail.page || {};
          state.pendingOverwrite = { pageId: page.id, templateId: template.id };
          refs.overwriteMessage.textContent = '将覆盖页面「' + (page.title || page.id) + '」。' + (detail.message || '');
          refs.overwriteConfirm.hidden = false;
          refs.applyConfirm.focus();
          return;
        }
        toast(error.message, 'error');
      })
      .then(function () {
        state.busy = false;
        refs.applySubmit.disabled = false;
      });
  }

  function showApplyResult(data) {
    var lines = [];
    if (data.mode === 'overwrite') {
      lines.push('已覆盖页面「' + ((data.overwritten && data.overwritten.title) || '') + '」，原内容已备份。');
    } else if (data.pages) {
      lines.push('新建 ' + data.pages.length + ' 个页面：' + data.pages.map(function (page) {
        return page.title + '（' + page.path + '）';
      }).join('、'));
    }
    if (data.configApplied) lines.push('导航与页脚已套用。');
    if (data.installedComponents && data.installedComponents.length) {
      lines.push('补齐组件：' + data.installedComponents.join('、'));
    }
    if (data.skippedComponents && data.skippedComponents.length) {
      lines.push('跳过已存在组件：' + data.skippedComponents.join('、'));
    }
    (data.notices || []).forEach(function (notice) { lines.push(notice); });
    refs.applyResult.hidden = false;
    refs.applyResult.innerHTML = '<strong>套用结果</strong><ul>' + lines.map(function (line) {
      return '<li>' + esc(line) + '</li>';
    }).join('') + '</ul>';
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    refs.siteSelect.addEventListener('change', function () {
      if (!refs.siteSelect.value) { showProjectGate(); return; }
      loadSite(refs.siteSelect.value);
    });
    refs.search.addEventListener('input', renderList);
    refs.kindFilter.addEventListener('change', renderList);
    refs.categoryFilter.addEventListener('change', renderList);
    refs.tagFilter.addEventListener('change', renderList);

    refs.templateList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-template-id]');
      if (!button) return;
      selectTemplate(button.getAttribute('data-template-id'));
    });
    if (refs.starterList) {
      refs.starterList.addEventListener('click', function (event) {
        var button = event.target.closest('[data-apply-starter]');
        if (!button) return;
        applyStarter(button.getAttribute('data-apply-starter'));
      });
    }
    refs.trashList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-restore-trash]');
      if (!button) return;
      restoreTrash(button.getAttribute('data-restore-trash'));
    });

    refs.createPage.addEventListener('click', function () { openCreate('page'); });
    refs.createSite.addEventListener('click', function () { openCreate('site'); });
    refs.createCancel.addEventListener('click', function () {
      refs.createPanel.hidden = true;
      if (state.items.length) selectTemplate(state.items[0].id);
      else {
        refs.empty.hidden = false;
        refs.editorTitle.textContent = '选择一个模板';
      }
    });
    refs.createSubmit.addEventListener('click', createTemplate);

    [refs.metaName, refs.metaTags, refs.metaDescription].forEach(function (input) {
      input.addEventListener('input', function () { setDirty(true); });
    });
    refs.metaCategory.addEventListener('change', function () { setDirty(true); });

    refs.saveMeta.addEventListener('click', saveMeta);
    refs.remove.addEventListener('click', deleteTemplate);
    refs.confirmCancel.addEventListener('click', function () { hideDanger(); });
    refs.confirmDelete.addEventListener('click', confirmDelete);
    refs.export.addEventListener('click', exportTemplate);

    refs.importOpen.addEventListener('click', function () { refs.importFile.click(); });
    refs.importFile.addEventListener('change', function () {
      importFile(refs.importFile.files && refs.importFile.files[0]);
    });

    refs.applyModes.forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.disabled) return;
        setApplyMode(button.getAttribute('data-apply-mode'));
      });
    });
    refs.applySubmit.addEventListener('click', function () { applyTemplate(false); });
    refs.applyConfirm.addEventListener('click', function () { applyTemplate(true); });
    var overwriteCancel = document.querySelector('[data-overwrite-cancel]');
    if (overwriteCancel) overwriteCancel.addEventListener('click', hideOverwriteConfirm);
  }

  function init() {
    bindEvents();
    loadSites().catch(function (error) { toast(error.message, 'error'); });
  }

  init();
})();
