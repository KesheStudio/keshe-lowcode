/* 后端积木编排 · 页面逻辑
 *
 * 与 builder 共用控件样式与交互习惯：左侧资源库、中间树（拖拽/嵌套/插入指示线）、
 * 右侧属性面板。节点类型来自服务端注册表，页面不重复维护 schema。
 *
 * 数据流：GET/PUT /api/sites/:id/backend-flow 读写流程草稿；
 * 代码节点内容用现有 /api/sites/:id/code/backend 读写用户区文件。
 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var TOKEN = tokenMeta ? tokenMeta.getAttribute('content') : '';
  var LANGUAGE = 'node';
  var ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
  var DRAG_NODE_TYPE = 'text/x-lc-node-type';
  var DRAG_NODE_ID = 'text/x-lc-node-id';
  var CATEGORY_PREFIX = {
    entry: 'entry',
    middleware: 'mw',
    data: 'db',
    transform: 'tf',
    control: 'ctl',
    output: 'res',
    component: 'cmp',
    code: 'code'
  };
  var LANG_LABEL = { node: 'Node', rust: 'Rust', go: 'Go' };
  var LANG_EXT = { node: 'js', rust: 'rs', go: 'go' };

  var refs = {};
  [
    'siteSelect', 'saveState', 'loadSample', 'save', 'validate', 'compile',
    'previewStart', 'previewStop', 'nodeSearch', 'nodeLibrary', 'flowName',
    'flowMeta', 'treeCount', 'expandAll', 'collapseAll', 'flowTitle',
    'flowVersion', 'flowHash', 'dirtyBadge', 'tree', 'treeEmpty', 'issueCount',
    'issues', 'previewState', 'previewUrl', 'reqMethod', 'reqPath', 'reqBody',
    'reqSend', 'reqMeta', 'reqResult', 'generation', 'generationMeta',
    'generationFiles', 'generationClose', 'tabHint',
    'statusDot', 'statusText', 'statusSite',
    'codeDialog', 'codePath', 'codeEditor', 'codeResult', 'codeSave', 'codeCheck', 'codeClose', 'codeCancel',
    'target', 'backBuilder'
  ].forEach(function (key) {
    refs[key] = document.querySelector('[data-' + key.replace(/[A-Z]/g, function (ch) { return '-' + ch.toLowerCase(); }) + ']');
  });

  /* 首屏即用 URL 里的站点参数，避免站点列表返回前「返回编辑器」指向无参地址。 */
  (function initBackBuilder() {
    var requested = new URLSearchParams(window.location.search).get('site') || '';
    if (refs.backBuilder && requested) refs.backBuilder.href = 'builder.html?site=' + encodeURIComponent(requested);
  })();

  var panels = {
    node: document.querySelector('[data-panel="node"]'),
    middleware: document.querySelector('[data-panel="middleware"]'),
    config: document.querySelector('[data-panel="config"]'),
    components: document.querySelector('[data-panel="components"]')
  };
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));

  var state = {
    sites: [],
    siteId: '',
    categories: [],
    types: {},
    typeList: [],
    flow: null,
    issues: [],
    selectedId: '',
    collapsed: {},
    tab: 'node',
    target: 'node',
    components: { project: [], global: [] },
    search: '',
    dirty: false,
    preview: null,
    codeNodeId: '',
    codePageMode: false,
    codeLanguage: 'node',
    componentDraft: null,
    overrideFiles: {},
    pageCard: null,
    editor: null,
    loading: false
  };

  /* ---------------------------------------------------------------- 工具 */

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
          var message = (payload.error && payload.error.message) || ('请求失败（' + response.status + '）');
          var error = new Error(message);
          error.code = payload.error && payload.error.code;
          error.detail = payload.error && payload.error.detail;
          error.issues = payload.issues || [];
          throw error;
        }
        return payload.data;
      });
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function toast(message, kind) {
    var box = el('div', 'lc-toast' + (kind ? ' is-' + kind : ''), message);
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3200);
  }

  function setStatus(text, kind) {
    if (!refs.statusText) return;
    refs.statusText.textContent = text || '';
    refs.statusDot.style.background = kind === 'error'
      ? 'var(--lc-color-danger)'
      : kind === 'warn' ? 'var(--lc-color-warn)' : 'var(--lc-color-success)';
  }

  function typeDef(type) {
    return state.types[type] || null;
  }

  /* 页面级覆盖：每个目标语言一个用户区入口文件，生成区只引用、不改写。 */
  function pageOverrideRel(target) {
    var flowId = (state.flow && state.flow.flow && state.flow.flow.id) || 'main';
    var language = target || state.target;
    var dir = language === 'go' ? 'internal/custom/flows/' : 'src/custom/flows/';
    return dir + flowId + '.' + (LANG_EXT[language] || 'js');
  }

  function nodeCodeRel(node) {
    var codeLanguage = (node && node.params && node.params.codeLanguage) || 'node';
    return 'src/custom/handlers/' + ((state.flow && state.flow.flow.id) || 'main') + '.' +
      (node ? node.id : '') + '.' + (LANG_EXT[codeLanguage] || 'js');
  }

  function overrideFile(language, rel) {
    var map = state.overrideFiles[language];
    return map && map[rel] ? map[rel] : null;
  }

  function refreshOverrideFiles(languages) {
    if (!state.siteId || !state.flow) return Promise.resolve();
    var list = languages && languages.length ? languages : ['node', state.target];
    var unique = list.filter(function (item, index) { return list.indexOf(item) === index; });
    return Promise.all(unique.map(function (language) {
      return api(siteBase() + '/code/backend?language=' + encodeURIComponent(language))
        .then(function (data) {
          var map = {};
          (data.files || []).forEach(function (file) { if (file.saved) map[file.path] = file; });
          state.overrideFiles[language] = map;
        })
        .catch(function () { state.overrideFiles[language] = {}; });
    })).then(function () {
      renderTree();
      renderPageOverrideCard();
    });
  }

  /* 每个积木对三种语言的支持状态：已实现 / 设计支持但未实现 / 不支持。 */
  function languageState(def, language) {
    var declared = (def.languages || ['node']).indexOf(language) >= 0;
    var implemented = declared && (def.implementedLanguages || []).indexOf(language) >= 0;
    return implemented ? 'ok' : declared ? 'design' : 'missing';
  }

  function languageBadges(def, activeTarget) {
    var row = el('span', 'lc-bf-lib-langs');
    ['node', 'go', 'rust'].forEach(function (language) {
      var status = languageState(def, language);
      var badge = el('span', 'lc-bf-lang is-' + status, LANG_LABEL[language].slice(0, 1));
      badge.textContent = LANG_LABEL[language];
      badge.title = language === activeTarget
        ? (status === 'ok' ? LANG_LABEL[language] + '：当前目标，已实现'
          : status === 'design' ? LANG_LABEL[language] + '：当前目标，设计上支持但生成器未实现'
            : LANG_LABEL[language] + '：当前目标不支持这个积木')
        : (status === 'ok' ? LANG_LABEL[language] + '：已实现代码生成'
          : status === 'design' ? LANG_LABEL[language] + '：设计上支持，生成器未实现'
            : LANG_LABEL[language] + '：不支持');
      row.appendChild(badge);
    });
    return row;
  }

  /* 换成什么：同类、支持当前目标、且已实现的积木。 */
  function languageAlternatives(def, target) {
    if (!def) return [];
    var items = state.typeList.filter(function (item) {
      if (!item || item.type === def.type) return false;
      if (item.category !== def.category || item.category === 'component' || item.category === 'code') return false;
      if (item.singleton) return false;
      return languageState(item, target) === 'ok';
    });
    return items.slice(0, 3);
  }

  function alternativesText(def, target) {
    var items = languageAlternatives(def, target);
    if (items.length) return '可换成：' + items.map(function (item) { return '「' + item.label + '」'; }).join('、');
    return '同类积木里没有可直接替换的实现；可在用户区代码里自行实现这段逻辑';
  }

  function targetLanguageIssues() {
    var out = [];
    if (!state.flow) return out;
    walk(state.flow.flow.root.children, function (node) {
      var def = typeDef(node.type);
      if (!def || node.enabled === false) return;
      if (languageState(def, state.target) === 'ok') return;
      out.push({
        level: 'warning',
        code: 'LC_F_LANG_NODE',
        nodeId: node.id,
        nodeLabel: node.name || node.id,
        message: '积木「' + def.label + '」不支持 ' + LANG_LABEL[state.target] + ' 目标。' + alternativesText(def, state.target)
      });
    });
    return out;
  }

  function safeDoc() {
    if (!state.flow) return null;
    if (!state.flow.settings) state.flow.settings = {};
    var center = state.flow.settings.configCenter;
    if (!center || typeof center !== 'object') {
      state.flow.settings.configCenter = { definitions: [], values: {} };
    }
    if (!Array.isArray(state.flow.settings.configCenter.definitions)) state.flow.settings.configCenter.definitions = [];
    if (!state.flow.settings.configCenter.values || typeof state.flow.settings.configCenter.values !== 'object') {
      state.flow.settings.configCenter.values = {};
    }
    if (!Array.isArray(state.flow.flow.root.children)) state.flow.flow.root.children = [];
    return state.flow;
  }

  function touch() {
    state.dirty = true;
    renderSaveState();
  }

  function renderSaveState() {
    if (!refs.saveState) return;
    refs.saveState.hidden = !state.dirty;
    refs.saveState.textContent = state.dirty ? '未保存' : '已保存';
    refs.saveState.className = 'lc-badge ' + (state.dirty ? 'lc-badge-warn' : 'lc-badge-success');
    if (refs.dirtyBadge) refs.dirtyBadge.hidden = !state.dirty;
  }

  function walk(list, fn, parent) {
    (list || []).forEach(function (node, index) {
      if (!node || typeof node !== 'object') return;
      fn(node, list, index, parent);
      walk(node.children, fn, node);
      walk(node.elseChildren, fn, node);
    });
  }

  function findNode(id) {
    var found = null;
    walk(state.flow && state.flow.flow.root.children, function (node) {
      if (node.id === id) found = node;
    });
    return found;
  }

  function locate(id) {
    var result = null;
    walk(state.flow && state.flow.flow.root.children, function (node, list, index, parent) {
      if (node.id === id) result = { node: node, list: list, index: index, parent: parent };
    });
    return result;
  }

  function isDescendant(node, id) {
    var hit = false;
    var check = function (list) {
      (list || []).forEach(function (child) {
        if (!child || hit) return;
        if (child.id === id) hit = true;
        else { check(child.children); check(child.elseChildren); }
      });
    };
    check(node.children);
    check(node.elseChildren);
    return hit;
  }

  function countNodes() {
    var total = 0;
    walk(state.flow && state.flow.flow.root.children, function () { total += 1; });
    return total;
  }

  function nextId(type) {
    var def = typeDef(type);
    var prefix = CATEGORY_PREFIX[def && def.category] || 'n';
    var seq = 0;
    var id;
    do {
      seq += 1;
      id = prefix + '_' + Date.now().toString(36).slice(-4) + seq.toString(36);
    } while (findNode(id));
    return id;
  }

  function defaultsFor(type) {
    var def = typeDef(type);
    var params = {};
    if (!def) return params;
    def.fields.forEach(function (field) {
      if (field.default !== undefined) params[field.key] = Array.isArray(field.default) ? [] : field.default;
    });
    return params;
  }

  function createNode(type) {
    var def = typeDef(type);
    if (!def) return null;
    return {
      id: nextId(type),
      type: type,
      name: def.label,
      enabled: true,
      params: defaultsFor(type),
      children: def.container ? [] : undefined,
      elseChildren: def.slots && def.slots.some(function (slot) { return slot.key === 'elseChildren'; }) ? [] : undefined
    };
  }

  function nodeSummary(node) {
    var def = typeDef(node.type);
    var params = node.params || {};
    if (node.type === 'entry.request') return String(params.method || 'GET') + ' ' + String(params.path || '');
    if (node.type === 'db.readCollection' || node.type === 'db.insertCollection') return '集合 ' + String(params.collection || '—');
    if (node.type === 'response.json') return 'HTTP ' + String(params.status || 200);
    if (node.type === 'code.node') return 'custom/';
    if (node.type === 'flow.branch') return 'if / else';
    if (node.type === 'flow.loop') return 'for ' + String(params.itemVar || 'item');
    if (node.type === 'http.request') return String(params.method || 'GET') + ' ' + String(params.url || '—');
    if (node.type === 'file.read' || node.type === 'file.write') return String(params.path || '—');
    return params.output ? '→ ' + params.output : (def ? def.summary : '');
  }

  function typeShort(node) {
    var def = typeDef(node.type);
    if (!def) return '?';
    return { entry: '入口', middleware: '中间', data: '数据', transform: '变换', control: '控制', output: '响应', component: '组件', code: '代码' }[def.category] || def.category;
  }

  /* ---------------------------------------------------------------- 站点与加载 */

  function siteBase() {
    return '/api/sites/' + encodeURIComponent(state.siteId);
  }

  function loadSites() {
    return api('/api/sites').then(function (sites) {
      var all = Array.isArray(sites) ? sites : [];
      /* 后端积木只适用于后端项目；站点选择器里也不出现纯静态项目。 */
      state.sites = all.filter(function (site) { return site.type === 'backend'; });
      if (!state.sites.length) {
        showProjectGate('还没有后端项目，先到工作台新建一个带后端的项目', 'home.html');
        return;
      }
      var params = new URLSearchParams(window.location.search);
      var requested = params.get('site') || '';
      if (!requested) {
        /* 没有项目上下文时不静默落到第一个站点。 */
        showProjectGate('未选择项目：请从 Builder 的后端积木入口进入，或在右上角选择后端项目', 'builder.html');
        return;
      }
      var exists = all.some(function (site) { return site.siteId === requested; });
      if (!exists || !state.sites.some(function (site) { return site.siteId === requested; })) {
        showProjectGate(
          exists ? '项目「' + requested + '」不是后端项目，无法打开后端积木' : '项目不存在：' + requested,
          exists ? 'builder.html?site=' + encodeURIComponent(requested) : 'home.html'
        );
        return;
      }
      return loadFlow(requested);
    });
  }

  function setEditingEnabled(enabled) {
    ['loadSample', 'save', 'validate', 'compile', 'previewStart', 'previewStop', 'flowName'].forEach(function (key) {
      if (refs[key]) refs[key].disabled = !enabled;
    });
  }

  function showProjectGate(message, backHref) {
    state.siteId = '';
    renderSiteSelect();
    setEditingEnabled(false);
    if (refs.backBuilder && backHref) refs.backBuilder.href = backHref;
    setStatus(message, 'warn');
  }

  function renderSiteSelect() {
    if (!refs.siteSelect) return;
    refs.siteSelect.innerHTML = '';
    if (!state.siteId) {
      var placeholder = el('option', null, '选择后端项目…');
      placeholder.value = '';
      refs.siteSelect.appendChild(placeholder);
    }
    state.sites.forEach(function (site) {
      var option = el('option', null, site.name || site.siteId);
      option.value = site.siteId;
      option.selected = site.siteId === state.siteId;
      refs.siteSelect.appendChild(option);
    });
    refs.siteSelect.disabled = state.sites.length < 1;
  }

  function loadFlow(siteId) {
    state.siteId = siteId;
    renderSiteSelect();
    setEditingEnabled(true);
    if (refs.backBuilder) refs.backBuilder.href = 'builder.html?site=' + encodeURIComponent(siteId);
    state.loading = true;
    setStatus('读取流程…');
    return api(siteBase() + '/backend-flow?language=' + LANGUAGE).then(function (data) {
      state.categories = data.categories || [];
      state.typeList = data.nodeTypes || [];
      state.types = {};
      state.typeList.forEach(function (item) { state.types[item.type] = item; });
      state.flow = data.flow;
      state.issues = data.issues || [];
      state.components = data.components || { project: [], global: [] };
      state.preview = data.preview || null;
      state.dirty = false;
      state.collapsed = {};
      safeDoc();
      var entry = findEntry();
      state.selectedId = entry ? entry.id : '';
      state.loading = false;
      if (refs.statusSite) refs.statusSite.textContent = siteId;
      ensurePageOverrideCard();
      renderAll();
      refreshOverrideFiles(['node', state.target]);
      setStatus(data.exists ? '已加载流程草稿' : '项目还没有流程，已载入默认草稿');
      if (!data.exists) state.dirty = true;
      renderSaveState();
    }).catch(function (err) {
      state.loading = false;
      setStatus(err.message, 'error');
      toast(err.message, 'error');
    });
  }

  function findEntry() {
    var entry = null;
    walk(state.flow && state.flow.flow.root.children, function (node) {
      if (!entry && node.type === 'entry.request') entry = node;
    });
    return entry;
  }

  function renderAll() {
    if (!state.flow) return;
    renderLibrary();
    renderFlowHead();
    renderTree();
    renderIssues();
    renderInspector();
    renderPageOverrideCard();
    renderPreview();
    renderSaveState();
    /* 切换站点时组件池会整体变化，面板开着也要跟着换，避免看到上一个项目的组件。 */
    if (state.tab === 'components') renderComponentPanel();
  }

  /* ---------------------------------------------------------------- 左侧节点库 */

  function renderLibrary() {
    if (!refs.nodeLibrary) return;
    refs.nodeLibrary.innerHTML = '';
    var keyword = state.search.trim().toLowerCase();
    var any = false;
    if (state.target !== 'node') {
      refs.nodeLibrary.appendChild(el('div', 'lc-bf-lib-hint',
        '当前目标：' + LANG_LABEL[state.target] + '。每个积木下方标出 Node / Go / Rust 的支持状态；不支持的积木会写出可替换的同类积木。'));
    }
    state.categories.forEach(function (category) {
      var items = state.typeList.filter(function (item) {
        if (item.category !== category.id) return false;
        if (!keyword) return true;
        return (item.label + ' ' + item.summary + ' ' + item.type).toLowerCase().indexOf(keyword) >= 0;
      });
      if (!items.length) return;
      any = true;
      var group = el('div', 'lc-bf-lib-group');
      var title = el('div', 'lc-tree-group-title');
      title.appendChild(el('span', null, category.label));
      title.appendChild(el('span', null, String(items.length)));
      group.appendChild(title);
      if (category.id === 'component') {
        var pool = mergedComponents();
        group.appendChild(el('div', 'lc-bf-lib-hint',
          pool.length ? '项目内 / 全局共 ' + pool.length + ' 个组件' : '还没有组件，到右侧「组件库」新建或导入'));
      }
      items.forEach(function (item) {
        var supported = languageState(item, state.target) === 'ok';
        var button = el('button', 'lc-bf-lib-item' + (supported ? '' : ' is-unavailable'));
        button.type = 'button';
        button.draggable = true;
        button.dataset.type = item.type;
        button.title = item.summary + (supported
          ? '（拖到节点树，或点击插入到选中节点之后）'
          : '（该积木不支持当前目标语言 ' + LANG_LABEL[state.target] + '；' + alternativesText(item, state.target) + '）');
        button.appendChild(el('strong', null, item.label));
        button.appendChild(el('small', null, item.summary));
        if (!supported) {
          var unsupported = el('span', 'lc-bf-lib-unsupported', '不支持 ' + LANG_LABEL[state.target] + ' · ' + alternativesText(item, state.target));
          button.appendChild(unsupported);
        }
        button.appendChild(languageBadges(item, state.target));
        button.addEventListener('dragstart', function (event) {
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData(DRAG_NODE_TYPE, item.type);
        });
        button.addEventListener('click', function () { insertFromLibrary(item.type); });
        group.appendChild(button);
      });
      refs.nodeLibrary.appendChild(group);
    });
    if (!any) refs.nodeLibrary.appendChild(el('div', 'lc-bf-lib-empty', '没有匹配的节点类型'));
  }

  function mergedComponents() {
    var map = {};
    (state.components.project || []).forEach(function (item) { map[item.id] = item; });
    (state.components.global || []).forEach(function (item) {
      if (!map[item.id]) map[item.id] = item;
    });
    return Object.keys(map).map(function (key) { return map[key]; });
  }

  function refreshComponents() {
    if (!state.sites.length) return Promise.resolve();
    return api(siteBase() + '/backend/components').then(function (data) {
      state.components = data || { project: [], global: [] };
      renderLibrary();
      if (state.tab === 'components') renderComponentPanel();
      return state.components;
    }).catch(function (err) {
      setStatus(err.message, 'error');
    });
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function insertFromLibrary(type) {
    var node = createNode(type);
    if (!node) return;
    var def = typeDef(type);
    var support = languageState(def || {}, state.target);
    if (def && support === 'missing') {
      toast('「' + def.label + '」不支持 ' + LANG_LABEL[state.target] + '。' + alternativesText(def, state.target), 'warn');
      return;
    }
    if (def && support === 'design') {
      toast('「' + def.label + '」在 ' + LANG_LABEL[state.target] + ' 只有设计、生成器还没实现；生成时会指出这一段。', 'warn');
    }
    if (def && def.singleton && def.category === 'entry' && findEntry()) {
      toast('流程里已经有入口节点了', 'warn');
      return;
    }
    var selected = state.selectedId ? locate(state.selectedId) : null;
    if (selected && typeDef(selected.node.type) && typeDef(selected.node.type).container) {
      selected.node.children = selected.node.children || [];
      selected.node.children.push(node);
    } else if (selected) {
      selected.list.splice(selected.index + 1, 0, node);
    } else {
      state.flow.flow.root.children.push(node);
    }
    state.selectedId = node.id;
    state.collapsed[selected ? selected.node.id : ''] = false;
    touch();
    renderAll();
  }

  /* ---------------------------------------------------------------- 中间节点树 */

  function renderFlowHead() {
    var flow = state.flow.flow;
    if (refs.flowName) refs.flowName.textContent = flow.name || '流程';
    if (refs.flowTitle) refs.flowTitle.value = flow.name || '';
    if (refs.flowMeta) refs.flowMeta.textContent = 'v' + (Number(flow.treeVersion) || 0);
    if (refs.flowVersion) refs.flowVersion.textContent = 'v' + (Number(flow.treeVersion) || 0);
    if (refs.flowHash) refs.flowHash.textContent = flow.lastTreeHash || '—';
    if (refs.treeCount) refs.treeCount.textContent = countNodes() + ' 个节点';
  }

  function renderTree() {
    if (!refs.tree) return;
    refs.tree.innerHTML = '';
    var children = state.flow.flow.root.children;
    children.forEach(function (node) { refs.tree.appendChild(renderNode(node, 0)); });
    if (refs.treeEmpty) refs.treeEmpty.hidden = children.length > 0;
  }

  function renderNode(node, depth) {
    var def = typeDef(node.type);
    var container = Boolean(def && def.container);
    var collapsed = Boolean(state.collapsed[node.id]);

    var row = el('div', 'lc-tree-item' + (node.enabled === false ? ' is-disabled' : ''));
    row.setAttribute('role', 'treeitem');
    row.dataset.nodeId = node.id;
    row.draggable = true;
    row.style.paddingLeft = (4 + depth * 14) + 'px';
    if (node.id === state.selectedId) {
      row.classList.add('is-active');
      row.setAttribute('aria-selected', 'true');
    }

    var toggle = el('span', 'lc-tree-toggle' + (container ? '' : ' is-empty'), container ? (collapsed ? '▸' : '▾') : '');
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      if (!container) return;
      state.collapsed[node.id] = !collapsed;
      renderTree();
    });
    row.appendChild(toggle);

    row.appendChild(el('span', 'lc-tree-type', typeShort(node)));
    row.appendChild(el('span', 'lc-tree-text', node.name || node.id));
    row.appendChild(el('span', 'lc-tree-meta', nodeSummary(node)));
    if (def && def.codeNode) {
      var covered = Boolean(overrideFile('node', nodeCodeRel(node)));
      row.appendChild(el('span', 'lc-badge ' + (covered ? 'lc-badge-success' : ''), covered ? '已覆盖' : 'custom'));
    }

    var actions = el('span', 'lc-bf-node-actions');
    var switchLabel = el('label', 'lc-bf-mini-switch');
    switchLabel.title = node.enabled === false ? '已禁用，点击启用' : '启用中，点击禁用';
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = node.enabled !== false;
    checkbox.addEventListener('click', function (event) { event.stopPropagation(); });
    checkbox.addEventListener('change', function () {
      node.enabled = checkbox.checked;
      touch();
      renderTree();
      renderInspector();
    });
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(el('span', 'lc-switch-track'));
    actions.appendChild(switchLabel);

    var remove = el('button', 'lc-btn lc-btn-sm', '删除');
    remove.type = 'button';
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      removeNode(node.id);
    });
    actions.appendChild(remove);
    row.appendChild(actions);

    row.addEventListener('click', function () {
      state.selectedId = node.id;
      setTab('node');
      renderTree();
      renderInspector();
    });
    attachDrag(row, node);

    var wrap = document.createDocumentFragment();
    wrap.appendChild(row);
    if (container && !collapsed) {
      (def.slots || [{ key: 'children', label: '子节点' }]).forEach(function (slot) {
        var slotRow = el('div', 'lc-bf-slot');
        slotRow.dataset.slotKey = slot.key;
        slotRow.dataset.nodeId = node.id;
        slotRow.style.marginLeft = (14 + (depth + 1) * 14) + 'px';
        slotRow.appendChild(el('span', null, slot.label));
        attachSlotDrop(slotRow, node, slot.key);
        wrap.appendChild(slotRow);

        var list = node[slot.key] || [];
        list.forEach(function (child) { wrap.appendChild(renderNode(child, depth + 1)); });
        if (!list.length) {
          var empty = el('div', 'lc-bf-slot-empty', slot.label + '为空，拖节点到这里');
          empty.style.marginLeft = (28 + (depth + 1) * 14) + 'px';
          wrap.appendChild(empty);
        }
      });
    }
    return wrap;
  }

  function attachDrag(row, node) {
    row.addEventListener('dragstart', function (event) {
      state.draggingId = node.id;
      state.draggingType = '';
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_NODE_ID, node.id);
    });
    row.addEventListener('dragend', function () {
      state.draggingId = '';
      clearDropMarks();
    });
    row.addEventListener('dragover', function (event) {
      if (!isNodeDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      var mode = dropMode(event, node);
      clearDropMarks();
      row.dataset.drop = mode;
    });
    row.addEventListener('dragleave', function (event) {
      if (event.relatedTarget && row.contains(event.relatedTarget)) return;
      delete row.dataset.drop;
    });
    row.addEventListener('drop', function (event) {
      if (!isNodeDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      var mode = row.dataset.drop || 'after';
      delete row.dataset.drop;
      dropOnNode(node, mode);
    });
  }

  function attachSlotDrop(slotRow, node, slotKey) {
    slotRow.addEventListener('dragover', function (event) {
      if (!isNodeDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      clearDropMarks();
      slotRow.dataset.drop = 'inside';
    });
    slotRow.addEventListener('dragleave', function () { delete slotRow.dataset.drop; });
    slotRow.addEventListener('drop', function (event) {
      if (!isNodeDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      delete slotRow.dataset.drop;
      insertInto(node, slotKey);
    });
  }

  function isNodeDrag(event) {
    var types = event.dataTransfer ? event.dataTransfer.types : [];
    var wanted = [DRAG_NODE_TYPE.toLowerCase(), DRAG_NODE_ID.toLowerCase()];
    return Array.prototype.some.call(types, function (type) {
      return wanted.indexOf(String(type).toLowerCase()) >= 0;
    });
  }

  function dropMode(event, node) {
    var def = typeDef(node.type);
    var rect = event.currentTarget.getBoundingClientRect();
    var ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
    if (def && def.container && ratio > 0.3 && ratio < 0.7) return 'inside';
    return ratio < 0.5 ? 'before' : 'after';
  }

  function clearDropMarks() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-drop]'), function (node) {
      delete node.dataset.drop;
    });
  }

  function dropOnNode(target, mode) {
    var dragId = state.draggingId;
    var dragType = state.draggingType;
    state.draggingId = '';
    var targetDef = typeDef(target.type);

    if (dragId) {
      var dragNode = findNode(dragId);
      if (!dragNode) return;
      if (dragId === target.id || isDescendant(dragNode, target.id)) {
        toast('不能把节点拖进自己的子树', 'warn');
        return;
      }
      var from = locate(dragId);
      if (from) from.list.splice(from.index, 1);
      if (mode === 'inside' && targetDef && targetDef.container) {
        target.children = target.children || [];
        target.children.push(dragNode);
      } else {
        var to = locate(target.id);
        if (!to) { to = { list: state.flow.flow.root.children, index: state.flow.flow.root.children.length - 1 }; }
        var index = mode === 'before' ? to.index : to.index + 1;
        to.list.splice(index, 0, dragNode);
      }
      state.selectedId = dragNode.id;
      touch();
      renderAll();
      return;
    }

    if (dragType) {
      var def = typeDef(dragType);
      if (def && def.singleton && def.category === 'entry' && findEntry()) {
        toast('流程里已经有入口节点了', 'warn');
        return;
      }
      var created = createNode(dragType);
      if (!created) return;
      if (mode === 'inside' && targetDef && targetDef.container) {
        target.children = target.children || [];
        target.children.push(created);
      } else {
        var loc = locate(target.id);
        if (!loc) return;
        loc.list.splice(mode === 'before' ? loc.index : loc.index + 1, 0, created);
      }
      state.selectedId = created.id;
      touch();
      renderAll();
    }
  }

  function insertInto(node, slotKey) {
    var dragId = state.draggingId;
    var dragType = state.draggingType;
    state.draggingId = '';
    node[slotKey] = node[slotKey] || [];
    if (dragId) {
      var dragNode = findNode(dragId);
      if (!dragNode || dragId === node.id || isDescendant(dragNode, node.id)) {
        toast('不能把节点拖进自己的子树', 'warn');
        return;
      }
      var from = locate(dragId);
      if (from) from.list.splice(from.index, 1);
      node[slotKey].push(dragNode);
      state.selectedId = dragNode.id;
    } else if (dragType) {
      var created = createNode(dragType);
      if (!created) return;
      node[slotKey].push(created);
      state.selectedId = created.id;
    } else {
      return;
    }
    touch();
    renderAll();
  }

  function removeNode(id) {
    var loc = locate(id);
    if (!loc) return;
    loc.list.splice(loc.index, 1);
    if (state.selectedId === id) {
      state.selectedId = loc.parent ? loc.parent.id : '';
    }
    touch();
    renderAll();
  }

  /* ---------------------------------------------------------------- 校验结果 */

  function mergedIssues() {
    var list = (state.issues || []).slice();
    var seen = {};
    list.forEach(function (item) { if (item.code) seen[item.code + ':' + (item.nodeId || '')] = true; });
    targetLanguageIssues().forEach(function (item) {
      if (seen[item.code + ':' + (item.nodeId || '')]) return;
      list.push(item);
    });
    return list;
  }

  function renderIssues() {
    if (!refs.issues) return;
    refs.issues.innerHTML = '';
    var issues = mergedIssues();
    var errors = issues.filter(function (item) { return item.level === 'error'; });
    var warnings = issues.filter(function (item) { return item.level !== 'error'; });
    if (!issues.length) {
      var ok = el('div', 'lc-bf-issue-ok');
      ok.appendChild(el('span', 'lc-badge lc-badge-success', '通过'));
      ok.appendChild(el('span', null, '结构、参数、引用与目标语言支持检查均通过。'));
      refs.issues.appendChild(ok);
    }
    issues.forEach(function (issue) {
      var row = el('button', 'lc-bf-issue ' + (issue.level === 'error' ? 'is-error' : 'is-warning'));
      row.type = 'button';
      row.appendChild(el('span', 'lc-badge', issue.level === 'error' ? '错误' : '提示'));
      if (issue.nodeId) row.appendChild(el('code', null, issue.nodeId));
      row.appendChild(el('span', null, (issue.nodeLabel ? issue.nodeLabel + '：' : '') + issue.message));
      if (issue.nodeId && findNode(issue.nodeId)) {
        row.addEventListener('click', function () {
          state.selectedId = issue.nodeId;
          setTab('node');
          renderTree();
          renderInspector();
          var target = refs.tree.querySelector('[data-node-id="' + issue.nodeId + '"]');
          if (target) target.scrollIntoView({ block: 'center' });
        });
      }
      refs.issues.appendChild(row);
    });
    if (refs.issueCount) {
      refs.issueCount.textContent = errors.length + ' 错误 · ' + warnings.length + ' 提示';
      refs.issueCount.className = 'lc-badge ' + (errors.length ? 'lc-badge-danger' : warnings.length ? 'lc-badge-warn' : 'lc-badge-success');
    }
  }

  /* ---------------------------------------------------------------- 右侧面板 */

  function setTab(tab) {
    state.tab = tab;
    tabs.forEach(function (button) {
      var active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Object.keys(panels).forEach(function (key) { panels[key].hidden = key !== tab; });
    if (refs.tabHint) {
      refs.tabHint.textContent = tab === 'node'
        ? '选中节点后，字段按节点类型 schema 生成。'
        : tab === 'middleware'
          ? '中间件按固定优先级执行，与树中位置无关；开关即启用/禁用。'
          : tab === 'components'
            ? '后端组件与前端组件并列：项目内或全局保存，可导入导出，带自己的参数 schema 与多语言实现。'
            : '配置项会写入预览配置；标记为密钥的项只从环境变量读取，不落文件。';
    }
    renderInspector();
  }

  function renderInspector() {
    if (state.tab === 'node') renderNodePanel();
    else if (state.tab === 'middleware') renderMiddlewarePanel();
    else if (state.tab === 'components') renderComponentPanel();
    else renderConfigPanel();
  }

  function fieldWrap(field) {
    var wrap = el('label', 'lc-field' + (field.width === 'short' ? ' is-short' : field.width === 'medium' ? ' is-medium' : ' lc-bf-full'));
    var label = el('span', 'lc-label', field.label || field.key);
    if (field.required) label.appendChild(el('small', null, '必填'));
    wrap.appendChild(label);
    if (field.hint) wrap.appendChild(el('p', 'lc-hint', field.hint));
    return wrap;
  }

  function renderNodePanel() {
    var panel = panels.node;
    if (!panel) return;
    panel.innerHTML = '';
    var loc = state.selectedId ? locate(state.selectedId) : null;
    if (!loc) {
      panel.appendChild(el('p', 'lc-inspector-hint', '还没有选中节点。点左侧树里的节点，或从节点库拖入一个。'));
      return;
    }
    var node = loc.node;
    var def = typeDef(node.type) || { label: node.type, fields: [], summary: '' };

    var head = el('div', 'lc-bf-node-head');
    head.appendChild(el('span', 'lc-tree-type', typeShort(node)));
    head.appendChild(el('strong', null, def.label));
    var enabledLabel = el('label', 'lc-switch');
    var enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = node.enabled !== false;
    enabledInput.addEventListener('change', function () {
      node.enabled = enabledInput.checked;
      touch();
      renderTree();
    });
    enabledLabel.appendChild(enabledInput);
    enabledLabel.appendChild(el('span', 'lc-switch-track'));
    enabledLabel.appendChild(el('span', null, '启用'));
    head.appendChild(enabledLabel);
    panel.appendChild(head);

    var langRow = el('div', 'lc-bf-lang-row');
    langRow.appendChild(el('span', 'lc-label', '语言支持'));
    langRow.appendChild(languageBadges(def, state.target));
    var support = languageState(def, state.target);
    langRow.appendChild(el('span', 'lc-hint',
      support === 'ok'
        ? '当前目标 ' + LANG_LABEL[state.target] + '：已实现'
        : support === 'design'
          ? '当前目标 ' + LANG_LABEL[state.target] + '：设计上支持，生成器还没实现'
          : '当前目标 ' + LANG_LABEL[state.target] + ' 不支持这个积木。' + alternativesText(def, state.target)));
    panel.appendChild(langRow);

    var grid = el('div', 'lc-bf-field-grid');
    var nameField = fieldWrap({ key: 'name', label: '节点名称', width: 'full' });
    var nameInput = el('input', 'lc-input');
    nameInput.type = 'text';
    nameInput.maxLength = 64;
    nameInput.value = node.name || '';
    nameInput.addEventListener('input', function () {
      node.name = nameInput.value;
      touch();
      var rowText = refs.tree.querySelector('[data-node-id="' + node.id + '"] .lc-tree-text');
      if (rowText) rowText.textContent = node.name || node.id;
    });
    nameField.appendChild(nameInput);
    grid.appendChild(nameField);

    var idField = fieldWrap({ key: 'id', label: '节点 id', width: 'short', hint: '稳定标识，生成代码与用户代码文件名都用它。' });
    var idInput = el('input', 'lc-input lc-data-mono');
    idInput.type = 'text';
    idInput.value = node.id;
    idInput.readOnly = true;
    idField.appendChild(idInput);
    grid.appendChild(idField);
    panel.appendChild(grid);

    var fields = el('div', 'lc-bf-field-grid');
    fields.style.marginTop = 'var(--lc-space-3)';
    (def.fields || []).forEach(function (field) {
      var item = renderField(node, field);
      if (item) fields.appendChild(item);
    });
    panel.appendChild(fields);

    if (node.type === 'component.custom') {
      var componentForm = renderComponentParams(node);
      if (componentForm) panel.appendChild(componentForm);
    }

    if (def.codeNode) {
      var note = el('div', 'lc-bf-code-note');
      note.appendChild(el('strong', null, '用户代码，不会被生成过程改写'));
      var noteCovered = Boolean(overrideFile('node', codePathFor(node.id)));
      note.appendChild(el('span', 'lc-badge ' + (noteCovered ? 'lc-badge-success' : ''), noteCovered ? '已覆盖' : '跟随生成'));
      note.appendChild(el('code', null, codePathFor(node.id)));
      note.appendChild(el('p', 'lc-hint', '重新生成只会更新生成区（src/generated），这个文件保持不变，由你直接维护。'));
      var edit = el('button', 'lc-btn lc-btn-sm lc-btn-primary', '编辑用户代码');
      edit.type = 'button';
      edit.addEventListener('click', function () { openCodeDialog(node.id); });
      note.appendChild(edit);
      panel.appendChild(note);
    }

    var actions = el('div', 'lc-bf-inline-actions');
    var remove = el('button', 'lc-btn lc-btn-sm lc-btn-danger', '删除节点');
    remove.type = 'button';
    remove.addEventListener('click', function () { removeNode(node.id); });
    actions.appendChild(remove);
    panel.appendChild(actions);
  }

  function componentArgs(node) {
    var raw = node.params && node.params.args;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return Object.assign({}, raw);
    try {
      var parsed = JSON.parse(raw || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function renderComponentParams(node) {
    var componentId = String((node.params && node.params.component) || '');
    var component = mergedComponents().find(function (item) { return item.id === componentId; });
    if (!component || !Array.isArray(component.params) || !component.params.length) return null;
    var args = componentArgs(node);
    var box = el('div', 'lc-bf-component-args');
    var head = el('div', 'lc-bf-issue-head');
    head.appendChild(el('strong', null, '组件参数'));
    head.appendChild(el('span', null, component.name + ' · v' + component.version));
    box.appendChild(head);
    var grid = el('div', 'lc-bf-field-grid');
    component.params.forEach(function (param) {
      var wrap = fieldWrap({
        key: param.key,
        label: param.label || param.key,
        width: param.kind === 'json' ? 'full' : 'medium',
        required: param.required,
        hint: param.hint
      });
      var input;
      if (param.kind === 'toggle') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = args[param.key] === true;
        input.addEventListener('change', function () {
          args[param.key] = input.checked;
          node.params.args = JSON.stringify(args, null, 2);
          touch();
        });
      } else if (param.kind === 'select') {
        input = el('select', 'lc-select');
        (param.options || []).forEach(function (option) {
          var opt = el('option', null, String(option));
          opt.value = String(option);
          input.appendChild(opt);
        });
        input.value = args[param.key] == null ? String(param.default || '') : String(args[param.key]);
        input.addEventListener('change', function () {
          args[param.key] = input.value;
          node.params.args = JSON.stringify(args, null, 2);
          touch();
        });
      } else if (param.kind === 'json') {
        input = el('textarea', 'lc-textarea lc-data-mono');
        input.rows = 4;
        input.value = args[param.key] === undefined ? '{}' : JSON.stringify(args[param.key], null, 2);
        input.addEventListener('input', function () {
          try {
            args[param.key] = JSON.parse(input.value || 'null');
            input.classList.remove('is-invalid');
          } catch (err) {
            input.classList.add('is-invalid');
            return;
          }
          node.params.args = JSON.stringify(args, null, 2);
          touch();
        });
      } else if (param.kind === 'number') {
        input = el('input', 'lc-input');
        input.type = 'number';
        input.value = args[param.key] == null ? String(param.default == null ? '' : param.default) : String(args[param.key]);
        input.addEventListener('input', function () {
          args[param.key] = input.value === '' ? '' : Number(input.value);
          node.params.args = JSON.stringify(args, null, 2);
          touch();
        });
      } else {
        input = el('input', 'lc-input');
        input.type = 'text';
        input.value = args[param.key] == null ? String(param.default == null ? '' : param.default) : String(args[param.key]);
        input.addEventListener('input', function () {
          args[param.key] = input.value;
          node.params.args = JSON.stringify(args, null, 2);
          touch();
        });
      }
      wrap.appendChild(input);
      grid.appendChild(wrap);
    });
    box.appendChild(grid);
    box.appendChild(el('p', 'lc-hint', '这些值写入节点的 args，生成时作为组件的第二个参数传入；代码实现仍在组件库里维护。'));
    return box;
  }

  function renderField(node, field) {
    if (field.kind === 'params') return renderParamsField(node, field);
    var wrap = fieldWrap(field);
    var value = node.params ? node.params[field.key] : undefined;
    var input;

    if (field.kind === 'select') {
      input = el('select', 'lc-select');
      var options = (field.options || []).slice();
      if (field.componentOptions) {
        var pool = mergedComponents();
        options = pool.map(function (item) {
          return item.id + ' · ' + item.name + (item.scope === 'global' ? '（全局）' : '（项目）');
        });
        if (!pool.length) options = ['（还没有组件，请到「组件库」创建）'];
      }
      options.forEach(function (option) {
        var opt = el('option', null, String(option));
        opt.value = String(option).split(' · ')[0];
        input.appendChild(opt);
      });
      input.value = value == null ? (field.default || '') : String(value);
      input.addEventListener('change', function () {
        node.params[field.key] = input.value;
        touch();
        updateRowMeta(node);
      });
    } else if (field.kind === 'toggle') {
      var label = el('label', 'lc-switch');
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value === true;
      input.addEventListener('change', function () {
        node.params[field.key] = input.checked;
        touch();
      });
      label.appendChild(input);
      label.appendChild(el('span', 'lc-switch-track'));
      label.appendChild(el('span', null, input.checked ? '开启' : '关闭'));
      input.addEventListener('change', function () { label.lastChild.textContent = input.checked ? '开启' : '关闭'; });
      wrap.appendChild(label);
      return wrap;
    } else if (field.kind === 'textarea') {
      input = el('textarea', 'lc-textarea' + (field.json ? ' lc-data-mono' : ''));
      input.rows = field.rows || 4;
      input.value = value == null ? '' : String(value);
      input.addEventListener('input', function () {
        node.params[field.key] = input.value;
        touch();
      });
    } else if (field.kind === 'number') {
      input = el('input', 'lc-input');
      input.type = 'number';
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      input.value = value == null ? '' : String(value);
      input.addEventListener('input', function () {
        node.params[field.key] = input.value === '' ? '' : Number(input.value);
        touch();
      });
    } else {
      input = el('input', 'lc-input' + (field.kind === 'expression' ? ' lc-data-mono' : ''));
      input.type = 'text';
      input.value = value == null ? '' : String(value);
      if (field.placeholder) input.placeholder = field.placeholder;
      input.addEventListener('input', function () {
        node.params[field.key] = input.value;
        touch();
        updateRowMeta(node);
      });
    }
    wrap.appendChild(input);
    return wrap;
  }

  function renderParamsField(node, field) {
    var wrap = el('div', 'lc-bf-full');
    wrap.style.flex = '1 1 100%';
    var head = el('div', 'lc-bf-card-head');
    head.style.margin = '0 0 var(--lc-space-2)';
    head.appendChild(el('h3', null, field.label));
    if (field.hint) head.appendChild(el('p', null, field.hint));
    var add = el('button', 'lc-btn lc-btn-sm', '添加参数');
    add.type = 'button';
    add.style.marginLeft = 'auto';
    head.appendChild(add);
    wrap.appendChild(head);

    node.params[field.key] = Array.isArray(node.params[field.key]) ? node.params[field.key] : [];
    var list = node.params[field.key];

    if (!list.length) wrap.appendChild(el('div', 'lc-bf-param-empty', '还没有参数；缺必填参数会在运行时返回 400。'));
    else {
      var table = el('table', 'lc-bf-param-table');
      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      (field.columns || []).forEach(function (column) { headRow.appendChild(el('th', null, column.label)); });
      headRow.appendChild(el('th', null, ''));
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = document.createElement('tbody');
      list.forEach(function (item, index) {
        var row = document.createElement('tr');
        (field.columns || []).forEach(function (column) {
          var cell = document.createElement('td');
          if (column.kind === 'select') {
            var select = el('select', 'lc-select');
            (column.options || []).forEach(function (option) { select.appendChild(el('option', null, option)); });
            select.value = item[column.key] || column.default || '';
            select.addEventListener('change', function () {
              item[column.key] = select.value;
              touch();
            });
            cell.appendChild(select);
          } else if (column.kind === 'toggle') {
            var label = el('label', 'lc-switch');
            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = item[column.key] === true;
            checkbox.addEventListener('change', function () {
              item[column.key] = checkbox.checked;
              touch();
            });
            label.appendChild(checkbox);
            label.appendChild(el('span', 'lc-switch-track'));
            cell.appendChild(label);
          } else {
            var input = el('input', 'lc-input');
            input.type = 'text';
            input.value = item[column.key] == null ? '' : String(item[column.key]);
            input.addEventListener('input', function () {
              item[column.key] = input.value;
              touch();
            });
            cell.appendChild(input);
          }
          row.appendChild(cell);
        });
        var actionCell = document.createElement('td');
        var remove = el('button', 'lc-btn lc-btn-sm', '×');
        remove.type = 'button';
        remove.title = '删除该参数';
        remove.addEventListener('click', function () {
          list.splice(index, 1);
          touch();
          renderInspector();
        });
        actionCell.appendChild(remove);
        row.appendChild(actionCell);
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
    }

    add.addEventListener('click', function () {
      var item = {};
      (field.columns || []).forEach(function (column) {
        item[column.key] = column.default !== undefined ? column.default : (column.kind === 'toggle' ? false : '');
      });
      list.push(item);
      touch();
      renderInspector();
    });
    return wrap;
  }

  function updateRowMeta(node) {
    var row = refs.tree.querySelector('[data-node-id="' + node.id + '"]');
    if (!row) return;
    var meta = row.querySelector('.lc-tree-meta');
    if (meta) meta.textContent = nodeSummary(node);
    var text = row.querySelector('.lc-tree-text');
    if (text) text.textContent = node.name || node.id;
  }

  function collectMiddleware() {
    var list = [];
    walk(state.flow.flow.root.children, function (node) {
      var def = typeDef(node.type);
      if (def && def.category === 'middleware') list.push({ node: node, def: def });
    });
    list.sort(function (a, b) { return (a.def.middlewarePriority || 99) - (b.def.middlewarePriority || 99); });
    return list;
  }

  function renderMiddlewarePanel() {
    var panel = panels.middleware;
    if (!panel) return;
    panel.innerHTML = '';
    panel.appendChild(el('p', 'lc-inspector-hint', '中间件按固定优先级执行：CORS → 日志 → 鉴权 → 限流。开关只影响是否启用，不改变顺序。'));

    var all = collectMiddleware();
    if (!all.length) panel.appendChild(el('p', 'lc-hint', '流程里还没有中间件。用下面的按钮快速添加。'));

    all.forEach(function (item) {
      var row = el('div', 'lc-bf-mw' + (item.node.enabled === false ? ' is-off' : ''));
      var label = el('label', 'lc-switch');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.node.enabled !== false;
      checkbox.addEventListener('change', function () {
        item.node.enabled = checkbox.checked;
        touch();
        renderMiddlewarePanel();
        renderTree();
      });
      label.appendChild(checkbox);
      label.appendChild(el('span', 'lc-switch-track'));
      row.appendChild(label);

      var main = el('div', 'lc-bf-mw-main');
      main.appendChild(el('strong', null, item.def.label));
      main.appendChild(el('small', null, '优先级 ' + (item.def.middlewarePriority || '-') + ' · ' + item.node.id));
      row.appendChild(main);

      var go = el('button', 'lc-btn lc-btn-sm', '设置');
      go.type = 'button';
      go.addEventListener('click', function () {
        state.selectedId = item.node.id;
        setTab('node');
        renderTree();
      });
      row.appendChild(go);
      panel.appendChild(row);
    });

    var title = el('div', 'lc-tree-group-title');
    title.appendChild(el('span', null, '添加中间件'));
    panel.appendChild(title);
    var grid = el('div', 'lc-bf-inline-actions');
    ['middleware.cors', 'middleware.log', 'middleware.auth', 'middleware.rateLimit'].forEach(function (type) {
      var def = typeDef(type);
      if (!def) return;
      var button = el('button', 'lc-btn lc-btn-sm', def.label);
      button.type = 'button';
      button.disabled = all.some(function (item) { return item.node.type === type; });
      button.title = button.disabled ? '该中间件已在流程里' : '追加到流程根节点';
      button.addEventListener('click', function () {
        var created = createNode(type);
        state.flow.flow.root.children.push(created);
        state.selectedId = created.id;
        touch();
        renderAll();
        setTab('node');
      });
      grid.appendChild(button);
    });
    panel.appendChild(grid);
  }

  function configCenter() {
    safeDoc();
    return state.flow.settings.configCenter;
  }

  function renderConfigPanel() {
    var panel = panels.config;
    if (!panel) return;
    panel.innerHTML = '';
    panel.appendChild(el('p', 'lc-inspector-hint', '配置中心的值会写进预览配置；标记为密钥的项只从环境变量 LC_CFG_* 读取，界面和文件都不保存明文。'));

    var center = configCenter();
    if (!center.definitions.length) {
      panel.appendChild(el('p', 'lc-hint', '还没有配置项。'));
    }

    center.definitions.forEach(function (def, index) {
      var card = el('div', 'lc-bf-config-item');
      var grid = el('div', 'lc-bf-config-grid');

      var keyField = el('label', 'lc-field is-medium');
      keyField.appendChild(el('span', 'lc-label', '键名'));
      var keyInput = el('input', 'lc-input lc-data-mono');
      keyInput.type = 'text';
      keyInput.value = def.key || '';
      keyInput.placeholder = 'appName';
      keyInput.addEventListener('input', function () {
        var oldKey = def.key;
        def.key = keyInput.value;
        if (oldKey && center.values[oldKey] !== undefined && def.key !== oldKey) {
          center.values[def.key] = center.values[oldKey];
          delete center.values[oldKey];
        }
        touch();
      });
      keyField.appendChild(keyInput);
      grid.appendChild(keyField);

      var typeField = el('label', 'lc-field is-short');
      typeField.appendChild(el('span', 'lc-label', '类型'));
      var typeSelect = el('select', 'lc-select');
      ['string', 'number', 'bool', 'enum'].forEach(function (type) {
        var option = el('option', null, type);
        option.value = type;
        typeSelect.appendChild(option);
      });
      typeSelect.value = def.type || 'string';
      typeSelect.addEventListener('change', function () {
        def.type = typeSelect.value;
        touch();
        renderConfigPanel();
      });
      typeField.appendChild(typeSelect);
      grid.appendChild(typeField);

      var secretField = el('label', 'lc-field is-short');
      secretField.appendChild(el('span', 'lc-label', '密钥'));
      var secretLabel = el('label', 'lc-switch');
      var secretInput = document.createElement('input');
      secretInput.type = 'checkbox';
      secretInput.checked = def.secret === true;
      secretInput.addEventListener('change', function () {
        def.secret = secretInput.checked;
        if (def.secret) {
          def.default = '';
          delete center.values[def.key];
        }
        touch();
        renderConfigPanel();
      });
      secretLabel.appendChild(secretInput);
      secretLabel.appendChild(el('span', 'lc-switch-track'));
      secretLabel.appendChild(el('span', null, secretInput.checked ? '只读环境变量' : '普通配置'));
      secretField.appendChild(secretLabel);
      grid.appendChild(secretField);

      var defaultField = el('label', 'lc-field is-medium');
      defaultField.appendChild(el('span', 'lc-label', '默认值'));
      var defaultInput = el('input', 'lc-input');
      defaultInput.type = 'text';
      defaultInput.disabled = def.secret === true;
      defaultInput.value = def.default == null ? '' : String(def.default);
      defaultInput.placeholder = def.secret === true ? '密钥项不允许默认值' : '可留空';
      defaultInput.addEventListener('input', function () {
        def.default = defaultInput.value;
        touch();
      });
      defaultField.appendChild(defaultInput);
      grid.appendChild(defaultField);

      if (def.type === 'enum') {
        var enumField = el('label', 'lc-field is-medium');
        enumField.appendChild(el('span', 'lc-label', '枚举值'));
        var enumInput = el('input', 'lc-input');
        enumInput.type = 'text';
        enumInput.value = Array.isArray(def.enum) ? def.enum.join(', ') : '';
        enumInput.placeholder = 'a, b, c';
        enumInput.addEventListener('input', function () {
          def.enum = enumInput.value.split(',').map(function (item) { return item.trim(); }).filter(Boolean);
          touch();
        });
        enumField.appendChild(enumInput);
        grid.appendChild(enumField);
      }

      var descField = el('label', 'lc-field lc-bf-full');
      descField.appendChild(el('span', 'lc-label', '说明'));
      var descInput = el('input', 'lc-input');
      descInput.type = 'text';
      descInput.value = def.description || '';
      descInput.addEventListener('input', function () {
        def.description = descInput.value;
        touch();
      });
      descField.appendChild(descInput);
      grid.appendChild(descField);
      card.appendChild(grid);

      var foot = el('div', 'lc-bf-config-foot');
      if (def.secret === true) {
        foot.appendChild(el('code', null, '环境变量：LC_CFG_' + String(def.key || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')));
      } else {
        var valueInput = el('input', 'lc-input');
        valueInput.type = 'text';
        valueInput.placeholder = '项目值（留空使用默认值）';
        valueInput.value = center.values[def.key] == null ? '' : String(center.values[def.key]);
        valueInput.addEventListener('input', function () {
          if (valueInput.value === '') delete center.values[def.key];
          else center.values[def.key] = valueInput.value;
          touch();
        });
        foot.appendChild(valueInput);
      }
      var remove = el('button', 'lc-btn lc-btn-sm lc-btn-danger', '删除');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        center.definitions.splice(index, 1);
        delete center.values[def.key];
        touch();
        renderConfigPanel();
      });
      foot.appendChild(remove);
      card.appendChild(foot);
      panel.appendChild(card);
    });

    var add = el('button', 'lc-btn lc-btn-sm lc-btn-primary', '添加配置项');
    add.type = 'button';
    add.addEventListener('click', function () {
      center.definitions.push({ key: 'config' + (center.definitions.length + 1), type: 'string', default: '', secret: false, description: '' });
      touch();
      renderConfigPanel();
    });
    panel.appendChild(add);
  }

  /* ---------------------------------------------------------------- 页面级覆盖 */

  function ensurePageOverrideCard() {
    if (state.pageCard || !refs.tree) return;
    var treeCard = refs.tree.closest ? refs.tree.closest('.lc-bf-card') : null;
    if (!treeCard || !treeCard.parentNode) return;
    var card = el('section', 'lc-bf-card');
    card.dataset.pageOverrideCard = 'true';
    treeCard.parentNode.insertBefore(card, treeCard);
    state.pageCard = card;
  }

  function renderPageOverrideCard() {
    if (!state.pageCard) return;
    var card = state.pageCard;
    card.innerHTML = '';
    var target = state.target;
    var supported = target === 'node';
    var rel = pageOverrideRel(target);
    var covered = supported && Boolean(overrideFile(target, rel));

    var head = el('header', 'lc-bf-card-head');
    head.appendChild(el('h3', null, '页面级代码覆盖'));
    head.appendChild(el('p', null, supported
      ? '当前目标 ' + LANG_LABEL[target] + '：入口、参数校验和中间件仍由生成区负责，业务处理交给用户区文件；重新生成不会改写它。'
      : '页面级覆盖目前只对 Node 目标开放；' + LANG_LABEL[target] + ' 目标请在用户区自定义路由里实现。'));
    var badge = el('span', 'lc-badge ' + (covered ? 'lc-badge-success' : ''), covered ? '已覆盖' : supported ? '跟随生成' : '未开放');
    var right = el('span', 'is-right');
    right.appendChild(badge);
    head.appendChild(right);
    card.appendChild(head);

    if (!supported) return;

    var row = el('div', 'lc-bf-preview-row');
    row.appendChild(el('code', null, rel));
    var edit = el('button', 'lc-btn lc-btn-sm lc-btn-primary', covered ? '编辑用户代码' : '覆盖页面代码');
    edit.type = 'button';
    edit.dataset.pageOverrideEdit = 'true';
    var restore = el('button', 'lc-btn lc-btn-sm', '恢复原样');
    restore.type = 'button';
    restore.dataset.pageOverrideRestore = 'true';
    restore.hidden = !covered;
    row.appendChild(edit);
    row.appendChild(restore);
    card.appendChild(row);

    card.appendChild(el('p', 'lc-hint',
      covered
        ? '用户区已有这个文件，生成区只会 import 它；点「恢复原样」删除用户文件并回到生成区逻辑。'
        : '点「覆盖页面代码」会在用户区创建入口文件，之后整段业务逻辑都由你维护。'));
  }

  function restorePageOverride() {
    var language = state.target;
    var rel = pageOverrideRel(language);
    if (!window.confirm('恢复原样会删除用户区文件：' + rel + '，继续？')) return;
    api(siteBase() + '/code/backend', { method: 'DELETE', body: { language: language, path: rel } })
      .then(function () {
        refreshOverrideFiles([language]);
        toast('已恢复原样：页面级用户代码已删除，生成区重新接管');
      })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function defaultPageTemplate(language) {
    return [
      '// [LC-CUSTOM] 页面级用户代码 · 生成过程不会改写。',
      '// ctx: { request, reply, deps, vars }；返回 { status?, headers?, body } 或直接返回 body。',
      'export async function run(ctx) {',
      '  const { request, deps } = ctx',
      '  return {',
      '    ok: true,',
      '    method: request.method,',
      '    url: request.url,',
      '    hasDeps: Boolean(deps)',
      '  }',
      '}',
      ''
    ].join('\n');
  }

  /* ---------------------------------------------------------------- 代码弹窗（节点级 / 页面级共用） */

  function ensureCodeRestoreButton() {
    if (!refs.codeDialog || refs.codeRestore) return;
    var host = refs.codeDialog.querySelector('.lc-bf-dialog-head .is-right');
    if (!host) return;
    var restore = document.createElement('button');
    restore.className = 'lc-btn lc-btn-sm';
    restore.type = 'button';
    restore.textContent = '恢复原样';
    restore.setAttribute('data-code-restore', '');
    host.insertBefore(restore, host.querySelector('[data-code-cancel]'));
    refs.codeRestore = restore;
    restore.addEventListener('click', restoreCode);
  }

  function currentCodeLanguage() {
    return state.codePageMode ? state.target : state.codeLanguage;
  }

  function currentCodeRel() {
    if (state.codePageMode) return pageOverrideRel();
    var node = state.codeNodeId ? findNode(state.codeNodeId) : null;
    return nodeCodeRel(node);
  }

  function restoreCode() {
    if (!state.siteId) return;
    var rel = currentCodeRel();
    var language = currentCodeLanguage();
    if (!window.confirm('恢复原样会删除用户区文件：' + rel + '，继续？')) return;
    api(siteBase() + '/code/backend', { method: 'DELETE', body: { language: language, path: rel } })
      .then(function () {
        if (refs.codeResult) {
          refs.codeResult.className = 'lc-code-result is-ok';
          refs.codeResult.textContent = '已恢复原样：用户区文件已删除，生成区重新接管。';
        }
        if (refs.codeRestore) refs.codeRestore.hidden = true;
        var template = state.codePageMode ? defaultPageTemplate(language) : defaultCodeTemplate(findNode(state.codeNodeId));
        if (state.editor) state.editor.setValue(template, { silent: true });
        refreshOverrideFiles([language]);
        toast('已恢复原样');
      })
      .catch(function (err) {
        if (refs.codeResult) {
          refs.codeResult.className = 'lc-code-result is-fail';
          refs.codeResult.textContent = err.message;
        }
        toast(err.message, 'error');
      });
  }

  /* ---------------------------------------------------------------- 保存 / 校验 / 生成 */

  function save() {
    if (!state.siteId || !state.flow) return Promise.resolve();
    safeDoc();
    setStatus('保存中…');
    return api(siteBase() + '/backend-flow', { method: 'PUT', body: { language: LANGUAGE, doc: state.flow } })
      .then(function (data) {
        state.flow = data.flow;
        state.issues = data.issues || [];
        state.dirty = false;
        renderAll();
        setStatus('已保存');
        if (data.createdCodeFiles && data.createdCodeFiles.length) {
          toast('已创建用户代码文件：' + data.createdCodeFiles.join('、'));
        }
      })
      .catch(function (err) {
        setStatus(err.message, 'error');
        toast(err.message, 'error');
        throw err;
      });
  }

  function validate() {
    return save().then(function () {
      return api(siteBase() + '/backend-flow/validate?language=' + LANGUAGE + '&target=' + state.target, { method: 'POST' });
    }).then(function (data) {
      state.issues = data.issues || [];
      renderIssues();
      setStatus(data.ok ? '校验通过' : '校验发现问题', data.ok ? '' : 'warn');
      toast(data.ok ? '校验通过' : '校验发现问题，请查看校验结果', data.ok ? '' : 'warn');
    }).catch(function (err) {
      if (err.issues && err.issues.length) {
        state.issues = err.issues;
        renderIssues();
      }
      setStatus(err.message, 'error');
      toast(err.message, 'error');
    });
  }

  function compile() {
    safeDoc();
    setStatus('生成中…');
    return api(siteBase() + '/backend-flow/compile', { method: 'POST', body: { language: LANGUAGE, doc: state.flow, target: state.target } })
      .then(function (data) {
        state.flow = data.flow || state.flow;
        state.issues = data.issues || [];
        state.dirty = false;
        renderAll();
        renderGeneration(data);
        setStatus('已生成 v' + data.treeVersion);
        toast('已生成节点树 v' + data.treeVersion + '（' + data.treeHash + '）');
      })
      .catch(function (err) {
        if (err.issues && err.issues.length) {
          state.issues = err.issues;
          renderIssues();
        }
        setStatus(err.message, 'error');
        toast(err.message, 'error');
      });
  }

  function renderGeneration(data) {
    if (!refs.generation) return;
    refs.generation.hidden = false;
    refs.generationMeta.textContent = 'v' + data.treeVersion + ' · ' + data.treeHash + ' · ' + (data.buildDir || '');
    refs.generationFiles.innerHTML = '';
    (data.files || []).forEach(function (file) {
      var details = el('details', 'lc-bf-file');
      var summary = document.createElement('summary');
      summary.appendChild(el('span', null, file.path));
      summary.appendChild(el('span', null, formatBytes(file.bytes)));
      details.appendChild(summary);
      var pre = el('pre', null, file.content || '');
      details.appendChild(pre);
      refs.generationFiles.appendChild(details);
    });
    if (!(data.files || []).length) refs.generationFiles.appendChild(el('p', 'lc-hint', '没有生成文件。'));
  }

  function formatBytes(bytes) {
    var size = Number(bytes) || 0;
    return size < 1024 ? size + ' B' : (size / 1024).toFixed(1) + ' KB';
  }

  /* ---------------------------------------------------------------- 预览 */

  function renderPreview() {
    var preview = state.preview;
    var running = preview && preview.running !== false;
    if (refs.previewState) {
      refs.previewState.textContent = running ? '运行中' : '未启动';
      refs.previewState.className = 'lc-badge ' + (running ? 'lc-badge-success' : '');
    }
    if (refs.previewUrl) refs.previewUrl.textContent = running ? preview.url : '—';
    if (refs.previewStop) refs.previewStop.disabled = !running;
    if (refs.previewStart) refs.previewStart.disabled = false;
  }

  function startPreview() {
    safeDoc();
    setStatus('准备隔离预览…');
    return api(siteBase() + '/backend-flow/preview/start', { method: 'POST', body: { language: LANGUAGE, doc: state.flow } })
      .then(function (data) {
        state.flow = data.flow || state.flow;
        state.preview = { url: data.url, running: true, port: data.port, treeVersion: data.treeVersion };
        state.dirty = false;
        renderAll();
        setStatus('预览运行在 ' + data.url);
        toast('预览已启动（临时 SQLite，停止后自动删除）');
      })
      .catch(function (err) {
        if (err.issues && err.issues.length) {
          state.issues = err.issues;
          renderIssues();
        }
        setStatus(err.message, 'error');
        toast(err.message, 'error');
      });
  }

  function stopPreview() {
    return api(siteBase() + '/backend-flow/preview/stop', { method: 'POST' })
      .then(function () {
        state.preview = null;
        renderPreview();
        setStatus('预览已停止');
      })
      .catch(function (err) {
        toast(err.message, 'error');
      });
  }

  function sendRequest() {
    if (!state.preview) {
      toast('先启动预览', 'warn');
      return;
    }
    var method = refs.reqMethod.value;
    var path = refs.reqPath.value.trim() || '/';
    var body;
    if (method !== 'GET' && refs.reqBody.value.trim()) {
      try {
        body = JSON.parse(refs.reqBody.value);
      } catch (err) {
        toast('请求体不是合法 JSON：' + err.message, 'error');
        return;
      }
    }
    refs.reqSend.disabled = true;
    refs.reqMeta.hidden = false;
    refs.reqMeta.textContent = '请求中…';
    refs.reqResult.hidden = true;
    api(siteBase() + '/backend-flow/preview/request', { method: 'POST', body: { method: method, path: path, body: body } })
      .then(function (data) {
        refs.reqMeta.hidden = false;
        refs.reqMeta.textContent = method + ' ' + path + ' → ' + data.status + '（' + data.ms + 'ms）' + (data.truncated ? ' · 已截断' : '');
        refs.reqResult.hidden = false;
        refs.reqResult.className = 'lc-bf-response ' + (data.status < 400 ? 'is-ok' : 'is-fail');
        var text = data.body;
        try { text = JSON.stringify(JSON.parse(data.body), null, 2); } catch (err) { /* 非 JSON 原样显示 */ }
        refs.reqResult.textContent = text;
      })
      .catch(function (err) {
        refs.reqMeta.hidden = false;
        refs.reqMeta.textContent = '请求失败';
        refs.reqResult.hidden = false;
        refs.reqResult.className = 'lc-bf-response is-fail';
        refs.reqResult.textContent = err.message;
      })
      .then(function () {
        refs.reqSend.disabled = false;
      });
  }

  /* ---------------------------------------------------------------- 组件库 */

  function defaultComponentDraft() {
    return {
      id: '',
      name: '',
      description: '',
      scope: 'project',
      version: 1,
      languages: ['node'],
      implementedLanguages: ['node'],
      params: [],
      code: { node: '' }
    };
  }

  function insertComponentNode(componentId) {
    var node = createNode('component.custom');
    if (!node) return;
    node.params.component = componentId;
    node.params.output = 'componentResult';
    var selected = state.selectedId ? locate(state.selectedId) : null;
    if (selected && typeDef(selected.node.type) && typeDef(selected.node.type).container) {
      selected.node.children = selected.node.children || [];
      selected.node.children.push(node);
    } else if (selected) {
      selected.list.splice(selected.index + 1, 0, node);
    } else {
      state.flow.flow.root.children.push(node);
    }
    state.selectedId = node.id;
    touch();
    renderAll();
    setTab('node');
  }

  function renderComponentPanel() {
    var panel = panels.components;
    if (!panel) return;
    panel.innerHTML = '';

    var head = el('div', 'lc-bf-issue-head');
    head.appendChild(el('strong', null, '后端组件库'));
    head.appendChild(el('span', null, '与前端组件并列'));
    panel.appendChild(head);

    var pool = mergedComponents();
    var list = el('div', 'lc-bf-component-list');
    if (!pool.length) {
      list.appendChild(el('p', 'lc-inspector-hint', '还没有组件。用下面的表单新建，或把导出的 JSON 粘进来。'));
    }
    pool.forEach(function (item) {
      var card = el('div', 'lc-bf-component-card');
      var top = el('div', 'lc-bf-component-top');
      top.appendChild(el('strong', null, item.name || item.id));
      top.appendChild(el('span', 'lc-bf-component-id', item.id));
      top.appendChild(el('span', 'lc-bf-lang', item.scope === 'global' ? '全局' : '项目'));
      top.appendChild(el('span', 'lc-bf-lang', 'v' + item.version));
      (item.languages || ['node']).forEach(function (language) {
        top.appendChild(el('span', 'lc-bf-lang', LANG_LABEL[language] || language));
      });
      card.appendChild(top);
      if (item.description) card.appendChild(el('p', 'lc-hint', item.description));

      var actions = el('div', 'lc-bf-component-actions');
      var insert = el('button', 'lc-btn lc-btn-ghost lc-btn-sm', '插入流程');
      insert.type = 'button';
      insert.addEventListener('click', function () { insertComponentNode(item.id); });
      var edit = el('button', 'lc-btn lc-btn-ghost lc-btn-sm', '编辑');
      edit.type = 'button';
      edit.addEventListener('click', function () {
        state.componentDraft = JSON.parse(JSON.stringify(item));
        renderComponentPanel();
      });
      var exportBtn = el('button', 'lc-btn lc-btn-ghost lc-btn-sm', '导出');
      exportBtn.type = 'button';
      exportBtn.addEventListener('click', function () {
        api(siteBase() + '/backend/components/' + encodeURIComponent(item.id) + '/export?scope=' + encodeURIComponent(item.scope))
          .then(function (data) { downloadText(item.id + '.component.json', data.json); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
      var remove = el('button', 'lc-btn lc-btn-ghost lc-btn-sm is-danger', '删除');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        if (!window.confirm('删除组件 ' + item.id + '？引用了它的节点会变成悬空引用。')) return;
        api(siteBase() + '/backend/components/' + encodeURIComponent(item.id) + '?scope=' + encodeURIComponent(item.scope), { method: 'DELETE' })
          .then(function () {
            state.components = { project: [], global: [] };
            return refreshComponents();
          })
          .then(function () { toast('组件已删除', 'warn'); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
      actions.appendChild(insert);
      actions.appendChild(edit);
      actions.appendChild(exportBtn);
      actions.appendChild(remove);
      card.appendChild(actions);
      list.appendChild(card);
    });
    panel.appendChild(list);

    var draft = state.componentDraft || defaultComponentDraft();
    var form = el('div', 'lc-bf-component-form');
    var formHead = el('div', 'lc-bf-component-form-head');
    formHead.appendChild(el('strong', null, state.componentDraft ? '编辑组件' : '新建组件'));
    var newButton = el('button', 'lc-btn lc-btn-ghost lc-btn-sm', '清空');
    newButton.type = 'button';
    newButton.addEventListener('click', function () {
      state.componentDraft = null;
      renderComponentPanel();
    });
    formHead.appendChild(newButton);
    form.appendChild(formHead);

    var grid = el('div', 'lc-bf-field-grid');
    var idWrap = fieldWrap({ key: 'id', label: '组件 ID', width: 'short', hint: '小写字母开头，只含字母数字连字符' });
    var idInput = el('input', 'lc-input');
    idInput.value = draft.id || '';
    idInput.placeholder = 'order-total';
    idInput.addEventListener('input', function () { draft.id = idInput.value.trim(); });
    idWrap.appendChild(idInput);
    grid.appendChild(idWrap);

    var nameWrap = fieldWrap({ key: 'name', label: '名称', width: 'medium' });
    var nameInput = el('input', 'lc-input');
    nameInput.value = draft.name || '';
    nameInput.addEventListener('input', function () { draft.name = nameInput.value; });
    nameWrap.appendChild(nameInput);
    grid.appendChild(nameWrap);

    var scopeWrap = fieldWrap({ key: 'scope', label: '作用域', width: 'short', hint: '全局组件可被其他项目复用' });
    var scopeSelect = el('select', 'lc-select');
    ['project', 'global'].forEach(function (scope) {
      var option = el('option', null, scope === 'global' ? '保存为全局' : '仅本项目');
      option.value = scope;
      scopeSelect.appendChild(option);
    });
    scopeSelect.value = draft.scope === 'global' ? 'global' : 'project';
    scopeSelect.addEventListener('change', function () { draft.scope = scopeSelect.value; });
    scopeWrap.appendChild(scopeSelect);
    grid.appendChild(scopeWrap);

    var langWrap = fieldWrap({ key: 'languages', label: '支持语言', width: 'full', hint: '能力矩阵：声明该组件可翻译成哪些语言' });
    var langRow = el('div', 'lc-bf-lang-row');
    ['node', 'rust', 'go'].forEach(function (language) {
      var label = el('label', 'lc-check');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = (draft.languages || ['node']).indexOf(language) >= 0;
      box.addEventListener('change', function () {
        var set = {};
        (draft.languages || []).forEach(function (item) { set[item] = true; });
        if (box.checked) set[language] = true;
        else delete set[language];
        draft.languages = ['node', 'rust', 'go'].filter(function (item) { return set[item]; });
        if (!draft.languages.length) draft.languages = ['node'];
      });
      label.appendChild(box);
      label.appendChild(el('span', null, LANG_LABEL[language]));
      langRow.appendChild(label);
    });
    langWrap.appendChild(langRow);
    grid.appendChild(langWrap);

    var descWrap = fieldWrap({ key: 'description', label: '描述', width: 'full' });
    var descInput = el('input', 'lc-input');
    descInput.value = draft.description || '';
    descInput.addEventListener('input', function () { draft.description = descInput.value; });
    descWrap.appendChild(descInput);
    grid.appendChild(descWrap);
    form.appendChild(grid);

    var paramsWrap = fieldWrap({ key: 'params', label: '参数 schema（JSON）', width: 'full', hint: '每项 {key,label,kind,required}，节点属性面板按它渲染' });
    var paramsInput = el('textarea', 'lc-textarea lc-data-mono');
    paramsInput.rows = 4;
    paramsInput.value = JSON.stringify(draft.params || [], null, 2);
    paramsWrap.appendChild(paramsInput);
    form.appendChild(paramsWrap);

    var codeWrap = fieldWrap({ key: 'code', label: 'Node 实现', width: 'full', hint: '导出 run(ctx, args)；用户代码，生成过程只引用不改写' });
    var codeInput = el('textarea', 'lc-textarea lc-data-mono');
    codeInput.rows = 8;
    codeInput.value = (draft.code && draft.code.node) || defaultComponentCode(draft.id);
    codeWrap.appendChild(codeInput);
    form.appendChild(codeWrap);

    var foot = el('div', 'lc-bf-component-actions');
    var save = el('button', 'lc-btn lc-btn-primary lc-btn-sm', '保存组件');
    save.type = 'button';
    save.addEventListener('click', function () {
      var params;
      try {
        params = JSON.parse(paramsInput.value || '[]');
      } catch (err) {
        toast('参数 schema 不是合法 JSON：' + err.message, 'error');
        return;
      }
      var code = Object.assign({}, draft.code || {});
      code.node = codeInput.value;
      var component = {
        id: draft.id,
        name: draft.name,
        description: draft.description,
        version: draft.version || 1,
        languages: draft.languages,
        implementedLanguages: (draft.implementedLanguages || ['node']).filter(function (language) {
          return (draft.languages || []).indexOf(language) >= 0;
        }),
        params: params,
        code: code
      };
      save.disabled = true;
      api(siteBase() + '/backend/components', { method: 'PUT', body: { component: component, scope: draft.scope } })
        .then(function (data) {
          state.componentDraft = null;
          toast('组件已保存：' + data.component.id);
          return refreshComponents();
        })
        .catch(function (err) {
          toast(err.message + (err.issues && err.issues.length ? '：' + err.issues.map(function (issue) { return issue.message; }).join('；') : ''), 'error');
        })
        .then(function () { save.disabled = false; });
    });
    var importBtn = el('button', 'lc-btn lc-btn-ghost lc-btn-sm', '导入 JSON');
    importBtn.type = 'button';
    importBtn.addEventListener('click', function () {
      var text = window.prompt('粘贴导出的组件 JSON（整段即可）');
      if (!text) return;
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        toast('不是合法 JSON：' + err.message, 'error');
        return;
      }
      var component = parsed && parsed.component ? parsed.component : parsed;
      if (!component || !component.id) {
        toast('导入内容里没有 component.id', 'error');
        return;
      }
      state.componentDraft = Object.assign(defaultComponentDraft(), component);
      renderComponentPanel();
      toast('已载入组件定义，确认后点「保存组件」');
    });
    foot.appendChild(save);
    foot.appendChild(importBtn);
    form.appendChild(foot);
    panel.appendChild(form);
  }

  function defaultComponentCode(componentId) {
    return [
      '// [LC-CUSTOM] 后端组件实现 · 用户代码，生成过程只引用，不会改写。',
      'export async function run(ctx, args) {',
      '  return { ok: true, args }',
      '}',
      ''
    ].join('\n');
  }

  /* ---------------------------------------------------------------- 用户代码弹窗 */

  function codePathFor(nodeId) {
    var node = findNode(nodeId);
    return nodeCodeRel(node);
  }

  function openCodeDialog(nodeId) {
    state.codePageMode = !nodeId;
    state.codeNodeId = nodeId || '';
    var node = nodeId ? findNode(nodeId) : null;
    var language = state.codePageMode ? state.target : ((node && node.params && node.params.codeLanguage) || 'node');
    state.codeLanguage = language;
    var rel = state.codePageMode ? pageOverrideRel(language) : codePathFor(nodeId);
    var title = document.getElementById('lc-bf-code-title');
    if (title) title.textContent = state.codePageMode ? '页面级用户代码' : '用户代码节点';
    if (refs.codeDialog) refs.codeDialog.hidden = false;
    if (refs.codePath) refs.codePath.textContent = rel;
    if (refs.codeResult) {
      refs.codeResult.className = 'lc-code-result';
      refs.codeResult.textContent = '用户代码，不会被生成过程改写。';
    }
    if (refs.codeRestore) refs.codeRestore.hidden = true;
    if (refs.codeSave) refs.codeSave.disabled = true;
    setStatus('读取用户代码…');
    api(siteBase() + '/code/backend?language=' + encodeURIComponent(language)).then(function (data) {
      var file = (data.files || []).find(function (item) { return item.path === rel; });
      var template = state.codePageMode ? defaultPageTemplate(language) : defaultCodeTemplate(node);
      var code = file ? file.code : template;
      var editorLanguage = state.codePageMode
        ? (language === 'rust' ? 'rust' : language === 'go' ? 'go' : 'javascript')
        : 'javascript';
      if (!state.editor && window.LC && window.LC.CodeEditor) {
        state.editor = window.LC.CodeEditor.create(refs.codeEditor, {
          language: editorLanguage,
          value: code,
          tabSize: 2,
          onSave: function () { saveCode(); }
        });
      } else if (state.editor) {
        state.editor.setValue(code, { silent: true });
      }
      if (refs.codeRestore) refs.codeRestore.hidden = !file;
      if (refs.codeSave) refs.codeSave.disabled = false;
      setStatus('用户代码已加载');
      if (file) {
        if (refs.codeResult) refs.codeResult.textContent = '这个文件在用户区已存在，标记为「已覆盖」。';
      } else if (refs.codeResult) {
        refs.codeResult.textContent = '文件还没有创建；点「保存代码」会在用户区新建。';
      }
    }).catch(function (err) {
      setStatus(err.message, 'error');
      toast(err.message, 'error');
    });
  }

  function defaultCodeTemplate(node) {
    return [
      '// 用户代码 · 不会被平台生成过程改写。',
      '// 节点 ' + (node ? node.id : '') + '（' + (node ? node.name : '') + '）。',
      '// ctx: { vars, request, reply, deps }；返回值为该节点的输出变量。',
      'export async function run(ctx) {',
      '  const { vars, request } = ctx',
      '  return {',
      '    ok: true,',
      '    method: request.method,',
      '    url: request.url',
      '  }',
      '}',
      ''
    ].join('\n');
  }

  function currentCode() {
    if (state.editor && typeof state.editor.getValue === 'function') return state.editor.getValue();
    return '';
  }

  function saveCode() {
    if (!state.codeNodeId && !state.codePageMode) return Promise.resolve();
    if (!state.editor) {
      toast('代码编辑器还没加载完，请稍后再保存。', 'warn');
      return Promise.resolve();
    }
    var rel = currentCodeRel();
    var language = currentCodeLanguage();
    var code = currentCode();
    return api(siteBase() + '/code/backend', { method: 'PUT', body: { language: language, path: rel, code: code } })
      .then(function () {
        if (refs.codeResult) {
          refs.codeResult.className = 'lc-code-result is-ok';
          refs.codeResult.textContent = '已保存到用户区：' + rel;
        }
        if (refs.codeRestore) refs.codeRestore.hidden = false;
        setStatus('用户代码已保存');
        toast('用户代码已保存（不会随生成被覆盖）');
        refreshOverrideFiles([language]);
      })
      .catch(function (err) {
        if (refs.codeResult) {
          refs.codeResult.className = 'lc-code-result is-fail';
          refs.codeResult.textContent = err.message;
        }
        toast(err.message, 'error');
      });
  }

  function checkCode() {
    var code = currentCode();
    var language = currentCodeLanguage();
    api(siteBase() + '/code/check', { method: 'POST', body: { language: language, code: code, run: false } }).then(function (data) {
      var ok = data.ok !== false;
      if (refs.codeResult) {
        refs.codeResult.className = 'lc-code-result ' + (ok ? 'is-ok' : 'is-fail');
        refs.codeResult.textContent = ok ? '语法检查通过。' : (data.message || '语法检查未通过。');
      }
    }).catch(function (err) {
      if (refs.codeResult) {
        refs.codeResult.className = 'lc-code-result is-fail';
        refs.codeResult.textContent = err.message;
      }
    });
  }

  function closeCodeDialog() {
    if (refs.codeDialog) refs.codeDialog.hidden = true;
    state.codeNodeId = '';
    state.codePageMode = false;
  }

  /* ---------------------------------------------------------------- 事件 */

  function bind() {
    if (refs.siteSelect) {
      refs.siteSelect.addEventListener('change', function () {
        var siteId = refs.siteSelect.value;
        if (!siteId) return;
        if (state.dirty && !window.confirm('当前流程有未保存的修改，切换站点会丢弃，继续？')) {
          refs.siteSelect.value = state.siteId;
          return;
        }
        var url = new URL(window.location.href);
        url.searchParams.set('site', siteId);
        window.history.replaceState(null, '', url.toString());
        loadFlow(siteId);
      });
    }

    if (refs.target) {
      refs.target.addEventListener('change', function () {
        state.target = refs.target.value;
        renderLibrary();
        renderIssues();
        renderInspector();
        renderPageOverrideCard();
        refreshOverrideFiles([state.target]);
        var blocked = targetLanguageIssues().length;
        toast(blocked
          ? '已切到 ' + LANG_LABEL[state.target] + '：有 ' + blocked + ' 个积木不支持，右侧检查结果里标出了可替换项。'
          : '已切到 ' + LANG_LABEL[state.target] + '：现有节点都支持。', blocked ? 'warn' : '');
      });
    }

    if (refs.save) refs.save.addEventListener('click', function () { save().catch(function () {}); });
    if (refs.validate) refs.validate.addEventListener('click', validate);
    if (refs.compile) refs.compile.addEventListener('click', compile);
    if (refs.previewStart) refs.previewStart.addEventListener('click', startPreview);
    if (refs.previewStop) refs.previewStop.addEventListener('click', stopPreview);
    if (refs.reqSend) refs.reqSend.addEventListener('click', sendRequest);
    if (refs.generationClose) {
      refs.generationClose.addEventListener('click', function () { refs.generation.hidden = true; });
    }

    if (refs.loadSample) {
      refs.loadSample.addEventListener('click', function () {
        if (state.dirty && !window.confirm('载入示例会替换当前节点树，继续？')) return;
        api(siteBase() + '/backend-flow/sample', { method: 'POST', body: { language: LANGUAGE } })
          .then(function (data) {
            state.flow = data.flow;
            state.selectedId = findEntry() ? findEntry().id : '';
            state.issues = [];
            touch();
            renderAll();
            toast('已载入示例：GET /api/items → CORS/日志 → 读集合 → 返回 JSON');
          })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }

    if (refs.flowTitle) {
      refs.flowTitle.addEventListener('input', function () {
        state.flow.flow.name = refs.flowTitle.value;
        refs.flowName.textContent = state.flow.flow.name || '流程';
        touch();
      });
    }

    if (refs.nodeSearch) {
      refs.nodeSearch.addEventListener('input', function () {
        state.search = refs.nodeSearch.value;
        renderLibrary();
      });
    }

    if (refs.expandAll) {
      refs.expandAll.addEventListener('click', function () {
        state.collapsed = {};
        renderTree();
      });
    }
    if (refs.collapseAll) {
      refs.collapseAll.addEventListener('click', function () {
        state.collapsed = {};
        walk(state.flow.flow.root.children, function (node) {
          if (typeDef(node.type) && typeDef(node.type).container) state.collapsed[node.id] = true;
        });
        renderTree();
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-preview-start]'), function (button) {
      if (button !== refs.previewStart) button.addEventListener('click', startPreview);
    });

    tabs.forEach(function (button) {
      button.addEventListener('click', function () { setTab(button.dataset.tab); });
    });

    if (refs.codeSave) refs.codeSave.addEventListener('click', saveCode);
    if (refs.codeCheck) refs.codeCheck.addEventListener('click', checkCode);
    if (refs.codeClose) refs.codeClose.addEventListener('click', closeCodeDialog);
    if (refs.codeCancel) refs.codeCancel.addEventListener('click', closeCodeDialog);
    ensureCodeRestoreButton();

    document.addEventListener('click', function (event) {
      var edit = event.target.closest && event.target.closest('[data-page-override-edit]');
      if (edit) {
        openCodeDialog('');
        return;
      }
      var restore = event.target.closest && event.target.closest('[data-page-override-restore]');
      if (restore) restorePageOverride();
    });
    if (refs.codeDialog) {
      refs.codeDialog.addEventListener('click', function (event) {
        if (event.target === refs.codeDialog) closeCodeDialog();
      });
    }

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!refs.codeDialog.hidden) saveCode();
        else save().catch(function () {});
      }
      if (event.key === 'Escape' && !refs.codeDialog.hidden) closeCodeDialog();
    });

    document.addEventListener('dragend', function () {
      state.draggingId = '';
      state.draggingType = '';
      clearDropMarks();
    });
  }

  /* 窄屏（≤900）节点库与属性面板变成抽屉，顶栏两个按钮负责开合（BLD-01）。 */
  function bindDrawerToggles() {
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
  }

  window.addEventListener('DOMContentLoaded', function () {
    bind();
    bindDrawerToggles();
    loadSites();
  });

  // 节点库拖拽时把类型记在全局，避免某些浏览器在 dragover 阶段读不到 dataTransfer。
  document.addEventListener('dragstart', function (event) {
    var button = event.target.closest && event.target.closest('[data-type]');
    if (button && button.draggable) state.draggingType = button.dataset.type;
  });
})();
