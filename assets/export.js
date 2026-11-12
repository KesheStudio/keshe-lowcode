/* 导出向导 · Web 静态
 *
 * 只调用服务端导出接口：预估（dryRun）→ 任务（jobs）→ 下载 / 构建记录。
 * 不在浏览器里拼产物，也不连接任何数据库。 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var TOKEN = tokenMeta ? tokenMeta.getAttribute('content') : '';
  var STAGE_LABELS = {
    queued: '准备导出',
    read: '读取站点文件',
    render: '渲染页面',
    templates: '装配部署模板',
    assets: '装配静态资源',
    snapshot: '快照数据源',
    minify: '压缩 CSS / JS',
    checks: '校验入口与外链',
    bundle: '生成产物清单',
    zip: '生成压缩包',
    done: '构建完成'
  };

  var refs = {
    siteSelect: document.querySelector('[data-site-select]'),
    wizardCard: document.querySelector('[data-wizard-card]'),
    configLoading: document.querySelector('[data-config-loading]'),
    configUserEditNote: document.querySelector('[data-config-user-edit-note]'),
    configPanel: document.querySelector('[data-config-panel]'),
    siteTitle: document.querySelector('[data-site-title]'),
    siteMeta: document.querySelector('[data-site-meta]'),
    targetBadge: document.querySelector('[data-target-badge]'),
    backBuilder: document.querySelector('[data-back-builder]'),
    steps: Array.prototype.slice.call(document.querySelectorAll('[data-goto]')),
    panels: Array.prototype.slice.call(document.querySelectorAll('[data-step]')),
    next: document.querySelector('[data-next]'),
    prev: document.querySelector('[data-prev]'),
    targets: Array.prototype.slice.call(document.querySelectorAll('[data-target]')),
    tauriFields: document.querySelector('[data-tauri-fields]'),
    dtProduct: document.querySelector('[data-dt-product]'),
    dtIdentifier: document.querySelector('[data-dt-identifier]'),
    dtVersion: document.querySelector('[data-dt-version]'),
    dtPlatform: document.querySelector('[data-dt-platform]'),
    androidFields: document.querySelector('[data-android-fields]'),
    dtAndroidSigning: document.querySelector('[data-dt-android-signing]'),
    dtAndroidKeystore: document.querySelector('[data-dt-android-keystore]'),
    dtAndroidAlias: document.querySelector('[data-dt-android-alias]'),
    androidAbiNote: document.querySelector('[data-android-abi-note]'),
    androidNote: document.querySelector('[data-android-note]'),
    androidNoteTitle: document.querySelector('[data-android-note-title]'),
    androidNoteText: document.querySelector('[data-android-note-text]'),
    dtWidth: document.querySelector('[data-dt-width]'),
    dtHeight: document.querySelector('[data-dt-height]'),
    dtMinWidth: document.querySelector('[data-dt-min-width]'),
    dtMinHeight: document.querySelector('[data-dt-min-height]'),
    dtProtocol: document.querySelector('[data-dt-protocol]'),
    dtHttpsMode: document.querySelector('[data-dt-https-mode]'),
    dtUpdate: document.querySelector('[data-dt-update]'),
    dtUpdateFields: document.querySelector('[data-dt-update-fields]'),
    dtEndpoint: document.querySelector('[data-dt-endpoint]'),
    dtPubkey: document.querySelector('[data-dt-pubkey]'),
    dtHttpsNote: document.querySelector('[data-dt-https-note]'),
    dtImportedNote: document.querySelector('[data-dt-imported-note]'),
    dtHttpNote: document.querySelector('[data-dt-http-note]'),
    scopes: Array.prototype.slice.call(document.querySelectorAll('[data-scope]')),
    pagePicker: document.querySelector('[data-page-picker]'),
    pageList: document.querySelector('[data-page-list]'),
    pageSummary: document.querySelector('[data-page-summary]'),
    version: document.querySelector('[data-version]'),
    minifyCss: document.querySelector('[data-minify-css]'),
    minifyHtml: document.querySelector('[data-minify-html]'),
    snapshot: document.querySelector('[data-snapshot]'),
    includeData: document.querySelector('[data-include-data]'),
    backends: Array.prototype.slice.call(document.querySelectorAll('[data-backend]')),
    dbDriver: document.querySelector('[data-db-driver]'),
    dbFields: document.querySelector('[data-db-fields]'),
    dbHost: document.querySelector('[data-db-host]'),
    dbPort: document.querySelector('[data-db-port]'),
    dbName: document.querySelector('[data-db-name]'),
    dbUser: document.querySelector('[data-db-user]'),
    dbPassword: document.querySelector('[data-db-password]'),
    dbPasswordHint: document.querySelector('[data-db-password-hint]'),
    redisEnabled: document.querySelector('[data-redis-enabled]'),
    redisFields: document.querySelector('[data-redis-fields]'),
    redisHost: document.querySelector('[data-redis-host]'),
    redisPort: document.querySelector('[data-redis-port]'),
    redisDb: document.querySelector('[data-redis-db]'),
    redisPassword: document.querySelector('[data-redis-password]'),
    redisPasswordHint: document.querySelector('[data-redis-password-hint]'),
    webDomain: document.querySelector('[data-web-domain]'),
    webBasePath: document.querySelector('[data-web-base-path]'),
    webAddress: document.querySelector('[data-web-address]'),
    corsOrigins: document.querySelector('[data-cors-origins]'),
    nginxEnabled: document.querySelector('[data-nginx-enabled]'),
    nginxPanel: document.querySelector('[data-nginx-panel]'),
    nginxText: document.querySelector('[data-nginx-text]'),
    nginxDefault: document.querySelector('[data-nginx-default]'),
    nginxUndo: document.querySelector('[data-nginx-undo]'),
    nginxState: document.querySelector('[data-nginx-state]'),
    configSave: document.querySelector('[data-config-save]'),
    configStatus: document.querySelector('[data-config-status]'),
    desktopNote: document.querySelector('[data-desktop-note]'),
    desktopText: document.querySelector('[data-desktop-text]'),
    estimateBtn: document.querySelector('[data-estimate-btn]'),
    startBtn: document.querySelector('[data-start-btn]'),
    estimatePanel: document.querySelector('[data-estimate-panel]'),
    estimateTotal: document.querySelector('[data-estimate-total]'),
    estimateZip: document.querySelector('[data-estimate-zip]'),
    estimateUnpacked: document.querySelector('[data-estimate-unpacked]'),
    estimateHtml: document.querySelector('[data-estimate-html]'),
    estimateCode: document.querySelector('[data-estimate-code]'),
    estimateRuntime: document.querySelector('[data-estimate-runtime]'),
    estimateOther: document.querySelector('[data-estimate-other]'),
    mermaidText: document.querySelector('[data-mermaid-text]'),
    estimatePages: document.querySelector('[data-estimate-pages]'),
    estimateFiles: document.querySelector('[data-estimate-files]'),
    estimateIssues: document.querySelector('[data-estimate-issues]'),
    progress: document.querySelector('[data-progress]'),
    progressStage: document.querySelector('[data-progress-stage]'),
    progressPercent: document.querySelector('[data-progress-percent]'),
    progressBar: document.querySelector('[data-progress-bar]'),
    progressText: document.querySelector('[data-progress-text]'),
    failures: document.querySelector('[data-failures]'),
    result: document.querySelector('[data-result]'),
    resultBadge: document.querySelector('[data-result-badge]'),
    resultSummary: document.querySelector('[data-result-summary]'),
    resultPath: document.querySelector('[data-result-path]'),
    download: document.querySelector('[data-download]'),
    recordLink: document.querySelector('[data-record-link]'),
    reset: document.querySelector('[data-reset]'),
    footHint: document.querySelector('[data-foot-hint]'),
    statusText: document.querySelector('[data-status-text]'),
    statusRev: document.querySelector('[data-status-rev]')
  };

  var state = {
    sites: [],
    siteId: '',
    info: null,
    config: null,
    pages: [],
    step: 1,
    estimate: null,
    jobId: '',
    polling: 0,
    busy: false,
    lastResult: null,
    nginxDefaultText: '',
    nginxUndoText: '',
    configLoading: false,
    configReady: false,
    loadSeq: 0,
    loadingDirty: new Map(),
    loadingDisabled: null
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

  function fmtBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1024 / 1024).toFixed(2) + ' MB';
  }

  function toast(text, kind) {
    var el = document.createElement('div');
    el.className = 'lc-toast' + (kind ? ' is-' + kind : '');
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function setStatus(text, kind) {
    refs.statusText.textContent = text;
    if (kind === 'error') refs.statusText.style.color = 'var(--lc-color-danger)';
    else if (kind === 'ok') refs.statusText.style.color = 'var(--lc-color-success)';
    else refs.statusText.style.color = '';
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

  /* ---------------- 配置加载门闩 ---------------- */

  function configFieldRoots() {
    return [refs.tauriFields, refs.configPanel].filter(Boolean);
  }

  function configFields() {
    var fields = [];
    configFieldRoots().forEach(function (root) {
      Array.prototype.slice.call(root.querySelectorAll('input, select, textarea, button')).forEach(function (field) {
        fields.push(field);
      });
    });
    return fields;
  }

  function updateExportLocks() {
    var blocked = state.busy || state.configLoading || !state.configReady;
    refs.estimateBtn.disabled = blocked;
    refs.startBtn.disabled = blocked;
    refs.next.disabled = blocked;
    refs.configSave.disabled = blocked;
  }

  /* 切站瞬间清空可见值：旧站点的域名、桌面配置不能在新站点加载期间继续显示。 */
  function clearConfigView() {
    configFields().forEach(function (field) {
      if (!field.matches('input, select, textarea')) return;
      if (field.type === 'checkbox' || field.type === 'radio') field.checked = false;
      else field.value = '';
    });
    refs.version.value = '';
  }

  function resetConfigLoadingNote() {
    var title = refs.configLoading.querySelector('strong');
    var text = refs.configLoading.querySelector('p');
    if (title) title.textContent = '正在加载项目配置…';
    if (text) text.textContent = '配置到达前，桌面与运行环境字段不可编辑；这是为了避免异步返回的默认值覆盖你已经填写的内容。';
    refs.configLoading.className = 'lc-note lc-note-info';
  }

  function showConfigLoadFailure(message) {
    var title = refs.configLoading.querySelector('strong');
    var text = refs.configLoading.querySelector('p');
    if (title) title.textContent = '项目配置加载失败';
    if (text) text.textContent = '字段保持禁用，避免用不完整配置覆盖输入。请重新选择项目或刷新页面重试。' + (message ? '（' + message + '）' : '');
    refs.configLoading.className = 'lc-note lc-note-danger';
    refs.configLoading.hidden = false;
  }

  /* 加载期间禁用配置字段；原始 disabled 状态要记住，解锁时不能把 http 下本来禁用的 HTTPS 模式重新打开。 */
  function setConfigLoading(loading) {
    loading = Boolean(loading);
    if (state.configLoading === loading) {
      if (loading) resetConfigLoadingNote();
      return;
    }
    state.configLoading = loading;
    refs.configLoading.hidden = !loading;
    if (loading) resetConfigLoadingNote();
    if (refs.wizardCard) refs.wizardCard.classList.toggle('is-config-loading', loading);
    var fields = configFields();
    if (loading) {
      state.loadingDisabled = new Map();
      fields.forEach(function (field) {
        state.loadingDisabled.set(field, field.disabled);
        field.disabled = true;
      });
    } else {
      if (state.loadingDisabled) {
        state.loadingDisabled.forEach(function (wasDisabled, field) {
          field.disabled = wasDisabled;
        });
        state.loadingDisabled = null;
      }
      syncTauriVisibility();
      syncBackendVisibility();
    }
    updateExportLocks();
  }

  function captureLoadingInput(event) {
    if (!state.configLoading) return;
    var target = event.target;
    if (!target || !target.matches || !target.matches('input, select, textarea')) return;
    var inConfig = target === refs.version || configFieldRoots().some(function (root) {
      return root.contains(target);
    });
    if (!inConfig) return;
    /* 只记录事件发生时的值；配置返回后原样恢复，绝不让默认值把它盖掉。 */
    state.loadingDirty.set(target, { value: target.value, checked: target.checked });
  }

  function restoreLoadingInputs() {
    if (!state.loadingDirty.size) return false;
    state.loadingDirty.forEach(function (snapshot, field) {
      if (field.type === 'checkbox' || field.type === 'radio') field.checked = snapshot.checked;
      else field.value = snapshot.value;
    });
    state.loadingDirty.clear();
    refs.configUserEditNote.hidden = false;
    return true;
  }

  /* ---------------- 站点 ---------------- */

  function renderSiteSelect() {
    var placeholder = state.siteId ? '' : '<option value="">选择项目…</option>';
    refs.siteSelect.innerHTML = placeholder + state.sites.map(function (site) {
      return '<option value="' + esc(site.siteId) + '"' + (site.siteId === state.siteId ? ' selected' : '') + '>' +
        esc(site.name || site.siteId) + '</option>';
    }).join('');
  }

  function backendOf(project) {
    var language = project && project.export && project.export.backend && project.export.backend.language;
    return ['none', 'rust', 'node', 'go'].indexOf(language) >= 0 ? language : 'rust';
  }

  function selectBackend(language) {
    refs.backends.forEach(function (radio) {
      radio.checked = radio.value === language;
      radio.closest('.lc-wizard-choice').classList.toggle('is-selected', radio.checked);
    });
  }

  function renderPages() {
    if (!state.pages.length) {
      refs.pageList.innerHTML = '<p class="lc-hint">当前站点还没有页面，无法导出。</p>';
      refs.pageSummary.textContent = '0 个页面';
      return;
    }
    refs.pageList.innerHTML = state.pages.map(function (page) {
      return '<label class="lc-check"><input type="checkbox" checked data-page-check value="' + esc(page.id) + '"><span>' +
        esc(page.title || page.id) + ' <em class="lc-hint">' + esc(page.path || '') + '</em></span></label>';
    }).join('');
    refs.pageList.onchange = updatePageSummary;
    updatePageSummary();
  }

  function updatePageSummary() {
    var boxes = Array.prototype.slice.call(refs.pageList.querySelectorAll('[data-page-check]'));
    var checked = boxes.filter(function (box) { return box.checked; }).length;
    refs.pageSummary.textContent = '已选 ' + checked + ' / ' + boxes.length + ' 页';
  }

  function applySiteInfo(info) {
    state.info = info;
    state.pages = Array.isArray(info.pages) ? info.pages : [];
    refs.siteTitle.textContent = (info.site && info.site.name) || state.siteId;
    refs.siteMeta.textContent = state.pages.length + ' 个页面 · ' + (info.themes || []).length + ' 套主题';
    refs.backBuilder.href = 'builder.html?site=' + encodeURIComponent(state.siteId);
    /* 切站时必须把版本号换成目标项目的值；加载期间用户若已输入，applyExportConfig 之后会恢复。 */
    refs.version.value = String((info.project && info.project.version) || '1.0.0');
    renderPages();

    selectBackend(backendOf(info.project));
  }

  function loadSite(siteId, options) {
    var opts = options || {};
    var seq = ++state.loadSeq;
    state.siteId = siteId;
    state.config = null;
    state.configReady = false;
    state.estimate = null;
    state.jobId = '';
    state.lastResult = null;
    if (!opts.keepDirty) state.loadingDirty.clear();
    refs.configUserEditNote.hidden = true;
    clearConfigView();
    /* 先上锁再发请求：配置是异步的，任何提前输入都要先被门闩挡住。 */
    setConfigLoading(true);
    resetOutput();
    renderSiteSelect();
    setStatus('读取站点…');
    return api('/api/sites/' + encodeURIComponent(siteId) + '/builder/site').then(function (info) {
      if (seq !== state.loadSeq || state.siteId !== siteId) return;
      applySiteInfo(info);
      setStatus('正在加载运行环境配置…');
      return api('/api/sites/' + encodeURIComponent(siteId) + '/export/config').then(function (view) {
        if (seq !== state.loadSeq || state.siteId !== siteId) return;
        applyExportConfig(view);
        var keptLoadingInput = restoreLoadingInputs();
        state.configReady = true;
        setConfigLoading(false);
        setStatus('已加载站点 ' + ((state.info.site && state.info.site.name) || siteId) + ' · 配置已就绪', 'ok');
        if (keptLoadingInput) toast('配置已加载；你在加载期间的输入已保留，未被默认值覆盖', 'ok');
      });
    }).catch(function (error) {
      if (seq !== state.loadSeq || state.siteId !== siteId) return;
      state.configReady = false;
      showConfigLoadFailure(error.message);
      setStatus('加载项目配置失败：' + error.message, 'error');
      toast('加载项目配置失败：' + error.message, 'error');
    }).then(function () {
      if (seq !== state.loadSeq || state.siteId !== siteId || !state.configReady) return;
      var params = new URLSearchParams(window.location.search);
      if (params.get('site') !== siteId) {
        params.set('site', siteId);
        window.history.replaceState(null, '', 'export.html?' + params.toString());
      }
    });
  }

  /* 没有明确项目上下文时不静默落到第一个站点，防止从首页/收藏夹直接打开导出向导时导错项目。 */
  function showProjectGate() {
    state.siteId = '';
    state.configReady = false;
    setConfigLoading(false);
    refs.configUserEditNote.hidden = true;
    renderSiteSelect();
    refs.siteTitle.textContent = '未选择项目';
    refs.siteMeta.textContent = '从工作台的项目卡片进入，或在右上角「项目」里选一个项目后再导出。';
    refs.backBuilder.href = 'home.html';
    refs.estimateBtn.disabled = true;
    refs.startBtn.disabled = true;
    refs.next.disabled = true;
    setStatus('未选择项目');
  }

  function loadSites() {
    return api('/api/sites').then(function (sites) {
      state.sites = Array.isArray(sites) ? sites : [];
      if (!state.sites.length) {
        state.configReady = false;
        setConfigLoading(false);
        setStatus('还没有项目，先到 Builder 创建一个项目。', 'error');
        refs.siteSelect.innerHTML = '<option>无项目</option>';
        return;
      }
      var params = new URLSearchParams(window.location.search);
      var requested = params.get('site') || '';
      /* 明确指定了站点但不存在时直接报错，绝不静默改写 URL 或导出第一个站点（EXP-01）。 */
      if (requested && !state.sites.some(function (site) { return site.siteId === requested; })) {
        state.siteId = '';
        state.configReady = false;
        setConfigLoading(false);
        refs.configUserEditNote.hidden = true;
        refs.siteSelect.innerHTML = '<option value="">项目不存在</option>';
        refs.siteTitle.textContent = '项目不存在';
        refs.siteMeta.textContent = '请求的项目「' + requested + '」不存在，请从工作台重新进入。';
        refs.backBuilder.href = 'home.html';
        refs.estimateBtn.disabled = true;
        refs.startBtn.disabled = true;
        refs.next.disabled = true;
        setStatus('项目不存在', 'error');
        toast('项目「' + requested + '」不存在，不会导出任何项目。', 'error');
        return;
      }
      if (!requested) {
        showProjectGate();
        return;
      }
      /* 首屏可能已经在门闩加载期间输入（浏览器回填），这里保留 dirty，等配置到达后恢复。 */
      return loadSite(requested, { keepDirty: true });
    });
  }

  /* ---------------- 运行环境与桌面配置 ---------------- */

  function numberOr(input, fallback) {
    var value = Number(input.value);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  }

  function updateSwitchLabel(input) {
    var label = input.parentElement.querySelector('span:last-child');
    if (label) label.textContent = input.checked ? '开' : '关';
  }

  function syncTauriVisibility() {
    var isTauri = selectedTarget() === 'tauri-desktop';
    refs.tauriFields.hidden = !isTauri;
    refs.targetBadge.textContent = isTauri ? 'Tauri 桌面' : 'Web 静态';
    refs.dtUpdateFields.hidden = !refs.dtUpdate.checked;
    updateSwitchLabel(refs.dtUpdate);
    var isHttp = refs.dtProtocol.value === 'http';
    /* http 协议用不到证书：模式直接归零并禁用，避免“选了生成证书但导出后从未使用”。 */
    if (isHttp && refs.dtHttpsMode.value !== 'none') refs.dtHttpsMode.value = 'none';
    refs.dtHttpsMode.disabled = isHttp;
    var httpsMode = refs.dtHttpsMode.value;
    refs.dtHttpsNote.hidden = !isTauri || isHttp || httpsMode !== 'generated';
    refs.dtImportedNote.hidden = !isTauri || isHttp || httpsMode !== 'imported';
    refs.dtHttpNote.hidden = !isTauri || !isHttp;
    var isAndroid = isTauri && refs.dtPlatform.value === 'android';
    refs.androidFields.hidden = !isAndroid;
    refs.androidAbiNote.hidden = !isAndroid;
    refs.androidNote.hidden = !isAndroid;
    if (isAndroid) {
      var release = refs.dtAndroidSigning.value === 'release';
      refs.androidNote.className = 'lc-note ' + (release ? 'lc-note-info' : 'lc-note-warn');
      refs.androidNoteTitle.textContent = release ? '正式签名用于上架，密钥必须自己长期保管' : '测试签名只能自己装，不能上架';
      refs.androidNoteText.textContent = release
        ? '用自己的上传密钥，并在 Google Play 开启 Play App Signing。keystore 与密码只留在构建机；上传密钥丢失会导致老用户无法更新。'
        : '测试 keystore 由 signing/android/gen-test-keystore 生成，文件名带 TEST-SIGNING-ONLY，适合真机调试与内测；Google Play 会拒绝测试签名包。正式上架请切到「正式签名」。';
    }
  }

  function syncBackendVisibility() {
    refs.dbFields.hidden = refs.dbDriver.value === 'none';
    refs.redisFields.hidden = !refs.redisEnabled.checked;
    refs.nginxPanel.hidden = !refs.nginxEnabled.checked;
    updateSwitchLabel(refs.redisEnabled);
    updateSwitchLabel(refs.nginxEnabled);
  }

  function applyTauriConfig(view) {
    var tauri = (view && view.tauri) || (state.info && state.info.project && state.info.project.export && state.info.project.export.tauri) || {};
    var win = tauri.window || {};
    refs.dtProduct.value = tauri.productName || (state.info && state.info.site && state.info.site.name) || '';
    refs.dtIdentifier.value = tauri.identifier || 'com.keshestudio.lowcode';
    refs.dtVersion.value = tauri.version || (state.info && state.info.project && state.info.project.version) || '0.1.0';
    refs.dtPlatform.value = ['win32', 'linux', 'android'].indexOf(tauri.platform) >= 0 ? tauri.platform : 'win32';
    refs.dtWidth.value = win.width || 1024;
    refs.dtHeight.value = win.height || 720;
    refs.dtMinWidth.value = win.minWidth || 800;
    refs.dtMinHeight.value = win.minHeight || 600;
    refs.dtProtocol.value = tauri.protocol === 'http' ? 'http' : 'https';
    refs.dtHttpsMode.value = (tauri.https && tauri.https.mode) || 'generated';
    refs.dtUpdate.checked = Boolean(tauri.update && tauri.update.enabled);
    refs.dtEndpoint.value = (tauri.update && tauri.update.endpoint) || '';
    refs.dtPubkey.value = (tauri.update && tauri.update.pubkey) || '';
    var android = tauri.android || {};
    refs.dtAndroidSigning.value = android.signing === 'release' ? 'release' : 'test';
    refs.dtAndroidKeystore.value = android.keystorePath || '';
    refs.dtAndroidAlias.value = android.keyAlias || 'upload';
    syncTauriVisibility();
  }

  function applyBackendConfig(backend) {
    var data = backend || {};
    var database = data.database || {};
    var cache = data.cache || {};
    selectBackend(['none', 'rust', 'node', 'go'].indexOf(data.language) >= 0 ? data.language : 'rust');
    refs.dbDriver.value = ['none', 'sqlite', 'mysql', 'postgres'].indexOf(database.driver) >= 0 ? database.driver : 'sqlite';
    refs.dbHost.value = database.host || '';
    refs.dbPort.value = database.port ? String(database.port) : '';
    refs.dbName.value = database.name || '';
    refs.dbUser.value = database.user || '';
    refs.redisEnabled.checked = cache.driver === 'redis';
    refs.redisHost.value = cache.host || '';
    refs.redisPort.value = cache.port ? String(cache.port) : '';
    refs.redisDb.value = cache.db == null ? '' : String(cache.db);
    syncBackendVisibility();
  }

  function applySecretHints(secrets) {
    var info = secrets || {};
    var dbSaved = Boolean(info.database && info.database.hasPassword);
    var redisSaved = Boolean(info.redis && info.redis.hasPassword);
    refs.dbPasswordHint.textContent = dbSaved ? '已保存，不改则保留' : '';
    refs.redisPasswordHint.textContent = redisSaved ? '已保存，不改则保留' : '';
    refs.dbPassword.placeholder = dbSaved ? '已保存（留空不修改）' : '可留空';
    refs.redisPassword.placeholder = redisSaved ? '已保存（留空不修改）' : '可留空';
  }

  function applyNginxConfig(nginx) {
    var data = nginx || {};
    state.nginxDefaultText = data.defaultText || '';
    refs.nginxEnabled.checked = Boolean(data.enabled);
    refs.nginxText.value = data.text || state.nginxDefaultText;
    state.nginxUndoText = '';
    refs.nginxUndo.hidden = true;
    refs.nginxState.textContent = data.customized ? '已保存自定义配置。' : '当前使用模板默认配置。';
    syncBackendVisibility();
  }

  function applyWebConfig(view) {
    var web = (view && view.web) || {};
    var backend = (view && view.backend) || {};
    refs.webDomain.value = web.domain || '';
    refs.webBasePath.value = web.basePath || '/';
    refs.corsOrigins.value = ((backend.cors && backend.cors.origins) || [])
      .filter(function (item) { return String(item || '').trim() && String(item).trim() !== '*'; })
      .join('\n');
    setWebAddressHint(web);
  }

  function setWebAddressHint(web) {
    var data = web || {};
    if (data.error) {
      refs.webAddress.textContent = '域名配置有误：' + data.error;
      return;
    }
    var normalized = data.normalized || null;
    if (!normalized) {
      refs.webAddress.textContent = '保存后显示生效的公开基址。';
    } else if (!normalized.configured) {
      refs.webAddress.textContent = '域名未配置，仅本机可用；公开基址：' + normalized.publicBaseUrl;
    } else {
      refs.webAddress.textContent = '公开基址：' + normalized.publicBaseUrl + '；CORS 默认允许来源：' + normalized.origin;
    }
  }

  function applyExportConfig(view) {
    state.config = view || {};
    applyTauriConfig(state.config);
    applyBackendConfig(state.config.backend);
    applyWebConfig(state.config);
    applySecretHints(state.config.secrets);
    applyNginxConfig(state.config.nginx);
    refs.configStatus.textContent = state.config.rev ? '配置版本 rev ' + state.config.rev : '';
  }

  function collectDesktopOptions() {
    if (refs.dtUpdate.checked) {
      var endpoint = refs.dtEndpoint.value.trim();
      if (!/^https:\/\//i.test(endpoint)) throw new Error('自动更新的地址必须是 https:// 开头');
      if (!refs.dtPubkey.value.trim()) throw new Error('开启自动更新时必须填写签名公钥');
    }
    return {
      productName: refs.dtProduct.value.trim(),
      identifier: refs.dtIdentifier.value.trim(),
      version: refs.dtVersion.value.trim(),
      platform: refs.dtPlatform.value,
      protocol: refs.dtProtocol.value,
      window: {
        width: numberOr(refs.dtWidth, 1024),
        height: numberOr(refs.dtHeight, 720),
        minWidth: numberOr(refs.dtMinWidth, 800),
        minHeight: numberOr(refs.dtMinHeight, 600),
        resizable: true
      },
      https: { mode: refs.dtHttpsMode.value },
      android: {
        signing: refs.dtAndroidSigning.value === 'release' ? 'release' : 'test',
        keystorePath: refs.dtAndroidKeystore.value.trim(),
        keyAlias: refs.dtAndroidAlias.value.trim() || 'upload'
      },
      update: {
        enabled: refs.dtUpdate.checked,
        endpoint: refs.dtEndpoint.value.trim(),
        pubkey: refs.dtPubkey.value.trim()
      }
    };
  }

  function collectBackendPayload() {
    return {
      language: selectedBackend(),
      cors: {
        enabled: true,
        origins: refs.corsOrigins.value.split(/\r?\n/)
          .map(function (item) { return item.trim(); })
          .filter(function (item) { return item && item !== '*'; }),
        credentials: Boolean(state.config.backend && state.config.backend.cors && state.config.backend.cors.credentials)
      },
      database: {
        driver: refs.dbDriver.value,
        host: refs.dbHost.value.trim() || '127.0.0.1',
        port: Number(refs.dbPort.value) || 0,
        name: refs.dbName.value.trim() || 'app',
        user: refs.dbUser.value.trim()
      },
      cache: {
        driver: refs.redisEnabled.checked ? 'redis' : 'memory',
        host: refs.redisHost.value.trim() || '127.0.0.1',
        port: Number(refs.redisPort.value) || 16379,
        db: Number(refs.redisDb.value) || 0,
        keyPrefix: 'lc:',
        ttlSeconds: 30
      }
    };
  }

  function saveConfig() {
    var payload = {
      backend: collectBackendPayload(),
      web: {
        domain: refs.webDomain.value.trim(),
        basePath: refs.webBasePath.value.trim()
      },
      nginx: { enabled: refs.nginxEnabled.checked, text: refs.nginxText.value },
      tauri: state.info && state.info.site ? {
        productName: refs.dtProduct.value.trim(),
        identifier: refs.dtIdentifier.value.trim(),
        version: refs.dtVersion.value.trim(),
        platform: refs.dtPlatform.value,
        protocol: refs.dtProtocol.value,
        window: {
          width: numberOr(refs.dtWidth, 1024),
          height: numberOr(refs.dtHeight, 720),
          minWidth: numberOr(refs.dtMinWidth, 800),
          minHeight: numberOr(refs.dtMinHeight, 600)
        },
        https: { mode: refs.dtHttpsMode.value },
        update: {
          enabled: refs.dtUpdate.checked,
          endpoint: refs.dtEndpoint.value.trim(),
          pubkey: refs.dtPubkey.value.trim()
        }
      } : undefined,
      secrets: {}
    };
    /* 只有用户真的输入了内容才提交密码；留空表示保留原值。 */
    if (refs.dbPassword.value) payload.secrets.databasePassword = refs.dbPassword.value;
    if (refs.redisPassword.value) payload.secrets.redisPassword = refs.redisPassword.value;
    refs.configSave.disabled = true;
    refs.configStatus.textContent = '保存中…';
    return api('/api/sites/' + encodeURIComponent(state.siteId) + '/export/config', { method: 'PUT', body: payload }).then(function (data) {
      refs.dbPassword.value = '';
      refs.redisPassword.value = '';
      applyExportConfig(data);
      refs.configStatus.textContent = '已保存（rev ' + (data.rev || '?') + '）';
      setStatus('运行环境配置已保存', 'ok');
      toast('运行环境配置已保存', 'ok');
    }).catch(function (error) {
      refs.configStatus.textContent = '保存失败：' + error.message;
      toast('保存失败：' + error.message, 'error');
    }).then(function () {
      refs.configSave.disabled = false;
    });
  }

  /* ---------------- 步骤 ---------------- */

  function stepIssue(step) {
    if (step === 2 || step === 3) {
      try {
        buildOptions();
      } catch (error) {
        return error.message;
      }
    }
    return '';
  }

  function setStep(next, options) {
    var opts = options || {};
    var step = Math.max(1, Math.min(4, Number(next) || 1));
    /* 向前跳步先校验当前步骤，避免带着空选择进入下一步（EXP-02）。 */
    if (!opts.force) {
      for (var from = state.step; from < step; from += 1) {
        var issue = stepIssue(from);
        if (issue) {
          setStatus(issue, 'error');
          toast(issue, 'error');
          return false;
        }
      }
    }
    state.step = step;
    refs.panels.forEach(function (panel) {
      panel.hidden = Number(panel.getAttribute('data-step')) !== step;
    });
    refs.steps.forEach(function (button) {
      var value = Number(button.getAttribute('data-goto'));
      button.classList.toggle('is-active', value === step);
      button.classList.toggle('is-done', value < step);
    });
    refs.prev.disabled = step === 1;
    refs.next.hidden = step === 4;
    if (step < 4) refs.next.textContent = '下一步';
    var hints = {
      1: '默认 Web 静态；点「下一步」继续。',
      2: '范围、压缩、快照都有默认值；直接下一步即可。',
      3: '默认 Rust；可以换成 Node / Go。',
      4: '先「预估体积」看构成，也可以直接「开始导出」。'
    };
    refs.footHint.textContent = hints[step] || '';
    return true;
  }

  function selectedTarget() {
    var checked = refs.targets.filter(function (radio) { return radio.checked; })[0];
    return checked ? checked.value : 'web-static';
  }

  function selectedScope() {
    var checked = refs.scopes.filter(function (radio) { return radio.checked; })[0];
    return checked ? checked.value : 'all';
  }

  function selectedBackend() {
    var checked = refs.backends.filter(function (radio) { return radio.checked; })[0];
    return checked ? checked.value : 'node';
  }

  function setBusy(busy, label) {
    state.busy = busy;
    var blocked = busy || state.configLoading || !state.configReady;
    refs.estimateBtn.disabled = blocked;
    refs.startBtn.disabled = blocked;
    if (label) refs.estimateBtn.textContent = label;
    else refs.estimateBtn.textContent = '预估体积';
  }

  /* ---------------- 导出选项 ---------------- */

  function buildOptions() {
    var scopeMode = selectedScope();
    var pageIds = [];
    if (scopeMode === 'selected') {
      pageIds = Array.prototype.slice.call(refs.pageList.querySelectorAll('[data-page-check]'))
        .filter(function (box) { return box.checked; })
        .map(function (box) { return box.value; });
      if (!pageIds.length) throw new Error('至少选择一个页面，或改为「全部页面」');
    }
    return {
      target: selectedTarget(),
      scope: { mode: scopeMode, pageIds: pageIds },
      minify: { cssJs: refs.minifyCss.checked, html: refs.minifyHtml.checked },
      snapshotSources: refs.snapshot.checked,
      includeData: refs.includeData ? refs.includeData.checked : true,
      backend: { language: selectedBackend() },
      desktop: selectedTarget() === 'tauri-desktop' ? collectDesktopOptions() : undefined,
      version: refs.version.value.trim()
    };
  }

  function showIssues(container, warnings, failures, pageErrors, limit) {
    var items = [];
    (failures || []).forEach(function (item) {
      items.push({ fail: true, title: item.message || String(item), meta: item.file || item.pagePath || '' });
    });
    (pageErrors || []).forEach(function (item) {
      items.push({ fail: true, title: item.code + ' ' + item.message, meta: item.pagePath || item.pageId || '' });
    });
    (warnings || []).forEach(function (item) {
      items.push({ fail: false, title: item.message || String(item), meta: item.code || '' });
    });
    if (!items.length) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }
    var max = limit || 12;
    container.innerHTML = items.slice(0, max).map(function (item) {
      return '<div class="lc-wizard-issue' + (item.fail ? ' is-fail' : '') + '"><b>' +
        esc(item.title) + '</b>' + (item.meta ? '<em>' + esc(item.meta) + '</em>' : '') + '</div>';
    }).join('') + (items.length > max
      ? '<p class="lc-hint">另有 ' + (items.length - max) + ' 条，见构建记录。</p>'
      : '');
    container.hidden = false;
  }

  function renderEstimate(estimate, issues) {
    state.estimate = estimate;
    var b = estimate.breakdown || {};
    refs.estimatePanel.hidden = false;
    refs.estimateTotal.textContent = 'zip ' + fmtBytes(b.zip);
    refs.estimateZip.textContent = fmtBytes(b.zip);
    refs.estimateUnpacked.textContent = fmtBytes(b.unpacked);
    refs.estimateHtml.textContent = fmtBytes(b.html);
    refs.estimateCode.textContent = fmtBytes((b.css || 0) + (b.js || 0));
    refs.estimateRuntime.textContent = fmtBytes(b.runtime);
    refs.estimateOther.textContent = fmtBytes(b.other);

    var mermaid = estimate.mermaid || { bytes: 0 };
    if (mermaid.external && mermaid.used) {
      refs.mermaidText.textContent = '不打包图表库，省掉约 ' + fmtBytes(mermaid.savedBytes || mermaid.vendorBytes) +
        '；图表改从 CDN 加载，断网时图块位置显示源码。';
    } else if (mermaid.bytes) {
      refs.mermaidText.textContent = 'mermaid ' + fmtBytes(mermaid.bytes) +
        '，占解压后 ' + (mermaid.share || 0) + '%。不需要图表的页面也会带上这份运行时。';
    } else {
      refs.mermaidText.textContent = '本次没有引入 mermaid，图表库体积为 0。';
    }

    refs.estimatePages.innerHTML = (estimate.pages || []).map(function (page) {
      return '<tr><td>' + esc(page.title || page.id) + '<br><em class="lc-hint">' + esc(page.path) + '</em></td><td class="is-num">' + fmtBytes(page.bytes) + '</td></tr>';
    }).join('') || '<tr><td colspan="2">没有页面</td></tr>';

    refs.estimateFiles.innerHTML = (estimate.largest || []).map(function (file) {
      return '<tr><td><code>' + esc(file.path) + '</code></td><td class="is-num">' + fmtBytes(file.bytes) + '</td></tr>';
    }).join('') || '<tr><td colspan="2">没有文件</td></tr>';

    showIssues(refs.estimateIssues, issues.warnings, issues.failures, issues.pageErrors, 8);
    renderDesktopNote(estimate.desktop);
    setStatus('预估完成：zip ' + fmtBytes(b.zip) + ' / 解压后 ' + fmtBytes(b.unpacked), 'ok');
  }

  function renderDesktopNote(desktop) {
    if (!refs.desktopNote) return;
    if (!desktop) {
      refs.desktopNote.hidden = true;
      return;
    }
    var platform = desktop.platform === 'android' ? 'Android' : (desktop.platform === 'linux' ? 'Linux' : 'Windows');
    var https = desktop.httpsMode === 'generated' ? '生成测试证书（仅本地测试）'
      : (desktop.httpsMode === 'imported' ? '导入证书（私钥不进包）' : '不使用 HTTPS');
    refs.desktopNote.hidden = false;
    refs.desktopText.textContent = desktop.productName + ' · ' + desktop.identifier + ' · ' + desktop.version +
      ' · ' + platform + '（' + (desktop.targets || []).join(' / ') + '） · ' + https +
      (desktop.updateActive ? ' · 已开启自动更新' : ' · 未开启自动更新') +
      (desktop.errors && desktop.errors.length ? ' · 配置有 ' + desktop.errors.length + ' 个错误，导出会被阻止' : '');
  }

  function estimate() {
    if (state.busy) return Promise.resolve();
    var options;
    try { options = buildOptions(); } catch (error) {
      toast(error.message, 'error');
      return Promise.resolve();
    }
    setBusy(true, '预估中…');
    setStatus('正在预估体积（会真实渲染一遍）…');
    return api('/api/sites/' + encodeURIComponent(state.siteId) + '/export/estimate', { method: 'POST', body: options }).then(function (data) {
      renderEstimate(data.estimate, data);
      if (!data.canExport) {
        toast('预估发现前置校验未通过，产物不会生成', 'error');
      }
    }).catch(function (error) {
      toast('预估失败：' + error.message, 'error');
      setStatus('预估失败：' + error.message, 'error');
    }).then(function () {
      setBusy(false);
    });
  }

  /* ---------------- 执行 ---------------- */

  function resetOutput() {
    refs.progress.hidden = true;
    refs.result.hidden = true;
    refs.failures.hidden = true;
    refs.failures.innerHTML = '';
    refs.estimatePanel.hidden = true;
    state.polling = 0;
  }

  function stageLabel(stage) {
    return STAGE_LABELS[stage] || stage || '处理中';
  }

  function updateProgress(job) {
    refs.progress.hidden = false;
    var percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
    refs.progressStage.textContent = stageLabel(job.stage);
    refs.progressPercent.textContent = percent + '%';
    refs.progressBar.style.width = percent + '%';
    refs.progressText.textContent = job.message || '—';
    if (job.status === 'running') setStatus('导出中：' + stageLabel(job.stage) + ' ' + percent + '%');
  }

  function renderResult(result) {
    refs.result.hidden = false;
    refs.resultBadge.textContent = result.status === 'success' ? '成功' : '失败';
    refs.resultBadge.className = 'lc-badge ' + (result.status === 'success' ? 'lc-badge-success' : 'lc-badge-danger');
    var b = result.estimate && result.estimate.breakdown ? result.estimate.breakdown : {};
    refs.resultSummary.textContent = '构建 ' + result.buildId + ' · zip ' + fmtBytes(result.bytes) +
      (result.sha256 ? ' · sha256 ' + result.sha256.slice(0, 12) + '…' : '') +
      (b.unpacked ? ' · 解压后 ' + fmtBytes(b.unpacked) : '');
    refs.resultPath.textContent = '产物保存在站点 builds/' + result.buildId + '/artifact.zip，构建记录含范围、压缩与体积明细。';
    var base = '/api/sites/' + encodeURIComponent(state.siteId);
    refs.download.href = base + '/builds/' + encodeURIComponent(result.buildId) + '/artifact.zip?token=' + encodeURIComponent(TOKEN);
    refs.recordLink.href = 'builds.html?site=' + encodeURIComponent(state.siteId) +
      '&build=' + encodeURIComponent(result.buildId);
    refs.download.removeAttribute('aria-disabled');
  }

  function pollJob() {
    if (!state.jobId) return;
    window.clearTimeout(state.polling);
    api('/api/sites/' + encodeURIComponent(state.siteId) + '/export/jobs/' + encodeURIComponent(state.jobId)).then(function (job) {
      updateProgress(job);
      if (job.status === 'running') {
        state.polling = window.setTimeout(pollJob, 400);
        return;
      }
      setBusy(false);
      if (job.status === 'done' && job.result) {
        state.lastResult = job.result;
        renderResult(job.result);
        setStatus('导出完成：' + fmtBytes(job.result.bytes), 'ok');
        showIssues(refs.failures, job.result.warnings, job.result.failures, job.result.pageErrors, 12);
        toast('导出完成，可以下载压缩包了', 'ok');
        return;
      }
      refs.progressStage.textContent = '导出失败';
      refs.progressBar.className = 'lc-progress-bar';
      refs.progress.hidden = false;
      var error = job.error || { message: '导出失败' };
      refs.progressText.textContent = (error.code ? error.code + ' · ' : '') + (error.message || '未知错误');
      setStatus('导出失败：' + (error.message || '未知错误'), 'error');
      if (job.result) {
        state.lastResult = job.result;
        showIssues(refs.failures, job.result.warnings, job.result.failures, job.result.pageErrors, 12);
      } else if (Array.isArray(error.detail)) {
        refs.failures.innerHTML = error.detail.map(function (item) {
          return '<div class="lc-wizard-issue is-fail"><b>' + esc(item.message || String(item)) + '</b><em>' + esc(item.file || item.pagePath || '') + '</em></div>';
        }).join('');
        refs.failures.hidden = false;
      }
      toast('导出失败：' + (error.message || '未知错误'), 'error');
    }).catch(function (error) {
      setBusy(false);
      setStatus('查询导出进度失败：' + error.message, 'error');
      toast('查询导出进度失败：' + error.message, 'error');
    });
  }

  function start() {
    if (state.busy) return Promise.resolve();
    var options;
    try { options = buildOptions(); } catch (error) {
      toast(error.message, 'error');
      return Promise.resolve();
    }
    refs.result.hidden = true;
    refs.failures.hidden = true;
    refs.failures.innerHTML = '';
    refs.progress.hidden = false;
    refs.progressStage.textContent = '准备导出';
    refs.progressPercent.textContent = '0%';
    refs.progressBar.style.width = '0%';
    refs.progressText.textContent = '任务已提交，等待服务端开始…';
    setBusy(true, '导出中…');
    setStatus('正在导出…');
    return api('/api/sites/' + encodeURIComponent(state.siteId) + '/export/jobs', { method: 'POST', body: options }).then(function (data) {
      state.jobId = data.jobId;
      updateProgress(data);
      pollJob();
    }).catch(function (error) {
      setBusy(false);
      setStatus('提交导出失败：' + error.message, 'error');
      toast('提交导出失败：' + error.message, 'error');
    });
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    if (refs.wizardCard) {
      /* capture 阶段先记录，避免字段自身的 change 处理器先把值改掉。 */
      refs.wizardCard.addEventListener('input', captureLoadingInput, true);
      refs.wizardCard.addEventListener('change', captureLoadingInput, true);
    }
    refs.siteSelect.addEventListener('change', function () {
      if (refs.siteSelect.value) loadSite(refs.siteSelect.value).catch(function (error) {
        setStatus('加载站点失败：' + error.message, 'error');
        toast('加载站点失败：' + error.message, 'error');
      });
    });

    refs.steps.forEach(function (button) {
      button.addEventListener('click', function () { setStep(button.getAttribute('data-goto')); });
    });
    refs.next.addEventListener('click', function () { setStep(state.step + 1); });
    refs.prev.addEventListener('click', function () { setStep(state.step - 1); });

    refs.targets.forEach(function (radio) {
      radio.addEventListener('change', function () {
        refs.targets.forEach(function (item) {
          item.closest('.lc-wizard-choice').classList.toggle('is-selected', item.checked);
        });
        if (radio.value === 'tauri-desktop' && !refs.dtProduct.value) applyTauriConfig(state.config);
        syncTauriVisibility();
      });
    });

    [refs.dtPlatform, refs.dtProtocol, refs.dtAndroidSigning, refs.dtHttpsMode, refs.dtUpdate].forEach(function (input) {
      input.addEventListener('change', syncTauriVisibility);
    });
    [refs.dbDriver, refs.redisEnabled, refs.nginxEnabled].forEach(function (input) {
      input.addEventListener('change', syncBackendVisibility);
    });
    refs.nginxDefault.addEventListener('click', function () {
      if (refs.nginxUndo.hidden) state.nginxUndoText = refs.nginxText.value;
      refs.nginxText.value = state.nginxDefaultText;
      refs.nginxUndo.hidden = false;
      refs.nginxState.textContent = '已填入模板默认值（尚未保存，可撤销）。';
    });
    refs.nginxUndo.addEventListener('click', function () {
      refs.nginxText.value = state.nginxUndoText;
      refs.nginxUndo.hidden = true;
      refs.nginxState.textContent = '已撤销恢复，手写内容已还原（尚未保存）。';
    });
    refs.configSave.addEventListener('click', saveConfig);

    refs.scopes.forEach(function (radio) {
      radio.addEventListener('change', function () {
        var selected = selectedScope() === 'selected';
        refs.pagePicker.hidden = !selected;
        if (selected && state.pages.length) updatePageSummary();
      });
    });

    refs.backends.forEach(function (radio) {
      radio.addEventListener('change', function () {
        refs.backends.forEach(function (item) {
          item.closest('.lc-wizard-choice').classList.toggle('is-selected', item.checked);
        });
      });
    });

    [[refs.minifyCss, '[data-minify-css]'], [refs.minifyHtml, '[data-minify-html]'], [refs.snapshot, '[data-snapshot]'], [refs.includeData, '[data-include-data]']].forEach(function (pair) {
      var input = pair[0];
      var label = input.parentElement.querySelector('span:last-child');
      if (!label) return;
      var sync = function () { label.textContent = input.checked ? '开' : '关'; };
      input.addEventListener('change', sync);
      sync();
    });

    refs.estimateBtn.addEventListener('click', estimate);
    refs.startBtn.addEventListener('click', start);
    refs.reset.addEventListener('click', function () {
      resetOutput();
      refs.progress.hidden = true;
      setStatus('可以再次导出', 'ok');
    });

    window.addEventListener('beforeunload', function () { window.clearTimeout(state.polling); });
  }

  bind();
  setStep(1);
  /* 首屏先关门再取数：/api/sites → 站点 → 导出配置 全链路完成前都不接受编辑。 */
  setConfigLoading(true);
  loadSites().catch(function (error) {
    showConfigLoadFailure(error.message);
    setStatus('加载失败：' + error.message, 'error');
    toast('加载失败：' + error.message, 'error');
  });
}());
