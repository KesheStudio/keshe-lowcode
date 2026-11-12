/* Builder · 画布与属性面板
 *
 * 数据流：页面 JSON 是唯一真相 → 渲染引擎（服务端 /api/.../builder/render）产出画布文档
 *        → iframe 加载同源预览地址 → 点选回写选中路径 → 属性面板按 schema 改页面 JSON
 *        → 自动保存（PUT + expectedRev）→ localStorage 草稿兜底。
 *
 * 不复制渲染逻辑：画布 HTML/CSS 全部来自渲染引擎，客户端只负责选中态和编辑交互。 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var TOKEN = tokenMeta ? tokenMeta.getAttribute('content') : '';
  var SAVE_DELAY = 1200;
  var RENDER_DELAY = 220;

  var refs = {
    siteSelect: document.querySelector('[data-site-select]'),
    saveState: document.querySelector('[data-save-state]'),
    undo: document.querySelector('[data-undo]'),
    redo: document.querySelector('[data-redo]'),
    save: document.querySelector('[data-save]'),
    pageList: document.querySelector('[data-page-list]'),
    pageCount: document.querySelector('[data-page-count]'),
    newPage: document.querySelector('[data-new-page]'),
    layerTree: document.querySelector('[data-layer-tree]'),
    layerCount: document.querySelector('[data-layer-count]'),
    pageFile: document.querySelector('[data-page-file]'),
    sidebarState: document.querySelector('[data-sidebar-state]'),
    banner: document.querySelector('[data-banner]'),
    bannerTitle: document.querySelector('[data-banner-title]'),
    bannerText: document.querySelector('[data-banner-text]'),
    bannerPrimary: document.querySelector('[data-banner-primary]'),
    bannerSecondary: document.querySelector('[data-banner-secondary]'),
    bannerClose: document.querySelector('[data-banner-close]'),
    exportEntry: document.querySelector('[data-export-entry]'),
    dataEntry: document.querySelector('[data-data-entry]'),
    componentsEntry: document.querySelector('[data-components-entry]'),
    templatesEntry: document.querySelector('[data-templates-entry]'),
    pageImportEntry: document.querySelector('[data-page-import-entry]'),
    middlewareEntry: document.querySelector('[data-middleware-entry]'),
    configEntry: document.querySelector('[data-config-entry]'),
    moreToggle: document.querySelector('[data-more-toggle]'),
    moreMenu: document.querySelector('[data-more-menu]'),
    pageTitle: document.querySelector('[data-page-title]'),
    pagePath: document.querySelector('[data-page-path]'),
    blockCount: document.querySelector('[data-block-count]'),
    reloadPage: document.querySelector('[data-reload-page]'),
    canvasWrap: document.querySelector('[data-canvas-wrap]'),
    stage: document.querySelector('[data-canvas-stage]'),
    frame: document.querySelector('[data-canvas]'),
    placeholder: document.querySelector('[data-canvas-placeholder]'),
    inspectorTitle: document.querySelector('[data-inspector-title]'),
    inspectorSub: document.querySelector('[data-inspector-sub]'),
    inspector: document.querySelector('[data-inspector]'),
    statusText: document.querySelector('[data-status-text]'),
    statusRev: document.querySelector('[data-status-rev]'),
    statusRight: document.querySelector('[data-status-right]'),
    panelTabs: Array.prototype.slice.call(document.querySelectorAll('[data-panel-tab]')),
    panelBodies: Array.prototype.slice.call(document.querySelectorAll('[data-panel]')),
    panelHint: document.querySelector('[data-panel-hint]'),
    componentList: document.querySelector('[data-component-list]'),
    builtinList: document.querySelector('[data-builtin-list]'),
    builtinCount: document.querySelector('[data-builtin-count]'),
    templateList: document.querySelector('[data-template-list]'),
    componentCount: document.querySelector('[data-component-count]'),
    templateCount: document.querySelector('[data-template-count]'),
    importZones: Array.prototype.slice.call(document.querySelectorAll('[data-drop-zone]')),
    importInputs: Array.prototype.slice.call(document.querySelectorAll('[data-file-input]')),
    codeEntry: document.querySelector('[data-code-entry]'),
    backendFlowEntry: document.querySelector('[data-backend-flow-entry]'),
    buildsEntry: document.querySelector('[data-builds-entry]'),
    projectPicker: document.querySelector('[data-project-picker]'),
    projectPickerList: document.querySelector('[data-project-picker-list]'),
    projectPickerReason: document.querySelector('[data-project-picker-reason]'),
    themeEntry: document.querySelector('[data-theme-entry]'),
    themeEditorEntry: document.querySelector('[data-theme-editor-entry]'),
    themeDialog: document.querySelector('[data-theme-dialog]'),
    themeClose: document.querySelector('[data-theme-close]'),
    themeCancel: document.querySelector('[data-theme-cancel]'),
    themeMode: document.querySelector('[data-theme-mode]'),
    themeOptions: document.querySelector('[data-theme-options]'),
    themeAllow: document.querySelector('[data-theme-allow]'),
    themeSave: document.querySelector('[data-theme-save]'),
    codeDialog: document.querySelector('[data-code-dialog]'),
    codeClose: document.querySelector('[data-code-close]'),
    backendLanguage: document.querySelector('[data-backend-language]'),
    backendFiles: document.querySelector('[data-backend-files]'),
    backendState: document.querySelector('[data-backend-state]'),
    backendPath: document.querySelector('[data-backend-path]'),
    backendEditor: document.querySelector('[data-backend-editor]'),
    backendResult: document.querySelector('[data-backend-result]'),
    backendCheck: document.querySelector('[data-backend-check]'),
    backendSave: document.querySelector('[data-backend-save]'),
    backendReset: document.querySelector('[data-backend-reset]'),
    backendNew: document.querySelector('[data-backend-new]'),
    backendImport: document.querySelector('[data-backend-import]'),
    backendFileInput: document.querySelector('[data-backend-file-input]'),
    backendRename: document.querySelector('[data-backend-rename]'),
    backendDelete: document.querySelector('[data-backend-delete]')
  };

  var state = {
    token: TOKEN,
    sites: [],
    siteId: '',
    info: null,
    pages: [],
    page: null,
    pagePath: '',
    rev: 0,
    baseline: '',
    dirty: false,
    saving: false,
    savePromise: null,
    saveError: '',
    baselineHash: '',
    retryAfterRev: false,
    /* 历史按编辑端分开：桌面端和移动端各自维护自己的撤销/重做栈，
       避免在移动端撤销时把另一端的改动一起退掉。 */
    history: { desktop: [], mobile: [] },
    historyIndex: { desktop: -1, mobile: -1 },
    selection: null,
    selectionId: '',
    selectionByEnd: { desktop: '', mobile: '' },
    blockIndex: {},
    schemaByType: {},
    componentSchemaById: {},
    themeId: '',
    mode: 'light',
    canvasScrollY: 0,
    canvasPageScrollY: 0,
    pendingScroll: 0,
    pendingPageScroll: 0,
    canvasDragging: false,
    /* 画布最近一次渲染完成时的文档溢出（拖拽回退的基线，由画布 ready 上报）。 */
    canvasOverflow: { x: false, y: false },
    /* 拖拽排序的回退点：拖拽开始记快照，落位重渲染后若出现新溢出就整段回退。 */
    dragRollback: null,
    viewport: 'desktop',
    uiEnd: 'desktop',
    lastMobileViewport: 'phone',
    renderTimer: 0,
    renderSeq: 0,
    renderInFlight: false,
    renderAgain: false,
    saveTimer: 0,
    retryTimer: 0,
    interacting: false,
    dragging: null,
    fieldSession: null,
    panels: 'pages',
    templates: [],
    importing: false,
    applyingTemplate: false,
    clipboard: null,
    collapsed: {},
    codeTab: 'html',
    pageCodeTab: 'html',
    apiActive: '',
    bindingDraft: { event: 'click', method: 'GET', handler: 'auto', route: '', target: '', script: '' },
    backendRoutes: [],
    editors: {},
    backend: { language: '', files: [], active: '', loaded: false, prefixes: [], extensions: [] },
    bannerActions: null,
    idSerial: 0,
    editing: false,
    siteReady: false
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

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
          error.status = response.status;
          error.code = payload.error && payload.error.code;
          throw error;
        }
        return payload.data;
      });
    });
  }

  function siteApi(path) {
    return '/api/sites/' + encodeURIComponent(state.siteId) + path;
  }

  function nowLabel() {
    var date = new Date();
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function setStatus(text, kind) {
    refs.statusText.textContent = text;
    if (kind === 'error') refs.statusText.style.color = 'var(--lc-color-danger)';
    else if (kind === 'ok') refs.statusText.style.color = 'var(--lc-color-success)';
    else refs.statusText.style.color = '';
  }

  function toast(text, kind) {
    var el = document.createElement('div');
    el.className = 'lc-toast' + (kind ? ' is-' + kind : '');
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  /* 自定义代码里的 id 被重映射后给一次显式提示，避免用户不知道代码已被改写。 */
  function notifyCodeRemap() {
    if (!state.codeIdRemapped) return;
    state.codeIdRemapped = false;
    toast('自定义 JS/CSS 里的区块 id 已随复制重映射，请检查代码引用是否符合预期。', 'warn');
  }

  /* ---------------- 代码编辑器 ---------------- */

  function destroyEditor(key) {
    var editor = state.editors[key];
    if (!editor) return;
    try { editor.destroy(); } catch (error) { /* 已卸载时忽略 */ }
    delete state.editors[key];
  }

  function destroyAllEditors() {
    Object.keys(state.editors).forEach(destroyEditor);
  }

  function mountEditor(key, host, options) {
    destroyEditor(key);
    if (!host || !window.LC || !window.LC.CodeEditor) return null;
    var editor = window.LC.CodeEditor.create(host, options);
    state.editors[key] = editor;
    return editor;
  }

  function codeLanguageFor(name) {
    if (name === 'html') return 'html';
    if (name === 'css') return 'css';
    if (name === 'markdown') return 'markdown';
    return 'javascript';
  }

  function showCheckResult(target, result) {
    if (!target) return;
    target.innerHTML = '';
    target.className = 'lc-code-result';
    if (!result) return;
    var ok = result.ok;
    target.className = 'lc-code-result ' + (ok ? 'is-ok' : 'is-fail');
    (result.checks || []).forEach(function (item) {
      var row = document.createElement('div');
      row.textContent = (item.status === 'pass' ? '✓ ' : item.status === 'skipped' ? '· ' : '✗ ') + item.message +
        (item.line ? '（第 ' + item.line + ' 行，第 ' + item.column + ' 列）' : '');
      target.appendChild(row);
    });
  }

  function checkCodeAgainst(language, code, target) {
    if (!state.siteId) return Promise.resolve(null);
    if (target) {
      target.className = 'lc-code-result';
      target.textContent = '正在检查…';
    }
    return api(siteApi('/code/check'), {
      method: 'POST',
      body: { language: language, code: String(code || '') }
    }).then(function (result) {
      showCheckResult(target, result);
      return result;
    }).catch(function (error) {
      if (target) {
        target.className = 'lc-code-result is-fail';
        target.textContent = '检查失败：' + error.message;
      }
      return null;
    });
  }

  function isDirtyNow() {
    return !!state.page && serialize() !== state.baseline;
  }

  function serialize() {
    return JSON.stringify(state.page, null, 2);
  }

  /* 历史点只记录「页面级共享字段 + 本端区块」。
     如果把两端的区块都存进同一个历史点，另一端改过之后，
     撤销时新旧快照并不相等，会凭空多出一个历史点，导致撤销/重做串到另一端。 */
  function serializeForEnd(key) {
    var page = state.page || {};
    var out = {};
    Object.keys(page).forEach(function (name) {
      if (name === 'blocks' || name === 'blocksMobile') return;
      out[name] = page[name];
    });
    out.blocks = (key === 'mobile' ? page.blocksMobile : page.blocks) || [];
    return JSON.stringify(out, null, 2);
  }

  function ensureBlockIds(blocks) {
    if (!Array.isArray(blocks)) return;
    blocks.forEach(function (block) {
      if (!block || typeof block !== 'object') return;
      if (!block.id) {
        state.idSerial += 1;
        block.id = 'b-' + Date.now().toString(36) + '-' + state.idSerial;
      }
      if (Array.isArray(block.blocks)) ensureBlockIds(block.blocks);
    });
  }

  /* ---------------- 双端独立 UI ---------------- */

  function independentUiOn() {
    return !!(state.page && state.page.independentUi === true);
  }

  function activeBlocksKey() {
    return independentUiOn() && state.uiEnd === 'mobile' ? 'blocksMobile' : 'blocks';
  }

  /* 编辑器里所有“当前区块树”的读写都必须走这里，切端后自然落到另一份数据。 */
  function activeBlocks() {
    if (!state.page) return [];
    var key = activeBlocksKey();
    if (!Array.isArray(state.page[key])) state.page[key] = [];
    return state.page[key];
  }

  function collectBlockIds() {
    var used = {};
    [state.page && state.page.blocks, state.page && state.page.blocksMobile].forEach(function (list) {
      walkBlocks(list, [], function (block) {
        if (block && block.id) used[block.id] = true;
      });
    });
    return used;
  }

  /* 自定义代码里可能写死了区块 id：只按完整 id 匹配替换，避免误伤更长的标识符。 */
  var CODE_REMAP_KEYS = { html: 1, css: 1, js: 1, script: 1 };

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function remapCodeIds(text, map) {
    var ids = Object.keys(map);
    if (!ids.length) return text;
    ids.sort(function (a, b) { return b.length - a.length; });
    var pattern = new RegExp('(?<![A-Za-z0-9_-])(' + ids.map(escapeRegExp).join('|') +
      ')(?![A-Za-z0-9_-])', 'g');
    return text.replace(pattern, function (match, id) {
      state.codeIdRemapped = true;
      return map[id];
    });
  }

  function remapBlockRefs(value, map, key) {
    if (typeof value === 'string') {
      if (map[value]) return map[value];
      if (key === 'target' || key === 'targetId' || key === 'selector' || key === 'href') {
        return value.replace(/#([A-Za-z0-9_-]+)/g, function (match, id) {
          return map[id] ? '#' + map[id] : match;
        });
      }
      if (CODE_REMAP_KEYS[key]) return remapCodeIds(value, map);
      return value;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) value[i] = remapBlockRefs(value[i], map, '');
      return value;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (childKey) {
        value[childKey] = remapBlockRefs(value[childKey], map, childKey);
      });
    }
    return value;
  }

  /* 复制一棵区块树并换新 id：避免两端同 id 在导出后互相干扰，同时把常见的 #id 引用一起改掉。 */
  function cloneBlocksWithFreshIds(source) {
    state.codeIdRemapped = false;
    var copy = JSON.parse(JSON.stringify(Array.isArray(source) ? source : []));
    ensureBlockIds(copy);
    var used = collectBlockIds();
    var map = {};
    walkBlocks(copy, [], function (block) {
      if (!block || !block.id) return;
      var oldId = block.id;
      var nextId = newBlockId();
      while (used[nextId]) nextId = newBlockId();
      used[nextId] = true;
      map[oldId] = nextId;
      block.id = nextId;
    });
    return remapBlockRefs(copy, map, '');
  }

  function newBlockId() {
    state.idSerial += 1;
    return 'b-' + Date.now().toString(36) + '-' + state.idSerial;
  }

  function uiEndStorageKey() {
    return 'lc-builder-ui-end:' + state.siteId + ':' + (state.page ? state.page.id : '');
  }

  function readStoredUiEnd() {
    try {
      var value = localStorage.getItem(uiEndStorageKey());
      return value === 'mobile' ? 'mobile' : 'desktop';
    } catch (error) { return 'desktop'; }
  }

  function rememberUiEnd() {
    try { localStorage.setItem(uiEndStorageKey(), state.uiEnd); } catch (error) { /* 存储不可用时忽略 */ }
  }

  function ensurePageBlockIds() {
    if (!state.page) return;
    ensureBlockIds(state.page.blocks);
    if (state.page.independentUi === true) {
      if (!Array.isArray(state.page.blocksMobile)) {
        state.page.blocksMobile = cloneBlocksWithFreshIds(state.page.blocks);
        /* 自动补移动端时静默处理，不把提示留给后续手动复制操作。 */
        state.codeIdRemapped = false;
      }
      ensureBlockIds(state.page.blocksMobile);
    }
  }

  function walkBlocks(blocks, path, visit) {
    if (!Array.isArray(blocks)) return;
    blocks.forEach(function (block, index) {
      var current = path.concat(index);
      visit(block, current);
      if (block && Array.isArray(block.blocks)) walkBlocks(block.blocks, current, visit);
    });
  }

  function rebuildBlockIndex() {
    state.blockIndex = {};
    walkBlocks(state.page ? activeBlocks() : [], [], function (block, path) {
      if (block && block.id) state.blockIndex[block.id] = path;
    });
  }

  function blockAtPath(path) {
    var list = state.page ? activeBlocks() : null;
    var block = null;
    for (var i = 0; i < path.length; i += 1) {
      if (!Array.isArray(list)) return null;
      block = list[path[i]];
      if (!block) return null;
      list = block.blocks;
    }
    return block;
  }

  function listAtPath(path) {
    if (!state.page) return null;
    /* 顶层区块（长度 1）的父级就是 page.blocks，blockAtPath([]) 会返回 null。 */
    if (path.length <= 1) return activeBlocks();
    var parent = blockAtPath(path.slice(0, -1));
    return parent && Array.isArray(parent.blocks) ? parent.blocks : null;
  }

  function findBlockById(id) {
    var found = null;
    walkBlocks(state.page ? activeBlocks() : [], [], function (block, path) {
      if (!found && block && block.id === id) {
        found = { block: block, path: path };
      }
    });
    return found;
  }

  function locateBlockObject(blocks, target) {
    var found = null;
    (function walk(list, prefix) {
      if (!Array.isArray(list) || found) return;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i] === target) {
          found = { list: list, index: i, path: prefix.concat(i) };
          return;
        }
        if (list[i] && Array.isArray(list[i].blocks)) walk(list[i].blocks, prefix.concat(i));
        if (found) return;
      }
    }(blocks, []));
    return found;
  }

  function selectionPath() {
    return state.selection ? state.selection.slice() : null;
  }

  function selectedBlock() {
    return state.selection ? blockAtPath(state.selection) : null;
  }

  function parentBlockOf(path) {
    if (!path || path.length < 2) return null;
    return blockAtPath(path.slice(0, -1));
  }

  function countBlocks() {
    var total = 0;
    walkBlocks(state.page ? activeBlocks() : [], [], function () { total += 1; });
    return total;
  }

  /* ---------------- 历史 ---------------- */

  /* 当前编辑端对应的历史栈键；关闭双端独立 UI 时只有桌面端一套。 */
  function historyKey() {
    return independentUiOn() && state.uiEnd === 'mobile' ? 'mobile' : 'desktop';
  }

  function historyList() {
    return state.history[historyKey()] || [];
  }

  function pushHistory() {
    if (!state.page) return;
    var key = historyKey();
    var list = state.history[key] || [];
    var snap = serializeForEnd(key);
    if (list[state.historyIndex[key]] === snap) return;
    list = list.slice(0, state.historyIndex[key] + 1);
    list.push(snap);
    if (list.length > 120) list.shift();
    state.history[key] = list;
    state.historyIndex[key] = list.length - 1;
    updateUndoRedo();
  }

  function resetHistoryEnd(key) {
    state.history[key] = state.page ? [serializeForEnd(key)] : [];
    state.historyIndex[key] = state.page ? 0 : -1;
  }

  function resetHistory() {
    resetHistoryEnd('desktop');
    resetHistoryEnd('mobile');
    updateUndoRedo();
  }

  /* 撤销/重做只替换当前端的区块树，另一端和页面级共享字段保持现状。
     这样两端各自的历史点不会互相“串台”。 */
  function applySnapshot(text, options) {
    var keepId = state.selectionId;
    cancelLayerDrag();
    state.canvasDragging = false;
    postToCanvas({ type: 'cancel-drag' });
    var snapshot = JSON.parse(text);
    if (options && options.endOnly && state.page) {
      var activeKey = activeBlocksKey();
      var otherKey = activeKey === 'blocksMobile' ? 'blocks' : 'blocksMobile';
      var otherBlocks = state.page[otherKey];
      /* 快照里的 blocks 就是当前端；页面级共享字段照常还原，另一端原样保留。 */
      Object.keys(snapshot).forEach(function (name) {
        if (name === 'blocks') return;
        state.page[name] = snapshot[name];
      });
      state.page[activeKey] = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
      if (Array.isArray(otherBlocks)) state.page[otherKey] = otherBlocks;
      else delete state.page[otherKey];
      state.page.independentUi = snapshot.independentUi;
    } else {
      state.page = snapshot;
    }
    ensurePageBlockIds();
    if (!independentUiOn()) {
      state.uiEnd = 'desktop';
      setViewport('desktop');
    }
    rebuildBlockIndex();
    if (keepId && state.blockIndex[keepId]) {
      state.selection = state.blockIndex[keepId].slice();
      state.selectionId = keepId;
    } else {
      state.selection = null;
      state.selectionId = '';
    }
    markDirty();
    renderLayerTree();
    renderInspector();
    updatePageChrome();
    scheduleRender(80);
    /* 撤销/重做改变了页面内容，也要像普通编辑一样落盘，否则切页会丢。 */
    scheduleSave();
  }

  function undo() {
    /* 输入框里的改动可能还没形成历史点：先把当前状态记下来，再退回上一个点，
       这样 Ctrl+Z 不会跳过刚输入的内容。 */
    state.fieldSession = null;
    pushHistory();
    var key = historyKey();
    var list = historyList();
    if (state.historyIndex[key] <= 0) return;
    state.historyIndex[key] -= 1;
    applySnapshot(list[state.historyIndex[key]], { endOnly: true });
    updateUndoRedo();
    setStatus('已撤销到' + (independentUiOn() ? endLabel(key) + '端' : '') +
      '第 ' + (state.historyIndex[key] + 1) + ' 个历史点');
  }

  function redo() {
    var key = historyKey();
    var list = historyList();
    if (state.historyIndex[key] >= list.length - 1) return;
    state.historyIndex[key] += 1;
    applySnapshot(list[state.historyIndex[key]], { endOnly: true });
    updateUndoRedo();
    setStatus('已重做' + (independentUiOn() ? endLabel(key) + '端' : '') +
      '，历史点 ' + (state.historyIndex[key] + 1) + '/' + list.length);
  }

  function endLabel(key) {
    return key === 'mobile' ? '移动' : '桌面';
  }

  function updateUndoRedo() {
    var key = historyKey();
    var list = historyList();
    refs.undo.disabled = state.historyIndex[key] <= 0;
    refs.redo.disabled = state.historyIndex[key] >= list.length - 1;
  }

  /* ---------------- 保存与状态 ---------------- */

  function updateSaveState() {
    var text = '已保存';
    var cls = 'lc-badge-success';
    if (state.saving) { text = '保存中…'; cls = 'lc-badge-info'; }
    else if (state.saveError) { text = '保存失败'; cls = 'lc-badge-danger'; }
    else if (state.dirty) { text = '未保存'; cls = 'lc-badge-warn'; }
    refs.saveState.className = 'lc-badge ' + cls;
    refs.saveState.textContent = text;
    refs.save.disabled = !state.page || state.saving || !state.dirty;
    refs.save.title = state.page ? '保存（Ctrl+S）' : '先选择项目，再保存';
    refs.statusRev.textContent = 'rev ' + (state.rev || '—');
    if (state.page) {
      refs.sidebarState.textContent = state.dirty ? '有未保存改动（草稿已留存）' : '已与磁盘同步';
    }
  }

  function markDirty() {
    state.dirty = isDirtyNow();
    if (state.dirty) state.saveError = '';
    updateSaveState();
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    if (!state.page) return;
    storeDraft();
    state.saveTimer = setTimeout(function () {
      state.saveTimer = 0;
      if (state.dirty) saveNow();
    }, SAVE_DELAY);
  }

  function scheduleRetry(delay) {
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(function () {
      if (state.page && state.dirty && !state.saving) saveNow();
    }, delay);
  }

  function saveNow(options) {
    var opts = options || {};
    if (!state.page) return Promise.resolve(false);
    if (state.saving) {
      /* 保存进行中：等本次结束后再补存一次。
         调用方（切页 / 切站点 / Ctrl+S）因此能拿到真正落盘后的结果，
         保存期间的新编辑也不会被吞掉。 */
      if (!state.savePromise) return Promise.resolve(false);
      return state.savePromise.then(function (ok) {
        if (!ok || !state.page) return ok;
        return state.dirty ? saveNow(opts) : true;
      });
    }
    if (!state.dirty && !opts.force) {
      setStatus('没有需要保存的改动');
      return Promise.resolve(true);
    }
    state.saving = true;
    state.saveError = '';
    updateSaveState();
    setStatus('正在保存…');
    var content = serialize();
    state.savePromise = api(siteApi('/file?path=' + encodeURIComponent(state.pagePath)), {
      method: 'PUT',
      body: { content: content, expectedRev: state.rev }
    }).then(function (result) {
      state.rev = result.rev;
      state.baseline = content;
      state.baselineHash = result.hash || '';
      pushHistory();
      state.saveError = '';
      state.dirty = isDirtyNow();
      /* 保存期间又有编辑时，草稿要保留新内容，不能把兜底一起清掉。 */
      if (state.dirty) storeDraft(); else clearDraft();
      setStatus('已保存 · ' + nowLabel(), 'ok');
      refs.statusRight.textContent = 'rev ' + state.rev + ' · ' + countBlocks() + ' 个区块';
      return true;
    }).catch(function (error) {
      if (error.status === 409 || error.code === 'LC_E_REV_CONFLICT') {
        /* 站点 rev 是站点级单调计数：别的页面或资源写入也会 bump。
           先确认当前页在磁盘上是否真的变了；没变就静默换新 rev 重存，
           否则同站点编辑另一页会误报“冲突”。 */
        return api(siteApi('/file?path=' + encodeURIComponent(state.pagePath))).then(function (file) {
          if (file && state.baselineHash && file.hash === state.baselineHash) {
            state.rev = file.rev;
            state.retryAfterRev = true;
            return false;
          }
          openConflictDialog(error);
          return false;
        }).catch(function () {
          openConflictDialog(error);
          return false;
        });
      }
      state.saveError = error.message;
      setStatus('保存失败：' + error.message + '（改动已存本地草稿，稍后自动重试）', 'error');
      scheduleRetry(8000);
      return false;
    }).then(function (ok) {
      state.saving = false;
      state.savePromise = null;
      updateSaveState();
      if (state.retryAfterRev) {
        state.retryAfterRev = false;
        return saveNow({ force: true });
      }
      /* 保存期间的新编辑：成功后再排一次自动保存。 */
      if (ok && state.dirty) scheduleSave();
      return ok;
    });
    return state.savePromise;
  }

  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch (error) { /* 忽略隐私模式 */ }
  }

  function draftKey() {
    return 'lc-builder-draft:' + state.siteId + ':' + (state.page ? state.page.id : '');
  }

  function storeDraft() {
    if (!state.page) return;
    try {
      localStorage.setItem(draftKey(), JSON.stringify({
        text: serialize(),
        savedAt: Date.now(),
        rev: state.rev
      }));
    } catch (error) { /* 存储满时不影响编辑 */ }
  }

  function readDraft() {
    try {
      var raw = localStorage.getItem(draftKey());
      return raw ? JSON.parse(raw) : null;
    } catch (error) { return null; }
  }

  /* ---------------- 画布 ---------------- */

  function scheduleRender(delay) {
    clearTimeout(state.renderTimer);
    var wait = typeof delay === 'number' ? delay : RENDER_DELAY;
    state.renderTimer = setTimeout(renderCanvas, wait);
  }

  /* 画布 iframe 不再同源：滚动位置由画布内桥脚本通过 postMessage 上报。 */
  function captureScroll() {
    state.pendingScroll = state.canvasScrollY || 0;
    state.pendingPageScroll = state.canvasPageScrollY || 0;
  }

  function renderCanvas() {
    if (!state.page) return;
    if (state.interacting) { state.renderAgain = true; return; }
    var seq = ++state.renderSeq;
    captureScroll();
    /* 重渲染会换掉整份预览文档，先把父页侧的拖拽残留清掉。 */
    cancelLayerDrag();
    state.canvasDragging = false;
    state.renderInFlight = true;
    refs.statusRight.textContent = '渲染中…';
    api(siteApi('/builder/render'), {
      method: 'POST',
      body: { page: state.page, themeId: state.themeId, mode: state.mode, uiEnd: state.uiEnd }
    }).then(function (data) {
      if (seq !== state.renderSeq) return;
      state.renderInFlight = false;
      /* 画布加载平台同源真实地址：数据请求不再是不透明源的跨域预检。 */
      refs.frame.src = data.previewUrl;
      refs.statusRight.textContent = '渲染引擎 · ' + (data.blockCount || 0) + ' 个区块';
      var errors = (data.report || []).filter(function (item) { return item && item.severity === 'error'; });
      if (errors.length) {
        setStatus('渲染有 ' + errors.length + ' 条错误：' + (errors[0].message || ''), 'error');
      }
    }).catch(function (error) {
      state.renderInFlight = false;
      refs.statusRight.textContent = '渲染失败';
      setStatus('画布渲染失败', 'error');
      showBanner({
        title: '画布渲染失败',
        text: error.message,
        close: hideBanner
      });
    });
  }

  /* 画布加载完成：父页不读画布 DOM，等桥脚本 ready 后再同步选中态与滚动。 */
  function onFrameLoad() {
    if (state.renderAgain) {
      state.renderAgain = false;
      scheduleRender(60);
    }
  }

  function postToCanvas(message) {
    var win = refs.frame.contentWindow;
    if (!win) return;
    try {
      /* 画布与 builder 同源，目标 origin 用当前页面 origin，不再用 *。 */
      win.postMessage(Object.assign({ __lc: 'parent' }, message), window.location.origin);
    } catch (error) { /* 画布未就绪时忽略 */ }
  }

  function applySelectionToFrame() {
    postToCanvas({ type: 'select', id: state.selectionId, free: isFreeChild() });
  }

  function isFreeChild() {
    var block = state.selection ? blockAtPath(state.selection) : null;
    if (!block) return false;
    var parent = parentBlockOf(state.selection);
    if (parent && parent.type === 'container' && containerVariant(parent) === 'free') return true;
    /* 自由布局页面的根级区块同样是自由定位块，也要能直接拖动。 */
    return !!block.pos && isFreeLayout();
  }

  function isEditable(el) {
    if (!el) return false;
    var tag = String(el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function onCanvasMessage(event) {
    if (!refs.frame.contentWindow || event.source !== refs.frame.contentWindow) return;
    /* 画布与 builder 同源：只接受同源消息，不信任任意来源。 */
    if (event.origin !== window.location.origin) return;
    var message = event.data;
    if (!message || message.__lc !== 'canvas') return;
    if (message.type === 'ready') {
      state.canvasScrollY = Number(message.y) || 0;
      state.canvasPageScrollY = Number(message.pageY) || 0;
      state.canvasOverflow = { x: !!message.overflowX, y: !!message.overflowY };
      if (state.pendingScroll || state.pendingPageScroll) {
        postToCanvas({ type: 'scroll', y: state.pendingScroll, pageY: state.pendingPageScroll });
      }
      applySelectionToFrame();
      checkDragOverflow();
      return;
    }
    if (message.type === 'scroll') {
      state.canvasScrollY = Number(message.y) || 0;
      state.canvasPageScrollY = Number(message.pageY) || 0;
      return;
    }
    if (message.type === 'drag-begin') {
      state.canvasDragging = true;
      beginDragRollback();
      return;
    }
    if (message.type === 'drag-end') {
      state.canvasDragging = false;
      return;
    }
    if (message.type === 'overflow-result') {
      var guard = state.dragRollback;
      if (!guard || !guard.token || message.token !== guard.token) return;
      var base = guard.baseline || { x: false, y: false };
      /* 只有相对拖拽前新出现的溢出才算这次移动引入的，长页面自有滚动条不算。 */
      if ((message.overflowX && !base.x) || (message.overflowY && !base.y)) rollbackDrag();
      else state.dragRollback = null;
      return;
    }
    if (message.type === 'free-cancel') {
      state.interacting = false;
      applySelectionToFrame();
      return;
    }
    if (message.type === 'shell-block') {
      toast('这是项目的公共区块（导航 / 页脚 / 侧栏），请到「配置中心」修改，不能在当前页编辑。', 'warn');
      return;
    }
    if (message.type === 'pick') {
      var path = message.id ? state.blockIndex[message.id] : null;
      selectBlock(path || null);
      return;
    }
    if (message.type === 'drop') {
      var moved = message.from && message.to && message.position
        ? moveBlock(message.from, message.to, message.position)
        : false;
      /* 落位后要等重渲染完成才知道有没有把页面撑出滚动条。 */
      if (moved && state.dragRollback) state.dragRollback.pending = true;
      return;
    }
    if (message.type === 'free-start') {
      state.interacting = true;
      return;
    }
    if (message.type === 'free-end') {
      var target = state.blockIndex[message.id] ? blockAtPath(state.blockIndex[message.id]) : null;
      if (target && message.pos) {
        target.pos = Object.assign({}, target.pos, {
          left: Math.max(0, Number(message.pos.left) || 0),
          top: Math.max(0, Number(message.pos.top) || 0),
          width: Math.max(40, Number(message.pos.width) || 40),
          height: Math.max(40, Number(message.pos.height) || 40)
        });
      }
      state.interacting = false;
      pushHistory();
      markDirty();
      scheduleSave();
      scheduleRender(40);
      setStatus('自由定位已更新（位置/尺寸）');
      return;
    }
    if (message.type === 'key') {
      onKeydown({
        key: message.key,
        ctrlKey: message.ctrlKey,
        metaKey: message.metaKey,
        shiftKey: message.shiftKey,
        altKey: message.altKey,
        target: null,
        preventDefault: function () {}
      });
    }
  }

  /* ---------------- 选中 ---------------- */

  function selectBlock(path) {
    state.selection = path ? path.slice() : null;
    state.selectionId = '';
    state.fieldSession = null;
    if (path) {
      var block = blockAtPath(path);
      if (block && block.id) state.selectionId = block.id;
    }
    renderLayerTree();
    renderInspector();
    applySelectionToFrame();
    if (state.selectionId) {
      setStatus('已选中 ' + blockLabel(selectedBlock()) + ' · ' + state.selectionId);
    }
  }

  /* ---------------- 结构变更 ---------------- */

  function afterStructureChange(selectPath) {
    pushHistory();
    markDirty();
    rebuildBlockIndex();
    renderLayerTree();
    if (selectPath) {
      state.selection = selectPath.slice();
      var block = blockAtPath(selectPath);
      state.selectionId = block ? block.id : '';
    }
    renderInspector();
    scheduleRender(80);
    scheduleSave();
    updateBlockCount();
  }

  function deleteSelected() {
    if (!state.selection) return;
    var path = state.selection.slice();
    var list = listAtPath(path);
    if (!list) return;
    var removed = list[path[path.length - 1]];
    if (!removed) return;
    var label = blockLabel(removed);
    list.splice(path[path.length - 1], 1);
    var nextPath = path.slice(0, -1);
    if (nextPath.length && !blockAtPath(nextPath)) nextPath = [];
    /* 删除后原路径会指向相邻区块，必须先清空选中；
       否则连续按 Delete 会误删刚补位上来的区块。 */
    if (!nextPath.length) {
      state.selection = null;
      state.selectionId = '';
    }
    afterStructureChange(nextPath.length ? nextPath : null);
    toast('已删除：' + label, 'warn');
  }

  function duplicateSelected() {
    if (!state.selection) return;
    var path = state.selection.slice();
    var list = listAtPath(path);
    if (!list) return;
    var source = list[path[path.length - 1]];
    var copied = cloneBlocksWithFreshIds([source])[0];
    list.splice(path[path.length - 1] + 1, 0, copied);
    afterStructureChange(path.slice(0, -1).concat(path[path.length - 1] + 1));
    toast('已复制区块');
    notifyCodeRemap();
  }

  function copySelected() {
    var block = selectedBlock();
    if (!block) return;
    state.clipboard = clone(block);
    toast('已复制到剪贴板（Builder 内部）');
  }

  function pasteClipboard() {
    if (!state.clipboard || !state.page) return;
    var copy = cloneBlocksWithFreshIds([state.clipboard])[0];
    if (state.selection) {
      var path = state.selection.slice();
      var list = listAtPath(path);
      if (!list) return;
      var index = path[path.length - 1] + 1;
      list.splice(index, 0, copy);
      afterStructureChange(path.slice(0, -1).concat(index));
    } else {
      var rootList = activeBlocks();
      rootList.push(copy);
      afterStructureChange([rootList.length - 1]);
    }
    toast('已粘贴区块');
    notifyCodeRemap();
  }

  function moveBlock(fromId, targetId, position) {
    var from = findBlockById(fromId);
    var target = findBlockById(targetId);
    if (!from || !target) return false;
    if (from.block.id === target.block.id) return false;
    var fromPath = from.path;
    var targetPath = target.path;
    var descendant = targetPath.length > fromPath.length && fromPath.every(function (value, index) {
      return targetPath[index] === value;
    });
    if (descendant) {
      toast('不能把容器拖进自己的子级', 'error');
      return false;
    }
    var sourceList = listAtPath(fromPath);
    if (!sourceList) return false;
    var block = sourceList.splice(fromPath[fromPath.length - 1], 1)[0];
    if (position === 'inside') {
      if (target.block.type !== 'container') {
        sourceList.splice(fromPath[fromPath.length - 1], 0, block);
        toast('只能拖进容器内部', 'warn');
        return false;
      }
      target.block.blocks = target.block.blocks || [];
      target.block.blocks.push(block);
    } else {
      /* 移除后旧的 path 可能已经错位，这里按对象身份重新定位目标槽位。 */
      var located = locateBlockObject(activeBlocks(), target.block);
      if (!located) {
        sourceList.splice(fromPath[fromPath.length - 1], 0, block);
        return false;
      }
      located.list.splice(located.index + (position === 'after' ? 1 : 0), 0, block);
    }
    var found = findBlockById(block.id);
    afterStructureChange(found ? found.path : null);
    toast(position === 'inside' ? '已放进容器' : '已调整顺序');
    return true;
  }

  /* ---------------- 拖拽回退 ---------------- */

  /* 拖拽开始时留一份本端快照与历史点位置：落位后如果新布局把文档撑出滚动条，
     就退回这份快照，而不是只弹一句提示。 */
  function beginDragRollback() {
    if (!state.page) { state.dragRollback = null; return; }
    var key = historyKey();
    var index = state.historyIndex[key];
    if (!Number.isInteger(index)) index = (state.history[key] || []).length - 1;
    state.dragRollback = {
      key: key,
      pageId: state.page.id || '',
      snapshot: serializeForEnd(key),
      index: index,
      baseline: { x: !!state.canvasOverflow.x, y: !!state.canvasOverflow.y },
      pending: false,
      token: ''
    };
  }

  /* 落位后的首次重渲染完成时，向画布要一次溢出测量（画布会减去拖拽前基线）。 */
  function checkDragOverflow() {
    var guard = state.dragRollback;
    if (!guard || !guard.pending) return;
    /* 页面已经切走时旧回退点作废，避免把上一页的快照套到新页面。 */
    if (!state.page || guard.pageId !== (state.page.id || '')) { state.dragRollback = null; return; }
    guard.pending = false;
    guard.token = 'drag-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    postToCanvas({ type: 'measure-overflow', token: guard.token });
  }

  /* 真正回退：截掉这次移动压出来的历史点，再把页面恢复成拖拽前快照，
     等于这次拖拽没发生过，撤销栈也不会留下坏状态。 */
  function rollbackDrag() {
    var guard = state.dragRollback;
    state.dragRollback = null;
    if (!guard || !state.page) return false;
    var list = (state.history[guard.key] || []).slice(0, guard.index + 1);
    state.history[guard.key] = list;
    state.historyIndex[guard.key] = list.length - 1;
    applySnapshot(guard.snapshot, { endOnly: true });
    updateUndoRedo();
    setStatus('拖拽后的布局会撑出滚动条，已回退到拖拽前');
    toast('新位置会把页面撑出滚动条，已回退到拖拽前', 'warn');
    return true;
  }

  /* ---------------- 图层树 ---------------- */

  function blockLabel(block) {
    if (!block) return '空区块';
    if (block.type === 'container') {
      return (block.title ? '容器：' + block.title : '容器（' + (block.variant || 'card') + '）');
    }
    if (block.type === 'component') {
      var component = componentInfo(block.componentId);
      return (component ? component.name : '组件') + (block.fields && block.fields.title ? '：' + block.fields.title : '');
    }
    var text = block.text || block.md || block.html || block.label || (block.props && (block.props.text || block.props.label)) || '';
    var name = schemaName(block) || block.type;
    var clean = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return clean ? name + '：' + clean.slice(0, 28) : name;
  }

  function typeBadge(block) {
    var type = String((block && block.type) || '?');
    var map = {
      heading: 'H2', paragraph: 'P', markdown: 'MD', html: 'HTML', note: 'NOTE',
      cards: 'CARD', image: 'IMG', divider: '—', button: 'BTN', code: 'CODE',
      articleList: 'LIST', container: 'BOX', component: 'CMP'
    };
    return map[type] || type.slice(0, 5).toUpperCase();
  }

  function loadCollapsed() {
    state.collapsed = {};
    try {
      var raw = localStorage.getItem('lc-builder-collapsed:' + state.siteId);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state.collapsed = parsed;
    } catch (error) {
      state.collapsed = {};
    }
  }

  function saveCollapsed() {
    try {
      localStorage.setItem('lc-builder-collapsed:' + state.siteId, JSON.stringify(state.collapsed));
    } catch (error) { /* 存储不可用时只影响折叠记忆 */ }
  }

  function renderLayerTree() {
    var blocks = state.page ? activeBlocks() : [];
    if (!blocks || !blocks.length) {
      refs.layerTree.innerHTML = '<div class="lc-builder-layer-empty">当前页还没有区块。到「组件库」点「插入」，或先导入一个页面。</div>';
      refs.layerCount.textContent = '0';
      return;
    }
    var html = '';
    function row(block, path, depth) {
      var active = state.selection && state.selection.join('.') === path.join('.');
      var childCount = Array.isArray(block.blocks) ? block.blocks.length : 0;
      var collapsed = childCount > 0 && !!state.collapsed[block.id];
      var indent = 'padding-left:' + (8 + depth * 14) + 'px';
      html += '<button class="lc-tree-item' + (active ? ' is-active' : '') + '" type="button" draggable="true"' +
        ' data-path="' + esc(path.join('.')) + '" aria-selected="' + (active ? 'true' : 'false') + '"' +
        ' title="' + esc((block.id || '') + ' · ' + (block.type || '')) + '"' +
        ' style="' + indent + '">' +
        (childCount
          ? '<span class="lc-tree-toggle" data-collapse-id="' + esc(block.id || '') + '" role="button"' +
            ' title="' + (collapsed ? '展开' : '折叠') + '" aria-label="' + (collapsed ? '展开' : '折叠') + '">' +
            (collapsed ? '▸' : '▾') + '</span>'
          : '<span class="lc-tree-toggle is-empty"></span>') +
        '<span class="lc-tree-type">' + esc(typeBadge(block)) + '</span>' +
        '<span class="lc-tree-text">' + esc(blockLabel(block)) + '</span>' +
        (childCount ? '<span class="lc-tree-count">' + childCount + '</span>' : '') +
        '<span class="lc-tree-meta">' + esc(block.type || '') + '</span></button>';
      if (Array.isArray(block.blocks)) {
        if (collapsed) return;
        if (!block.blocks.length) {
          html += '<div class="lc-builder-layer-empty" style="padding-left:' + (24 + depth * 14) + 'px">（空容器）</div>';
        } else {
          block.blocks.forEach(function (child, index) { row(child, path.concat(index), depth + 1); });
        }
      }
    }
    blocks.forEach(function (block, index) { row(block, [index], 0); });
    refs.layerTree.innerHTML = html;
    refs.layerCount.textContent = String(countBlocks());
    var activeRow = refs.layerTree.querySelector('.lc-tree-item.is-active');
    if (activeRow && typeof activeRow.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------------- 页面 / 组件库 / 模板库 ---------------- */

  var PANEL_HINTS = {
    pages: '点页面切换；下面是当前页的真实区块层级。',
    components: '每个组件是一段可复用 HTML 模板；点「插入」放进当前页。',
    templates: '模板是预置页面；套用只新建页面，不会覆盖现有页面。'
  };

  var IMPORT_RULES = {
    page: { label: '页面', ext: /\.json$/i, accept: 'JSON 文件（.json）', maxBytes: 512 * 1024 },
    component: { label: '组件', ext: /\.json$/i, accept: 'JSON 文件（.component.json）', maxBytes: 512 * 1024 },
    template: { label: '模板', ext: /\.json$/i, accept: 'JSON 文件（.template.json）', maxBytes: 512 * 1024 }
  };

  function switchPanel(name) {
    state.panels = name;
    refs.panelTabs.forEach(function (tab) {
      var active = tab.getAttribute('data-panel-tab') === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    refs.panelBodies.forEach(function (body) {
      body.hidden = body.getAttribute('data-panel') !== name;
    });
    if (refs.panelHint) refs.panelHint.textContent = PANEL_HINTS[name] || '';
  }

  function renderComponentList() {
    var components = (state.info && state.info.components) || [];
    if (refs.componentCount) refs.componentCount.textContent = String(components.length);
    if (!refs.componentList) return;
    if (!components.length) {
      refs.componentList.innerHTML = '<div class="lc-resource-empty">还没有组件。拖入 .component.json 或点「选择文件」导入。</div>';
      return;
    }
    refs.componentList.innerHTML = components.map(function (component) {
      var fieldCount = (component.fields || []).length;
      return '<div class="lc-resource-item">' +
        '<div class="lc-resource-main"><strong>' + esc(component.name || component.id) + '</strong>' +
        '<small>' + esc(component.id) + ' · ' + (fieldCount ? fieldCount + ' 个字段' : '无字段') + '</small></div>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-insert-component="' + esc(component.id) + '">插入</button>' +
        '</div>';
    }).join('');
  }

  function renderBuiltinList() {
    var schemas = (state.info && state.info.blockSchemas) || [];
    var seen = {};
    var items = schemas.filter(function (schema) {
      if (!schema || !schema.type || seen[schema.type]) return false;
      seen[schema.type] = true;
      return true;
    });
    if (refs.builtinCount) refs.builtinCount.textContent = String(items.length);
    if (!refs.builtinList) return;
    refs.builtinList.innerHTML = items.map(function (schema) {
      return '<div class="lc-resource-item">' +
        '<div class="lc-resource-main"><strong>' + esc(schema.name || schema.type) + '</strong>' +
        '<small>' + esc(schema.type) + '</small></div>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-insert-builtin="' + esc(schema.type) + '">插入</button>' +
        '</div>';
    }).join('');
  }

  function renderTemplateList() {
    var templates = state.templates || [];
    if (refs.templateCount) refs.templateCount.textContent = String(templates.length);
    if (!refs.templateList) return;
    if (!templates.length) {
      refs.templateList.innerHTML = '<div class="lc-resource-empty">还没有模板。拖入 .template.json 或点「选择文件」导入。</div>';
      return;
    }
    refs.templateList.innerHTML = templates.map(function (template) {
      var kindLabel = template.kind === 'site' ? '整站模板' : '页面模板';
      return '<div class="lc-resource-item">' +
        '<div class="lc-resource-main"><strong>' + esc(template.name || template.id) + '</strong>' +
        '<small>' + kindLabel + ' · ' + (template.pageCount || 0) + ' 个页面' +
        (template.description ? ' · ' + esc(template.description) : '') + '</small></div>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-apply-template="' + esc(template.id) + '">套用</button>' +
        '</div>';
    }).join('');
  }

  function newBlockId() {
    state.idSerial += 1;
    return 'b-' + Date.now().toString(36) + '-' + state.idSerial;
  }

  function insertComponent(componentId) {
    if (!state.page) {
      toast('先打开一个页面再插入组件', 'warn');
      return;
    }
    var component = ((state.info && state.info.components) || []).filter(function (item) {
      return item.id === componentId;
    })[0];
    if (!component) {
      toast('找不到组件：' + componentId, 'error');
      return;
    }
    var block;
    if (component.builtin && component.builtinId) {
      /* 内置组件直接作为原生块插入，带样例数据，插入即可见效果。 */
      block = buildBlockFromSchema(component.builtinId, component.sample);
    } else {
      block = { id: newBlockId(), type: 'component', componentId: componentId, fields: {} };
      (component.fields || []).forEach(function (field) { block.fields[field] = ''; });
    }
    placeBlock(block);
    toast('已插入组件：' + (component.name || componentId), 'ok');
  }

  function isFreeLayout() {
    return !!(state.page && state.page.layout && state.page.layout.mode === 'free');
  }

  function containerVariant(block) {
    if (!block) return '';
    return block.variant || (block.props && block.props.variant) || '';
  }

  /* 自由布局下新块必须有明确坐标：否则渲染器会把它排到“所有块最底部之下”，
     遇到历史遗留的超远坐标块就会把页面继续撑长。这里按当前可视区域给一个安全位置。 */
  function freePosForInsert(parent) {
    var frameWidth = (refs.frame && refs.frame.clientWidth) || 560;
    var width = Math.round(Math.max(160, Math.min(parent ? 480 : 560, frameWidth - 48)));
    if (!parent) {
      return {
        left: 24,
        top: Math.max(24, Math.round((state.canvasScrollY || 0) + 24)),
        width: width
      };
    }
    var top = 16;
    (parent.blocks || []).forEach(function (child) {
      var pos = child && child.pos;
      if (!pos) return;
      top = Math.max(top, Number(pos.top || 0) + Number(pos.height || 0) + 12);
    });
    return { left: 16, top: Math.round(top), width: width };
  }

  function schemaDefaultValues(schema, sample) {
    if (sample && typeof sample === 'object') return JSON.parse(JSON.stringify(sample));
    var values = {};
    Object.keys((schema && schema.props) || {}).forEach(function (key) {
      var def = schema.props[key];
      values[key] = def && Object.prototype.hasOwnProperty.call(def, 'default') ? def.default : '';
    });
    return values;
  }

  /* 基础区块的字段直接挂在 block 上（store=block），自定义组件才放 props。
     之前统一塞进 props 会让插入后的标题/正文/容器布局全部变空。 */
  function buildBlockFromSchema(type, sample) {
    var schema = state.schemaByType[type];
    var values = schemaDefaultValues(schema, sample);
    var block = { id: newBlockId(), type: type };
    var store = schema && schema.store === 'props' ? 'props' : (schema ? 'block' : 'props');
    if (store === 'props') {
      block.props = values;
    } else {
      Object.keys(values).forEach(function (key) { block[key] = values[key]; });
    }
    if (type === 'container') {
      if (!Array.isArray(block.blocks)) block.blocks = [];
      if (!block.variant) block.variant = 'card';
    }
    return block;
  }

  /* 把一个新区块放进选中容器；没选容器时追加到页面末尾。 */
  function placeBlock(block) {
    var parent = state.selection ? blockAtPath(state.selection) : null;
    var targetPath;
    var freeParent = parent && parent.type === 'container' && containerVariant(parent) === 'free';
    var freeRoot = !parent && isFreeLayout();
    if ((freeParent || freeRoot) && !block.pos) {
      block.pos = freePosForInsert(freeParent ? parent : null);
    }
    if (parent && parent.type === 'container') {
      if (!Array.isArray(parent.blocks)) parent.blocks = [];
      parent.blocks.push(block);
      targetPath = state.selection.concat(parent.blocks.length - 1);
    } else {
      var rootList = activeBlocks();
      rootList.push(block);
      targetPath = [rootList.length - 1];
    }
    switchPanel('pages');
    afterStructureChange(targetPath);
  }

  /* 内置区块调色板：空白项目没有自定义组件，也能直接插入 ui-* 与基础区块（BLD-02）。 */
  function insertBuiltinBlock(type) {
    if (!state.page) {
      toast('先打开一个页面再插入区块', 'warn');
      return;
    }
    var schema = state.schemaByType[type];
    if (!schema) {
      toast('找不到区块类型：' + type, 'error');
      return;
    }
    placeBlock(buildBlockFromSchema(type, schema.sample));
    toast('已插入区块：' + (schema.name || type), 'ok');
  }

  function applyTemplate(templateId) {
    var template = (state.templates || []).filter(function (item) { return item.id === templateId; })[0];
    if (!template) {
      toast('找不到模板：' + templateId, 'error');
      return;
    }
    if (state.applyingTemplate) {
      toast('正在套用模板，请稍候', 'warn');
      return;
    }
    var run = function () {
      state.applyingTemplate = true;
      setStatus('正在套用模板「' + template.name + '」…');
      return api(siteApi('/builder/template/apply'), {
        method: 'POST',
        body: { templateId: templateId }
      }).then(function (data) {
        state.applyingTemplate = false;
        if (data.rev) state.rev = data.rev;
        var created = data.pages || [];
        return reloadSiteInfo().then(function () {
          renderPageList();
          setStatus('已套用模板「' + template.name + '」，新建 ' + created.length + ' 个页面');
          toast('已套用模板：' + created.map(function (page) { return page.title || page.id; }).join('、'), 'ok');
          if (created.length) return openPage(created[0].id, { skipSave: true });
          return true;
        });
      }).catch(function (error) {
        state.applyingTemplate = false;
        setStatus('套用模板失败：' + error.message, 'error');
        toast('套用模板失败：' + error.message, 'error');
        return false;
      });
    };
    if (state.page && state.dirty) {
      return saveNow().then(function (saved) { return saved ? run() : false; });
    }
    return run();
  }

  /* ---------------- 拖拽导入 ---------------- */

  function findImportInput(kind) {
    for (var i = 0; i < refs.importInputs.length; i += 1) {
      if (refs.importInputs[i].getAttribute('data-file-input') === kind) return refs.importInputs[i];
    }
    return null;
  }

  function importBox(kind, name) {
    return document.querySelector('[data-import-' + name + '="' + kind + '"]');
  }

  function resetImportLog(kind) {
    var box = importBox(kind, 'log');
    if (!box) return;
    box.innerHTML = '';
    box.hidden = true;
  }

  function setImportSummary(kind, text) {
    var el = importBox(kind, 'summary');
    if (el) el.textContent = text;
  }

  function updateImportProgress(kind, done, total, text) {
    var wrap = importBox(kind, 'progress');
    var bar = importBox(kind, 'bar');
    var label = importBox(kind, 'text');
    if (!wrap) return;
    wrap.hidden = false;
    var percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    if (bar) bar.style.width = percent + '%';
    if (label) label.textContent = text || (done + '/' + total);
  }

  function finishImportProgress(kind) {
    var wrap = importBox(kind, 'progress');
    if (wrap) wrap.hidden = true;
  }

  function logImport(kind, status, file, message) {
    var box = importBox(kind, 'log');
    if (!box) return;
    box.hidden = false;
    var row = document.createElement('div');
    row.className = 'lc-import-row is-' + status;
    var head = document.createElement('b');
    var labels = { ok: '成功', fail: '失败', note: '说明' };
    head.textContent = (labels[status] || status) + (file ? ' · ' + file : '');
    var body = document.createElement('em');
    body.textContent = message;
    row.appendChild(head);
    row.appendChild(body);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  function readFileText(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('文件读取失败')); };
      reader.readAsText(file);
    });
  }

  function handleImportFiles(kind, fileList) {
    var rule = IMPORT_RULES[kind];
    if (!rule) return;
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) {
      toast('没有可导入的文件', 'warn');
      return;
    }
    if (state.importing) {
      toast('有导入正在进行，请稍候', 'warn');
      return;
    }
    resetImportLog(kind);
    var accepted = [];
    var rejected = 0;
    files.forEach(function (file) {
      if (!rule.ext.test(file.name)) {
        logImport(kind, 'fail', file.name, '格式不支持：需要 ' + rule.accept);
        rejected += 1;
        return;
      }
      if (file.size > rule.maxBytes) {
        logImport(kind, 'fail', file.name, '体积超限：' + Math.ceil(file.size / 1024) + ' KB，上限 512 KB');
        rejected += 1;
        return;
      }
      accepted.push(file);
    });
    var total = accepted.length + rejected;
    if (!accepted.length) {
      setImportSummary(kind, '未导入：' + rejected + ' 个文件未通过校验');
      logImport(kind, 'note', '完成', '成功 0 个，校验拦截 ' + rejected + ' 个。');
      toast('没有文件通过校验', 'error');
      return;
    }
    state.importing = true;
    var ok = 0;
    var failed = 0;
    updateImportProgress(kind, 0, total, '准备导入 ' + accepted.length + ' 个' + rule.label + '…');
    var chain = Promise.resolve();
    accepted.forEach(function (file, index) {
      chain = chain.then(function () {
        var done = index + rejected;
        updateImportProgress(kind, done, total, '正在导入 ' + (index + 1) + '/' + accepted.length + '：' + file.name);
        return readFileText(file).then(function (text) {
          return api(siteApi('/builder/import'), {
            method: 'POST',
            body: { kind: kind, filename: file.name, content: text }
          });
        }).then(function (data) {
          if (data.rev) state.rev = data.rev;
          ok += 1;
          logImport(kind, 'ok', file.name, '已导入「' + data.name + '」' +
            (data.notices && data.notices.length ? '；' + data.notices.join('；') : ''));
        }).catch(function (error) {
          failed += 1;
          logImport(kind, 'fail', file.name, error.message);
        });
      });
    });
    chain.then(function () {
      state.importing = false;
      finishImportProgress(kind);
      var missed = failed + rejected;
      setImportSummary(kind, '成功 ' + ok + ' 个，未导入 ' + missed + ' 个 / 共 ' + total + ' 个');
      logImport(kind, 'note', '完成', '成功 ' + ok + ' 个，失败 ' + failed + ' 个' +
        (rejected ? '，校验拦截 ' + rejected + ' 个' : '') + '。');
      toast('导入完成：成功 ' + ok + ' 个' + (missed ? '，未导入 ' + missed + ' 个' : ''),
        ok ? 'ok' : 'error');
      return reloadSiteInfo().then(function () {
        if (!state.page && state.pages.length) return openPage(state.pages[0].id, { skipSave: true });
        return true;
      });
    });
  }

  function bindPanelEvents() {
    refs.panelTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchPanel(tab.getAttribute('data-panel-tab'));
      });
    });

    refs.importZones.forEach(function (zone) {
      var kind = zone.getAttribute('data-drop-zone');
      var input = findImportInput(kind);
      var open = function () { if (input) input.click(); };
      zone.addEventListener('click', open);
      zone.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      zone.addEventListener('dragenter', function (event) {
        event.preventDefault();
        zone.classList.add('is-dragging');
      });
      zone.addEventListener('dragover', function (event) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        zone.classList.add('is-dragging');
      });
      zone.addEventListener('dragleave', function (event) {
        if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-dragging');
      });
      zone.addEventListener('drop', function (event) {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove('is-dragging');
        handleImportFiles(kind, event.dataTransfer ? event.dataTransfer.files : null);
      });
    });

    refs.importInputs.forEach(function (input) {
      input.addEventListener('change', function () {
        var kind = input.getAttribute('data-file-input');
        handleImportFiles(kind, input.files);
        input.value = '';
      });
    });

    if (refs.builtinList) {
      refs.builtinList.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('[data-insert-builtin]') : null;
        if (button) insertBuiltinBlock(button.getAttribute('data-insert-builtin'));
      });
    }
    if (refs.componentList) {
      refs.componentList.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('[data-insert-component]') : null;
        if (button) insertComponent(button.getAttribute('data-insert-component'));
      });
    }
    if (refs.templateList) {
      refs.templateList.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('[data-apply-template]') : null;
        if (button) applyTemplate(button.getAttribute('data-apply-template'));
      });
    }

    /* 拖到画布外时不要触发浏览器「打开文件」，导入只认三个放置区。 */
    document.addEventListener('dragover', function (event) {
      if (event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1) {
        event.preventDefault();
      }
    });
    document.addEventListener('drop', function (event) {
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
        event.preventDefault();
      }
    });
  }

  function parsePath(value) {
    if (!value) return null;
    return String(value).split('.').map(function (part) { return Number(part); });
  }

  function clearDropMarks() {
    var items = refs.layerTree.querySelectorAll('.lc-tree-item[data-drop]');
    for (var i = 0; i < items.length; i += 1) items[i].removeAttribute('data-drop');
  }

  /* 图层树拖拽：撤销/重渲染/ESC 都要能清掉占位与内联样式。 */
  function cancelLayerDrag() {
    var rows = refs.layerTree.querySelectorAll('.lc-tree-item');
    for (var i = 0; i < rows.length; i += 1) rows[i].style.opacity = '';
    state.dragging = null;
    clearDropMarks();
    stopLayerAutoScroll();
  }

  var layerAuto = { raf: 0, x: 0, y: 0, active: false, host: null };

  function layerScrollHost() {
    var node = refs.layerTree;
    while (node && node !== document.body && node !== document.documentElement) {
      var style = getComputedStyle(node);
      var canY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
      if (canY) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function stopLayerAutoScroll() {
    if (layerAuto.raf) cancelAnimationFrame(layerAuto.raf);
    layerAuto.raf = 0;
    layerAuto.active = false;
  }

  function dropPositionAt(clientY, item) {
    var rect = item.getBoundingClientRect();
    var ratio = rect.height ? (clientY - rect.top) / rect.height : 0.5;
    var path = parsePath(item.getAttribute('data-path'));
    var block = path ? blockAtPath(path) : null;
    var isContainer = block && block.type === 'container';
    if (isContainer) {
      if (ratio < 0.3) return 'before';
      if (ratio > 0.7) return 'after';
      return 'inside';
    }
    return ratio < 0.5 ? 'before' : 'after';
  }

  function dropPosition(event, item) {
    return dropPositionAt(event.clientY, item);
  }

  /* 自动滚动后重新命中指针下的图层行，保证指示线跟着滚动更新。 */
  function refreshLayerDrop() {
    if (!state.dragging) return;
    var target = document.elementFromPoint(layerAuto.x, layerAuto.y);
    var item = target && target.closest ? target.closest('.lc-tree-item') : null;
    clearDropMarks();
    if (item) item.setAttribute('data-drop', dropPositionAt(layerAuto.y, item));
  }

  function layerAutoScrollTick() {
    if (!layerAuto.active) return;
    var host = layerAuto.host || layerScrollHost();
    var docHost = host === (document.scrollingElement || document.documentElement);
    var rect = docHost
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : host.getBoundingClientRect();
    var band = 72;
    var maxSpeed = 22;
    var vy = 0;
    var vx = 0;
    var top = layerAuto.y - rect.top;
    var bottom = rect.bottom - layerAuto.y;
    var left = layerAuto.x - rect.left;
    var right = rect.right - layerAuto.x;
    if (top >= 0 && top < band) vy = -Math.ceil((band - top) / band * maxSpeed);
    else if (bottom >= 0 && bottom < band) vy = Math.ceil((band - bottom) / band * maxSpeed);
    if (left >= 0 && left < band) vx = -Math.ceil((band - left) / band * maxSpeed);
    else if (right >= 0 && right < band) vx = Math.ceil((band - right) / band * maxSpeed);
    if (vx || vy) {
      if (docHost) window.scrollBy(vx, vy);
      else {
        if (vx) host.scrollLeft += vx;
        if (vy) host.scrollTop += vy;
      }
      refreshLayerDrop();
    }
    layerAuto.raf = requestAnimationFrame(layerAutoScrollTick);
  }

  function updateLayerAutoScroll(event) {
    layerAuto.x = event.clientX;
    layerAuto.y = event.clientY;
    layerAuto.host = layerScrollHost();
    layerAuto.active = true;
    if (!layerAuto.raf) layerAuto.raf = requestAnimationFrame(layerAutoScrollTick);
  }

  function bindLayerTreeEvents() {
    refs.layerTree.addEventListener('click', function (event) {
      var toggle = event.target.closest ? event.target.closest('[data-collapse-id]') : null;
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        var toggleId = toggle.getAttribute('data-collapse-id');
        if (toggleId) {
          if (state.collapsed[toggleId]) delete state.collapsed[toggleId];
          else state.collapsed[toggleId] = true;
          saveCollapsed();
          renderLayerTree();
        }
        return;
      }
      var item = event.target.closest ? event.target.closest('.lc-tree-item') : null;
      if (!item) return;
      var path = parsePath(item.getAttribute('data-path'));
      if (path) selectBlock(path);
    });

    refs.layerTree.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      var rows = Array.prototype.slice.call(refs.layerTree.querySelectorAll('.lc-tree-item'));
      if (!rows.length) return;
      var active = refs.layerTree.querySelector('.lc-tree-item.is-active');
      var index = rows.indexOf(active);
      var next = event.key === 'ArrowDown' ? index + 1 : index - 1;
      if (index === -1) next = 0;
      if (next < 0) next = 0;
      if (next >= rows.length) next = rows.length - 1;
      event.preventDefault();
      var nextPath = parsePath(rows[next].getAttribute('data-path'));
      if (nextPath) selectBlock(nextPath);
      /* 选中会重绘图层树，旧 rows 已失效；按新渲染的选中行恢复键盘焦点。 */
      var activeRow = refs.layerTree.querySelector('.lc-tree-item.is-active');
      if (activeRow) activeRow.focus();
    });

    refs.layerTree.addEventListener('dragstart', function (event) {
      var item = event.target.closest ? event.target.closest('.lc-tree-item') : null;
      if (!item) return;
      var path = parsePath(item.getAttribute('data-path'));
      var block = path ? blockAtPath(path) : null;
      if (!block) return;
      state.dragging = block.id;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', block.id);
      }
      item.style.opacity = '0.55';
    });

    refs.layerTree.addEventListener('dragend', function (event) {
      var item = event.target.closest ? event.target.closest('.lc-tree-item') : null;
      if (item) item.style.opacity = '';
      cancelLayerDrag();
    });

    refs.layerTree.addEventListener('dragover', function (event) {
      var item = event.target.closest ? event.target.closest('.lc-tree-item') : null;
      if (!item || !state.dragging) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      updateLayerAutoScroll(event);
      clearDropMarks();
      item.setAttribute('data-drop', dropPosition(event, item));
    });

    refs.layerTree.addEventListener('dragleave', function (event) {
      var item = event.target.closest ? event.target.closest('.lc-tree-item') : null;
      if (item && !item.contains(event.relatedTarget)) item.removeAttribute('data-drop');
      if (!event.relatedTarget) stopLayerAutoScroll();
    });

    refs.layerTree.addEventListener('drop', function (event) {
      var item = event.target.closest ? event.target.closest('.lc-tree-item') : null;
      if (!item) return;
      event.preventDefault();
      var position = item.getAttribute('data-drop') || dropPosition(event, item);
      var fromId = state.dragging || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
      var targetPath = parsePath(item.getAttribute('data-path'));
      var target = targetPath ? blockAtPath(targetPath) : null;
      cancelLayerDrag();
      if (fromId && target) moveBlock(fromId, target.id, position);
    });
  }

  /* ---------------- 属性面板 ---------------- */

  function schemaFor(block) {
    if (!block) return null;
    if (block.type === 'component') {
      return state.componentSchemaById[block.componentId] || null;
    }
    return state.schemaByType[block.type] || null;
  }

  function schemaName(block) {
    var schema = schemaFor(block);
    return (schema && schema.name) || block.type || '区块';
  }

  function componentInfo(id) {
    if (!state.info || !state.info.components) return null;
    for (var i = 0; i < state.info.components.length; i += 1) {
      if (state.info.components[i].id === id) return state.info.components[i];
    }
    return null;
  }

  /* 事件绑定的目标组件候选：当前页面里除自己以外的所有区块。 */
  function bindingTargetOptions(currentBlock) {
    var options = [{ value: '', label: '不指定（脚本自行处理）' }];
    walkBlocks(state.page ? activeBlocks() : [], [], function (block) {
      if (!block || !block.id || (currentBlock && block.id === currentBlock.id)) return;
      options.push({
        value: block.id,
        label: schemaName(block) + ' · ' + block.id
      });
    });
    return options;
  }

  function bindingSummary(item) {
    var where = item.target ? ' → ' + item.target : '';
    return item.event.toUpperCase() + ' → ' + item.method + ' ' + item.route + where +
      ' · ' + (item.handler === 'custom' ? '脚本处理' : '自动写入');
  }

  function storeOf(block, schema) {
    if (!schema) return block;
    if (schema.store === 'props') {
      if (!block.props || typeof block.props !== 'object') block.props = {};
      return block.props;
    }
    if (schema.store === 'fields') {
      if (!block.fields || typeof block.fields !== 'object') block.fields = {};
      return block.fields;
    }
    return block;
  }

  function readField(store, spec, key) {
    var value = store[key];
    if (value === undefined || value === null) value = spec && spec.default;
    if (value === undefined) value = '';
    return value;
  }

  function setByPath(target, path, value) {
    var parts = String(path).split('.');
    var cursor = target;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  }

  function getByPath(target, path) {
    var cursor = target;
    var parts = String(path).split('.');
    for (var i = 0; i < parts.length; i += 1) {
      if (!cursor || typeof cursor !== 'object') return undefined;
      cursor = cursor[parts[i]];
    }
    return cursor;
  }

  /* 按字段语义给宽度：数字/开关/枚举不铺满整行，文本与代码保持整行。 */
  function fieldClass(spec) {
    var type = spec.type || 'string';
    if (type === 'number') return 'lc-field is-short';
    if (type === 'boolean' || type === 'enum') return 'lc-field is-medium';
    return 'lc-field';
  }

  function fieldHtml(spec, key, value, path) {
    var label = spec.label || key;
    var common = ' data-field="1" data-field-path="' + esc(path) + '" data-field-type="' + esc(spec.type || 'string') + '"';
    var input;
    if (spec.type === 'text' || spec.type === 'code') {
      input = '<textarea class="lc-textarea' + (spec.type === 'code' ? ' lc-builder-code' : '') + '" rows="' + (spec.rows || (spec.type === 'code' ? 6 : 4)) + '"' + common + '>' + esc(value) + '</textarea>';
    } else if (spec.type === 'json' || spec.type === 'array' || spec.type === 'object') {
      input = '<textarea class="lc-textarea lc-builder-code" rows="5" spellcheck="false"' + common + '>' + esc(JSON.stringify(value, null, 2)) + '</textarea>';
    } else if (spec.type === 'number') {
      input = '<input class="lc-input" type="number"' + common +
        (spec.min != null ? ' min="' + spec.min + '"' : '') +
        (spec.max != null ? ' max="' + spec.max + '"' : '') +
        ' value="' + esc(value) + '">';
    } else if (spec.type === 'boolean') {
      return '<div class="' + fieldClass(spec) + '"><label class="lc-label"><span>' + esc(label) + '</span>' +
        '<input type="checkbox"' + common + ' ' + (value ? 'checked' : '') + '></label></div>';
    } else if (spec.type === 'enum') {
      var options = (spec.options || []).map(function (option) {
        var optionValue = option && typeof option === 'object' ? option.value : option;
        var optionLabel = option && typeof option === 'object' ? (option.label || option.value) : option;
        return '<option value="' + esc(optionValue) + '"' + (String(value) === String(optionValue) ? ' selected' : '') + '>' + esc(optionLabel) + '</option>';
      }).join('');
      input = '<select class="lc-select"' + common + '>' + options + '</select>';
    } else {
      input = '<input class="lc-input" type="text"' + common + ' value="' + esc(value) + '">';
    }
    return '<div class="' + fieldClass(spec) + '"><label class="lc-label"><span>' + esc(label) + '</span>' +
      (spec.hint || spec.description ? '<small>' + esc(spec.hint || spec.description) + '</small>' : '') + '</label>' + input + '</div>';
  }

  function pageApiRows(page) {
    var list = Array.isArray(page.apiOverrides) ? page.apiOverrides : [];
    var latest = {};
    list.forEach(function (item) {
      var key = (item.method || 'GET').toUpperCase() + ' ' + (item.path || '');
      var prev = latest[key];
      if (!prev || String(item.updatedAt || '') >= String(prev.updatedAt || '')) latest[key] = item;
    });
    return list.map(function (item) {
      var key = (item.method || 'GET').toUpperCase() + ' ' + (item.path || '');
      var effective = latest[key] === item;
      return '<div class="lc-resource-item" style="padding:4px 6px;">' +
        '<button class="lc-code-file" type="button" data-api-select="' + esc(item.id) + '">' +
        '<code>' + esc(key) + '</code></button>' +
        '<span class="lc-badge ' + (effective ? 'lc-badge-success' : '') + '">' + (effective ? '生效' : '被覆盖') + '</span>' +
        '<button class="lc-btn lc-btn-sm lc-btn-ghost" type="button" data-api-remove="' + esc(item.id) + '">删除</button>' +
        '</div>';
    }).join('');
  }

  function renderInspector() {
    destroyAllEditors();
    var block = selectedBlock();
    if (!state.page) {
      refs.inspectorTitle.textContent = '页面属性';
      refs.inspectorSub.textContent = '没有打开页面';
      refs.inspector.innerHTML = '<p class="lc-inspector-hint">先从左侧选择页面。</p>';
      return;
    }
    if (!block) {
      refs.inspectorTitle.textContent = '页面属性';
      refs.inspectorSub.textContent = '改页面地址、标题和布局；选中区块后切成区块字段。';
      var page = state.page;
      var layoutMode = (page.layout && page.layout.mode) || 'flow';
      refs.inspector.innerHTML =
        '<p class="lc-inspector-hint">当前页 <code>' + esc(page.id) + '</code>，' + esc(countBlocks()) + ' 个区块。</p>' +
        '<div class="lc-field"><label class="lc-label" for="lc-page-field-title"><span>页面标题</span></label>' +
        '<input class="lc-input" id="lc-page-field-title" data-page-field="title" data-field-type="string" value="' + esc(page.title || '') + '"></div>' +
        '<div class="lc-field is-medium"><label class="lc-label" for="lc-page-field-slug"><span>页面别名</span><small>Slug</small></label>' +
        '<input class="lc-input" id="lc-page-field-slug" aria-describedby="lc-page-field-slug-hint" data-page-field="slug" data-field-type="string" value="' + esc(page.slug || '') + '">' +
        '<p class="lc-hint" id="lc-page-field-slug-hint">用于生成 pages/别名.json 与页面地址；留空按标题自动生成。</p></div>' +
        '<div class="lc-field"><label class="lc-label" for="lc-page-field-path"><span>输出路径</span><small>相对站点根</small></label>' +
        '<input class="lc-input" id="lc-page-field-path" data-page-field="path" data-field-type="string" value="' + esc(page.path || '') + '"></div>' +
        '<div class="lc-field"><label class="lc-label" for="lc-page-field-nav"><span>显示在导航</span></label>' +
        '<input type="checkbox" id="lc-page-field-nav" data-page-field="nav" data-field-type="boolean" ' + (page.nav !== false ? 'checked' : '') + '></div>' +
        '<div class="lc-panel" style="margin: var(--lc-space-3) 0;">' +
        '<div class="lc-panel-title">双端独立 UI</div>' +
        '<div class="lc-field"><label class="lc-label" style="display:flex;align-items:center;gap:var(--lc-space-2);"><span>桌面 / 移动分开编辑</span>' +
        '<input type="checkbox" data-page-independent-ui ' + (page.independentUi === true ? 'checked' : '') + '></label>' +
        '<p class="lc-hint">关闭：两端共用一套区块，按 900px 断点响应式。开启：本页存两份区块树，桌面端（≥901px）与移动端（≤900px）互不影响。</p></div>' +
        (page.independentUi === true ? (
          '<div class="lc-field"><label class="lc-label"><span>当前编辑端</span><small>切端会切画布宽度</small></label>' +
          '<div style="display:flex;gap:var(--lc-space-2);">' +
          '<button class="lc-btn lc-btn-sm' + (state.uiEnd !== 'mobile' ? ' lc-btn-primary' : '') + '" type="button" data-ui-end-btn="desktop" aria-pressed="' + (state.uiEnd !== 'mobile' ? 'true' : 'false') + '">桌面端</button>' +
          '<button class="lc-btn lc-btn-sm' + (state.uiEnd === 'mobile' ? ' lc-btn-primary' : '') + '" type="button" data-ui-end-btn="mobile" aria-pressed="' + (state.uiEnd === 'mobile' ? 'true' : 'false') + '">移动端</button>' +
          '</div>' +
          '<p class="lc-hint">正在编辑' + (state.uiEnd === 'mobile' ? '移动端' : '桌面端') + '；另一端的区块、顺序、属性都不会被改动。</p></div>' +
          '<div class="lc-field"><button class="lc-btn lc-btn-sm" type="button" data-ui-copy>把' + (state.uiEnd === 'mobile' ? '移动端' : '桌面端') + '布局复制到另一端</button>' +
          '<p class="lc-hint">复制会覆盖另一端现有布局，操作前会二次确认；区块 id 会重新生成，避免两端冲突。</p></div>'
        ) : '') +
        '</div>' +
        '<div class="lc-field"><label class="lc-label" for="lc-page-field-layout"><span>页面布局</span></label>' +
        '<select class="lc-select" id="lc-page-field-layout" data-page-field="layout.mode" data-field-type="string">' +
        '<option value="flow"' + (layoutMode === 'flow' ? ' selected' : '') + '>流式</option>' +
        '<option value="free"' + (layoutMode === 'free' ? ' selected' : '') + '>自由定位</option>' +
        '</select><p class="lc-hint">自由定位时，页面根容器里的区块用 pos.left/top 摆放。</p></div>' +
        '<div class="lc-field is-medium"><label class="lc-label" for="lc-page-size-width"><span>最大宽度</span><small>px / vw / % / rem</small></label>' +
        '<input class="lc-input" id="lc-page-size-width" aria-describedby="lc-size-error-width" data-page-field="size.maxWidth" data-field-type="string" data-size-unit="width" placeholder="留空不限" value="' + esc((page.size && page.size.maxWidth) || '') + '">' +
        '<p class="lc-error" id="lc-size-error-width" data-size-error hidden></p></div>' +
        '<div class="lc-field is-medium"><label class="lc-label" for="lc-page-size-height"><span>最大高度</span><small>px / vh / % / rem</small></label>' +
        '<input class="lc-input" id="lc-page-size-height" aria-describedby="lc-size-error-height" data-page-field="size.maxHeight" data-field-type="string" data-size-unit="height" placeholder="留空不限" value="' + esc((page.size && page.size.maxHeight) || '') + '">' +
        '<p class="lc-error" id="lc-size-error-height" data-size-error hidden></p></div>' +
        '<p class="lc-hint">限高后超出的内容在页面内部滚动（overflow:auto）；预览与导出使用同一套渲染规则。</p>' +
        '<div class="lc-panel" style="margin-top: var(--lc-space-3);">' +
        '<div class="lc-panel-title">页面级代码覆盖</div>' +
        '<div class="lc-code-tabs">' +
        ['html', 'css', 'js'].map(function (name) {
          return '<button class="lc-btn lc-btn-sm' + (state.pageCodeTab === name ? ' lc-btn-primary' : '') + '" type="button" data-page-code-tab="' + name + '">' + name.toUpperCase() + '</button>';
        }).join('') +
        '</div>' +
        '<div class="lc-code-open is-tight" data-page-code-editor></div>' +
        '<div style="display:flex;align-items:center;gap:var(--lc-space-2);margin-top:var(--lc-space-2);">' +
        '<button class="lc-btn lc-btn-sm" type="button" data-page-check>检查这一段</button>' +
        '<span class="lc-check-hint">HTML 追加到页面末尾；CSS 只作用域当前页；JS 随页面脚本执行。</span></div>' +
        '<div class="lc-code-result" data-page-code-result></div>' +
        '<p class="lc-hint">页面级覆盖随页面 JSON 保存，重新生成不会清掉。</p></div>' +
        '<div class="lc-panel" style="margin-top: var(--lc-space-3);">' +
        '<div class="lc-panel-title">页面级接口覆盖</div>' +
        '<p class="lc-hint">只在这个页面生效，先于站点后端与模板默认实现。同一 METHOD + 路径只保留最新一段，其余标记「被覆盖」。</p>' +
        '<div class="lc-resource-list" data-api-list>' + (pageApiRows(page) || '<p class="lc-hint">还没有接口覆盖。</p>') + '</div>' +
        '<div style="display:flex;gap:var(--lc-space-2);margin-top:var(--lc-space-2);">' +
        '<select class="lc-select" data-api-method aria-label="接口方法" style="max-width:100px;"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>' +
        '<input class="lc-input" data-api-path aria-label="接口路径" placeholder="/api/items" style="flex:1;min-width:0;">' +
        '<button class="lc-btn lc-btn-sm" type="button" data-api-add>添加</button></div>' +
        (state.apiActive ? (
          '<div style="margin-top:var(--lc-space-2);">' +
          '<code class="lc-check-hint">' + esc(state.apiActive) + '</code>' +
          '<div class="lc-code-open is-tight" data-api-editor style="margin-top:var(--lc-space-1);"></div>' +
          '<div style="display:flex;gap:var(--lc-space-2);margin-top:var(--lc-space-2);">' +
          '<button class="lc-btn lc-btn-sm" type="button" data-api-check>检查这一段</button>' +
          '<button class="lc-btn lc-btn-sm lc-btn-ghost" type="button" data-api-remove-active>删除这段</button></div>' +
          '<div class="lc-code-result" data-api-code-result></div>' +
          '<p class="lc-hint">代码是拦截器主体，入参 <code>request</code>（url/method/pathname）与 <code>context</code>（page/entry/originalFetch），返回值当作 Response。</p></div>'
        ) : '') +
        '</div>';
      var pageEditorHost = refs.inspector.querySelector('[data-page-code-editor]');
      mountEditor('page-code', pageEditorHost, {
        language: codeLanguageFor(state.pageCodeTab),
        value: (page.overrides && page.overrides[state.pageCodeTab]) || '',
        tabSize: 2,
        onChange: function (value) {
          state.page.overrides = state.page.overrides || {};
          state.page.overrides[state.pageCodeTab] = String(value);
          markDirty();
          scheduleRender();
          scheduleSave();
        },
        onSave: function () { saveNow(); }
      });
      if (state.apiActive) {
        var api = pageApiFind(state.apiActive);
        if (api) {
          mountEditor('api-code', refs.inspector.querySelector('[data-api-editor]'), {
            language: 'javascript',
            value: api.code || '',
            tabSize: 2,
            onChange: function (value) {
              api.code = String(value);
              api.updatedAt = new Date().toISOString();
              markDirty();
              scheduleRender();
              scheduleSave();
            },
            onSave: function () { saveNow(); }
          });
        }
      }
      return;
    }

    var schema = schemaFor(block);
    var store = storeOf(block, schema);
    var fields = '';
    if (schema && schema.props) {
      Object.keys(schema.props).forEach(function (key) {
        fields += fieldHtml(schema.props[key], key, readField(store, schema.props[key], key), key);
      });
    } else {
      fields = '<p class="lc-hint">这个区块类型没有声明 schema，只能在代码覆盖里直接改数据。</p>';
    }

    var freeHint = '';
    if (isFreeChild()) {
      freeHint = '<p class="lc-hint">父容器是自由定位：直接在画布上拖区块移动，拖右下角小方块改尺寸。</p>';
    }

    var overrides = '';
    var dataOverride = null;
    var isComponentBlock = block.type === 'component';
    var canOverrideCode = isComponentBlock || /^ui-/.test(block.type);
    if (canOverrideCode) {
      var tab = state.codeTab;
      var overridesValue = block.overrides || {};
      var hasCodeOverride = ['html', 'css', 'js'].some(function (name) {
        return typeof overridesValue[name] === 'string' && overridesValue[name].trim();
      });
      if (isComponentBlock) dataOverride = overridesValue.data || {};
      var componentDefault = isComponentBlock ? componentInfo(block.componentId) : null;
      var canSeedDefault = componentDefault && String(componentDefault[tab] || '').trim();
      overrides =
        '<div class="lc-panel" style="margin-top: var(--lc-space-3);">' +
        '<div class="lc-panel-title">实例级代码覆盖' +
        '<span class="lc-badge lc-badge-info" data-instance-badge' + (hasCodeOverride ? '' : ' hidden') + '>已覆盖</span></div>' +
        '<div class="lc-code-tabs">' +
        ['html', 'css', 'js'].map(function (name) {
          return '<button class="lc-btn lc-btn-sm' + (tab === name ? ' lc-btn-primary' : '') + '" type="button" data-code-tab="' + name + '">' + name.toUpperCase() + '</button>';
        }).join('') +
        '</div>' +
        '<div class="lc-code-open" data-instance-code-editor></div>' +
        '<div style="display:flex;align-items:center;gap:var(--lc-space-2);margin-top:var(--lc-space-2);flex-wrap:wrap;">' +
        '<button class="lc-btn lc-btn-sm" type="button" data-instance-check>检查这一段</button>' +
        (canSeedDefault ? '<button class="lc-btn lc-btn-sm" type="button" data-instance-default>载入组件默认</button>' : '') +
        '<button class="lc-btn lc-btn-sm lc-btn-ghost" type="button" data-instance-reset' + (hasCodeOverride ? '' : ' hidden') + '>恢复默认</button>' +
        '</div>' +
        '<div class="lc-code-result" data-instance-code-result></div>' +
        '<p class="lc-hint">' + (isComponentBlock
          ? 'HTML 整段替换组件模板，CSS / JS 追加并限定在这个实例；内置组件也能直接覆盖，不必另存副本。'
          : '内置组件留空时按默认渲染；HTML 非空会整段替换默认结构，CSS / JS 追加并限定在这个实例。') +
        '覆盖内容随页面 JSON 保存，重新生成与导出都不会丢。</p></div>' +
        (isComponentBlock ? (
          '<div class="lc-panel" style="margin-top: var(--lc-space-3);">' +
          '<div class="lc-panel-title">实例数据来源</div>' +
          '<div class="lc-field"><label class="lc-label"><span>模式</span></label>' +
          '<select class="lc-select" data-data-mode>' +
          '<option value="inherit"' + ((dataOverride.mode || 'inherit') !== 'custom' ? ' selected' : '') + '>跟随组件/数据源默认</option>' +
          '<option value="custom"' + (dataOverride.mode === 'custom' ? ' selected' : '') + '>这个实例自己拉取</option>' +
          '</select></div>' +
          (dataOverride.mode === 'custom' ? (
            '<div class="lc-field"><label class="lc-label"><span>地址</span></label>' +
            '<input class="lc-input" data-data-url value="' + esc(dataOverride.url || '') + '" placeholder="/api/items"></div>' +
            '<div class="lc-field"><label class="lc-label"><span>方法</span></label>' +
            '<select class="lc-select" data-data-method>' +
            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(function (method) {
              return '<option value="' + method + '"' + ((dataOverride.method || 'GET') === method ? ' selected' : '') + '>' + method + '</option>';
            }).join('') +
            '</select></div>' +
            '<div class="lc-field"><label class="lc-label"><span>处理逻辑</span><small>入参 (payload, root)，返回值作为实例数据</small></label>' +
            '<div class="lc-code-open is-tight" data-instance-transform-editor></div></div>' +
            '<p class="lc-hint">数据到达后派发 <code>lc:instance-data</code>，可用 <code>data-lc-data-state</code> 观察 loading / ready / error。浏览器端优先于站点后端默认实现。</p>'
          ) : '<p class="lc-hint">跟随默认时，这个实例的数据与站点默认一致。</p>') +
          '</div>'
        ) : '');
    }

    /* 事件绑定：选事件、后端积木接口、返回值处理方式；配置存进区块本身。 */
    var bindings = Array.isArray(block.bindings) ? block.bindings : [];
    var draft = state.bindingDraft;
    var targetOptions = bindingTargetOptions(block);
    var bindingsPanel =
      '<div class="lc-panel" style="margin-top: var(--lc-space-3);">' +
      '<div class="lc-panel-title">事件绑定' +
      (bindings.length ? '<span class="lc-badge lc-badge-info">已绑定 ' + bindings.length + ' 个事件</span>' : '') +
      '</div>' +
      (bindings.length
        ? '<div class="lc-binding-list">' + bindings.map(function (item, index) {
          return '<div class="lc-binding-item"><code>' + esc(bindingSummary(item)) + '</code>' +
            '<button class="lc-btn lc-btn-xs lc-btn-ghost" type="button" data-binding-remove="' + index + '">解绑</button></div>';
        }).join('') + '</div>'
        : '<p class="lc-hint">还没有绑定事件。选一个事件和后端积木接口，再决定返回值怎么处理。</p>') +
      '<datalist id="lc-binding-routes">' + state.backendRoutes.map(function (route) {
        return '<option value="' + esc(route.path) + '">' + esc(route.method + ' ' + route.path) + '</option>';
      }).join('') + '</datalist>' +
      '<div class="lc-binding-form">' +
      '<div class="lc-binding-row">' +
      '<label class="lc-field"><span class="lc-label">事件</span><select class="lc-select" data-binding-draft="event">' +
      ['click', 'submit', 'change', 'input', 'dblclick', 'keydown', 'keyup', 'focus', 'blur'].map(function (name) {
        return '<option value="' + name + '"' + (draft.event === name ? ' selected' : '') + '>' + name + '</option>';
      }).join('') + '</select></label>' +
      '<label class="lc-field"><span class="lc-label">方法</span><select class="lc-select" data-binding-draft="method">' +
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(function (method) {
        return '<option value="' + method + '"' + (draft.method === method ? ' selected' : '') + '>' + method + '</option>';
      }).join('') + '</select></label></div>' +
      '<label class="lc-field"><span class="lc-label">后端积木接口<small>可从下拉选，也可手填路径</small></span>' +
      '<input class="lc-input" data-binding-draft="route" list="lc-binding-routes" value="' + esc(draft.route) + '" placeholder="/api/items"></label>' +
      '<label class="lc-field"><span class="lc-label">返回处理</span><select class="lc-select" data-binding-draft="handler">' +
      '<option value="auto"' + (draft.handler === 'auto' ? ' selected' : '') + '>自动写进指定组件</option>' +
      '<option value="custom"' + (draft.handler === 'custom' ? ' selected' : '') + '>交给脚本处理</option>' +
      '</select></label>' +
      (draft.handler === 'auto'
        ? '<label class="lc-field"><span class="lc-label">目标组件<small>数组→表格行，数值→KPI/统计，文本→文本组件</small></span>' +
          '<select class="lc-select" data-binding-draft="target">' + targetOptions.map(function (item) {
            return '<option value="' + esc(item.value) + '"' + (draft.target === item.value ? ' selected' : '') + '>' + esc(item.label) + '</option>';
          }).join('') + '</select></label>'
        : '<label class="lc-field"><span class="lc-label">处理脚本<small>参数：payload、data、event、root、target</small></span>' +
          '<textarea class="lc-input lc-binding-script" data-binding-draft="script" rows="5" spellcheck="false" placeholder="// data 是接口返回的数据&#10;if (target) target.textContent = data.total;">' + esc(draft.script) + '</textarea></label>') +
      '<div style="display:flex;justify-content:flex-end;">' +
      '<button class="lc-btn lc-btn-sm lc-btn-primary" type="button" data-binding-add>添加绑定</button></div>' +
      '</div></div>';

    refs.inspectorTitle.textContent = schemaName(block);
    refs.inspectorSub.textContent = block.type + ' · ' + block.id;
    refs.inspector.innerHTML =
      '<p class="lc-inspector-hint">' + esc(blockLabel(block)) + '</p>' +
      freeHint +
      '<div class="lc-panel"><div class="lc-panel-title">内容与样式</div>' + fields + '</div>' +
      '<div class="lc-panel"><div class="lc-panel-title">显示</div>' +
      '<div class="lc-field"><label class="lc-label"><span>区块可见</span></label>' +
      '<input type="checkbox" data-block-field="visible" data-field-type="boolean" ' + (block.visible !== false ? 'checked' : '') + '></label></div>' +
      '<div class="lc-field"><label class="lc-label"><span>区块 ID</span><small>只读</small></label>' +
      '<input class="lc-input" value="' + esc(block.id) + '" readonly></div></div>' +
      overrides +
      bindingsPanel +
      '<div class="lc-panel"><div class="lc-panel-title">操作</div>' +
      '<div style="display:flex;gap:var(--lc-space-2);flex-wrap:wrap;">' +
      '<button class="lc-btn lc-btn-sm" type="button" data-block-action="duplicate">复制一份</button>' +
      '<button class="lc-btn lc-btn-sm" type="button" data-block-action="copy">复制</button>' +
      '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-block-action="delete">删除</button>' +
      '</div></div>';

    if (block.type === 'component' || /^ui-/.test(block.type)) {
      var current = selectedBlock();
      if (current) {
        mountEditor('instance-code', refs.inspector.querySelector('[data-instance-code-editor]'), {
          language: codeLanguageFor(state.codeTab),
          value: (current.overrides && current.overrides[state.codeTab]) || '',
          tabSize: 2,
          onChange: function (value) {
            current.overrides = current.overrides || {};
            current.overrides[state.codeTab] = String(value);
            /* 徽标与「恢复默认」跟着输入实时切换：有任意非空覆盖即视为已覆盖。 */
            var hasOverride = ['html', 'css', 'js'].some(function (name) {
              return typeof current.overrides[name] === 'string' && current.overrides[name].trim() !== '';
            });
            var liveBadge = refs.inspector.querySelector('[data-instance-badge]');
            var liveReset = refs.inspector.querySelector('[data-instance-reset]');
            if (liveBadge) liveBadge.hidden = !hasOverride;
            if (liveReset) liveReset.hidden = !hasOverride;
            markDirty();
            scheduleRender();
            scheduleSave();
          },
          onSave: function () { saveNow(); }
        });
        var data = current.overrides && current.overrides.data;
        if (data && data.mode === 'custom') {
          mountEditor('instance-transform', refs.inspector.querySelector('[data-instance-transform-editor]'), {
            language: 'javascript',
            value: data.transform || '',
            tabSize: 2,
            onChange: function (value) {
              var target = selectedBlock();
              if (!target || !target.overrides || !target.overrides.data) return;
              target.overrides.data.transform = String(value);
              markDirty();
              scheduleRender();
              scheduleSave();
            },
            onSave: function () { saveNow(); }
          });
        }
      }
    }
  }

  function pageApiFind(id) {
    var page = state.page;
    if (!page || !Array.isArray(page.apiOverrides)) return null;
    for (var i = 0; i < page.apiOverrides.length; i += 1) {
      if (page.apiOverrides[i] && page.apiOverrides[i].id === id) return page.apiOverrides[i];
    }
    return null;
  }

  function inspectorControlValue(control, type) {
    if (type === 'boolean') return !!control.checked;
    if (type === 'number') {
      var number = Number(control.value);
      return isFinite(number) ? number : 0;
    }
    if (type === 'json') {
      try { return JSON.parse(control.value); } catch (error) { return null; }
    }
    return control.value;
  }

  function applyInspectorField(control, commitNow) {
    var type = control.getAttribute('data-field-type') || 'string';
    var value = inspectorControlValue(control, type);
    if (type === 'json' && value === null) {
      setStatus('JSON 格式不合法，本次没有写入。', 'error');
      return;
    }
    /* 页面尺寸只接受 数字 + px/vh/vw/%/rem；非法值不写入，只在字段下方提示。 */
    if (control.hasAttribute('data-size-unit')) {
      var rawSize = String(value == null ? '' : value).trim();
      var sizeOk = rawSize === '' || /^\d+(?:\.\d+)?(?:px|vh|vw|%|rem)$/.test(rawSize);
      control.classList.toggle('is-invalid', !sizeOk);
      control.setAttribute('aria-invalid', sizeOk ? 'false' : 'true');
      var sizeError = control.parentElement.querySelector('[data-size-error]');
      if (sizeError) {
        sizeError.hidden = sizeOk;
        sizeError.textContent = '格式不正确：只接受数字 + px / vh / vw / % / rem，例如 720px；留空表示不限。';
      }
      if (!sizeOk) {
        setStatus('页面尺寸格式不正确，本次没有写入。', 'error');
        return;
      }
    }
    var fieldPath = control.getAttribute('data-field-path');
    var blockField = control.getAttribute('data-block-field');
    var override = control.getAttribute('data-override');
    var pageField = control.getAttribute('data-page-field');

    if (pageField) {
      if (!state.page) return;
      setByPath(state.page, pageField, value);
    } else if (blockField) {
      var block = selectedBlock();
      if (!block) return;
      block[blockField] = value;
    } else if (override) {
      var block2 = selectedBlock();
      if (!block2) return;
      block2.overrides = block2.overrides || {};
      block2.overrides[override] = String(value);
    } else if (fieldPath) {
      var block3 = selectedBlock();
      if (!block3) return;
      var schema = schemaFor(block3);
      var store = storeOf(block3, schema);
      setByPath(store, fieldPath, value);
    } else {
      return;
    }

    markDirty();
    if (commitNow) {
      pushHistory();
      renderLayerTree();
      updatePageChrome();
      storeDraft();
    }
    scheduleRender();
    scheduleSave();
  }

  function applyDataOverride(control, commitNow) {
    var block = selectedBlock();
    if (!block) return;
    block.overrides = block.overrides || {};
    var data = block.overrides.data || {};
    if (!data.mode) data.mode = 'inherit';
    if (control.hasAttribute('data-data-mode')) data.mode = control.value;
    if (control.hasAttribute('data-data-url')) data.url = String(control.value || '').trim();
    if (control.hasAttribute('data-data-method')) data.method = String(control.value || 'GET').toUpperCase();
    if (data.transform == null) data.transform = null;
    block.overrides.data = data;
    markDirty();
    if (commitNow) {
      pushHistory();
      storeDraft();
      renderInspector();
    }
    scheduleRender();
    scheduleSave();
  }

  function addPageApiOverride() {
    if (!state.page) return;
    var methodSelect = refs.inspector.querySelector('[data-api-method]');
    var pathInput = refs.inspector.querySelector('[data-api-path]');
    var method = String((methodSelect && methodSelect.value) || 'GET').toUpperCase();
    var path = String((pathInput && pathInput.value) || '').trim();
    if (!path) {
      setStatus('先填接口路径，例如 /api/items。', 'error');
      return;
    }
    if (!path.startsWith('/')) path = '/' + path;
    state.page.apiOverrides = Array.isArray(state.page.apiOverrides) ? state.page.apiOverrides : [];
    state.idSerial += 1;
    var id = 'api-' + Date.now().toString(36) + '-' + state.idSerial;
    state.page.apiOverrides.push({
      id: id,
      method: method,
      path: path,
      code: 'var response = await context.originalFetch(request.url, request.init);\nreturn response;',
      note: '',
      updatedAt: new Date().toISOString()
    });
    state.apiActive = id;
    markDirty();
    pushHistory();
    storeDraft();
    renderInspector();
  }

  function resetInstanceOverrides() {
    var block = selectedBlock();
    if (!block || !block.overrides) return;
    delete block.overrides.html;
    delete block.overrides.css;
    delete block.overrides.js;
    if (!Object.keys(block.overrides).length) delete block.overrides;
    markDirty();
    pushHistory();
    storeDraft();
    renderInspector();
    scheduleRender();
    scheduleSave();
  }

  function seedInstanceDefault() {
    var block = selectedBlock();
    var info = block ? componentInfo(block.componentId) : null;
    var tab = state.codeTab;
    if (!block || !info || !String(info[tab] || '').trim()) return;
    block.overrides = block.overrides || {};
    block.overrides[tab] = String(info[tab]);
    markDirty();
    pushHistory();
    storeDraft();
    renderInspector();
    scheduleRender();
    scheduleSave();
  }

  function addBinding() {
    var block = selectedBlock();
    if (!block) return;
    var draft = state.bindingDraft;
    var route = String(draft.route || '').trim();
    if (!route) {
      setStatus('先填接口路径，例如 /api/items。', 'error');
      return;
    }
    if (draft.handler === 'auto' && !draft.target) {
      setStatus('自动处理需要先选目标组件。', 'error');
      return;
    }
    if (!route.startsWith('/')) route = '/' + route;
    block.bindings = Array.isArray(block.bindings) ? block.bindings : [];
    block.bindings.push({
      event: draft.event,
      method: draft.method,
      route: route,
      target: draft.handler === 'auto' ? draft.target : '',
      handler: draft.handler,
      script: draft.handler === 'custom' ? draft.script : ''
    });
    state.bindingDraft = { event: 'click', method: 'GET', handler: 'auto', route: '', target: '', script: '' };
    markDirty();
    pushHistory();
    storeDraft();
    renderInspector();
    scheduleRender();
    scheduleSave();
  }

  function removeBinding(index) {
    var block = selectedBlock();
    if (!block || !Array.isArray(block.bindings)) return;
    block.bindings.splice(index, 1);
    if (!block.bindings.length) delete block.bindings;
    markDirty();
    pushHistory();
    storeDraft();
    renderInspector();
    scheduleRender();
    scheduleSave();
  }

  function bindInspectorEvents() {
    refs.inspector.addEventListener('focusin', function (event) {
      var control = event.target;
      if (!control || !control.getAttribute) return;
      if (!control.hasAttribute('data-field') && !control.hasAttribute('data-page-field') &&
          !control.hasAttribute('data-block-field') && !control.hasAttribute('data-override')) return;
      state.fieldSession = { control: control, before: serialize() };
    });

    refs.inspector.addEventListener('focusout', function (event) {
      var control = event.target;
      if (!state.fieldSession || state.fieldSession.control !== control) return;
      state.fieldSession = null;
      pushHistory();
      renderLayerTree();
      updatePageChrome();
      storeDraft();
    });

    refs.inspector.addEventListener('input', function (event) {
      var control = event.target;
      if (!control || !control.hasAttribute) return;
      if (control.hasAttribute('data-binding-draft')) {
        state.bindingDraft[control.getAttribute('data-binding-draft')] = control.value;
        return;
      }
      if (control.tagName === 'SELECT' || (control.tagName === 'INPUT' && control.type === 'checkbox')) return;
      if (control.hasAttribute('data-data-url')) {
        applyDataOverride(control, false);
        return;
      }
      if (!control.hasAttribute('data-field') && !control.hasAttribute('data-page-field') &&
          !control.hasAttribute('data-block-field') && !control.hasAttribute('data-override')) return;
      applyInspectorField(control, false);
    });

    refs.inspector.addEventListener('change', function (event) {
      var control = event.target;
      if (!control || !control.hasAttribute) return;
      if (control.hasAttribute('data-binding-draft')) {
        var draftKey = control.getAttribute('data-binding-draft');
        state.bindingDraft[draftKey] = control.value;
        if (draftKey === 'handler') renderInspector();
        return;
      }
      if (control.hasAttribute('data-data-mode') || control.hasAttribute('data-data-method')) {
        applyDataOverride(control, true);
        return;
      }
      if (control.hasAttribute('data-page-independent-ui')) {
        toggleIndependentUi(!!control.checked);
        return;
      }
      if (control.tagName === 'SELECT' || (control.tagName === 'INPUT' && control.type === 'checkbox')) {
        applyInspectorField(control, true);
      }
    });

    refs.inspector.addEventListener('click', function (event) {
      var uiEndButton = event.target.closest ? event.target.closest('[data-ui-end-btn]') : null;
      if (uiEndButton) {
        setUiEnd(uiEndButton.getAttribute('data-ui-end-btn'));
        return;
      }
      if (event.target.closest && event.target.closest('[data-ui-copy]')) {
        copyCurrentEndToOther();
        return;
      }
      var tab = event.target.closest ? event.target.closest('[data-code-tab]') : null;
      if (tab) {
        state.codeTab = tab.getAttribute('data-code-tab');
        renderInspector();
        return;
      }
      var pageTab = event.target.closest ? event.target.closest('[data-page-code-tab]') : null;
      if (pageTab) {
        state.pageCodeTab = pageTab.getAttribute('data-page-code-tab');
        renderInspector();
        return;
      }
      if (event.target.closest && event.target.closest('[data-page-check]')) {
        var pageResult = refs.inspector.querySelector('[data-page-code-result]');
        checkCodeAgainst(codeLanguageFor(state.pageCodeTab),
          (state.page.overrides && state.page.overrides[state.pageCodeTab]) || '', pageResult);
        return;
      }
      if (event.target.closest && event.target.closest('[data-instance-check]')) {
        var blockNow = selectedBlock();
        if (!blockNow) return;
        var instanceResult = refs.inspector.querySelector('[data-instance-code-result]');
        checkCodeAgainst(codeLanguageFor(state.codeTab), (blockNow.overrides && blockNow.overrides[state.codeTab]) || '', instanceResult);
        return;
      }
      if (event.target.closest && event.target.closest('[data-api-add]')) {
        addPageApiOverride();
        return;
      }
      var apiSelect = event.target.closest ? event.target.closest('[data-api-select]') : null;
      if (apiSelect) {
        state.apiActive = apiSelect.getAttribute('data-api-select');
        renderInspector();
        return;
      }
      var apiRemove = event.target.closest ? event.target.closest('[data-api-remove]') : null;
      if (apiRemove) {
        var removeId = apiRemove.getAttribute('data-api-remove');
        state.page.apiOverrides = (state.page.apiOverrides || []).filter(function (item) { return item.id !== removeId; });
        if (state.apiActive === removeId) state.apiActive = '';
        markDirty();
        pushHistory();
        storeDraft();
        renderInspector();
        scheduleRender();
        scheduleSave();
        return;
      }
      if (event.target.closest && event.target.closest('[data-api-remove-active]')) {
        var activeId = state.apiActive;
        state.page.apiOverrides = (state.page.apiOverrides || []).filter(function (item) { return item.id !== activeId; });
        state.apiActive = '';
        markDirty();
        pushHistory();
        renderInspector();
        scheduleRender();
        scheduleSave();
        return;
      }
      if (event.target.closest && event.target.closest('[data-api-check]')) {
        var apiEntry = pageApiFind(state.apiActive);
        if (!apiEntry) return;
        checkCodeAgainst('javascript', apiEntry.code || '', refs.inspector.querySelector('[data-api-code-result]'));
        return;
      }
      if (event.target.closest && event.target.closest('[data-instance-reset]')) {
        resetInstanceOverrides();
        return;
      }
      if (event.target.closest && event.target.closest('[data-instance-default]')) {
        seedInstanceDefault();
        return;
      }
      if (event.target.closest && event.target.closest('[data-binding-add]')) {
        addBinding();
        return;
      }
      var bindingRemove = event.target.closest ? event.target.closest('[data-binding-remove]') : null;
      if (bindingRemove) {
        removeBinding(Number(bindingRemove.getAttribute('data-binding-remove')));
        return;
      }
      var action = event.target.closest ? event.target.closest('[data-block-action]') : null;
      if (!action) return;
      var name = action.getAttribute('data-block-action');
      if (name === 'delete') deleteSelected();
      else if (name === 'duplicate') duplicateSelected();
      else if (name === 'copy') copySelected();
    });
  }

  /* ---------------- 后端用户区代码 ---------------- */

  function backendEditorLanguage(rel) {
    var ext = String(rel || '').split('.').pop().toLowerCase();
    if (ext === 'rs') return 'rust';
    if (ext === 'go') return 'go';
    if (ext === 'json') return 'json';
    if (ext === 'md' || ext === 'sql') return 'markdown';
    return 'javascript';
  }

  function setBackendBadge(text, kind) {
    refs.backendState.textContent = text;
    refs.backendState.className = 'lc-badge' + (kind ? ' lc-badge-' + kind : '');
  }

  function renderBackendFiles() {
    var files = state.backend.files || [];
    if (!files.length) {
      refs.backendFiles.innerHTML = '<p class="lc-hint">没有可编辑的用户区文件。</p>';
      return;
    }
    refs.backendFiles.innerHTML = files.map(function (file) {
      var active = state.backend.active === file.path;
      return '<button class="lc-code-file' + (active ? ' is-active' : '') + '" type="button" data-backend-file="' + esc(file.path) + '">' +
        esc(file.path) + (file.saved ? ' <span class="lc-badge">已覆盖</span>' : '') + '</button>';
    }).join('');
  }

  function defaultBackendLanguage() {
    var project = state.info && state.info.project;
    var language = project && project.export && project.export.backend && project.export.backend.language;
    return ['node', 'rust', 'go'].indexOf(language) >= 0 ? language : '';
  }

  function selectBackendFile(rel) {
    var file = (state.backend.files || []).filter(function (item) { return item.path === rel; })[0];
    if (!file) return;
    state.backend.active = rel;
    state.backend.dirty = false;
    refs.backendPath.textContent = rel;
    if (refs.backendRename) refs.backendRename.hidden = !file.saved;
    if (refs.backendDelete) refs.backendDelete.hidden = !file.saved;
    setBackendBadge(file.saved ? '已覆盖模板' : '模板默认', file.saved ? 'success' : '');
    renderBackendFiles();
    var host = refs.backendEditor;
    mountEditor('backend', host, {
      language: backendEditorLanguage(rel),
      value: file.code || '',
      tabSize: 2,
      onChange: function (value) {
        file.code = String(value);
        state.backend.dirty = true;
        setBackendBadge('未保存', 'warn');
      },
      onSave: function () { saveBackendFile(); }
    });
  }

  function loadBackendFiles(language) {
    state.backend.language = language;
    state.backend.active = '';
    state.backend.files = [];
    destroyEditor('backend');
    refs.backendFiles.innerHTML = '<p class="lc-hint">读取中…</p>';
    setBackendBadge('读取中', '');
    return api(siteApi('/code/backend?language=' + encodeURIComponent(language)))
      .then(function (payload) {
        state.backend.files = payload.files || [];
        state.backend.label = payload.label;
        state.backend.prefixes = payload.prefixes || [];
        state.backend.extensions = payload.extensions || [];
        setBackendBadge(payload.label + ' · ' + state.backend.files.length + ' 个文件', '');
        renderBackendFiles();
        var preferred = state.backend.files.filter(function (item) {
          return /routes\.(js|rs|go)$/.test(item.path);
        })[0] || state.backend.files[0];
        if (preferred) selectBackendFile(preferred.path);
        else refs.backendEditor.innerHTML = '<p class="lc-hint" style="padding:var(--lc-space-3);">这个语言暂无用户区文件。</p>';
        return payload;
      }).catch(function (error) {
        setBackendBadge('读取失败', 'danger');
        refs.backendFiles.innerHTML = '<p class="lc-hint">' + esc(error.message) + '</p>';
        if (refs.backendRename) refs.backendRename.hidden = true;
        if (refs.backendDelete) refs.backendDelete.hidden = true;
      });
  }

  function activeBackendFile() {
    return (state.backend.files || []).filter(function (item) { return item.path === state.backend.active; })[0] || null;
  }

  function saveBackendFile() {
    var file = activeBackendFile();
    if (!file || !state.backend.language) return Promise.resolve(null);
    refs.backendResult.className = 'lc-code-result';
    refs.backendResult.textContent = '正在保存…';
    return api(siteApi('/code/backend'), {
      method: 'PUT',
      body: { language: state.backend.language, path: file.path, code: file.code || '' }
    }).then(function (result) {
      state.backend.dirty = false;
      file.saved = true;
      file.updatedAt = result.file && result.file.updatedAt;
      setBackendBadge('已覆盖模板', 'success');
      renderBackendFiles();
      refs.backendResult.className = 'lc-code-result is-ok';
      refs.backendResult.textContent = '已保存 ' + file.path + '；导出时覆盖模板同名用户区文件。';
      toast('后端用户区文件已保存', 'ok');
      return result;
    }).catch(function (error) {
      refs.backendResult.className = 'lc-code-result is-fail';
      refs.backendResult.textContent = '保存失败：' + error.message;
      return null;
    });
  }

  function resetBackendFile() {
    var file = activeBackendFile();
    if (!file || !state.backend.language) return;
    if (!file.saved) {
      selectBackendFile(file.path);
      return;
    }
    api(siteApi('/code/backend'), {
      method: 'DELETE',
      body: { language: state.backend.language, path: file.path }
    }).then(function () {
      toast('已恢复模板默认：' + file.path, 'ok');
      return loadBackendFiles(state.backend.language).then(function () {
        var active = state.backend.active || file.path;
        selectBackendFile(active);
      });
    }).catch(function (error) {
      refs.backendResult.className = 'lc-code-result is-fail';
      refs.backendResult.textContent = '恢复失败：' + error.message;
    });
  }

  /* 用户区文件的新建、导入、重命名、删除。路径限制全部交给服务端校验，
     生成区与非法扩展名会得到明确错误，不在前端猜。 */
  function backendDefaultPath(name) {
    var prefix = (state.backend.prefixes && state.backend.prefixes[0]) || 'src/custom/';
    var ext = (state.backend.extensions && state.backend.extensions[0]) || '.js';
    var base = String(name || '').replace(/\\/g, '/').split('/').pop();
    if (!base) base = 'new-file' + ext;
    if (base.indexOf('.') < 0) base += ext;
    return prefix + base;
  }

  function backendNewStub() {
    if (state.backend.language === 'rust') return '// 用户区文件：导出时覆盖模板同名文件\n';
    if (state.backend.language === 'go') return '// 用户区文件：导出时覆盖模板同名文件\n';
    return '// 用户区文件：导出时覆盖模板同名文件\n';
  }

  function reloadBackendAndSelect(preferred) {
    return loadBackendFiles(state.backend.language).then(function () {
      if (preferred) selectBackendFile(preferred);
    });
  }

  function writeBackendFile(path, code, preferred) {
    return api(siteApi('/code/backend'), {
      method: 'PUT',
      body: { language: state.backend.language, path: path, code: code }
    }).then(function () {
      return reloadBackendAndSelect(preferred || path);
    });
  }

  function newBackendFile() {
    if (!state.backend.language) return;
    var value = window.prompt('新建用户区文件（只允许 custom/ 等允许目录）', backendDefaultPath(''));
    if (!value) return;
    var path = String(value).trim().replace(/\\/g, '/');
    if (!path) return;
    if ((state.backend.files || []).some(function (file) { return file.path === path; })) {
      toast('文件已存在：' + path, 'warn');
      selectBackendFile(path);
      return;
    }
    refs.backendResult.className = 'lc-code-result';
    refs.backendResult.textContent = '正在创建 ' + path + '…';
    writeBackendFile(path, backendNewStub(), path).then(function () {
      refs.backendResult.className = 'lc-code-result is-ok';
      refs.backendResult.textContent = '已创建 ' + path + '，可直接编辑并保存。';
      toast('已创建用户区文件', 'ok');
    }).catch(function (error) {
      refs.backendResult.className = 'lc-code-result is-fail';
      refs.backendResult.textContent = '创建失败：' + error.message;
    });
  }

  function importBackendFile(file) {
    if (!file || !state.backend.language) return;
    file.text().then(function (text) {
      var value = window.prompt('导入到用户区路径（只允许 custom/ 等允许目录）', backendDefaultPath(file.name));
      if (!value) return;
      var path = String(value).trim().replace(/\\/g, '/');
      if (!path) return;
      var exists = (state.backend.files || []).some(function (item) { return item.path === path; });
      if (exists && !window.confirm('目标文件已存在：' + path + '，导入会覆盖它。继续？')) return;
      refs.backendResult.className = 'lc-code-result';
      refs.backendResult.textContent = '正在导入 ' + path + '…';
      writeBackendFile(path, text, path).then(function () {
        refs.backendResult.className = 'lc-code-result is-ok';
        refs.backendResult.textContent = '已导入 ' + path + '（' + new Blob([text]).size + ' 字节）。';
        toast('已导入用户区文件', 'ok');
      }).catch(function (error) {
        refs.backendResult.className = 'lc-code-result is-fail';
        refs.backendResult.textContent = '导入失败：' + error.message;
      });
    }).catch(function () {
      toast('读取本地文件失败', 'warn');
    });
  }

  function renameBackendFile() {
    var file = activeBackendFile();
    if (!file || !file.saved || !state.backend.language) return;
    var value = window.prompt('重命名用户区文件（输入新路径）', file.path);
    if (!value) return;
    var next = String(value).trim().replace(/\\/g, '/');
    if (!next || next === file.path) return;
    if ((state.backend.files || []).some(function (item) { return item.path === next; })) {
      toast('目标路径已存在：' + next, 'warn');
      return;
    }
    writeBackendFile(next, file.code || '').then(function () {
      return api(siteApi('/code/backend'), {
        method: 'DELETE',
        body: { language: state.backend.language, path: file.path }
      });
    }).then(function () {
      return reloadBackendAndSelect(next);
    }).then(function () {
      refs.backendResult.className = 'lc-code-result is-ok';
      refs.backendResult.textContent = '已重命名为 ' + next + '。';
      toast('文件已重命名', 'ok');
    }).catch(function (error) {
      refs.backendResult.className = 'lc-code-result is-fail';
      refs.backendResult.textContent = '重命名失败：' + error.message;
    });
  }

  function deleteBackendFile() {
    var file = activeBackendFile();
    if (!file || !file.saved || !state.backend.language) return;
    if (!window.confirm('删除用户区文件 ' + file.path + '？模板同名文件会在下次加载时恢复。')) return;
    api(siteApi('/code/backend'), {
      method: 'DELETE',
      body: { language: state.backend.language, path: file.path }
    }).then(function () {
      return reloadBackendAndSelect('');
    }).then(function () {
      refs.backendResult.className = 'lc-code-result is-ok';
      refs.backendResult.textContent = '已删除 ' + file.path + '。';
      toast('用户区文件已删除', 'ok');
    }).catch(function (error) {
      refs.backendResult.className = 'lc-code-result is-fail';
      refs.backendResult.textContent = '删除失败：' + error.message;
    });
  }

  function openCodeDialog() {
    if (!state.siteId) return;
    var project = state.info && state.info.project;
    var rawLanguage = String((project && project.export && project.export.backend && project.export.backend.language) || 'none');
    if (rawLanguage === 'none') {
      toast('这是纯静态项目，没有后端用户区代码。需要后端时请新建「带后端」项目。', 'warn');
      return;
    }
    refs.codeDialog.hidden = false;
    enterDialog(refs.codeDialog, refs.codeDialog.querySelector('[data-code-close]'));
    var language = defaultBackendLanguage() || state.backend.language || 'rust';
    refs.backendLanguage.value = language;
    if (!defaultBackendLanguage()) {
      setBackendBadge('项目未配置后端语言，这里只是预览模板用户区', 'warn');
    }
    loadBackendFiles(language);
  }

  function closeCodeDialog() {
    refs.codeDialog.hidden = true;
    destroyEditor('backend');
    exitDialog(refs.codeDialog);
  }

  function resolveSiteMode(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    /* 未指定模式时默认亮色，不再按操作系统 prefers-color-scheme 猜暗色。 */
    return 'light';
  }

  function renderThemeDialogList(builtin, custom) {
    var seen = {};
    var list = [];
    (builtin || []).concat(custom || []).forEach(function (item) {
      if (!item || !item.id || seen[item.id]) return;
      seen[item.id] = true;
      list.push({
        id: String(item.id),
        name: String(item.name || item.id),
        note: String(item.description || item.tone || ''),
        custom: Boolean(item.custom)
      });
    });
    state.themeList = list;
    var theme = (state.info.project && state.info.project.theme) || {};
    var active = theme.activeId || state.themeId || (list[0] && list[0].id) || '';
    var allow = Array.isArray(theme.allowSwitch) ? theme.allowSwitch.slice() : [];
    if (active && allow.indexOf(active) === -1) allow.push(active);

    refs.themeOptions.innerHTML = list.length ? list.map(function (item) {
      return '<label class="lc-theme-option' + (item.id === active ? ' is-active' : '') + '">' +
        '<input type="radio" name="site-theme" value="' + esc(item.id) + '"' + (item.id === active ? ' checked' : '') + '>' +
        '<span><strong>' + esc(item.name) + '</strong>' +
        '<small>' + esc(item.custom ? '项目自定义' : '内置') + (item.note ? ' · ' + esc(item.note) : '') + '</small></span>' +
      '</label>';
    }).join('') : '<p class="lc-hint">没有可用主题。</p>';

    refs.themeAllow.innerHTML = list.map(function (item) {
      var on = allow.indexOf(item.id) !== -1;
      return '<label><input type="checkbox" value="' + esc(item.id) + '"' + (on ? ' checked' : '') +
        (item.id === active ? ' disabled' : '') + '> ' + esc(item.name) + '</label>';
    }).join('');
  }

  function openThemeDialog() {
    if (!state.siteId) return;
    var theme = (state.info.project && state.info.project.theme) || {};
    var active = theme.activeId || state.themeId || '';
    refs.themeMode.value = theme.mode === 'light' || theme.mode === 'dark' ? theme.mode : 'auto';
    refs.themeDialog.hidden = false;
    enterDialog(refs.themeDialog, refs.themeDialog.querySelector('[data-theme-mode]'));
    api('/api/themes').then(function (data) {
      var builtin = (data && data.themes) || [];
      var builtinIds = {};
      builtin.forEach(function (item) { builtinIds[item.id] = true; });
      var custom = (state.info.themes || []).filter(function (item) {
        return item && item.id && !builtinIds[item.id];
      }).map(function (item) {
        return { id: item.id, name: item.name, custom: true };
      });
      renderThemeDialogList(builtin, custom);
      var checked = refs.themeOptions.querySelector('input[value="' + active + '"]');
      if (checked) checked.checked = true;
    }).catch(function (error) {
      toast('主题列表读取失败：' + error.message, 'error');
    });
  }

  function closeThemeDialog() {
    refs.themeDialog.hidden = true;
    exitDialog(refs.themeDialog);
  }

  function saveTheme() {
    var checked = refs.themeOptions.querySelector('input[name="site-theme"]:checked');
    var activeId = checked ? checked.value : (state.themeId || '');
    if (!activeId) {
      toast('请先选择一套主题', 'warn');
      return;
    }
    var allow = Array.prototype.slice.call(refs.themeAllow.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (input) { return input.value; });
    if (allow.indexOf(activeId) === -1) allow.push(activeId);
    var mode = refs.themeMode.value;
    refs.themeSave.disabled = true;
    api(siteApi('/theme'), { method: 'PUT', body: { activeId: activeId, mode: mode, allowSwitch: allow } })
      .then(function (data) {
        var theme = (data && data.theme) || { activeId: activeId, mode: mode, allowSwitch: allow };
        if (!state.info.project) state.info.project = {};
        state.info.project.theme = theme;
        state.themeId = theme.activeId || activeId;
        state.mode = resolveSiteMode(theme.mode || mode);
        refs.themeSave.disabled = false;
        closeThemeDialog();
        scheduleRender(0);
        toast('主题已保存，画布与导出都会使用这套设置', 'ok');
      })
      .catch(function (error) {
        refs.themeSave.disabled = false;
        toast('主题保存失败：' + error.message, 'error');
      });
  }

  function bindThemeDialogEvents() {
    if (refs.themeEntry) refs.themeEntry.addEventListener('click', openThemeDialog);
    if (refs.themeClose) refs.themeClose.addEventListener('click', closeThemeDialog);
    if (refs.themeCancel) refs.themeCancel.addEventListener('click', closeThemeDialog);
    if (refs.themeSave) refs.themeSave.addEventListener('click', saveTheme);
    if (refs.themeDialog) {
      refs.themeDialog.addEventListener('click', function (event) {
        if (event.target === refs.themeDialog) closeThemeDialog();
      });
    }
    if (refs.themeOptions) {
      refs.themeOptions.addEventListener('change', function (event) {
        if (!event.target.matches('input[name="site-theme"]')) return;
        Array.prototype.forEach.call(refs.themeOptions.querySelectorAll('.lc-theme-option'), function (label) {
          var input = label.querySelector('input');
          label.classList.toggle('is-active', Boolean(input && input.checked));
        });
      });
    }
  }

  function bindCodeDialogEvents() {
    if (!refs.codeDialog) return;
    refs.codeEntry.addEventListener('click', openCodeDialog);
    refs.codeClose.addEventListener('click', closeCodeDialog);
    refs.codeDialog.addEventListener('click', function (event) {
      if (event.target === refs.codeDialog) closeCodeDialog();
    });
    refs.backendLanguage.addEventListener('change', function () {
      loadBackendFiles(refs.backendLanguage.value);
    });
    refs.backendFiles.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('[data-backend-file]') : null;
      if (!item) return;
      selectBackendFile(item.getAttribute('data-backend-file'));
    });
    refs.backendSave.addEventListener('click', saveBackendFile);
    refs.backendReset.addEventListener('click', resetBackendFile);
    if (refs.backendNew) refs.backendNew.addEventListener('click', newBackendFile);
    if (refs.backendImport) refs.backendImport.addEventListener('click', function () { refs.backendFileInput.click(); });
    if (refs.backendFileInput) {
      refs.backendFileInput.addEventListener('change', function () {
        var file = refs.backendFileInput.files && refs.backendFileInput.files[0];
        refs.backendFileInput.value = '';
        importBackendFile(file);
      });
    }
    if (refs.backendRename) refs.backendRename.addEventListener('click', renameBackendFile);
    if (refs.backendDelete) refs.backendDelete.addEventListener('click', deleteBackendFile);
    refs.backendCheck.addEventListener('click', function () {
      var file = activeBackendFile();
      if (!file) return;
      checkCodeAgainst(backendEditorLanguage(file.path), file.code || '', refs.backendResult);
    });
  }

  /* ---------------- 页面与站点 ---------------- */

  function updatePageChrome() {
    if (!state.page) return;
    refs.pageTitle.value = state.page.title || '';
    /* 输入框按剩余宽度伸缩，窄宽度会省略；悬停时用原生提示显示完整标题。 */
    refs.pageTitle.title = state.page.title || '';
    refs.pageTitle.disabled = false;
    refs.pagePath.textContent = state.pagePath + ' · ' + state.page.id;
    refs.pageFile.textContent = state.pagePath || '—';
    updateBlockCount();
    updateUiEndChrome();
    refs.statusRev.textContent = 'rev ' + (state.rev || '—');
  }

  function setViewport(next) {
    state.viewport = next;
    if (next === 'tablet' || next === 'phone') state.lastMobileViewport = next;
    if (refs.stage) refs.stage.setAttribute('data-viewport', next);
    document.querySelectorAll('[data-viewport]').forEach(function (item) {
      var active = item.getAttribute('data-viewport') === next;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateUiEndChrome() {
    var on = independentUiOn();
    var nav = document.querySelector('[data-ui-end-nav]');
    if (nav) {
      nav.hidden = !on;
      nav.style.display = on ? '' : 'none';
    }
    document.querySelectorAll('[data-ui-end-nav-btn]').forEach(function (item) {
      var active = item.getAttribute('data-ui-end-nav-btn') === state.uiEnd;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-ui-end-btn]').forEach(function (item) {
      var active = item.getAttribute('data-ui-end-btn') === state.uiEnd;
      item.classList.toggle('lc-btn-primary', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setUiEnd(end, options) {
    if (!independentUiOn()) return;
    var next = end === 'mobile' ? 'mobile' : 'desktop';
    var opts = options || {};
    if (state.uiEnd === next && !opts.force) {
      updateUiEndChrome();
      return;
    }
    /* 切端前记住当前端的选中项，切回来时按块 id 还原；
       块可能已被删掉，所以还要确认它仍存在于目标端的索引里。 */
    state.selectionByEnd[historyKey()] = state.selectionId;
    state.uiEnd = next;
    rememberUiEnd();
    rebuildBlockIndex();
    var keepId = state.selectionByEnd[next];
    if (keepId && state.blockIndex[keepId]) {
      state.selection = state.blockIndex[keepId].slice();
      state.selectionId = keepId;
    } else {
      state.selection = null;
      state.selectionId = '';
    }
    setViewport(next === 'desktop' ? 'desktop' : (opts.viewport || state.lastMobileViewport || 'phone'));
    updateUiEndChrome();
    updateBlockCount();
    updateUndoRedo();
    renderLayerTree();
    renderInspector();
    scheduleRender(60);
    if (!opts.silent) {
      toast(next === 'mobile'
        ? '正在编辑移动端（视口 ≤ 900px）：这里的改动不会影响桌面端'
        : '正在编辑桌面端（视口 ≥ 901px）：这里的改动不会影响移动端');
    }
  }

  function toggleIndependentUi(enabled) {
    if (!state.page) return;
    var freshMobile = false;
    if (enabled) {
      if (!Array.isArray(state.page.blocksMobile)) {
        state.page.blocksMobile = cloneBlocksWithFreshIds(state.page.blocks);
        freshMobile = true;
      }
      ensureBlockIds(state.page.blocksMobile);
      state.page.independentUi = true;
      state.uiEnd = 'desktop';
      setViewport('desktop');
      toast('已开启双端独立 UI：桌面与移动各自维护区块，移动端断点为 900px', 'ok');
      if (freshMobile) notifyCodeRemap();
    } else {
      if (state.uiEnd === 'mobile' && !window.confirm('当前在编辑移动端。关闭双端独立 UI 后，页面回到共享布局并以桌面端区块为准；移动端布局会保留但不再渲染。继续关闭？')) {
        renderInspector();
        return;
      }
      state.page.independentUi = false;
      state.uiEnd = 'desktop';
      setViewport('desktop');
      toast('已关闭双端独立 UI：恢复单一布局，以桌面端区块为准；移动端数据保留但不再渲染');
    }
    rememberUiEnd();
    state.selection = null;
    state.selectionId = '';
    state.selectionByEnd = { desktop: '', mobile: '' };
    if (freshMobile) resetHistoryEnd('mobile');
    rebuildBlockIndex();
    updateUiEndChrome();
    updateBlockCount();
    renderLayerTree();
    renderInspector();
    markDirty();
    pushHistory();
    storeDraft();
    scheduleRender(60);
    scheduleSave();
  }

  function copyCurrentEndToOther() {
    if (!state.page || !independentUiOn()) return;
    var from = state.uiEnd === 'mobile' ? 'mobile' : 'desktop';
    var to = from === 'mobile' ? 'desktop' : 'mobile';
    var fromLabel = from === 'mobile' ? '移动端' : '桌面端';
    var toLabel = to === 'mobile' ? '移动端' : '桌面端';
    var targetList = activeBlocks();
    if (!window.confirm('把' + fromLabel + '的 ' + targetList.length + ' 个区块复制到' + toLabel +
      '？这会覆盖' + toLabel + '现有布局，' + toLabel + '上已经改过的内容会丢失。')) {
      return;
    }
    var copy = cloneBlocksWithFreshIds(activeBlocks());
    if (to === 'mobile') state.page.blocksMobile = copy;
    else state.page.blocks = copy;
    toast('已把' + fromLabel + '布局复制到' + toLabel + '（区块 id 已重新生成）', 'ok');
    notifyCodeRemap();
    if (to === 'desktop') state.uiEnd = 'desktop';
    else state.uiEnd = 'mobile';
    rememberUiEnd();
    state.selection = null;
    state.selectionId = '';
    state.selectionByEnd = { desktop: '', mobile: '' };
    rebuildBlockIndex();
    updateUiEndChrome();
    updateBlockCount();
    renderLayerTree();
    renderInspector();
    markDirty();
    pushHistory();
    storeDraft();
    scheduleRender(60);
    scheduleSave();
  }

  function updateBlockCount() {
    var total = countBlocks();
    refs.blockCount.textContent = total + ' 个区块';
    refs.layerCount.textContent = String(total);
  }

  function openPage(pageId, options) {
    var opts = options || {};
    if (!state.siteId || !pageId) return Promise.resolve(false);
    var go = function () {
      return api(siteApi('/builder/page?pageId=' + encodeURIComponent(pageId))).then(function (data) {
        state.page = data.page;
        state.pagePath = data.path;
        state.rev = data.rev;
        state.baselineHash = data.hash || '';
        ensurePageBlockIds();
        state.uiEnd = independentUiOn() ? readStoredUiEnd() : 'desktop';
        if (state.uiEnd === 'mobile') state.viewport = state.lastMobileViewport || 'phone';
        else state.viewport = 'desktop';
        setViewport(state.viewport);
        state.selection = null;
        state.selectionId = '';
        state.fieldSession = null;
        rebuildBlockIndex();
        state.baseline = serialize();
        resetHistory();
        state.dirty = false;
        state.saveError = '';
        state.interacting = false;
        clearTimeout(state.renderTimer);
        state.renderSeq += 1;
        updatePageChrome();
        renderPageList();
        renderLayerTree();
        renderInspector();
        updateSaveState();
        setStatus('已打开 ' + (state.page.title || pageId));
        var draft = readDraft();
        if (draft && draft.text && draft.text !== state.baseline) {
          showBanner({
            title: '发现本地草稿',
            text: '「' + (state.page.title || pageId) + '」有 ' + new Date(draft.savedAt).toLocaleString('zh-CN') + ' 的未保存改动，已保留在本机。',
            primary: '恢复草稿',
            secondary: '丢弃草稿',
            onPrimary: restoreDraft,
            onSecondary: discardDraft,
            close: hideBanner
          });
        } else {
          hideBanner();
        }
        renderCanvas();
        syncUrl();
        refs.frame.focus();
        return true;
      }).catch(function (error) {
        setStatus('页面打开失败：' + error.message, 'error');
        toast('页面打开失败：' + error.message, 'error');
        return false;
      });
    };
    if (state.page && state.dirty && !opts.skipSave) {
      return saveNow().then(function (saved) { return saved ? go() : false; });
    }
    return go();
  }

  function restoreDraft() {
    var draft = readDraft();
    if (!draft || !draft.text) return;
    try {
      state.page = JSON.parse(draft.text);
    } catch (error) {
      toast('草稿损坏，已丢弃', 'error');
      discardDraft();
      return;
    }
    ensurePageBlockIds();
    state.uiEnd = independentUiOn() ? readStoredUiEnd() : 'desktop';
    if (state.uiEnd === 'mobile') state.viewport = state.lastMobileViewport || 'phone';
    else state.viewport = 'desktop';
    setViewport(state.viewport);
    rebuildBlockIndex();
    state.selection = null;
    state.selectionId = '';
    state.dirty = true;
    resetHistory();
    updatePageChrome();
    renderLayerTree();
    renderInspector();
    updateSaveState();
    hideBanner();
    scheduleRender(60);
    storeDraft();
    setStatus('已恢复本地草稿，正在后台保存');
    saveNow();
  }

  function discardDraft() {
    var pageId = state.page ? state.page.id : (state.pages[0] && state.pages[0].id);
    clearDraft();
    hideBanner();
    setStatus('已丢弃本地草稿');
    if (pageId) openPage(pageId, { skipSave: true });
  }

  function syncUrl() {
    if (!state.siteId) return;
    var next = new URL(window.location.href);
    next.searchParams.set('site', state.siteId);
    if (state.page) next.searchParams.set('page', state.page.id);
    window.history.replaceState(null, '', next.toString());
  }

  function renderPageList() {
    if (refs.pageCount) refs.pageCount.textContent = String(state.pages.length);
    if (!state.pages.length) {
      refs.pageList.innerHTML = '<div class="lc-builder-layer-empty">这个项目还没有页面。</div>';
      return;
    }
    refs.pageList.innerHTML = state.pages.map(function (page) {
      var active = state.page && state.page.id === page.id;
      return '<button class="lc-tree-item lc-builder-page-item' + (active ? ' is-active' : '') + '" type="button"' +
        ' data-page-id="' + esc(page.id) + '"' + (active ? ' aria-current="page"' : '') + ' title="' + esc(page.title || page.id) + '">' +
        '<span class="lc-tree-type">' + (page.nav === false ? '隐藏' : '导航') + '</span>' +
        '<span class="lc-tree-text">' + esc(page.title || page.id) + '</span>' +
        '<span class="lc-tree-meta">' + esc(page.path || page.id) + '</span></button>';
    }).join('');
  }

  /* ---------------- 新建页面 ---------------- */

  function pageIdTaken(id) {
    return state.pages.some(function (page) {
      return page.id === id || page.slug === id || page.path === id + '.html';
    });
  }

  function suggestPageId(title) {
    /* 标题可能带 HTML 片段：先剥标签再生成别名，避免把标签内容带进公开 URL。
       中文等 Unicode 字母保留，emoji/标点等不可用字符剔除后再退化。 */
    var plain = String(title || '').replace(/<[^>]*>/g, ' ').replace(/&[#a-z0-9]+;/gi, ' ');
    var base = Array.from(plain.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')).slice(0, 32).join('');
    if (base && /[\p{L}\p{N}]/u.test(base)) {
      var candidate = base;
      var index = 2;
      while (pageIdTaken(candidate)) { candidate = base + '-' + index; index += 1; }
      return candidate;
    }
    var serial = state.pages.length + 1;
    while (pageIdTaken('page-' + serial)) serial += 1;
    return 'page-' + serial;
  }

  /* 弹窗焦点管理：打开时移入、Tab 循环、Esc 关闭、关闭后归还触发按钮。 */
  var dialogReturnFocus = null;
  var activeDialogRoot = null;

  function dialogFocusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(function (el) {
      return !el.disabled && el.offsetHeight > 1 && el.getAttribute('aria-hidden') !== 'true';
    });
  }

  function dialogKeydown(event) {
    if (!activeDialogRoot) return;
    if (event.key === 'Escape') {
      var closer = activeDialogRoot.querySelector('[data-new-page-close],[data-theme-close],[data-code-close],[data-conflict-close],[data-dialog-close]');
      if (closer) {
        event.preventDefault();
        event.stopPropagation();
        closer.click();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    var list = dialogFocusables(activeDialogRoot);
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !activeDialogRoot.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function enterDialog(root, preferred) {
    if (!root) return;
    if (activeDialogRoot && activeDialogRoot !== root) exitDialog(activeDialogRoot);
    activeDialogRoot = root;
    dialogReturnFocus = document.activeElement;
    document.addEventListener('keydown', dialogKeydown, true);
    setTimeout(function () {
      var target = preferred && root.contains(preferred) ? preferred : dialogFocusables(root)[0] || root;
      if (!target.hasAttribute('tabindex') && !/^(button|a|input|select|textarea)$/i.test(target.tagName)) target.setAttribute('tabindex', '-1');
      target.focus();
    }, 0);
  }

  function exitDialog(root) {
    if (!root) return;
    document.removeEventListener('keydown', dialogKeydown, true);
    activeDialogRoot = null;
    var opener = dialogReturnFocus;
    dialogReturnFocus = null;
    if (opener && opener.isConnected && !opener.disabled) opener.focus();
  }

  function closeNewPageDialog() {
    var existing = document.querySelector('[data-new-page-dialog]');
    if (!existing) return;
    exitDialog(existing);
    existing.remove();
  }

  function openNewPageDialog() {
    if (!state.siteId) return;
    closeNewPageDialog();
    var backdrop = document.createElement('div');
    backdrop.className = 'lc-dialog-backdrop';
    backdrop.setAttribute('data-new-page-dialog', '1');
    backdrop.innerHTML =
      '<div class="lc-dialog" role="dialog" aria-modal="true" aria-labelledby="lc-new-page-title">' +
      '<div class="lc-dialog-head"><div><h2 id="lc-new-page-title">新建页面</h2>' +
      '<p>页面写入当前项目；创建后直接进入编辑。</p></div>' +
      '<button class="lc-btn lc-btn-sm lc-btn-ghost" type="button" data-new-page-close aria-label="关闭" style="margin-left:auto;">×</button></div>' +
      '<div class="lc-dialog-body">' +
      '<label class="lc-field"><span class="lc-label">页面标题</span>' +
      '<input class="lc-input" type="text" data-new-page-title placeholder="例如：产品介绍" aria-label="页面标题"></label>' +
      '<p class="lc-hint" data-new-page-path>页面文件：pages/—.json</p>' +
      '<p class="lc-error" data-new-page-error hidden></p></div>' +
      '<div class="lc-dialog-foot">' +
      '<button class="lc-btn lc-btn-sm lc-btn-ghost" type="button" data-new-page-cancel>取消</button>' +
      '<button class="lc-btn lc-btn-sm lc-btn-primary" type="button" data-new-page-create>创建并编辑</button>' +
      '</div></div>';
    document.body.appendChild(backdrop);

    var titleInput = backdrop.querySelector('[data-new-page-title]');
    var pathText = backdrop.querySelector('[data-new-page-path]');
    var errorText = backdrop.querySelector('[data-new-page-error]');
    var createBtn = backdrop.querySelector('[data-new-page-create]');
    var busy = false;

    function preview() {
      var id = suggestPageId(titleInput.value);
      pathText.textContent = '页面文件：pages/' + id + '.json';
    }

    function showError(message) {
      errorText.textContent = message;
      errorText.hidden = !message;
      titleInput.classList.toggle('is-invalid', !!message);
    }

    function submit() {
      if (busy) return;
      var title = titleInput.value.trim();
      if (!title) {
        showError('请填写页面标题');
        titleInput.focus();
        return;
      }
      var id = suggestPageId(title);
      var page = {
        schemaVersion: 2,
        id: id,
        title: title,
        slug: id,
        path: id + '.html',
        nav: true,
        blocks: []
      };
      var rel = 'pages/' + id + '.json';
      busy = true;
      createBtn.disabled = true;
      createBtn.textContent = '创建中…';
      showError('');
      /* 先确认文件不存在，避免状态过期时覆盖别人的页面。 */
      api(siteApi('/file?path=' + encodeURIComponent(rel)))
        .then(function () { throw new Error('页面标识「' + id + '」已存在，请换个标题'); },
          function () {
            return api(siteApi('/file?path=' + encodeURIComponent(rel)), {
              method: 'PUT',
              body: { content: JSON.stringify(page, null, 2) + '\n' }
            });
          })
        .then(function () {
          closeNewPageDialog();
          toast('已新建页面「' + title + '」', 'ok');
          /* 切页前先把当前页的未保存改动落盘，否则绑定/覆盖会丢。
             自动保存可能正在飞行中，等它落地再判断是否还需要保存。 */
          var settle = function () {
            if (!state.page) return Promise.resolve(true);
            if (state.saving) {
              return new Promise(function (resolve) {
                setTimeout(function () { resolve(settle()); }, 120);
              });
            }
            return state.dirty ? saveNow() : Promise.resolve(true);
          };
          return settle().then(function (saved) {
            return saved ? loadSite(state.siteId, id) : false;
          });
        })
        .catch(function (error) {
          busy = false;
          createBtn.disabled = false;
          createBtn.textContent = '创建并编辑';
          showError(error.message || '新建页面失败');
        });
    }

    titleInput.addEventListener('input', function () {
      showError('');
      preview();
    });
    titleInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
      if (event.key === 'Escape') { event.preventDefault(); closeNewPageDialog(); }
    });
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) { closeNewPageDialog(); return; }
      var cancel = event.target.closest ? event.target.closest('[data-new-page-cancel]') : null;
      if (cancel) { closeNewPageDialog(); return; }
      var headClose = event.target.closest ? event.target.closest('[data-new-page-close]') : null;
      if (headClose) { closeNewPageDialog(); return; }
      var create = event.target.closest ? event.target.closest('[data-new-page-create]') : null;
      if (create) submit();
    });
    preview();
    enterDialog(backdrop, titleInput);
  }

  function applySiteInfo(info) {
    state.info = info;
    state.pages = info.pages || [];
    hideProjectPicker();
    var backendLanguage = String((info.project && info.project.export && info.project.export.backend && info.project.export.backend.language) || 'none');
    var isBackendProject = backendLanguage !== 'none';
    /* 后端专属入口按项目类型收敛：纯静态项目不显示后端代码、中间件与配置中心。 */
    if (refs.codeEntry) refs.codeEntry.hidden = !isBackendProject;
    if (refs.backendFlowEntry) refs.backendFlowEntry.hidden = !isBackendProject;
    [refs.middlewareEntry, refs.configEntry].forEach(function (entry) {
      if (entry) entry.hidden = !isBackendProject;
    });
    /* 窄屏「更多」菜单里的镜像入口跟随原按钮的显隐，避免纯静态项目仍能从这里进后端。 */
    Array.prototype.forEach.call(document.querySelectorAll('[data-more-menu] [data-mirror]'), function (mirror) {
      var original = document.querySelector(mirror.getAttribute('data-mirror'));
      if (original) mirror.hidden = original.hidden;
    });
    state.templates = info.templates || [];
    var themePref = info.project && info.project.theme ? info.project.theme.mode : '';
    state.themeId = (info.project && info.project.theme && info.project.theme.activeId) || info.activeTheme || state.themeId;
    state.mode = themePref === 'light' || themePref === 'dark' ? themePref : 'light';
    state.schemaByType = {};
    (info.blockSchemas || []).forEach(function (schema) { state.schemaByType[schema.type] = schema; });
    state.componentSchemaById = {};
    (info.componentSchemas || []).forEach(function (schema) { state.componentSchemaById[schema.componentId] = schema; });
    renderSiteSelect();
    if (refs.exportEntry && state.siteId) {
      refs.exportEntry.href = 'export.html?site=' + encodeURIComponent(state.siteId);
    }
    syncSiteLinks();
    renderPageList();
    renderBuiltinList();
    renderComponentList();
    renderTemplateList();
  }

  function reloadSiteInfo() {
    if (!state.siteId) return Promise.resolve(false);
    return api(siteApi('/builder/site')).then(function (info) {
      applySiteInfo(info);
      return true;
    }).catch(function (error) {
      toast('刷新资源列表失败：' + error.message, 'error');
      return false;
    });
  }

  /* 从后端积木流程里收集可绑定的接口，供事件绑定下拉使用。 */
  function refreshBackendRoutes() {
    if (!state.siteId) return;
    api(siteApi('/backend-flow')).then(function (data) {
      var routes = [];
      var seen = {};
      walkFlowNodes(data && data.flow && data.flow.root, function (node) {
        if (!node || node.type !== 'entry.request') return;
        var method = String((node.params && node.params.method) || 'GET').toUpperCase();
        var pathValue = String((node.params && node.params.path) || '');
        if (!pathValue) return;
        var key = method + ' ' + pathValue;
        if (seen[key]) return;
        seen[key] = true;
        routes.push({ method: method, path: pathValue });
      });
      state.backendRoutes = routes;
    }).catch(function () {
      state.backendRoutes = [];
    });
  }

  function walkFlowNodes(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    ['children', 'elseChildren'].forEach(function (key) {
      var list = node[key];
      if (Array.isArray(list)) list.forEach(function (child) { walkFlowNodes(child, visit); });
    });
  }

  /* 顶栏入口统一带当前站点；记住最近站点供工作台入口复用。 */
  function siteEntryPairs() {
    return [
      [refs.dataEntry, 'data.html'],
      [refs.componentsEntry, 'components.html'],
      [refs.templatesEntry, 'templates.html'],
      [refs.themeEditorEntry, 'theme/editor.html'],
      [refs.pageImportEntry, 'page-import.html'],
      [refs.middlewareEntry, 'middleware.html'],
      [refs.configEntry, 'config-center.html'],
      [refs.backendFlowEntry, 'backend-flow.html'],
      [refs.buildsEntry, 'builds.html'],
      [refs.exportEntry, 'export.html']
    ];
  }

  function applySiteLinkQuery(siteId) {
    var query = siteId ? '?site=' + encodeURIComponent(siteId) : '';
    siteEntryPairs().forEach(function (pair) {
      if (pair[0]) pair[0].href = pair[1] + query;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-more-menu] a[data-mirror]'), function (link) {
      var original = document.querySelector(link.getAttribute('data-mirror'));
      if (original && original.href) link.href = original.href;
    });
  }

  function syncSiteLinks() {
    if (!state.siteId) return;
    applySiteLinkQuery(state.siteId);
    try { localStorage.setItem('lc.lastSite', state.siteId); } catch (error) { /* 隐私模式忽略 */ }
  }

  /* 未选站点：站点相关入口只保留外壳，点击时说明原因而不是悄悄串到第一个项目。 */
  function setSiteReady(ready) {
    state.siteReady = Boolean(ready);
    var entries = siteEntryPairs().map(function (pair) { return pair[0]; })
      .concat([refs.themeEntry, refs.codeEntry]);
    entries.forEach(function (entry) {
      if (!entry) return;
      if (ready) {
        entry.removeAttribute('aria-disabled');
        entry.removeAttribute('data-site-blocked');
        if (entry.getAttribute('data-lc-title')) {
          entry.setAttribute('title', entry.getAttribute('data-lc-title'));
          entry.removeAttribute('data-lc-title');
        }
      } else {
        if (entry.getAttribute('title') && !entry.getAttribute('data-lc-title')) {
          entry.setAttribute('data-lc-title', entry.getAttribute('title'));
        }
        entry.setAttribute('aria-disabled', 'true');
        entry.setAttribute('data-site-blocked', '1');
        entry.setAttribute('title', '先选择项目，再打开这个功能');
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-more-menu] [data-mirror]'), function (mirror) {
      var original = document.querySelector(mirror.getAttribute('data-mirror'));
      if (!original) return;
      if (ready) {
        mirror.removeAttribute('aria-disabled');
        mirror.removeAttribute('data-site-blocked');
      } else {
        mirror.setAttribute('aria-disabled', 'true');
        mirror.setAttribute('data-site-blocked', '1');
      }
    });
    if (!ready) {
      refs.save.disabled = true;
      refs.save.title = '先选择项目，再保存';
      refs.saveState.className = 'lc-badge';
      refs.saveState.textContent = '未选择项目';
    }
  }

  function siteTypeLabel(site) {
    if (!site || site.type !== 'backend') return '纯静态';
    var lang = { rust: 'Rust', node: 'Node', go: 'Go' }[site.backendLanguage] || 'Rust';
    return '带后端 · ' + lang;
  }

  function showProjectPicker(reason) {
    state.siteId = '';
    state.info = null;
    state.pages = [];
    state.page = null;
    state.selection = null;
    state.selectionId = '';
    renderSiteSelect();
    refs.siteSelect.value = '';
    applySiteLinkQuery('');
    setSiteReady(false);
    document.body.setAttribute('data-lc-sidebar', 'hidden');
    document.body.setAttribute('data-lc-inspector', 'hidden');
    refs.placeholder.hidden = false;
    refs.stage.hidden = true;
    refs.projectPicker.hidden = false;
    refs.projectPickerReason.textContent = reason || '请选择要编辑的项目。';
    if (!state.sites.length) {
      refs.projectPickerList.innerHTML = '<div class="lc-builder-picker-empty">还没有项目。先去 <a href="home.html">工作台</a> 新建一个项目。</div>';
    } else {
      refs.projectPickerList.innerHTML = state.sites.map(function (site) {
        return '<a class="lc-builder-project" href="builder.html?site=' + encodeURIComponent(site.siteId) + '">' +
          '<strong>' + esc(site.name || site.siteId) + '</strong>' +
          '<small>' + esc(siteTypeLabel(site)) + ' · ' + (Number(site.pageCount) || 0) + ' 个页面</small>' +
          '<small>' + esc(site.siteId) + '</small>' +
        '</a>';
      }).join('');
    }
    setStatus('未选择项目：请先选一个项目', 'error');
  }

  function hideProjectPicker() {
    refs.projectPicker.hidden = true;
    document.body.removeAttribute('data-lc-sidebar');
    document.body.removeAttribute('data-lc-inspector');
    setSiteReady(true);
    renderSiteSelect();
    if (state.siteId) refs.siteSelect.value = state.siteId;
    updateSaveState();
  }

  function bindTopbarLinks() {
    /* 未选站点时，站点相关入口在捕获阶段拦下，先说明原因再谈导航。 */
    document.addEventListener('click', function (event) {
      var blocked = event.target.closest ? event.target.closest('[data-site-blocked]') : null;
      if (!blocked || state.siteReady) return;
      event.preventDefault();
      event.stopPropagation();
      if (refs.moreMenu) {
        refs.moreMenu.hidden = true;
        refs.moreToggle.setAttribute('aria-expanded', 'false');
      }
      toast('先选择项目，再打开这个功能', 'error');
      setStatus('未选择项目：请先在项目选择页点一个项目', 'error');
    }, true);
    /* 窄屏（≤900）资源栏与属性面板变成抽屉，顶栏两个按钮负责开合（BLD-01）。 */
    var shell = document.body;
    var sidebarToggle = document.querySelector('[data-toggle-sidebar]');
    var inspectorToggle = document.querySelector('[data-toggle-inspector]');
    function toggleDrawer(button, attr) {
      if (!button) return;
      button.addEventListener('click', function () {
        var open = shell.getAttribute(attr) === 'open';
        shell.setAttribute(attr, open ? 'closed' : 'open');
        if (!open) {
          var other = attr === 'data-lc-sidebar' ? 'data-lc-inspector' : 'data-lc-sidebar';
          shell.setAttribute(other, 'closed');
        }
        button.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    }
    toggleDrawer(sidebarToggle, 'data-lc-sidebar');
    toggleDrawer(inspectorToggle, 'data-lc-inspector');
    if (!refs.moreToggle || !refs.moreMenu) return;
    refs.moreToggle.addEventListener('click', function () {
      var open = refs.moreMenu.hidden;
      refs.moreMenu.hidden = !open;
      refs.moreToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    refs.moreMenu.addEventListener('click', function (event) {
      var mirror = event.target.closest ? event.target.closest('[data-mirror]') : null;
      if (mirror) {
        var original = document.querySelector(mirror.getAttribute('data-mirror'));
        if (original && original.tagName === 'BUTTON') {
          event.preventDefault();
          original.click();
        }
      }
      refs.moreMenu.hidden = true;
      refs.moreToggle.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', function (event) {
      if (refs.moreMenu.hidden) return;
      if (refs.moreToggle.contains(event.target) || refs.moreMenu.contains(event.target)) return;
      refs.moreMenu.hidden = true;
      refs.moreToggle.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', function (event) {
      if (refs.moreMenu.hidden || event.key !== 'Escape') return;
      refs.moreMenu.hidden = true;
      refs.moreToggle.setAttribute('aria-expanded', 'false');
      refs.moreToggle.focus();
    });
  }

  function loadSite(siteId, pageId) {
    state.siteId = siteId;
    loadCollapsed();
    setStatus('正在读取项目…');
    return api(siteApi('/builder/site')).then(function (info) {
      applySiteInfo(info);
      refreshBackendRoutes();
      var target = pageId && state.pages.some(function (page) { return page.id === pageId; })
        ? pageId
        : (state.pages[0] && state.pages[0].id);
      if (!target) {
        /* 切到没有页面的站点时必须清空上一站点的编辑态，
           否则后续编辑/保存会带着旧 pagePath 写到别的站点。 */
        state.page = null;
        state.pagePath = '';
        state.rev = 0;
        state.baseline = '';
        state.baselineHash = '';
        state.retryAfterRev = false;
        state.dirty = false;
        state.saving = false;
        state.savePromise = null;
        state.saveError = '';
        state.selection = null;
        state.selectionId = '';
        state.fieldSession = null;
        state.blockIndex = {};
        clearTimeout(state.saveTimer);
        clearTimeout(state.retryTimer);
        state.saveTimer = 0;
        state.retryTimer = 0;
        resetHistory();
        state.interacting = false;
        refs.pageTitle.value = '';
        refs.pageTitle.title = '';
        refs.pageTitle.disabled = true;
        refs.pagePath.textContent = '—';
        refs.pageFile.textContent = '—';
        refs.blockCount.textContent = '0 个区块';
        refs.placeholder.hidden = false;
        refs.stage.hidden = true;
        hideBanner();
        renderPageList();
        renderLayerTree();
        renderInspector();
        updateSaveState();
        setStatus('项目下还没有页面');
        return;
      }
      refs.placeholder.hidden = true;
      refs.canvasWrap.querySelector('.lc-canvas-stage').hidden = false;
      return openPage(target);
    }).catch(function (error) {
      state.siteId = '';
      showProjectPicker('站点读取失败：' + error.message + '。请重新选择项目。');
    });
  }

  function renderSiteSelect() {
    var placeholder = state.siteId
      ? ''
      : '<option value="">' + (state.sites.length ? '选择项目…' : '还没有项目') + '</option>';
    refs.siteSelect.innerHTML = placeholder + state.sites.map(function (site) {
      return '<option value="' + esc(site.siteId) + '"' + (site.siteId === state.siteId ? ' selected' : '') + '>' +
        esc(site.name || site.siteId) + '</option>';
    }).join('');
  }

  /* ---------------- 提示条 ---------------- */

  function showBanner(options) {
    state.bannerActions = options;
    refs.bannerTitle.textContent = options.title || '提示';
    refs.bannerText.textContent = options.text || '';
    refs.bannerPrimary.hidden = !options.primary;
    refs.bannerSecondary.hidden = !options.secondary;
    refs.bannerClose.hidden = !options.close;
    if (options.primary) refs.bannerPrimary.textContent = options.primary;
    if (options.secondary) refs.bannerSecondary.textContent = options.secondary;
    refs.banner.hidden = false;
  }

  function hideBanner() {
    refs.banner.hidden = true;
    state.bannerActions = null;
  }

  /* ---------------- 冲突对话框 ---------------- */

  function openConflictDialog(error) {
    closeConflictDialog();
    var backdrop = document.createElement('div');
    backdrop.className = 'lc-dialog-backdrop';
    backdrop.setAttribute('data-conflict', '1');
    backdrop.innerHTML =
      '<div class="lc-dialog" role="dialog" aria-modal="true" aria-labelledby="lc-conflict-title">' +
      '<div class="lc-dialog-head"><h2 id="lc-conflict-title">这个页面在别处被改过</h2>' +
      '<p>磁盘上的版本比你打开时新，直接覆盖会丢掉别人的改动。</p>' +
      '<button class="lc-btn lc-btn-sm lc-btn-ghost" type="button" data-conflict-close aria-label="关闭" style="margin-left:auto;">×</button></div>' +
      '<div class="lc-dialog-body"><p class="lc-hint">你本地这次改的内容还留在编辑器里。可以先用最新版本覆盖磁盘，或者放弃本地改动、加载磁盘上的最新版本。</p>' +
      (error && error.message ? '<p class="lc-error">' + esc(error.message) + '</p>' : '') + '</div>' +
      '<div class="lc-dialog-foot">' +
      '<button class="lc-btn lc-btn-sm lc-btn-ghost" type="button" data-conflict-later>稍后处理</button>' +
      '<button class="lc-btn lc-btn-sm" type="button" data-conflict-discard>放弃我的改动</button>' +
      '<button class="lc-btn lc-btn-sm lc-btn-primary" type="button" data-conflict-overwrite>用我的版本覆盖</button>' +
      '</div></div>';
    document.body.appendChild(backdrop);
    enterDialog(backdrop, backdrop.querySelector('[data-conflict-later]'));
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) closeConflictDialog();
      var headClose = event.target.closest ? event.target.closest('[data-conflict-close]') : null;
      if (headClose) closeConflictDialog();
      var later = event.target.closest ? event.target.closest('[data-conflict-later]') : null;
      if (later) closeConflictDialog();
      var overwrite = event.target.closest ? event.target.closest('[data-conflict-overwrite]') : null;
      if (overwrite) {
        api(siteApi('/builder/page?pageId=' + encodeURIComponent(state.page.id))).then(function (data) {
          state.rev = data.rev;
          closeConflictDialog();
          return saveNow({ force: true });
        }).catch(function (fetchError) {
          closeConflictDialog();
          setStatus('读取最新版本失败：' + fetchError.message, 'error');
        });
      }
      var discard = event.target.closest ? event.target.closest('[data-conflict-discard]') : null;
      if (discard) {
        closeConflictDialog();
        /* 放弃本地改动 = 重新读磁盘版本，不能再走保存（旧 rev 会立刻再次冲突）。 */
        openPage(state.page ? state.page.id : null, { skipSave: true });
      }
    });
    updateSaveState();
    setStatus('保存冲突，等待你选择处理方式', 'error');
  }

  function closeConflictDialog() {
    var existing = document.querySelector('[data-conflict]');
    if (!existing) return;
    exitDialog(existing);
    existing.remove();
  }

  /* ---------------- 快捷键 ---------------- */

  function onKeydown(event) {
    var key = String(event.key || '').toLowerCase();
    var mod = event.ctrlKey || event.metaKey;
    if (key === 'escape' && (state.dragging || state.canvasDragging || state.interacting)) {
      cancelLayerDrag();
      postToCanvas({ type: 'cancel-drag' });
      event.preventDefault();
      return;
    }
    if (key === 'escape') {
      /* 弹窗优先响应 ESC：关闭最上层弹窗，避免焦点在输入框时关不掉。 */
      if (refs.codeDialog && !refs.codeDialog.hidden) {
        closeCodeDialog(); event.preventDefault(); return;
      }
      if (refs.themeDialog && !refs.themeDialog.hidden) {
        closeThemeDialog(); event.preventDefault(); return;
      }
      if (document.querySelector('[data-new-page-dialog]')) {
        closeNewPageDialog(); event.preventDefault(); return;
      }
      if (document.querySelector('[data-conflict]')) {
        closeConflictDialog(); event.preventDefault(); return;
      }
    }
    /* 拖拽中忽略撤销/复制粘贴，避免数据先变、落点再插一次。 */
    if ((state.dragging || state.canvasDragging) && mod &&
        (key === 'z' || key === 'y' || key === 'd' || key === 'c' || key === 'v')) {
      event.preventDefault();
      return;
    }
    /* 有弹窗（冲突 / 新建页 / 代码 / 主题）时，编辑器快捷键全部让位，
       避免 Delete 删掉弹窗背后的区块、Ctrl+Z 改到背后的页面。 */
    var dialogOpen = !!document.querySelector('.lc-dialog-backdrop, [data-new-page-dialog]') ||
      (refs.codeDialog && !refs.codeDialog.hidden) ||
      (refs.themeDialog && !refs.themeDialog.hidden);
    if (dialogOpen) {
      if (mod && key === 's') event.preventDefault();
      return;
    }
    var editableTarget = isEditable(event.target);
    if (mod && key === 's') {
      event.preventDefault();
      saveNow();
      return;
    }
    /* 光标在输入框/代码编辑器里时，撤销重做和复制都是文本操作，交给浏览器。 */
    if (editableTarget && mod && (key === 'z' || key === 'y' || key === 'd' || key === 'c' || key === 'v')) {
      return;
    }
    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }
    if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      redo();
      return;
    }
    if (mod && key === 'd') {
      event.preventDefault();
      duplicateSelected();
      return;
    }
    if (mod && key === 'c') {
      if (isEditable(event.target)) return;
      event.preventDefault();
      copySelected();
      return;
    }
    if (mod && key === 'v') {
      if (isEditable(event.target)) return;
      event.preventDefault();
      pasteClipboard();
      return;
    }
    if ((key === 'delete' || key === 'backspace') && !isEditable(event.target)) {
      event.preventDefault();
      deleteSelected();
    }
  }

  /* ---------------- 静态绑定 ---------------- */

  function bindStaticEvents() {
    refs.undo.addEventListener('click', undo);
    refs.redo.addEventListener('click', redo);
    refs.save.addEventListener('click', function () { saveNow(); });
    refs.reloadPage.addEventListener('click', function () {
      if (!state.page) return;
      if (state.dirty && !window.confirm('当前页有未保存改动，重新加载会丢掉这些改动（本地草稿仍会保留）。继续？')) return;
      openPage(state.page.id, { skipSave: true });
    });

    refs.siteSelect.addEventListener('change', function () {
      var nextId = refs.siteSelect.value;
      if (!nextId) {
        showProjectPicker('已回到项目选择。选择要编辑的项目后再继续。');
        return;
      }
      if (nextId === state.siteId) return;
      var run = function () { loadSite(nextId, null); };
      if (state.dirty) {
        saveNow().then(function (saved) {
          if (saved) run();
          else {
            /* 保存失败时留在当前站点，别把未落盘的改动丢在切换途中。 */
            renderSiteSelect();
            setStatus(state.saveError ? '保存失败，暂不切换项目：' + state.saveError : '保存未完成，暂不切换项目', 'error');
          }
        });
      } else run();
    });

    refs.pageTitle.addEventListener('input', function () {
      if (!state.page) return;
      state.page.title = refs.pageTitle.value;
      refs.pageTitle.title = state.page.title;
      markDirty();
      scheduleSave();
      if (!state.fieldSession) {
        // 标题也参与画布和图层树，重绘稍慢一点避免打断输入
        scheduleRender(400);
      }
    });
    refs.pageTitle.addEventListener('change', function () {
      pushHistory();
      renderLayerTree();
      renderPageList();
      state.pages.forEach(function (page) {
        if (page.id === state.page.id) page.title = state.page.title;
      });
      renderPageList();
      storeDraft();
    });

    refs.pageList.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('[data-page-id]') : null;
      if (!item) return;
      var pageId = item.getAttribute('data-page-id');
      if (state.page && state.page.id === pageId) return;
      openPage(pageId);
    });

    if (refs.newPage) refs.newPage.addEventListener('click', function () { openNewPageDialog(); });

    document.querySelectorAll('[data-viewport]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.getAttribute('data-viewport');
        if (independentUiOn()) {
          var end = next === 'desktop' ? 'desktop' : 'mobile';
          if (end !== state.uiEnd) {
            setUiEnd(end, { viewport: next });
            return;
          }
        }
        setViewport(next);
      });
    });

    document.querySelectorAll('[data-ui-end-nav-btn]').forEach(function (button) {
      button.addEventListener('click', function () {
        setUiEnd(button.getAttribute('data-ui-end-nav-btn'));
      });
    });

    refs.bannerPrimary.addEventListener('click', function () {
      if (state.bannerActions && state.bannerActions.onPrimary) state.bannerActions.onPrimary();
    });
    refs.bannerSecondary.addEventListener('click', function () {
      if (state.bannerActions && state.bannerActions.onSecondary) state.bannerActions.onSecondary();
    });
    refs.bannerClose.addEventListener('click', hideBanner);

    refs.frame.addEventListener('load', onFrameLoad);
    window.addEventListener('message', onCanvasMessage);
    document.addEventListener('keydown', onKeydown);
    /* 窗口失焦/切走：立即停掉左右两侧的拖拽自动滚动与拖拽态。 */
    window.addEventListener('blur', function () {
      cancelLayerDrag();
      postToCanvas({ type: 'cancel-drag' });
      state.canvasDragging = false;
    });

    window.addEventListener('beforeunload', function (event) {
      if (state.dirty) {
        event.preventDefault();
        event.returnValue = '还有改动没有保存到磁盘。';
        return event.returnValue;
      }
    });
  }

  function boot() {
    setSiteReady(false);
    applySiteLinkQuery('');
    bindStaticEvents();
    bindPanelEvents();
    bindLayerTreeEvents();
    bindInspectorEvents();
    bindCodeDialogEvents();
    bindThemeDialogEvents();
    bindThemeWatch();
    bindTopbarLinks();
    var params = new URLSearchParams(window.location.search);
    var requestedSite = params.get('site') || '';
    var requestedPage = params.get('page') || '';
    api('/api/sites').then(function (sites) {
      state.sites = sites || [];
      renderSiteSelect();
      if (!requestedSite) {
        showProjectPicker(state.sites.length
          ? 'URL 缺少 site 参数。选择要编辑的项目进入 Builder，或从工作台的项目卡片进入。'
          : '还没有项目。先去工作台新建一个项目，再开始编辑。');
        return;
      }
      var known = state.sites.some(function (site) { return site.siteId === requestedSite; });
      if (!known) {
        showProjectPicker('站点不存在：「' + requestedSite + '」。不会自动切换到第一个项目，请重新选择。');
        return;
      }
      refs.siteSelect.value = requestedSite;
      return loadSite(requestedSite, requestedPage);
    }).catch(function (error) {
      setStatus('项目列表读取失败', 'error');
      showProjectPicker('项目列表读取失败：' + error.message);
    });
  }

  function bindThemeWatch() {
    if (!window.matchMedia) return;
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    var apply = function () {
      var pref = document.documentElement.getAttribute('data-lc-mode-pref') || 'light';
      if (pref === 'auto') {
        /* 与站点渲染口径一致：auto 默认亮色，不跟随系统暗色。 */
        document.documentElement.setAttribute('data-lc-mode', 'light');
        state.mode = 'light';
        scheduleRender(120);
      }
    };
    if (media.addEventListener) media.addEventListener('change', apply);
    else if (media.addListener) media.addListener(apply);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
