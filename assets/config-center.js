/* 低代码平台 · 配置中心页面 */
(function () {
  'use strict';

  var Catalog = window.LCMiddlewareCatalog;
  var UI = window.LCConfigUI;
  var esc = UI.esc;

  var LAYERS = [
    { id: 'default', label: '内置默认', hint: '定义里的 default' },
    { id: 'generated', label: '平台生成', hint: 'config.generated.yaml' },
    { id: 'site', label: '站点覆盖', hint: 'config.yaml' },
    { id: 'env', label: '环境变量', hint: 'LC_CFG_<KEY>' },
    { id: 'cli', label: '启动参数', hint: '--cfg KEY=VALUE' }
  ];

  var state = {
    sites: [],
    siteId: '',
    environment: 'dev',
    data: null,
    dirty: false,
    busy: false,
    revealed: {}
  };

  var refs = {};

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function setSaveState(text, kind) {
    refs.saveState.textContent = text;
    refs.saveState.className = 'lc-save-state' + (kind ? ' is-' + kind : '');
  }

  function syncBackBuilder() {
    if (!refs.backBuilder) return;
    var requested = state.siteId || new URLSearchParams(window.location.search).get('site') || '';
    refs.backBuilder.href = requested ? 'builder.html?site=' + encodeURIComponent(requested) : 'builder.html';
  }

  function updateDirty(dirty) {
    if (dirty !== undefined) state.dirty = dirty;
    refs.save.disabled = !state.siteId || !state.dirty || state.busy;
    if (!state.siteId) setSaveState('未选择项目');
    else if (state.busy) setSaveState('保存中…');
    else if (state.dirty) setSaveState('有未保存修改', 'dirty');
    else if (state.data) setSaveState('已保存', 'saved');
  }

  function setStatusSite() {
    refs.statusSite.textContent = state.siteId
      ? '当前项目：' + state.siteId + ' · 环境：' + state.environment
      : '未选择项目';
  }

  /* ---------------- 站点 ---------------- */

  function renderSiteSelects() {
    var options = '<option value="">选择项目…</option>' + state.sites.map(function (site) {
      return '<option value="' + esc(site.siteId) + '">' + esc(site.name || site.siteId) + '</option>';
    }).join('');
    refs.siteSelect.innerHTML = options;
    refs.gateSite.innerHTML = options;
    refs.siteSelect.value = state.siteId;
    refs.gateSite.value = state.siteId;
  }

  function showGate(message, title) {
    state.siteId = '';
    state.data = null;
    state.dirty = false;
    refs.gate.hidden = false;
    refs.content.hidden = true;
    if (refs.gateTitle) refs.gateTitle.textContent = title || '先选择一个项目';
    refs.gateHint.textContent = message || '选择一个项目开始编辑。';
    refs.pageTitle.textContent = '配置中心';
    refs.pageMeta.textContent = '';
    refs.groups.innerHTML = '';
    refs.groupNav.innerHTML = '';
    refs.save.disabled = true;
    refs.importBtn.disabled = true;
    refs.exportBtn.disabled = true;
    updateDirty(false);
    setStatusSite();
    renderSiteSelects();
  }

  function emptyLayers() {
    return { values: {}, site: {}, env: {}, cli: {} };
  }

  function normalizeView(view) {
    view.environment = view.environment === 'prod' ? 'prod' : 'dev';
    view.definitions = Array.isArray(view.definitions) ? view.definitions : [];
    view.environments = view.environments && typeof view.environments === 'object' ? view.environments : {};
    ['dev', 'prod'].forEach(function (name) {
      if (!view.environments[name]) view.environments[name] = emptyLayers();
      ['values', 'site', 'env', 'cli'].forEach(function (layer) {
        if (!view.environments[name][layer] || typeof view.environments[name][layer] !== 'object') {
          view.environments[name][layer] = {};
        }
      });
    });
    view.builtin = Array.isArray(view.builtin) ? view.builtin : [];
    view.definitions.forEach(function (def) {
      def.derived = def.derived === true;
      def.secret = def.secret === true;
      if (!def.group) def.group = 'backend';
    });
    return view;
  }

  function syncSiteLinks(siteId) {
    Array.prototype.forEach.call(document.querySelectorAll('a[data-site-link]'), function (link) {
      var base = link.getAttribute('data-site-link');
      link.href = siteId ? base + '?site=' + encodeURIComponent(siteId) : base;
    });
  }

  async function loadSite(siteId) {
    state.siteId = siteId;
    syncBackBuilder();
    syncSiteLinks(siteId);
    state.revealed = {};
    var site = state.sites.find(function (item) { return item.siteId === siteId; });
    /* 纯静态项目不读后端配置：直接给出口提示，避免绕过入口后露出完整后端面板。 */
    if (site && site.type !== 'backend') {
      showGate('「' + (site.name || site.siteId) + '」是纯静态项目，没有后端配置可改。切换到带后端项目后再配置。', '这个项目是纯静态');
      state.siteId = siteId;
      renderSiteSelects();
      if (refs.backendLink) refs.backendLink.hidden = true;
      return;
    }
    if (refs.backendLink) refs.backendLink.hidden = false;
    refs.gate.hidden = true;
    refs.content.hidden = false;
    refs.pageTitle.textContent = '正在读取配置…';
    refs.pageMeta.textContent = '';
    renderSiteSelects();
    try {
      var view = await UI.api('/api/sites/' + encodeURIComponent(siteId) + '/config-center');
      state.data = normalizeView(view);
      state.environment = state.data.environment;
      state.dirty = false;
      render();
      var url = new URL(window.location.href);
      url.searchParams.set('site', siteId);
      window.history.replaceState(null, '', url.pathname + url.search);
    } catch (error) {
      showGate('读取失败：' + error.message);
      UI.toast(error.message, 'error');
    }
  }

  function loadSites() {
    return UI.api('/api/sites').then(function (sites) {
      state.sites = Array.isArray(sites) ? sites : [];
      renderSiteSelects();
      var requested = new URLSearchParams(window.location.search).get('site') || '';
      if (state.sites.some(function (site) { return site.siteId === requested; })) {
        return loadSite(requested);
      }
      if (!state.sites.length) {
        showGate('还没有项目。先到 Builder 创建一个项目，再回来配置。');
        return;
      }
      showGate('选择一个项目开始编辑；未选项目时不会读取或写入任何项目配置。');
    }).catch(function (error) {
      showGate('项目列表读取失败：' + error.message);
    });
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    if (!state.data) return;
    var site = state.sites.find(function (item) { return item.siteId === state.siteId; });
    refs.pageTitle.textContent = '配置中心 · ' + (site ? (site.name || site.siteId) : state.siteId);
    refs.pageMeta.textContent = '环境 ' + state.environment + ' · ' + state.data.definitions.filter(function (def) { return !def.derived; }).length + ' 个配置项';
    refs.importBtn.disabled = false;
    refs.exportBtn.disabled = false;
    renderEnvSwitch();
    renderChain();
    renderGroupNav();
    renderGroups();
    updateDirty(state.dirty);
    setStatusSite();
  }

  function renderEnvSwitch() {
    $all('[data-env]', refs.envSwitch).forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-env') === state.environment);
    });
  }

  function renderChain() {
    refs.chain.innerHTML = LAYERS.map(function (layer) {
      return '<li title="' + esc(layer.hint) + '">' + esc(layer.label) + '</li>';
    }).join('');
  }

  function definitionsOfGroup(groupId) {
    return state.data.definitions.filter(function (def) { return def.group === groupId; });
  }

  function renderGroupNav() {
    refs.groupNav.innerHTML = Catalog.CONFIG_GROUPS.map(function (group) {
      var count = definitionsOfGroup(group.id).length;
      return '<button type="button" data-jump="cfg-group-' + esc(group.id) + '">' +
        '<span>' + esc(group.label) + '</span>' +
        '<span class="lc-config-nav-count">' + count + '</span>' +
        '</button>';
    }).join('');
  }

  function envVarName(key) {
    return Catalog.envNameForKey(key);
  }

  function sourceBadge(source) {
    return '<span class="lc-source is-' + esc(source || 'missing') + '">' + esc(UI.sourceLabel(source)) + '</span>';
  }

  function valueCell(def, entry) {
    if (def.secret) {
      if (!entry || entry.source === 'missing' || entry.effective === undefined || entry.effective === '') {
        return '<span class="lc-config-value">—</span>';
      }
      var revealKey = state.environment + '.' + def.key;
      var revealed = state.revealed[revealKey] === true;
      return '<span class="lc-config-value is-secret" data-effective-value="' + esc(def.key) + '">' +
        esc(revealed ? entry.effective : '••••••') +
        '</span> <button class="lc-btn lc-btn-sm" type="button" data-reveal-effective="' + esc(def.key) + '">' +
        (revealed ? '隐藏' : '查看') + '</button>';
    }
    var text = UI.valueText(entry && entry.effective, def.type);
    return '<span class="lc-config-value">' + (text === '' ? '—' : esc(text)) + '</span>';
  }

  function renderGroups() {
    refs.groups.innerHTML = Catalog.CONFIG_GROUPS.map(function (group) {
      var defs = definitionsOfGroup(group.id);
      var rows = defs.map(function (def) {
        var entry = def[state.environment] || { source: 'missing' };
        return '<tr data-def-row="' + esc(def.key) + '">' +
          '<td>' +
            '<div class="lc-config-key">' + esc(def.key) + (def.secret ? ' <span class="lc-badge lc-badge-warn">敏感</span>' : '') + '</div>' +
            '<p class="lc-config-sub">' + esc(def.description || '没有说明') + '</p>' +
            '<p class="lc-config-sub">' + esc(envVarName(def.key)) + '</p>' +
          '</td>' +
          '<td><span class="lc-badge">' + esc(UI.typeLabel(def.type)) + '</span></td>' +
          '<td>' + valueCell(def, entry) + '</td>' +
          '<td>' + sourceBadge(entry.source) + '</td>' +
          '<td>' +
            (def.derived
              ? '<span class="lc-config-sub">由自定义中间件生成</span>'
              : '<div class="lc-config-actions">' +
                  '<button class="lc-btn" type="button" data-layers="' + esc(def.key) + '">各层</button>' +
                  '<button class="lc-btn" type="button" data-edit="' + esc(def.key) + '">编辑</button>' +
                  '<button class="lc-btn lc-btn-danger" type="button" data-delete="' + esc(def.key) + '">删除</button>' +
                '</div>') +
          '</td>' +
        '</tr>';
      }).join('');

      var recommended = (Catalog.RECOMMENDED_DEFINITIONS[group.id] || []).filter(function (item) {
        return !defs.some(function (def) { return def.key === item.key; });
      });
      var builtin = group.id === 'middleware' && state.data.builtin.length
        ? '<ul class="lc-mw-summary">' + state.data.builtin.map(function (item) {
            return '<li><strong>' + esc(item.label) + '</strong>' +
              '<span class="lc-source is-generated">项目配置</span>' +
              (item.fields.filter(function (field) { return field.secret; }).map(function (field) {
                return '<span class="lc-config-sub">' + esc(field.env) + '</span>';
              }).join('')) +
              '</li>';
          }).join('') + '</ul>'
        : '';

      return '<section class="lc-config-section" id="cfg-group-' + esc(group.id) + '">' +
        '<div class="lc-config-section-head">' +
          '<h2>' + esc(group.label) + '</h2>' +
          '<p>' + esc(group.description) + '</p>' +
          '<button class="lc-btn lc-btn-sm" type="button" data-add-group="' + esc(group.id) + '">添加配置项</button>' +
        '</div>' +
        builtin +
        (defs.length
          ? '<div class="lc-config-table-wrap"><table class="lc-config-table">' +
              '<thead><tr><th>键</th><th>类型</th><th>当前生效值（' + esc(state.environment) + '）</th><th>来源</th><th>操作</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table></div>'
          : '<div class="lc-config-empty">这个分组还没有配置项。可以点右上角添加，或从推荐键里挑一个。</div>') +
        (recommended.length
          ? '<div class="lc-config-rule" style="margin-top:10px;">' + recommended.map(function (item) {
              return '<button class="lc-btn lc-btn-sm" type="button" data-add-recommended="' + esc(item.key) + '" data-group="' + esc(group.id) + '">+ ' + esc(item.key) + '</button>';
            }).join('') + '</div>'
          : '') +
      '</section>';
    }).join('');
  }

  function findDefinition(key) {
    return state.data.definitions.find(function (def) { return def.key === key; });
  }

  /* ---------------- 值校验 ---------------- */

  function coerce(type, raw, enumList, fieldKey) {
    if (raw === undefined || raw === null || raw === '') return { value: undefined };
    if (type === 'number') {
      var number = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(number)) return { error: (fieldKey || '值') + ' 必须是数字' };
      return { value: number };
    }
    if (type === 'bool') {
      if (typeof raw === 'boolean') return { value: raw };
      var text = String(raw).trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(text)) return { value: true };
      if (['false', '0', 'no', 'off'].includes(text)) return { value: false };
      return { error: (fieldKey || '值') + ' 必须是 true/false' };
    }
    if (type === 'enum') {
      var value = String(raw);
      if (!Array.isArray(enumList) || !enumList.includes(value)) {
        return { error: (fieldKey || '值') + ' 只能是 ' + (enumList || []).join(' / ') };
      }
      return { value: value };
    }
    return { value: String(raw) };
  }

  /* ---------------- 添加 / 编辑 ---------------- */

  function openEditor(key, groupId, recommended) {
    var editing = Boolean(key);
    var definition = editing ? findDefinition(key) : null;
    if (!definition) {
      definition = {
        key: recommended ? recommended.key : '',
        group: groupId || 'backend',
        type: recommended ? recommended.type : 'string',
        default: recommended ? recommended.default : undefined,
        enum: recommended ? recommended.enum : undefined,
        secret: false,
        description: recommended ? recommended.description : ''
      };
    }
    var draft = UI.clone(definition);
    var env = state.environment;
    var currentLayers = state.data.environments[env];
    var dialog = UI.dialog({
      title: editing ? '编辑配置项 ' + definition.key : '添加配置项',
      description: editing ? '定义是 dev / prod 共用的；下面只编辑当前环境（' + env + '）的层值。' : '先定义键和类型，再填当前环境（' + env + '）的层值。',
      width: '760px'
    });
    dialog.body.innerHTML =
      '<div class="lc-form-grid">' +
        '<label class="lc-field is-short"><span class="lc-label">配置键</span>' +
          '<input class="lc-input" type="text" data-def-key value="' + esc(draft.key) + '" placeholder="APP_MODE" autocomplete="off" spellcheck="false"' + (editing ? ' disabled' : '') + '></label>' +
        '<label class="lc-field is-short"><span class="lc-label">分组</span>' +
          '<select class="lc-select" data-def-group>' + Catalog.CONFIG_GROUPS.map(function (group) {
            return '<option value="' + esc(group.id) + '"' + (draft.group === group.id ? ' selected' : '') + '>' + esc(group.label) + '</option>';
          }).join('') + '</select></label>' +
        '<label class="lc-field is-short"><span class="lc-label">类型</span>' +
          '<select class="lc-select" data-def-type>' + ['string', 'number', 'bool', 'enum'].map(function (type) {
            return '<option value="' + type + '"' + (draft.type === type ? ' selected' : '') + '>' + UI.typeLabel(type) + '</option>';
          }).join('') + '</select></label>' +
        '<label class="lc-check" style="padding-top:22px;"><input type="checkbox" data-def-secret' + (draft.secret ? ' checked' : '') + '><span>敏感值</span></label>' +
        '<label class="lc-field is-medium"><span class="lc-label">默认值 <small>可留空</small></span>' +
          '<input class="lc-input" type="text" data-def-default value="' + esc(draft.default == null ? '' : draft.default) + '" autocomplete="off"></label>' +
        '<label class="lc-field is-long" data-enum-wrap' + (draft.type === 'enum' ? '' : ' hidden') + '><span class="lc-label">枚举可选值 <small>逗号分隔</small></span>' +
          '<input class="lc-input" type="text" data-def-enum value="' + esc(Array.isArray(draft.enum) ? draft.enum.join(', ') : '') + '" placeholder="standard, strict" autocomplete="off"></label>' +
        '<label class="lc-field is-long"><span class="lc-label">说明 <small>可留空</small></span>' +
          '<input class="lc-input" type="text" data-def-description value="' + esc(draft.description || '') + '" autocomplete="off" maxlength="512"></label>' +
      '</div>' +
      '<h3 style="margin:20px 0 6px;font-size:var(--lc-text-sm);">当前环境层值（' + esc(env) + '）</h3>' +
      '<p class="lc-hint" style="margin:0 0 12px;">留空表示这一层不设置，不会覆盖前面的层。密钥只允许放在环境变量 / 启动参数层。</p>' +
      '<div class="lc-layer-editor" data-layers-editor></div>';

    var layersEditor = $('[data-layers-editor]', dialog.body);
    var keyInput = $('[data-def-key]', dialog.body);
    var typeSelect = $('[data-def-type]', dialog.body);
    var secretCheck = $('[data-def-secret]', dialog.body);
    var defaultInput = $('[data-def-default]', dialog.body);
    var enumWrap = $('[data-enum-wrap]', dialog.body);
    var enumInput = $('[data-def-enum]', dialog.body);

    function layerValue(layerId) {
      return currentLayers[layerId] ? currentLayers[layerId][draft.key] : undefined;
    }

    function renderLayers() {
      var type = typeSelect.value;
      var secret = secretCheck.checked;
      var enumList = enumInput.value.split(',').map(function (part) { return part.trim(); }).filter(Boolean);
      var currentKey = keyInput.value.trim().toUpperCase() || draft.key;
      layersEditor.innerHTML = LAYERS.slice(1).map(function (layer) {
        var stored = currentLayers[layer.id] ? currentLayers[layer.id][currentKey] : undefined;
        var disabled = secret && (layer.id === 'generated' || layer.id === 'site');
        var input = '';
        if (disabled) {
          input = '<input class="lc-input" type="text" value="" placeholder="密钥不允许写这一层" disabled>';
        } else if (type === 'bool') {
          input = '<select class="lc-select" data-layer-input="' + layer.id + '">' +
            '<option value=""' + (stored === undefined || stored === '' ? ' selected' : '') + '>未设置</option>' +
            '<option value="true"' + (stored === true || stored === 'true' ? ' selected' : '') + '>true</option>' +
            '<option value="false"' + (stored === false || stored === 'false' ? ' selected' : '') + '>false</option>' +
          '</select>';
        } else if (type === 'enum') {
          input = '<select class="lc-select" data-layer-input="' + layer.id + '">' +
            '<option value=""' + (stored === undefined || stored === '' ? ' selected' : '') + '>未设置</option>' +
            enumList.map(function (option) {
              return '<option value="' + esc(option) + '"' + (String(stored) === option ? ' selected' : '') + '>' + esc(option) + '</option>';
            }).join('') +
          '</select>';
        } else {
          input = '<input class="lc-input" type="' + (secret ? 'password' : 'text') + '" data-layer-input="' + layer.id + '" value="' +
            esc(stored === undefined || stored === '' ? '' : stored) + '" autocomplete="off" spellcheck="false">';
        }
        return '<div class="lc-layer-row' + (disabled ? ' is-disabled' : '') + '">' +
          '<span class="lc-label">' + esc(layer.label) + '<small>' + esc(layer.hint) + '</small></span>' +
          '<div>' + input + '</div>' +
        '</div>';
      }).join('');
    }

    renderLayers();

    typeSelect.addEventListener('change', function () {
      enumWrap.hidden = typeSelect.value !== 'enum';
      renderLayers();
    });
    secretCheck.addEventListener('change', function () {
      defaultInput.disabled = secretCheck.checked;
      if (secretCheck.checked) defaultInput.value = '';
      renderLayers();
    });
    enumInput.addEventListener('input', function () {
      if (typeSelect.value === 'enum') renderLayers();
    });
    defaultInput.disabled = secretCheck.checked;

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lc-btn';
    cancel.textContent = '取消';
    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'lc-btn lc-btn-primary';
    save.textContent = '应用';
    dialog.foot.appendChild(cancel);
    dialog.foot.appendChild(save);
    cancel.addEventListener('click', dialog.close);

    save.addEventListener('click', function () {
      var nextKey = keyInput.value.trim().toUpperCase();
      if (!Catalog.KEY_RE.test(nextKey)) {
        UI.toast('配置键需大写字母开头，只含 A-Z、0-9、下划线', 'error');
        return;
      }
      if (Catalog.isReservedKey(nextKey)) {
        UI.toast('配置键与内置中间件环境变量或 MW_ 前缀冲突', 'error');
        return;
      }
      var duplicate = state.data.definitions.some(function (item) {
        return item.key === nextKey && (!editing || item.key !== key);
      });
      if (duplicate) {
        UI.toast('配置键已存在：' + nextKey, 'error');
        return;
      }
      var type = typeSelect.value;
      var secret = secretCheck.checked;
      var enumList = type === 'enum'
        ? enumInput.value.split(',').map(function (part) { return part.trim(); }).filter(Boolean)
        : undefined;
      if (type === 'enum' && (!enumList || !enumList.length)) {
        UI.toast('枚举类型必须填写可选值', 'error');
        return;
      }
      var defDefault;
      if (secret) {
        defDefault = undefined;
      } else {
        var coercedDefault = coerce(type, defaultInput.value, enumList, '默认值');
        if (coercedDefault.error) {
          UI.toast(coercedDefault.error, 'error');
          return;
        }
        defDefault = coercedDefault.value;
      }

      var nextLayers = { values: {}, site: {}, env: {}, cli: {} };
      var invalid = null;
      $all('[data-layer-input]', layersEditor).forEach(function (input) {
        if (invalid) return;
        var layerId = input.getAttribute('data-layer-input');
        if (secret && (layerId === 'generated' || layerId === 'site')) return;
        var result = coerce(type, input.value, enumList, nextKey);
        if (result.error) {
          invalid = result.error + '（' + LAYERS.find(function (layer) { return layer.id === layerId; }).label + '）';
          return;
        }
        if (result.value !== undefined) nextLayers[layerId][nextKey] = result.value;
      });
      if (invalid) {
        UI.toast(invalid, 'error');
        return;
      }

      var nextDef = {
        key: nextKey,
        group: $('[data-def-group]', dialog.body).value,
        type: type,
        default: defDefault,
        enum: enumList,
        secret: secret,
        description: $('[data-def-description]', dialog.body).value.trim(),
        derived: false
      };
      if (editing) {
        var index = state.data.definitions.findIndex(function (item) { return item.key === key; });
        state.data.definitions[index] = nextDef;
        if (nextKey !== key) {
          LAYERS.slice(1).forEach(function (layer) {
            ['dev', 'prod'].forEach(function (name) {
              var map = state.data.environments[name][layer.id];
              if (map[key] !== undefined) {
                map[nextKey] = map[key];
                delete map[key];
              }
            });
          });
        }
      } else {
        state.data.definitions.push(nextDef);
      }
      /* 只替换当前键在当前环境的层值，不能覆盖同环境其他键。 */
      LAYERS.slice(1).forEach(function (layer) {
        var target = state.data.environments[env][layer.id];
        if (nextKey !== key) delete target[key];
        delete target[nextKey];
        if (nextLayers[layer.id][nextKey] !== undefined) target[nextKey] = nextLayers[layer.id][nextKey];
      });
      recomputeAll();
      state.dirty = true;
      dialog.close();
      render();
    });
  }

  /* ---------------- 各层查看 ---------------- */

  function openLayers(key) {
    var def = findDefinition(key);
    if (!def) return;
    var entry = def[state.environment] || { source: 'missing' };
    var env = state.environment;
    var dialog = UI.dialog({
      title: def.key + ' · 各层覆盖（' + env + '）',
      description: '从上到下逐层覆盖，最后有值的一层就是当前生效值。',
      width: '680px'
    });
    var layerValues = entry.layers || {};
    dialog.body.innerHTML =
      '<ul class="lc-layer-chain" style="margin-bottom:16px;">' + LAYERS.map(function (layer) {
        return '<li class="' + (entry.source === layer.id ? 'is-win' : '') + '">' + esc(layer.label) + '</li>';
      }).join('') + '</ul>' +
      '<div class="lc-layer-editor">' + LAYERS.map(function (layer) {
        var value = layerValues[layer.id];
        var hasValue = !(value === undefined || value === null || value === '');
        var shown = hasValue ? (def.secret ? '••••••' : String(value)) : '—';
        return '<div class="lc-layer-row">' +
          '<span class="lc-label">' + esc(layer.label) + '<small>' + esc(layer.hint) + '</small></span>' +
          '<div><span class="lc-config-value' + (entry.source === layer.id ? ' is-win' : '') + '" data-layer-value="' + esc(layer.id) + '">' + esc(shown) + '</span>' +
            (def.secret && hasValue ? ' <button class="lc-btn lc-btn-sm" type="button" data-reveal-layer="' + esc(layer.id) + '">查看</button>' : '') +
            (entry.source === layer.id ? ' <span class="lc-badge lc-badge-success">生效</span>' : '') +
          '</div>' +
        '</div>';
      }).join('') + '</div>' +
      (entry.source === 'missing'
        ? '<div class="lc-danger-box" style="margin-top:14px;">这个键当前没有值。' + (def.secret ? '密钥必须由环境变量或启动参数提供。' : '建议至少填默认值或平台生成值。') + '</div>'
        : '');
    var revealedLayers = {};
    dialog.body.addEventListener('click', function (event) {
      var button = event.target.closest('[data-reveal-layer]');
      if (!button) return;
      var layerId = button.getAttribute('data-reveal-layer');
      var value = layerValues[layerId];
      revealedLayers[layerId] = !revealedLayers[layerId];
      var cell = $('[data-layer-value="' + layerId + '"]', dialog.body);
      if (cell) cell.textContent = revealedLayers[layerId] ? String(value == null ? '' : value) : '••••••';
      button.textContent = revealedLayers[layerId] ? '隐藏' : '查看';
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'lc-btn lc-btn-primary';
    close.textContent = '知道了';
    dialog.foot.appendChild(close);
    close.addEventListener('click', dialog.close);
  }

  /* ---------------- 前后端同构的生效值计算 ---------------- */

  function computeEntry(def, environment) {
    var layers = {
      default: def.default,
      generated: environment.values[def.key],
      site: environment.site[def.key],
      env: environment.env[def.key],
      cli: environment.cli[def.key]
    };
    var source = 'missing';
    if (def.secret) {
      layers.default = undefined;
      layers.generated = undefined;
      layers.site = undefined;
      if (layers.env !== undefined && layers.env !== '') source = 'env';
      else if (layers.cli !== undefined && layers.cli !== '') source = 'cli';
    } else {
      if (layers.default !== undefined) source = 'default';
      if (layers.generated !== undefined) source = 'generated';
      if (layers.site !== undefined) source = 'site';
      if (layers.env !== undefined) source = 'env';
      if (layers.cli !== undefined) source = 'cli';
    }
    return {
      source: source,
      effective: source === 'missing' ? undefined : layers[source],
      layers: layers
    };
  }

  function recomputeAll() {
    state.data.definitions.forEach(function (def) {
      if (def.derived) return;
      ['dev', 'prod'].forEach(function (name) {
        def[name] = computeEntry(def, state.data.environments[name]);
      });
    });
  }

  /* ---------------- 删除 ---------------- */

  async function removeDefinition(key) {
    var def = findDefinition(key);
    if (!def || def.derived) return;
    var ok = await UI.confirm({
      title: '删除配置项 ' + key + '？',
      message: '会同时清理 dev / prod 两个环境里这一键的所有层值。',
      detail: '导出产物里的 configCenter 定义和 values 也不再包含它。',
      confirmLabel: '删除',
      danger: true
    });
    if (!ok) return;
    state.data.definitions = state.data.definitions.filter(function (item) { return item.key !== key; });
    ['dev', 'prod'].forEach(function (name) {
      LAYERS.slice(1).forEach(function (layer) {
        delete state.data.environments[name][layer.id][key];
      });
    });
    state.dirty = true;
    render();
  }

  /* ---------------- 导入导出 ---------------- */

  function exportedDefinitions() {
    return state.data.definitions.filter(function (def) { return !def.derived; }).map(function (def) {
      return {
        key: def.key,
        group: def.group,
        type: def.type,
        default: def.default,
        enum: def.enum,
        secret: def.secret,
        description: def.description
      };
    });
  }

  function buildExport(masked) {
    var environments = UI.clone(state.data.environments);
    if (masked) {
      state.data.definitions.forEach(function (def) {
        if (!def.secret) return;
        ['dev', 'prod'].forEach(function (name) {
          ['env', 'cli'].forEach(function (layer) {
            if (environments[name][layer][def.key] !== undefined) environments[name][layer][def.key] = '***';
          });
        });
      });
    }
    return {
      schemaVersion: 1,
      kind: 'lowcode-config-center',
      exportedAt: new Date().toISOString(),
      siteId: state.siteId,
      environment: state.environment,
      definitions: exportedDefinitions(),
      environments: environments,
      secretsIncluded: !masked
    };
  }

  function exportConfig() {
    if (!state.data) return;
    var dialog = UI.dialog({
      title: '导出配置中心',
      description: '导出定义与 dev / prod 两个环境的层值；导入时会校验格式并提示冲突。',
      width: '560px'
    });
    dialog.body.innerHTML =
      '<div class="lc-warn-box">默认导出包含敏感值明文。这个文件等同于密钥清单，请只放在安全位置。</div>' +
      '<label class="lc-check" style="margin-top:14px;"><input type="checkbox" data-mask><span>导出时把敏感值打码（导入时保留原有密钥）</span></label>' +
      '<p class="lc-hint" style="margin:10px 0 0;">格式：<code>lowcode-config-center</code> v1；包含 definitions 与 environments.dev / environments.prod。</p>';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lc-btn';
    cancel.textContent = '取消';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'lc-btn lc-btn-primary';
    ok.textContent = '导出 JSON';
    dialog.foot.appendChild(cancel);
    dialog.foot.appendChild(ok);
    cancel.addEventListener('click', dialog.close);
    ok.addEventListener('click', function () {
      var masked = $('[data-mask]', dialog.body).checked;
      var filename = 'config-center-' + state.siteId + '-' + new Date().toISOString().slice(0, 10) + '.json';
      UI.download(filename, JSON.stringify(buildExport(masked), null, 2));
      dialog.close();
      UI.toast('已导出 ' + filename, 'success');
    });
  }

  function normalizeImportedDefinition(raw) {
    var key = String(raw.key || '').trim().toUpperCase();
    if (!Catalog.KEY_RE.test(key)) throw new Error('配置键不合法：' + (key || '(空)'));
    if (Catalog.isReservedKey(key)) throw new Error('配置键与内置中间件环境变量或 MW_ 前缀冲突：' + key);
    var group = Catalog.configGroup(String(raw.group || 'backend')) ? String(raw.group || 'backend') : 'backend';
    var type = ['string', 'number', 'bool', 'enum'].includes(raw.type) ? raw.type : 'string';
    var enumList = Array.isArray(raw.enum) ? raw.enum.map(String).filter(Boolean) : undefined;
    if (type === 'enum' && (!enumList || !enumList.length)) throw new Error('枚举配置项 ' + key + ' 缺少可选值');
    var secret = raw.secret === true;
    var defDefault;
    if (!secret && raw.default !== undefined && raw.default !== null && String(raw.default) !== '') {
      var result = coerce(type, raw.default, enumList, key);
      if (result.error) throw new Error(result.error);
      defDefault = result.value;
    }
    return {
      key: key,
      group: group,
      type: type,
      default: defDefault,
      enum: enumList,
      secret: secret,
      description: String(raw.description || ''),
      derived: false
    };
  }

  function importPayload(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('文件内容不是对象');
    if (payload.kind !== 'lowcode-config-center') throw new Error('不是配置中心文件（kind 应为 lowcode-config-center）');
    if (Number(payload.schemaVersion) !== 1) throw new Error('不支持的 schemaVersion：' + payload.schemaVersion);
    if (!Array.isArray(payload.definitions)) throw new Error('缺少 definitions 数组');

    var seen = new Set();
    var definitions = payload.definitions.map(function (raw) {
      var def = normalizeImportedDefinition(raw);
      if (seen.has(def.key)) throw new Error('配置键重复：' + def.key);
      seen.add(def.key);
      return def;
    });

    var environments = { dev: emptyLayers(), prod: emptyLayers() };
    ['dev', 'prod'].forEach(function (name) {
      var source = payload.environments && payload.environments[name] ? payload.environments[name] : {};
      ['values', 'site', 'env', 'cli'].forEach(function (layer) {
        var map = source[layer] && typeof source[layer] === 'object' ? source[layer] : {};
        Object.keys(map).forEach(function (key) {
          var def = definitions.find(function (item) { return item.key === key; });
          if (!def) return;
          if (def.secret && (layer === 'values' || layer === 'site')) return;
          var result = coerce(def.type, map[key], def.enum, key);
          if (result.error) throw new Error(result.error);
          if (result.value !== undefined) environments[name][layer][key] = result.value;
        });
      });
    });

    var conflicts = [];
    definitions.forEach(function (def) {
      var current = state.data.definitions.find(function (item) { return item.key === def.key; });
      if (!current) return;
      if (current.type !== def.type || current.secret !== def.secret || current.group !== def.group) {
        conflicts.push(def.key + '：类型 / 敏感标记 / 分组与现有定义不同');
      }
    });

    var dialog = UI.dialog({
      title: '导入配置中心',
      description: '导入只改界面，点击保存后才写入项目。',
      width: '640px'
    });
    dialog.body.innerHTML =
      (conflicts.length
        ? '<div class="lc-warn-box"><strong>发现 ' + conflicts.length + ' 个定义冲突</strong><ul class="lc-import-list">' +
            conflicts.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul></div>'
        : '<div class="lc-config-empty" style="min-height:0;padding:12px;">没有发现定义冲突。</div>') +
      '<div class="lc-layer-editor" style="margin-top:16px;">' +
        '<label class="lc-check"><input type="radio" name="cfg-import-mode" value="merge" checked><span>合并：导入文件里的键覆盖现有同名键，其他键保持</span></label>' +
        '<label class="lc-check"><input type="radio" name="cfg-import-mode" value="replace"><span>覆盖：整份替换当前定义与两个环境的层值</span></label>' +
      '</div>';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lc-btn';
    cancel.textContent = '取消';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'lc-btn lc-btn-primary';
    ok.textContent = '应用到界面';
    dialog.foot.appendChild(cancel);
    dialog.foot.appendChild(ok);
    cancel.addEventListener('click', dialog.close);
    ok.addEventListener('click', function () {
      var mode = ($('input[name="cfg-import-mode"]:checked', dialog.body) || {}).value || 'merge';
      applyImport(definitions, environments, mode);
      dialog.close();
      UI.toast('已导入，请检查后点击保存', 'success');
    });
  }

  function applyImport(definitions, environments, mode) {
    var previousDefinitions = state.data.definitions;
    var previousEnvironments = state.data.environments;
    if (mode === 'replace') {
      definitions.forEach(function (def) {
        ['dev', 'prod'].forEach(function (name) {
          ['env', 'cli'].forEach(function (layer) {
            if (!def.secret || !UI.isMasked(environments[name][layer][def.key])) return;
            var old = previousDefinitions.find(function (item) { return item.key === def.key; });
            var oldValue = old && previousEnvironments[name][layer] ? previousEnvironments[name][layer][def.key] : '';
            environments[name][layer][def.key] = oldValue || '';
          });
        });
      });
      state.data.definitions = definitions;
      state.data.environments = environments;
    } else {
      definitions.forEach(function (def) {
        var index = state.data.definitions.findIndex(function (item) { return item.key === def.key; });
        if (index >= 0) state.data.definitions[index] = def;
        else state.data.definitions.push(def);
      });
      ['dev', 'prod'].forEach(function (name) {
        ['values', 'site', 'env', 'cli'].forEach(function (layer) {
          Object.keys(environments[name][layer]).forEach(function (key) {
            var value = environments[name][layer][key];
            if (UI.isMasked(value)) {
              var current = state.data.environments[name][layer][key];
              value = current === undefined ? '' : current;
            }
            state.data.environments[name][layer][key] = value;
          });
        });
      });
    }
    recomputeAll();
    state.dirty = true;
    render();
  }

  /* ---------------- 保存 ---------------- */

  async function save() {
    if (!state.siteId || !state.data || state.busy) return;
    state.busy = true;
    updateDirty();
    try {
      var view = await UI.api('/api/sites/' + encodeURIComponent(state.siteId) + '/config-center', {
        method: 'PUT',
        body: {
          environment: state.environment,
          definitions: exportedDefinitions(),
          environments: state.data.environments
        }
      });
      state.data = normalizeView(view);
      state.environment = state.data.environment;
      state.dirty = false;
      state.revealed = {};
      render();
      UI.toast('配置中心已保存', 'success');
    } catch (error) {
      setSaveState(error.message, 'error');
      UI.toast(error.message, 'error');
    } finally {
      state.busy = false;
      updateDirty();
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    refs.siteSelect.addEventListener('change', function () {
      if (this.value) loadSite(this.value);
      else showGate();
    });
    refs.gateSite.addEventListener('change', function () {
      if (this.value) loadSite(this.value);
    });
    refs.envSwitch.addEventListener('click', function (event) {
      var button = event.target.closest('[data-env]');
      if (!button) return;
      state.environment = button.getAttribute('data-env') === 'prod' ? 'prod' : 'dev';
      render();
    });
    refs.groupNav.addEventListener('click', function (event) {
      var button = event.target.closest('[data-jump]');
      if (!button) return;
      var target = document.getElementById(button.getAttribute('data-jump'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    refs.groups.addEventListener('click', function (event) {
      var target = event.target.closest('button');
      if (!target) return;
      if (target.matches('[data-add-group]')) {
        openEditor('', target.getAttribute('data-add-group'));
        return;
      }
      if (target.matches('[data-add-recommended]')) {
        var key = target.getAttribute('data-add-recommended');
        var groupId = target.getAttribute('data-group');
        var recommended = (Catalog.RECOMMENDED_DEFINITIONS[groupId] || []).find(function (item) { return item.key === key; });
        openEditor('', groupId, recommended);
        return;
      }
      if (target.matches('[data-edit]')) {
        openEditor(target.getAttribute('data-edit'));
        return;
      }
      if (target.matches('[data-delete]')) {
        removeDefinition(target.getAttribute('data-delete'));
        return;
      }
      if (target.matches('[data-layers]')) {
        openLayers(target.getAttribute('data-layers'));
        return;
      }
      if (target.matches('[data-reveal-effective]')) {
        var def = findDefinition(target.getAttribute('data-reveal-effective'));
        if (!def) return;
        var revealKey = state.environment + '.' + def.key;
        state.revealed[revealKey] = !state.revealed[revealKey];
        render();
      }
    });
    refs.exportBtn.addEventListener('click', exportConfig);
    refs.importBtn.addEventListener('click', function () { refs.importFile.click(); });
    refs.importFile.addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      UI.readJsonFile(file).then(importPayload).catch(function (error) {
        UI.toast(error.message, 'error');
      });
    });
    refs.save.addEventListener('click', save);
    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function init() {
    refs.siteSelect = $('[data-site-select]');
    refs.gate = $('[data-gate]');
    refs.gateTitle = $('[data-gate-title]');
    refs.backendLink = $('[data-backend-link]');
    refs.backBuilder = $('[data-back-builder]');
    syncBackBuilder();
    refs.gateSite = $('[data-gate-site]');
    refs.gateHint = $('[data-gate-hint]');
    refs.content = $('[data-content]');
    refs.pageTitle = $('[data-page-title]');
    refs.pageMeta = $('[data-page-meta]');
    refs.saveState = $('[data-save-state]');
    refs.save = $('[data-save]');
    refs.envSwitch = $('[data-env-switch]');
    refs.chain = $('[data-chain]');
    refs.groupNav = $('[data-group-nav]');
    refs.groups = $('[data-groups]');
    refs.importBtn = $('[data-import]');
    refs.exportBtn = $('[data-export]');
    refs.importFile = $('[data-import-file]');
    refs.statusSite = $('[data-status-site]');
    bind();
    loadSites();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
