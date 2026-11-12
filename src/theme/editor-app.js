/* 低代码平台 · 主题编辑器交互
 *
 * 纯经典脚本，不 import：
 *   - 颜色派生与导入校验来自 build.mjs 生成的 lc-theme-runtime.js（和 Node 侧同源）；
 *   - 内置主题从 editor.html 里内联的 window.LC_BUILTIN_THEMES 读取；
 *   - 带 ?site=<siteId> 打开时读写站点主题（/api/sites/<id>/themes、/themes/<id>.json），
 *     保存后 builder 预览与导出产物刷新即可读到同一份令牌；
 *   - 不带 site 参数时退化为本地草稿模式（localStorage），导出一个主题就是下载 JSON。
 *
 * 这个文件手写；改完不需要重新生成页面，刷新即可。
 */

(function () {
  'use strict';

  var R = window.LCThemeRuntime;
  if (!R) {
    document.body.innerHTML = '<p style="padding:24px">主题运行时没有加载，检查 lc-theme-runtime.js 是否和页面同目录。</p>';
    return;
  }

  var BUILTINS = Array.isArray(window.LC_BUILTIN_THEMES) ? window.LC_BUILTIN_THEMES : [];
  var STORE_KEY = 'lc-theme-editor-drafts-v1';
  var OPTIONAL_SEEDS = ['accent2'];
  var TOKEN = '';
  var SITE_ID = '';

  var state = {
    draft: null,
    origin: 'builtin',
    editingDraftId: null,
    mode: 'light',
    chrome: 'auto',
    showAll: false,
    dirty: false,
    site: null,
    siteThemes: []
  };

  var drafts = loadDrafts();
  var els = {};
  var lastImport = null;

  function boot() {
    cacheEls();
    var query;
    try {
      query = new URLSearchParams(window.location.search);
    } catch (error) {
      query = null;
    }
    var themeParam = query && query.get('theme');
    var modeParam = query && query.get('mode');
    var chromeParam = query && query.get('chrome');

    var tokenMeta = document.querySelector('meta[name="lc-token"]');
    TOKEN = tokenMeta ? String(tokenMeta.getAttribute('content') || '') : '';
    SITE_ID = (query && query.get('site')) || '';
    if (!SITE_ID && TOKEN) {
      /* 从 builder/首页进来时可能只带了 token，站点 id 用最近一次打开的工作台记录。 */
      try { SITE_ID = window.localStorage.getItem('lc.lastSite') || ''; } catch (error) { SITE_ID = ''; }
    }

    if (modeParam === 'light' || modeParam === 'dark') state.mode = modeParam;
    if (chromeParam === 'auto' || chromeParam === 'light' || chromeParam === 'dark') state.chrome = chromeParam;

    syncBackBuilder();

    bindStaticEvents();
    buildPreviewContent();

    if (SITE_ID && TOKEN) {
      bootSite(themeParam);
      return;
    }

    var start = findTheme(themeParam) || findTheme('ink-green') || firstTheme();
    if (start) loadTheme(start.theme, start.origin, start.draftId);
    else loadTheme(makeBlank(), 'custom', null);
    renderAll();
  }

  /* ---------------- 站点主题 API ---------------- */

  function apiRequest(method, url, body) {
    var headers = { 'x-lc-token': TOKEN };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return window.fetch(url, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : {}; } catch (error) { payload = null; }
        if (!response.ok || !payload || payload.ok === false) {
          var message = payload && payload.error && payload.error.message ? payload.error.message : ('HTTP ' + response.status);
          throw new Error(message);
        }
        return payload.data;
      });
    });
  }

  function bootSite(themeParam) {
    var fallback = findTheme(themeParam) || findTheme('ink-green') || firstTheme();
    if (fallback) loadTheme(fallback.theme, fallback.origin, fallback.draftId);
    else loadTheme(makeBlank(), 'custom', null);
    renderAll();

    els.teSiteBadge.hidden = false;
    els.teSiteBadge.textContent = '站点加载中…';
    els.teSiteModeLabel.hidden = false;
    els.teThemesHint.textContent = '站点主题保存后写入站点数据，builder 预览与导出产物刷新即生效；内置主题可另存为站点主题。';

    var base = '/api/sites/' + encodeURIComponent(SITE_ID);
    apiRequest('GET', base).then(function (info) {
      var site = (info && info.site) || {};
      var project = (info && info.project) || {};
      var themeConfig = project.theme || {};
      state.site = {
        id: SITE_ID,
        name: site.name || site.id || SITE_ID,
        activeId: themeConfig.activeId || '',
        mode: ['light', 'dark', 'auto'].indexOf(themeConfig.mode) >= 0 ? themeConfig.mode : 'auto',
        allowSwitch: Array.isArray(themeConfig.allowSwitch) ? themeConfig.allowSwitch : []
      };
      els.teSiteBadge.textContent = state.site.name;
      els.teSiteMode.value = state.site.mode;
      if (state.site.mode === 'light' || state.site.mode === 'dark') {
        state.mode = state.site.mode;
        setMode(state.mode);
      }
      return apiRequest('GET', base + '/themes');
    }).then(function (list) {
      state.siteThemes = ((list && list.themes) || []).map(normalizeTheme);
      return apiRequest('GET', base + '/theme');
    }).then(function (active) {
      var activeJson = normalizeTheme(active.themeJson);
      var inSite = state.siteThemes.some(function (theme) { return theme.id === activeJson.id; });
      loadTheme(activeJson, inSite ? 'site' : 'builtin', inSite ? activeJson.id : null);
      if (state.site && state.site.activeId && activeJson.id !== state.site.activeId) {
        state.site.activeId = activeJson.id;
      }
      renderAll();
      toast('已载入站点主题「' + (activeJson.name || activeJson.id) + '」');
    }).catch(function (error) {
      els.teSiteBadge.textContent = '站点不可用';
      toast('读取站点主题失败：' + error.message + '，已退回本地草稿模式', true);
      state.site = null;
      els.teSiteModeLabel.hidden = true;
      els.teThemesHint.textContent = '内置主题只读，改动会另存为草稿；自定义主题存在浏览器本地。';
      renderAll();
    });
  }

  /* ---------------- 元素与静态事件 ---------------- */

  function syncBackBuilder() {
    if (!els.teBackBuilder) return;
    els.teBackBuilder.href = SITE_ID ? '../builder.html?site=' + encodeURIComponent(SITE_ID) : '../builder.html';
  }

  function cacheEls() {
    [
      'teThemeList', 'teDrop', 'teImportFile', 'teModeTabs', 'teId', 'teName', 'teTone',
      'teDescription', 'teSeeds', 'teDerived', 'teChecks', 'teShowAll', 'teImportReport',
      'teChromeMode', 'teSaveState', 'teToast', 'tePreviewMeta', 'tePaneLight', 'tePaneDark',
      'teNew', 'teDuplicate', 'teExport', 'teImportLabel', 'teFormMeta', 'teDerivedCount',
      'teSiteBadge', 'teSiteMode', 'teSiteModeLabel', 'teThemesHint', 'teBackBuilder'
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
    els.saveLabel = document.querySelector('[data-save-label]');
  }

  function bindStaticEvents() {
    on(els.teNew, 'click', function () {
      var theme = makeBlank();
      loadTheme(theme, 'custom', null);
      state.dirty = true;
      renderAll();
      toast('已新建空白主题');
    });

    on(els.teDuplicate, 'click', function () {
      var copy = duplicateTheme(state.draft);
      if (copy) toast('已复制为「' + copy.name + '」');
    });

    on(els.teExport, 'click', exportTheme);

    on(els.teImportLabel, 'click', function () {
      if (els.teImportFile) els.teImportFile.click();
    });

    on(els.teImportFile, 'change', function () {
      var file = els.teImportFile.files && els.teImportFile.files[0];
      if (file) readFile(file);
      els.teImportFile.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      on(els.teDrop, type, function (event) {
        event.preventDefault();
        els.teDrop.classList.add('is-over');
      });
    });
    ['dragleave', 'dragend'].forEach(function (type) {
      on(els.teDrop, type, function () {
        els.teDrop.classList.remove('is-over');
      });
    });
    on(els.teDrop, 'drop', function (event) {
      event.preventDefault();
      els.teDrop.classList.remove('is-over');
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) readFile(file);
    });

    on(els.teModeTabs, 'click', function (event) {
      var button = event.target.closest('[data-mode]');
      if (!button) return;
      setMode(button.getAttribute('data-mode'));
    });
    on(els.teModeTabs, 'keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setMode(state.mode === 'light' ? 'dark' : 'light');
      var next = els.teModeTabs.querySelector('[data-mode="' + state.mode + '"]');
      if (next) next.focus();
    });

    on(els.teChromeMode, 'change', function () {
      state.chrome = els.teChromeMode.value;
      applyChrome();
    });

    on(els.teSiteMode, 'change', function () {
      if (!state.site) return;
      state.site.mode = els.teSiteMode.value;
      markDirty();
    });

    on(els.teId, 'input', function () {
      if (!state.draft) return;
      state.draft.id = els.teId.value.trim();
      markDirty();
      renderThemeList();
    });
    on(els.teName, 'input', function () {
      if (!state.draft) return;
      state.draft.name = els.teName.value;
      markDirty();
      renderThemeList();
      renderPreview();
    });
    on(els.teTone, 'change', function () {
      if (!state.draft) return;
      state.draft.tone = els.teTone.value;
      markDirty();
    });
    on(els.teDescription, 'input', function () {
      if (!state.draft) return;
      state.draft.description = els.teDescription.value;
      markDirty();
    });

    on(els.teSeeds, 'input', function (event) {
      var input = event.target;
      if (input.matches('input[type="color"]')) {
        setSeed(input.getAttribute('data-seed'), input.value);
      }
    });
    on(els.teSeeds, 'change', function (event) {
      var input = event.target;
      if (!input.matches('.te-hex')) return;
      applySeedText(input);
    });
    on(els.teSeeds, 'click', function (event) {
      var reset = event.target.closest('[data-reset-seed]');
      if (!reset) return;
      clearSeed(reset.getAttribute('data-reset-seed'));
    });

    on(els.teDerived, 'change', function (event) {
      var input = event.target.closest('.te-hex[data-token]');
      if (input) applyOverrideText(input);
    });
    on(els.teDerived, 'click', function (event) {
      var reset = event.target.closest('[data-reset-override]');
      if (!reset) return;
      clearOverride(reset.getAttribute('data-reset-override'));
    });

    on(els.teShowAll, 'click', function () {
      state.showAll = !state.showAll;
      els.teShowAll.setAttribute('aria-pressed', state.showAll ? 'true' : 'false');
      els.teShowAll.textContent = state.showAll ? '收起全部' : '查看全部检查项';
      renderChecks();
    });

    on(document.querySelector('[data-save]'), 'click', saveCurrent);
  }

  function on(target, type, handler) {
    if (target) target.addEventListener(type, handler);
  }

  /* ---------------- 主题集合 ---------------- */

  function loadDrafts() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function persist() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(drafts));
    } catch (error) {
      toast('草稿保存失败：浏览器禁止了本地存储', true);
    }
  }

  function firstTheme() {
    var theme = BUILTINS[0] || drafts[0];
    if (!theme) return null;
    return { theme: theme, origin: BUILTINS[0] ? 'builtin' : 'custom', draftId: BUILTINS[0] ? null : theme.id };
  }

  function findTheme(id) {
    if (!id) return null;
    var siteTheme = state.siteThemes.filter(function (theme) { return theme.id === id; })[0];
    if (siteTheme) return { theme: siteTheme, origin: 'site', draftId: id };
    var builtin = BUILTINS.filter(function (theme) { return theme.id === id; })[0];
    if (builtin) return { theme: builtin, origin: 'builtin', draftId: null };
    var draft = drafts.filter(function (theme) { return theme.id === id; })[0];
    if (draft) return { theme: draft, origin: 'custom', draftId: id };
    return null;
  }

  function loadTheme(theme, origin, draftId) {
    state.draft = normalizeTheme(theme);
    state.origin = origin;
    state.editingDraftId = draftId || null;
    state.dirty = false;
    lastImport = null;
  }

  /* 「复制为基础」：内置主题只读，复制出一份草稿再改，不会覆盖 themes/*.json。 */
  function duplicateTheme(source) {
    if (!source) return null;
    var copy = clone(source);
    copy.id = uniqueId((source.id || 'theme') + '-copy', null);
    copy.name = (source.name || '主题') + ' 副本';
    drafts.push(copy);
    persist();
    loadTheme(copy, 'custom', copy.id);
    state.dirty = false;
    renderAll();
    return copy;
  }

  function makeBlank() {
    var next = drafts.length + 1;
    var theme = {
      schemaVersion: R.THEME_SCHEMA_VERSION,
      id: uniqueId('custom-' + next, null),
      name: '自定义主题 ' + next,
      tone: 'paper',
      description: '从空白开始，按自己的品牌色填空。',
      modes: {
        light: { seeds: clone(R.DEFAULT_SEEDS.light), overrides: {} },
        dark: { seeds: clone(R.DEFAULT_SEEDS.dark), overrides: {} }
      },
      shared: { tokens: {} }
    };
    return theme;
  }

  function normalizeTheme(raw) {
    var theme = clone(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
    theme.schemaVersion = theme.schemaVersion == null ? R.THEME_SCHEMA_VERSION : theme.schemaVersion;
    theme.id = typeof theme.id === 'string' ? theme.id : '';
    theme.name = typeof theme.name === 'string' ? theme.name : '';
    theme.tone = typeof theme.tone === 'string' ? theme.tone : 'paper';
    theme.description = typeof theme.description === 'string' ? theme.description : '';
    theme.modes = theme.modes && typeof theme.modes === 'object' ? theme.modes : {};
    ['light', 'dark'].forEach(function (mode) {
      var variant = theme.modes[mode];
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) variant = {};
      variant.seeds = variant.seeds && typeof variant.seeds === 'object' && !Array.isArray(variant.seeds) ? variant.seeds : {};
      variant.overrides = variant.overrides && typeof variant.overrides === 'object' && !Array.isArray(variant.overrides) ? variant.overrides : {};
      theme.modes[mode] = variant;
    });
    if (!theme.shared || typeof theme.shared !== 'object') theme.shared = {};
    if (!theme.shared.tokens || typeof theme.shared.tokens !== 'object') theme.shared.tokens = {};
    return theme;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function seedBucket(mode) {
    return state.draft.modes[mode || state.mode].seeds;
  }

  function overrideBucket(mode) {
    return state.draft.modes[mode || state.mode].overrides;
  }

  /* ---------------- 渲染：主题列表 ---------------- */

  function renderAll() {
    syncMeta();
    renderThemeList();
    renderSeeds();
    renderDerived(true);
    renderChecks();
    renderPreview();
    applyChrome();
    updateSaveState();
    renderImportReport(lastImport);
  }

  function renderThemeList() {
    var list = els.teThemeList;
    if (!list) return;
    list.textContent = '';

    if (state.site) {
      appendGroup(list, '该站点主题', state.siteThemes, 'site');
      appendGroup(list, '内置主题', BUILTINS, 'builtin');
      return;
    }

    appendGroup(list, '内置主题', BUILTINS, 'builtin');
    if (drafts.length) appendGroup(list, '我的主题', drafts, 'custom');
    else {
      var empty = document.createElement('p');
      empty.className = 'te-themes-hint';
      empty.textContent = '还没有自定义主题。点上方「新建」或「复制」，导入的 JSON 也会出现在这里。';
      list.appendChild(empty);
    }
  }

  function appendGroup(list, label, themes, origin) {
    if (!themes.length) return;
    var title = document.createElement('div');
    title.className = 'lc-tree-group-title';
    var name = document.createElement('span');
    name.textContent = label;
    var count = document.createElement('span');
    count.textContent = String(themes.length);
    title.appendChild(name);
    title.appendChild(count);
    list.appendChild(title);

    themes.forEach(function (theme) {
      var row = document.createElement('div');
      row.className = 'te-theme-row';

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'te-theme-item';
      button.setAttribute('aria-pressed', state.draft && theme.id === state.draft.id ? 'true' : 'false');

      var swatches = document.createElement('span');
      swatches.className = 'te-theme-swatches';
      swatches.setAttribute('aria-hidden', 'true');
      var resolved = R.resolveMode(theme, 'light');
      [resolved['--lc-color-bg'], resolved['--lc-color-surface'], resolved['--lc-color-accent'], resolved['--lc-color-ink']].forEach(function (color) {
        var dot = document.createElement('span');
        dot.style.background = color;
        swatches.appendChild(dot);
      });

      var labelEl = document.createElement('span');
      labelEl.className = 'te-theme-name';
      labelEl.textContent = theme.name || theme.id || '未命名';
      var badge = document.createElement('span');
      badge.className = 'te-theme-badge';
      var badgeText = origin === 'site' ? '站点' : origin === 'builtin' ? '内置' : '草稿';
      if (state.site && theme.id === state.site.activeId) badgeText += ' · 当前';
      badge.textContent = badgeText;

      button.appendChild(swatches);
      button.appendChild(labelEl);
      button.appendChild(badge);
      button.addEventListener('click', function () {
        if (state.dirty && !window.confirm('当前主题有未保存改动，切换会丢失，继续吗？')) return;
        var draftId = origin === 'site' || origin === 'custom' ? theme.id : null;
        loadTheme(theme, origin, draftId);
        renderAll();
      });
      row.appendChild(button);

      if (origin === 'builtin') {
        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'te-override-reset';
        copyBtn.title = '复制为基础';
        copyBtn.setAttribute('aria-label', '复制「' + (theme.name || theme.id) + '」为基础主题');
        copyBtn.innerHTML = '<svg class="lc-icon" aria-hidden="true"><use href="#lc-icon-copy"></use></svg>';
        copyBtn.addEventListener('click', function () {
          if (state.dirty && !window.confirm('当前主题有未保存改动，复制会丢失，继续吗？')) return;
          var made = duplicateTheme(theme);
          if (made) toast('已复制「' + (theme.name || theme.id) + '」为基础');
        });
        row.appendChild(copyBtn);
      }

      if (origin === 'custom' && !state.site) {
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'te-override-reset';
        remove.title = '删除这套草稿';
        remove.setAttribute('aria-label', '删除草稿 ' + (theme.name || theme.id));
        remove.textContent = '×';
        remove.addEventListener('click', function () {
          if (!window.confirm('删除草稿「' + (theme.name || theme.id) + '」？此操作不可撤销。')) return;
          drafts = drafts.filter(function (item) { return item.id !== theme.id; });
          persist();
          if (state.editingDraftId === theme.id) {
            var fallback = firstTheme();
            if (fallback) loadTheme(fallback.theme, fallback.origin, fallback.draftId);
            else loadTheme(makeBlank(), 'custom', null);
          }
          renderAll();
          toast('已删除草稿');
        });
        row.appendChild(remove);
      }

      list.appendChild(row);
    });
  }

  /* ---------------- 渲染：元信息 ---------------- */

  function syncMeta() {
    if (!state.draft) return;
    els.teId.value = state.draft.id || '';
    els.teName.value = state.draft.name || '';
    els.teTone.value = R.TONES.indexOf(state.draft.tone) >= 0 ? state.draft.tone : 'paper';
    els.teDescription.value = state.draft.description || '';
    if (els.teFormMeta) {
      els.teFormMeta.textContent = (state.mode === 'light' ? '亮色' : '暗色') + ' · ' +
        (state.origin === 'builtin' ? '内置主题副本' : state.origin === 'site' ? '站点主题' : state.origin === 'custom' ? '我的草稿' : '导入文件');
    }
  }

  /* ---------------- 渲染：主色 ---------------- */

  function renderSeeds() {
    var host = els.teSeeds;
    host.textContent = '';
    var seeds = seedBucket();

    R.REQUIRED_SEEDS.concat(OPTIONAL_SEEDS).forEach(function (key) {
      var optional = OPTIONAL_SEEDS.indexOf(key) >= 0;
      var raw = seeds[key];
      var parsed = R.parseColor(raw);
      var effective = raw || effectiveAuto(key);

      var row = document.createElement('div');
      row.className = 'te-color-row';

      var label = document.createElement('label');
      label.className = 'te-color-row-label';
      var labelText = document.createElement('span');
      labelText.textContent = R.SEED_LABELS[key] || key;
      var code = document.createElement('code');
      code.textContent = key + (optional ? '（留空=自动）' : '');
      label.appendChild(labelText);
      label.appendChild(code);

      var color = document.createElement('input');
      color.type = 'color';
      color.value = parsed ? R.toHex(parsed) : '#000000';
      color.setAttribute('data-seed', key);
      color.setAttribute('aria-label', (R.SEED_LABELS[key] || key) + ' 颜色');

      var hex = document.createElement('input');
      hex.type = 'text';
      hex.className = 'te-hex';
      hex.value = typeof raw === 'string' ? raw : '';
      hex.placeholder = optional ? String(effective) : '';
      hex.setAttribute('data-seed', key);
      hex.setAttribute('aria-label', (R.SEED_LABELS[key] || key) + ' 十六进制值');
      hex.spellcheck = false;
      if (raw && !parsed) hex.classList.add('is-bad');

      var reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'te-override-reset';
      reset.textContent = '×';
      if (optional) {
        reset.setAttribute('data-reset-seed', key);
        reset.title = '回到自动派生';
        reset.setAttribute('aria-label', '清除 ' + (R.SEED_LABELS[key] || key) + '，回到自动');
        reset.disabled = raw == null;
      } else {
        reset.hidden = true;
      }

      row.appendChild(label);
      row.appendChild(color);
      row.appendChild(hex);
      row.appendChild(reset);
      host.appendChild(row);
    });

    var hint = document.createElement('p');
    hint.className = 'te-themes-hint';
    hint.style.margin = '4px 0 0';
    hint.textContent = '主色按实色十六进制保存。改主色后，派生色与对比度会立即重算。';
    host.appendChild(hint);
  }

  function effectiveAuto(key) {
    var token = key === 'accent2'
      ? '--lc-color-accent-2'
      : '--lc-color-' + key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
    var resolved = R.resolveMode(state.draft, state.mode);
    return resolved[token] || '#000000';
  }

  function setSeed(key, value) {
    seedBucket()[key] = value;
    var row = els.teSeeds.querySelector('.te-hex[data-seed="' + key + '"]');
    if (row) {
      row.value = value;
      row.classList.remove('is-bad');
    }
    var reset = els.teSeeds.querySelector('[data-reset-seed="' + key + '"]');
    if (reset) reset.disabled = false;
    markDirty();
    renderDerived(false);
    renderChecks();
    renderPreview();
    applyChrome();
  }

  function applySeedText(input) {
    var key = input.getAttribute('data-seed');
    var value = input.value.trim();
    if (!value) {
      if (OPTIONAL_SEEDS.indexOf(key) >= 0) {
        clearSeed(key);
        return;
      }
      input.classList.add('is-bad');
      return;
    }
    var parsed = R.parseColor(value);
    if (!parsed || parsed.a !== 1) {
      input.classList.add('is-bad');
      seedBucket()[key] = value;
    } else {
      input.classList.remove('is-bad');
      seedBucket()[key] = R.toHex(parsed);
      input.value = R.toHex(parsed);
      var colorInput = els.teSeeds.querySelector('input[type="color"][data-seed="' + key + '"]');
      if (colorInput) colorInput.value = R.toHex(parsed);
    }
    markDirty();
    renderDerived(false);
    renderChecks();
    renderPreview();
    applyChrome();
  }

  function clearSeed(key) {
    delete seedBucket()[key];
    markDirty();
    renderSeeds();
    renderDerived(false);
    renderChecks();
    renderPreview();
    applyChrome();
  }

  /* ---------------- 渲染：派生色 ---------------- */

  function renderDerived(rebuild) {
    var host = els.teDerived;
    if (rebuild) host.textContent = '';
    var resolved = R.resolveMode(state.draft, state.mode);
    var overrides = overrideBucket();
    var rows = host.querySelectorAll('[data-derived-token]');

    if (!rebuild && rows.length === R.COLOR_TOKENS.length) {
      R.COLOR_TOKENS.forEach(function (token) {
        var row = host.querySelector('[data-derived-token="' + token.name + '"]');
        if (!row) return;
        var swatch = row.querySelector('.te-derived-swatch');
        var input = row.querySelector('.te-hex');
        if (swatch) swatch.style.background = resolved[token.name] || 'transparent';
        if (input) {
          input.placeholder = String(resolved[token.name] || '');
          input.title = token.label + ' 自动值 ' + (resolved[token.name] || '未知');
        }
      });
      if (els.teDerivedCount) els.teDerivedCount.textContent = R.COLOR_TOKENS.length + ' 个颜色令牌';
      return;
    }

    R.COLOR_TOKENS.forEach(function (token) {
      var row = document.createElement('div');
      row.className = 'te-derived-row';
      row.setAttribute('data-derived-token', token.name);

      var swatch = document.createElement('span');
      swatch.className = 'te-derived-swatch';
      swatch.style.background = resolved[token.name] || 'transparent';
      swatch.title = token.label;

      var name = document.createElement('span');
      name.className = 'te-derived-name';
      name.textContent = token.name;

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'te-hex';
      input.value = overrides[token.name] || '';
      input.placeholder = String(resolved[token.name] || '');
      input.title = token.label + ' 自动值 ' + (resolved[token.name] || '未知');
      input.setAttribute('data-token', token.name);
      input.setAttribute('aria-label', token.label + ' 手动覆盖值');
      input.spellcheck = false;

      var reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'te-override-reset';
      reset.textContent = '×';
      reset.title = '清除手动覆盖';
      reset.setAttribute('aria-label', '清除 ' + token.label + ' 的手动覆盖');
      reset.setAttribute('data-reset-override', token.name);
      reset.disabled = !overrides[token.name];

      row.appendChild(swatch);
      row.appendChild(name);
      row.appendChild(input);
      row.appendChild(reset);
      host.appendChild(row);
    });

    if (els.teDerivedCount) els.teDerivedCount.textContent = R.COLOR_TOKENS.length + ' 个颜色令牌';
  }

  function applyOverrideText(input) {
    var token = input.getAttribute('data-token');
    var value = input.value.trim();
    if (!value) {
      delete overrideBucket()[token];
      input.classList.remove('is-bad');
    } else {
      var parsed = R.parseColor(value);
      if (!parsed) {
        input.classList.add('is-bad');
        return;
      }
      input.classList.remove('is-bad');
      overrideBucket()[token] = R.toHex(parsed);
      input.value = R.toHex(parsed);
    }
    var reset = els.teDerived.querySelector('[data-reset-override="' + token + '"]');
    if (reset) reset.disabled = !overrideBucket()[token];
    markDirty();
    renderDerived(false);
    renderChecks();
    renderPreview();
    applyChrome();
  }

  function clearOverride(token) {
    delete overrideBucket()[token];
    markDirty();
    renderDerived(true);
    renderChecks();
    renderPreview();
    applyChrome();
  }

  /* ---------------- 渲染：实时校验 ---------------- */

  function pairItems(resolved) {
    var items = [];
    [
      ['text', R.TEXT_PAIRS],
      ['weak', R.WEAK_PAIRS],
      ['ui', R.UI_PAIRS],
      ['disabled', R.DISABLED_PAIRS]
    ].forEach(function (group) {
      group[1].forEach(function (pair) {
        var ratio = R.contrastRatio(resolved[pair[0]], resolved[pair[1]]);
        items.push(makeItem(group[0], pair[0], pair[1], pair[2], ratio));
      });
    });
    R.OVERLAY_PAIRS.forEach(function (pair) {
      var composited = R.compositeOver(resolved[pair[1]], resolved[pair[2]]);
      var ratio = R.contrastRatio(resolved[pair[0]], composited);
      var item = makeItem('overlay', pair[0], pair[2], pair[3], ratio);
      item.bg = pair[1] + ' → ' + pair[2];
      item.bgLabel = (R.COLOR_TOKEN_LABELS[pair[2]] || pair[2]) + '上的遮罩';
      items.push(item);
    });
    return items;
  }

  function makeItem(kind, fg, bg, min, ratio) {
    return {
      kind: kind,
      fg: fg,
      bg: bg,
      min: min,
      ratio: ratio,
      pass: ratio != null && ratio >= min,
      deficit: ratio == null ? null : Math.max(0, min - ratio),
      fgLabel: R.COLOR_TOKEN_LABELS[fg] || fg,
      bgLabel: R.COLOR_TOKEN_LABELS[bg] || bg
    };
  }

  var KEY_PAIRS = [
    ['--lc-color-ink', '--lc-color-bg'],
    ['--lc-color-ink', '--lc-color-surface'],
    ['--lc-color-ink-2', '--lc-color-surface'],
    ['--lc-color-muted', '--lc-color-surface'],
    ['--lc-color-placeholder', '--lc-color-surface'],
    ['--lc-color-accent', '--lc-color-bg'],
    ['--lc-color-accent-2', '--lc-color-surface'],
    ['--lc-color-on-accent', '--lc-color-accent-fill'],
    ['--lc-color-on-accent', '--lc-color-accent-fill-hover'],
    ['--lc-color-on-accent', '--lc-color-accent-fill-pressed'],
    ['--lc-color-focus', '--lc-color-surface'],
    ['--lc-color-line-strong', '--lc-color-surface'],
    ['--lc-color-disabled-ink', '--lc-color-disabled-bg'],
    ['--lc-color-danger', '--lc-color-danger-soft']
  ];

  function seedsReady() {
    var seeds = seedBucket();
    return R.REQUIRED_SEEDS.every(function (key) {
      var parsed = R.parseColor(seeds[key]);
      return parsed && parsed.a === 1;
    });
  }

  function renderChecks() {
    var host = els.teChecks;
    host.textContent = '';
    var resolved = R.resolveMode(state.draft, state.mode);
    var items = pairItems(resolved);
    var failures = items.filter(function (item) { return !item.pass; });
    var serious = failures.filter(function (item) { return item.kind === 'text' || item.kind === 'weak'; });

    if (!seedsReady()) {
      var missing = R.REQUIRED_SEEDS.filter(function (key) {
        var parsed = R.parseColor(seedBucket()[key]);
        return !parsed || parsed.a !== 1;
      });
      addIssue(host, '还有 ' + missing.length + ' 个必填主色没填（' + missing.join('、') + '），下面按默认值预演。', 'warn');
    }

    var headline = items.filter(function (item) {
      return item.fg === '--lc-color-ink' && item.bg === '--lc-color-bg';
    })[0];
    if (headline && !headline.pass) {
      addIssue(host, '正文文字与页面背景只有 ' + ratioText(headline.ratio) + '，低于 4.5:1，差 ' +
        headline.deficit.toFixed(2) + '。请把正文调深或背景调浅，别等导出后才发现看不清。');
    }

    var shown = state.showAll ? items : items.filter(function (item) {
      return KEY_PAIRS.some(function (pair) { return pair[0] === item.fg && pair[1] === item.bg; });
    });

    var list = document.createElement('div');
    list.className = 'te-checks';
    shown.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'te-check' + (item.pass ? '' : ' is-fail');

      var icon = document.createElement('span');
      icon.className = 'te-check-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = item.pass
        ? '<svg class="lc-icon lc-icon-sm" aria-hidden="true"><use href="#lc-icon-check"></use></svg>'
        : '<svg class="lc-icon lc-icon-sm" aria-hidden="true"><use href="#lc-icon-warning"></use></svg>';

      var label = document.createElement('span');
      label.className = 'te-check-label';
      label.textContent = item.fgLabel + ' / ' + item.bgLabel;
      label.title = item.fg + ' × ' + item.bg + '，要求 ≥ ' + item.min + ':1';

      var ratio = document.createElement('span');
      ratio.className = 'te-check-ratio';
      ratio.textContent = ratioText(item.ratio) + (item.pass ? '' : ' · 差 ' + item.deficit.toFixed(2));

      row.appendChild(icon);
      row.appendChild(label);
      row.appendChild(ratio);
      list.appendChild(row);
    });
    host.appendChild(list);

    var foot = document.createElement('div');
    foot.className = 'te-checks-foot';
    var text = document.createElement('span');
    text.textContent = '全部 ' + items.length + ' 项，通过 ' + (items.length - failures.length) + ' 项' +
      (serious.length ? '，其中文字对比度不达标 ' + serious.length + ' 项' : '') + '。';
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'lc-btn lc-btn-ghost lc-btn-sm';
    toggle.textContent = state.showAll ? '只看关键项' : '查看全部 ' + items.length + ' 项';
    toggle.addEventListener('click', function () {
      state.showAll = !state.showAll;
      if (els.teShowAll) {
        els.teShowAll.setAttribute('aria-pressed', state.showAll ? 'true' : 'false');
        els.teShowAll.textContent = state.showAll ? '收起全部' : '查看全部检查项';
      }
      renderChecks();
    });
    foot.appendChild(text);
    foot.appendChild(toggle);
    host.appendChild(foot);
  }

  function ratioText(ratio) {
    return ratio == null ? '无法计算' : ratio.toFixed(2) + ':1';
  }

  function addIssue(host, text, tone) {
    var list = document.createElement('ul');
    list.className = 'te-issues';
    var item = document.createElement('li');
    if (tone) item.className = 'is-' + tone;
    item.textContent = text;
    list.appendChild(item);
    host.appendChild(list);
  }

  /* ---------------- 渲染：预览 ---------------- */

  function buildPreviewContent() {
    var markup = sampleMarkup();
    if (els.tePaneLight) els.tePaneLight.innerHTML = markup;
    if (els.tePaneDark) els.tePaneDark.innerHTML = markup;
  }

  function sampleMarkup() {
    return [
      '<article class="te-sample">',
      '  <h1>主题与设计令牌</h1>',
      '  <p class="te-sample-lead">同一段真实内容，用两套配色并排渲染。改任意主色，左右两侧和下方表格、图表都会立刻跟着变。</p>',
      '  <p>正文段落用来检查阅读密度：字号、行高、颜色层级是否拉开。次要文字应该比正文弱，但仍要看得清。</p>',
      '  <p class="te-sample-note">下面标着「禁用态示例」的复选框和输入框，是故意使用禁用态配色的示例块。它们比常规控件暗，属于示例豁免，不是对比度缺陷。</p>',
      '  <div class="te-sample-actions">',
      '    <button class="lc-btn lc-btn-primary lc-btn-sm" type="button">保存并应用</button>',
      '    <button class="lc-btn lc-btn-sm" type="button">取消</button>',
      '    <span class="lc-badge lc-badge-success">已发布</span>',
      '    <span class="lc-badge lc-badge-warn">有改动</span>',
      '  </div>',
      '  <form class="te-sample-form" onsubmit="return false">',
      '    <label class="lc-label">站点名称<input class="lc-input" placeholder="例如：科设笔记" /></label>',
      '    <label class="lc-label">订阅方式<select class="lc-select"><option>每日摘要</option><option>每周精选</option></select></label>',
      '    <label class="lc-check"><input type="checkbox" checked /> <span>接收更新通知</span></label>',
      '    <label class="lc-check"><input type="checkbox" disabled /> <span>禁用态示例</span></label>',
      '    <input class="lc-input" placeholder="占位符颜色示例" aria-label="占位符示例" />',
      '    <input class="lc-input" disabled value="禁用输入框" aria-label="禁用输入框示例" />',
      '  </form>',
      '  <h2>最近发布</h2>',
      '  <table class="te-sample-table">',
      '    <thead><tr><th>页面</th><th>状态</th><th>更新</th></tr></thead>',
      '    <tbody>',
      '      <tr><td>主题与令牌</td><td>已发布</td><td>今天</td></tr>',
      '      <tr><td>组件库</td><td>草稿</td><td>昨天</td></tr>',
      '      <tr><td>导出设置</td><td>待审</td><td>3 天前</td></tr>',
      '    </tbody>',
      '  </table>',
      '  <figure style="margin:0">',
      '    <svg class="te-chart" viewBox="0 0 220 82" role="img" aria-label="示例柱状图">',
      '      <line x1="6" y1="72" x2="214" y2="72" stroke="var(--lc-color-line)" />',
      '      <rect x="10" y="44" width="26" height="28" fill="var(--lc-color-accent)" rx="2" />',
      '      <rect x="52" y="28" width="26" height="44" fill="var(--lc-color-accent-2)" rx="2" />',
      '      <rect x="94" y="14" width="26" height="58" fill="var(--lc-color-accent)" rx="2" />',
      '      <rect x="136" y="34" width="26" height="38" fill="var(--lc-color-warn)" rx="2" />',
      '      <rect x="178" y="22" width="26" height="50" fill="var(--lc-color-success)" rx="2" />',
      '    </svg>',
      '    <figcaption class="te-sample-lead">示例图表：柱色直接引用主题变量，不写死色值。</figcaption>',
      '  </figure>',
      '</article>'
    ].join('\n');
  }

  function renderPreview() {
    if (!state.draft) return;
    ['light', 'dark'].forEach(function (mode) {
      var host = mode === 'light' ? els.tePaneLight : els.tePaneDark;
      if (!host) return;
      var resolved = R.resolveMode(state.draft, mode);
      Object.keys(resolved).forEach(function (key) {
        host.style.setProperty(key, resolved[key]);
      });
      host.style.colorScheme = mode;
    });

    var light = R.resolveMode(state.draft, 'light');
    var inkOnBg = R.contrastRatio(light['--lc-color-ink'], light['--lc-color-bg']);
    var mutedOnSurface = R.contrastRatio(light['--lc-color-muted'], light['--lc-color-surface']);
    if (els.tePreviewMeta) {
      els.tePreviewMeta.textContent = '亮色 正文 ' + ratioText(inkOnBg) + ' · 次要 ' + ratioText(mutedOnSurface);
    }
  }

  /* ---------------- 编辑器外观 ---------------- */

  function applyChrome() {
    var html = document.documentElement;
    var mode = state.chrome === 'auto' ? state.mode : state.chrome;
    html.setAttribute('data-lc-mode', mode);
    html.style.colorScheme = mode;

    if (state.chrome === 'auto' && state.draft) {
      html.setAttribute('data-lc-theme', state.draft.id || 'ink-green');
      var resolved = R.resolveMode(state.draft, mode);
      Object.keys(resolved).forEach(function (key) {
        html.style.setProperty(key, resolved[key]);
      });
    } else {
      html.setAttribute('data-lc-theme', 'ink-green');
      R.COLOR_TOKENS.forEach(function (token) {
        html.style.removeProperty(token.name);
      });
      Object.keys(R.BASE_SHADOW.light).forEach(function (key) {
        html.style.removeProperty(key);
      });
    }
  }

  /* ---------------- 保存 / 导入 / 导出 ---------------- */

  function markDirty() {
    state.dirty = true;
    updateSaveState();
  }

  function updateSaveState() {
    if (els.saveLabel) els.saveLabel.textContent = state.site ? '保存到站点' : '保存草稿';
    if (!els.teSaveState) return;
    var text;
    if (state.site) {
      if (state.origin === 'site') text = state.dirty ? '站点主题 · 有未保存改动' : '站点主题 · 已保存到站点';
      else if (state.origin === 'import') text = state.dirty ? '导入文件 · 保存后写入站点' : '导入文件 · 保存后写入站点';
      else text = '内置主题 · 保存后写入站点';
    } else if (state.origin === 'builtin') text = state.dirty ? '内置主题 · 有未保存改动' : '内置主题 · 改动会另存为草稿';
    else if (state.origin === 'import') text = state.dirty ? '导入文件 · 有未保存改动' : '导入文件';
    else text = state.dirty ? '草稿 · 未保存' : '草稿 · 已保存';
    els.teSaveState.textContent = text;
    els.teSaveState.classList.toggle('is-dirty', state.dirty);
  }

  function saveCurrent() {
    if (!state.draft) return;
    var result = R.validateThemeData(state.draft);
    if (!result.ok) {
      lastImport = { result: result, file: state.site ? '保存到站点检查' : '保存检查' };
      renderImportReport(lastImport);
      toast('还有 ' + result.errors.length + ' 个问题，修正后再保存', true);
      return;
    }
    if (state.site) saveToSite(result);
    else saveTheme();
  }

  /* 站点主题：写入 sites/<id>/themes/<themeId>.json，并把 project.theme.activeId 指过去。 */
  function saveToSite(result) {
    var originId = state.editingDraftId;
    var id = siteThemeId(state.draft.id, originId, state.origin);
    var renamed = id !== state.draft.id;
    state.draft.id = id;
    if (renamed) syncMeta();

    var mode = els.teSiteMode && ['light', 'dark', 'auto'].indexOf(els.teSiteMode.value) >= 0
      ? els.teSiteMode.value
      : 'auto';
    var allowSwitch = (state.site.allowSwitch || []).slice();
    if (allowSwitch.indexOf(id) === -1) allowSwitch.push(id);

    var saveButton = document.querySelector('[data-save]');
    if (saveButton) saveButton.disabled = true;
    apiRequest('PUT', '/api/sites/' + encodeURIComponent(SITE_ID) + '/theme', {
      themeJson: state.draft,
      activeId: id,
      mode: mode,
      allowSwitch: allowSwitch,
      previousId: originId && originId !== id ? originId : undefined
    }).then(function (data) {
      var saved = normalizeTheme(data && data.themeJson ? data.themeJson : state.draft);
      state.site.activeId = id;
      state.site.mode = mode;
      state.site.allowSwitch = Array.isArray(data && data.theme && data.theme.allowSwitch) ? data.theme.allowSwitch : allowSwitch;
      state.siteThemes = state.siteThemes.filter(function (theme) {
        return theme.id !== originId && theme.id !== id;
      });
      state.siteThemes.push(saved);
      state.siteThemes.sort(function (a, b) { return a.id.localeCompare(b.id); });
      state.origin = 'site';
      state.editingDraftId = id;
      state.dirty = false;
      renderAll();
      toast('已保存到站点「' + state.site.name + '」' + (renamed ? '，主题 id 调整为 ' + id : '') + '，builder 与导出刷新即生效');
    }).catch(function (error) {
      toast('保存到站点失败：' + error.message, true);
    }).then(function () {
      if (saveButton) saveButton.disabled = false;
    });
  }

  /* 站点内主题 id：允许覆盖当前内置主题；与其它站点主题重名时自动加 -2。 */
  function siteThemeId(base, originId, origin) {
    var stem = String(base || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (stem.length < 2) stem = 'site-theme';
    if (stem.length > 30) stem = stem.slice(0, 30).replace(/-+$/, '');
    var candidate = stem;
    var index = 2;
    while (conflicts(candidate, originId, origin)) {
      candidate = stem + '-' + index;
      index += 1;
    }
    return candidate;

    function conflicts(id, selfId, themeOrigin) {
      if (id === selfId) return false;
      if (state.siteThemes.some(function (theme) { return theme.id === id; })) return true;
      if (BUILTINS.some(function (theme) { return theme.id === id; })) {
        /* 内置主题原地改令牌，就写同名站点主题覆盖；其它情况带上后缀避免歧义。 */
        return themeOrigin !== 'builtin';
      }
      return false;
    }
  }

  function saveTheme() {
    if (!state.draft) return;
    var result = R.validateThemeData(state.draft);
    if (!result.ok) {
      lastImport = { result: result, file: '保存检查' };
      renderImportReport(lastImport);
      toast('还有 ' + result.errors.length + ' 个问题，修正后再保存', true);
      return;
    }

    var id = uniqueId(state.draft.id, state.editingDraftId);
    var renamed = id !== state.draft.id;
    state.draft.id = id;
    if (renamed) syncMeta();

    var previousId = state.editingDraftId;
    if (previousId && previousId !== id) {
      drafts = drafts.filter(function (theme) { return theme.id !== previousId; });
    }
    var index = -1;
    drafts.forEach(function (theme, i) { if (theme.id === id) index = i; });
    if (index >= 0) drafts[index] = clone(state.draft);
    else drafts.push(clone(state.draft));

    state.editingDraftId = id;
    state.origin = 'custom';
    state.dirty = false;
    persist();
    renderThemeList();
    syncMeta();
    updateSaveState();
    toast('已保存到「我的主题」' + (renamed ? '，id 调整为 ' + id : ''));
  }

  function exportTheme() {
    if (!state.draft) return;
    var text = JSON.stringify(state.draft, null, 2) + '\n';
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (state.draft.id || 'theme') + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    var result = R.validateThemeData(state.draft);
    if (result.ok) toast('已导出 ' + anchor.download);
    else toast('已导出，但还有 ' + result.errors.length + ' 个问题，对方导入时会看到清单', true);
  }

  function readFile(file) {
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      toast('只接受 .json 主题文件', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      importText(String(reader.result || ''), file.name);
    };
    reader.onerror = function () {
      toast('文件读取失败：' + (reader.error && reader.error.message ? reader.error.message : '未知错误'), true);
    };
    reader.readAsText(file);
  }

  function importText(text, filename) {
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      toast('JSON 解析失败：' + error.message, true);
      lastImport = {
        result: { ok: false, name: null, errors: ['JSON 解析失败：' + error.message], warnings: [], contrast: { light: [], dark: [] } },
        file: filename
      };
      renderImportReport(lastImport);
      return;
    }

    var result = R.validateThemeData(raw);
    /* 旧版本文件先迁移再载入，避免 v1 平铺结构进编辑器后 modes 为空。 */
    var migration = R.migrateThemeData(raw);
    loadTheme(migration.ok ? migration.theme : raw, 'import', null);
    state.dirty = true;
    lastImport = { result: result, file: filename };
    renderAll();
    toast(
      result.ok
        ? '已导入「' + (result.name || filename) + '」，字段与对比度全部通过'
        : '已导入「' + (result.name || filename) + '」，但有 ' + result.errors.length + ' 个问题，见右侧清单',
      !result.ok
    );
  }

  function renderImportReport(report) {
    var host = els.teImportReport;
    if (!host) return;
    host.textContent = '';
    if (!report) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    var title = document.createElement('h3');
    title.textContent = '导入检查 · ' + (report.file || '未命名文件');
    host.appendChild(title);

    var list = document.createElement('ul');
    list.className = 'te-issues';

    var result = report.result;
    if (result.ok) {
      var ok = document.createElement('li');
      ok.className = 'is-ok';
      ok.textContent = '字段完整，对比度全部达标，可以直接保存。';
      list.appendChild(ok);
    }
    (result.errors || []).forEach(function (text) {
      var item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    });
    (result.warnings || []).forEach(function (text) {
      var item = document.createElement('li');
      item.className = 'is-warn';
      item.textContent = text;
      list.appendChild(item);
    });
    host.appendChild(list);

    var note = document.createElement('p');
    note.className = 'te-themes-hint';
    note.style.margin = '6px 0 0';
    note.textContent = '导入不会拒绝文件：只要 JSON 能解析，就会载入编辑器，问题逐条列在上面。修好后再保存。';
    host.appendChild(note);
  }

  /* ---------------- 工具 ---------------- */

  function setMode(mode) {
    if (mode !== 'light' && mode !== 'dark') return;
    state.mode = mode;
    Array.prototype.forEach.call(els.teModeTabs.querySelectorAll('[data-mode]'), function (button) {
      var active = button.getAttribute('data-mode') === mode;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.classList.toggle('is-active', active);
      button.tabIndex = active ? 0 : -1;
    });
    syncMeta();
    renderSeeds();
    renderDerived(true);
    renderChecks();
    renderPreview();
    applyChrome();
  }

  function uniqueId(base, selfId) {
    var stem = String(base || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (stem.length < 2) stem = (stem || 'c') + 'theme';
    if (stem.length > 30) stem = stem.slice(0, 30).replace(/-+$/, '');
    var candidate = stem;
    var index = 2;
    while (idTaken(candidate, selfId)) {
      candidate = stem + '-' + index;
      index += 1;
    }
    return candidate;
  }

  function idTaken(id, selfId) {
    var inBuiltin = BUILTINS.some(function (theme) { return theme.id === id; });
    var inDrafts = drafts.some(function (theme) { return theme.id === id && theme.id !== selfId; });
    return inBuiltin || inDrafts;
  }

  var toastTimer = null;
  function toast(message, isError) {
    if (!els.teToast) return;
    els.teToast.textContent = message;
    els.teToast.classList.toggle('is-error', Boolean(isError));
    els.teToast.classList.add('is-show');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      els.teToast.classList.remove('is-show');
    }, 3200);
  }

  /* 所有 var 初始化和函数声明都就位后再启动，避免在 KEY_PAIRS 等常量赋值前
     就调用 renderChecks（否则会抛 undefined.some）。 */
  boot();
})();
