/* 低代码平台 · 中间件页面 */
(function () {
  'use strict';

  var Catalog = window.LCMiddlewareCatalog;
  var UI = window.LCConfigUI;
  var esc = UI.esc;

  var state = {
    sites: [],
    siteId: '',
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

  function groupDef(id) {
    return Catalog.builtinGroup(id);
  }

  function groupState(id) {
    return state.data.groups[id];
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
      ? '当前项目：' + state.siteId
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
    refs.pageTitle.textContent = '中间件';
    refs.pageMeta.textContent = '';
    refs.builtinGrid.innerHTML = '';
    refs.customList.innerHTML = '';
    refs.builtinNav.innerHTML = '';
    refs.customNav.innerHTML = '';
    refs.save.disabled = true;
    refs.addCustom.disabled = true;
    refs.addCustom2.disabled = true;
    refs.importBtn.disabled = true;
    refs.exportBtn.disabled = true;
    updateDirty(false);
    setStatusSite();
    renderSiteSelects();
  }

  function normalizeView(view) {
    view.groups = view.groups && typeof view.groups === 'object' ? view.groups : {};
    Catalog.BUILTIN_GROUPS.forEach(function (group) {
      var item = view.groups[group.id];
      if (!item || typeof item !== 'object') item = { enabled: false, config: {} };
      item.enabled = item.enabled === true;
      item.config = Object.assign(Catalog.defaultConfig(group), item.config || {});
      view.groups[group.id] = item;
    });
    view.custom = Array.isArray(view.custom) ? view.custom : [];
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
    /* 纯静态项目没有后端，中间件配置无处落地：直接给出口提示，不读取后端配置。 */
    if (site && site.type !== 'backend') {
      showGate('「' + (site.name || site.siteId) + '」是纯静态项目，没有后端中间件。切换到带后端项目后再配置。', '这个项目是纯静态');
      state.siteId = siteId;
      renderSiteSelects();
      if (refs.backendLink) refs.backendLink.hidden = true;
      return;
    }
    if (refs.backendLink) refs.backendLink.hidden = false;
    refs.gate.hidden = true;
    refs.content.hidden = false;
    refs.pageTitle.textContent = '正在读取中间件…';
    refs.pageMeta.textContent = '';
    renderSiteSelects();
    try {
      var view = await UI.api('/api/sites/' + encodeURIComponent(siteId) + '/middleware');
      state.data = normalizeView(view);
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
        showGate('还没有项目。先到 Builder 创建一个项目，再回来配置中间件。');
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
    refs.pageTitle.textContent = '中间件 · ' + (site ? (site.name || site.siteId) : state.siteId);
    refs.pageMeta.textContent = '键名与后端模板读取规则一致';
    refs.addCustom.disabled = false;
    refs.addCustom2.disabled = false;
    refs.importBtn.disabled = false;
    refs.exportBtn.disabled = false;
    renderBuiltinNav();
    renderBuiltinGrid();
    renderCustomNav();
    renderCustomList();
    updateDirty(state.dirty);
    setStatusSite();
  }

  function renderBuiltinNav() {
    refs.builtinNav.innerHTML = Catalog.BUILTIN_GROUPS.map(function (group) {
      var item = groupState(group.id);
      return '<button type="button" data-jump="group-' + esc(group.id) + '">' +
        '<span>' + esc(group.label) + '</span>' +
        '<span class="lc-config-nav-count">' + (item.enabled ? '已启用' : '未启用') + '</span>' +
        '</button>';
    }).join('');
  }

  function renderCustomNav() {
    if (!state.data.custom.length) {
      refs.customNav.innerHTML = '<button type="button" data-jump="custom-section"><span>还没有自定义项</span></button>';
      return;
    }
    refs.customNav.innerHTML = state.data.custom.map(function (item) {
      return '<button type="button" data-jump="custom-' + esc(item.id) + '">' +
        '<span>' + esc(item.name || item.id) + '</span>' +
        '<span class="lc-config-nav-count">' + item.fields.length + ' 项</span>' +
        '</button>';
    }).join('');
  }

  function fieldInputId(groupId, key) {
    return 'mw-' + groupId + '-' + key;
  }

  function renderField(group, item, value) {
    var id = fieldInputId(group.id, item.key);
    var widthClass = item.width === 'long' ? 'is-long' : item.width === 'medium' ? 'is-medium' : 'is-short';
    var label = '<label class="lc-label" for="' + esc(id) + '">' + esc(item.label) +
      (item.secret ? ' <small>敏感</small>' : '') +
      (item.required ? ' <small>必填</small>' : '') +
      '</label>';
    var control = '';
    if (item.type === 'enum') {
      control = '<select class="lc-select" id="' + esc(id) + '" data-group-field="' + esc(group.id) + '" data-field="' + esc(item.key) + '">' +
        item.enum.map(function (option) {
          return '<option value="' + esc(option) + '"' + (String(value) === option ? ' selected' : '') + '>' + esc(option) + '</option>';
        }).join('') +
        '</select>';
    } else if (item.type === 'bool') {
      control = '<select class="lc-select" id="' + esc(id) + '" data-group-field="' + esc(group.id) + '" data-field="' + esc(item.key) + '">' +
        '<option value="true"' + (value === true || value === 'true' ? ' selected' : '') + '>true</option>' +
        '<option value="false"' + (value === false || value === 'false' ? ' selected' : '') + '>false</option>' +
        '</select>';
    } else if (item.secret) {
      var revealed = state.revealed[group.id + '.' + item.key] === true;
      control = '<div class="lc-secret-field">' +
        '<input class="lc-input" id="' + esc(id) + '" type="' + (revealed ? 'text' : 'password') + '" data-group-field="' + esc(group.id) + '" data-field="' + esc(item.key) + '" value="' + esc(value == null ? '' : value) + '" autocomplete="new-password" spellcheck="false">' +
        '<button type="button" class="lc-secret-toggle" data-reveal-group="' + esc(group.id) + '" data-reveal-field="' + esc(item.key) + '">' + (revealed ? '隐藏' : '查看') + '</button>' +
        '</div>';
    } else if (item.type === 'number') {
      control = '<input class="lc-input" id="' + esc(id) + '" type="number" data-group-field="' + esc(group.id) + '" data-field="' + esc(item.key) + '" value="' + esc(value == null ? '' : value) + '"' +
        (item.min !== undefined ? ' min="' + esc(item.min) + '"' : '') +
        (item.max !== undefined ? ' max="' + esc(item.max) + '"' : '') +
        '>';
    } else {
      control = '<input class="lc-input" id="' + esc(id) + '" type="text" data-group-field="' + esc(group.id) + '" data-field="' + esc(item.key) + '" value="' + esc(value == null ? '' : value) + '"' +
        (item.placeholder ? ' placeholder="' + esc(item.placeholder) + '"' : '') +
        ' autocomplete="off" spellcheck="false">';
    }
    return '<div class="lc-mw-field ' + widthClass + '">' +
      label + control +
      (item.hint ? '<p class="lc-hint">' + esc(item.hint) + '</p>' : '') +
      (item.secret && item.env ? '<p class="lc-hint lc-mw-env">' + esc(item.env) + '</p>' : '') +
      '</div>';
  }

  function renderBuiltinGrid() {
    refs.builtinGrid.innerHTML = Catalog.BUILTIN_GROUPS.map(function (group) {
      var item = groupState(group.id);
      var cardClass = 'lc-mw-card' + (item.enabled ? ' is-on' : '');
      var body = '';
      if (item.enabled) {
        body = '<div class="lc-mw-card-body">' +
          '<div class="lc-mw-fields">' +
            group.fields.map(function (field) { return renderField(group, field, item.config[field.key]); }).join('') +
          '</div>' +
          '<div class="lc-mw-field-foot">' +
            '<span>键名：' + esc(Catalog.envNameForBuiltin(group.group, group.fields[0].key).replace(/_([A-Z0-9]+)$/, '_<字段>')) + '</span>' +
            '<span>· 来源：项目配置</span>' +
          '</div>' +
        '</div>';
      } else {
        body = '<div class="lc-mw-card-off">已关闭，配置已清空。开启后才显示配置项。</div>';
      }
      return '<article class="' + cardClass + '" id="group-' + esc(group.id) + '" data-group-card="' + esc(group.id) + '">' +
        '<header class="lc-mw-card-head">' +
          '<div class="lc-mw-card-title">' +
            '<h3>' + esc(group.label) +
              ' <span class="lc-badge ' + (item.enabled ? 'lc-badge-success' : '') + '">' + (item.enabled ? '已启用' : '已关闭') + '</span>' +
            '</h3>' +
            '<p>' + esc(group.description) + '</p>' +
          '</div>' +
          '<label class="lc-switch">' +
            '<input type="checkbox" data-group-toggle="' + esc(group.id) + '"' + (item.enabled ? ' checked' : '') + '>' +
            '<span class="lc-switch-track" aria-hidden="true"></span>' +
            '<span>启用</span>' +
          '</label>' +
        '</header>' +
        body +
      '</article>';
    }).join('');
  }

  function renderCustomList() {
    if (!state.data.custom.length) {
      refs.customList.innerHTML = '<div class="lc-config-empty">还没有自定义中间件。新增后可以自行定义键、值和是否敏感。</div>';
      return;
    }
    refs.customList.innerHTML = '<div class="lc-custom-list">' + state.data.custom.map(function (item, index) {
      var secretCount = item.fields.filter(function (field) { return field.secret; }).length;
      return '<article class="lc-custom-card" id="custom-' + esc(item.id) + '">' +
        '<h3>' + esc(item.name || item.id) + '</h3>' +
        '<p>' + esc(item.description || '没有说明') + '</p>' +
        '<p class="lc-config-sub">ID：' + esc(item.id) + ' · ' + item.fields.length + ' 个字段' +
          (secretCount ? ' · ' + secretCount + ' 个敏感值' : '') + '</p>' +
        '<div class="lc-custom-card-foot">' +
          '<button class="lc-btn lc-btn-sm" type="button" data-edit-custom="' + index + '">编辑</button>' +
          '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-delete-custom="' + index + '">删除</button>' +
          '<span class="lc-custom-card-meta">MW_' + esc(Catalog.snake(item.id)) + '_*</span>' +
        '</div>' +
      '</article>';
    }).join('') + '</div>';
  }

  /* ---------------- 内置开关与字段 ---------------- */

  function clearGroup(id) {
    var group = groupDef(id);
    var item = groupState(id);
    item.enabled = false;
    item.config = Catalog.defaultConfig(group);
  }

  async function onToggleGroup(id, enabled) {
    var group = groupDef(id);
    var item = groupState(id);
    if (!enabled) {
      var ok = await UI.confirm({
        title: '关闭 ' + group.label + '？',
        message: '关闭后会清空这一组已填写的配置和密钥，导出产物里也不会再出现对应键。',
        detail: '这个操作只影响当前项目的中间件配置，保存后生效。',
        confirmLabel: '关闭并清空',
        danger: true
      });
      if (!ok) {
        render();
        return;
      }
      clearGroup(id);
      state.dirty = true;
      render();
      return;
    }

    if (group.kind === 'database') {
      var others = Catalog.BUILTIN_GROUPS.filter(function (other) {
        return other.kind === 'database' && other.id !== id && groupState(other.id).enabled;
      });
      if (others.length) {
        var names = others.map(function (other) { return other.label; }).join('、');
        var swap = await UI.confirm({
          title: '数据库中间件只能启用一个',
          message: '当前已启用 ' + names + '，是否关闭它并启用 ' + group.label + '？',
          detail: '被关闭的数据库组会清空配置与密钥，保存后按新的数据库连接导出。',
          confirmLabel: '替换为 ' + group.label
        });
        if (!swap) {
          render();
          return;
        }
        others.forEach(function (other) { clearGroup(other.id); });
      }
    }

    item.enabled = true;
    item.config = Object.assign(Catalog.defaultConfig(group), item.config || {});
    state.dirty = true;
    render();
  }

  function onFieldInput(element) {
    var id = element.getAttribute('data-group-field');
    var key = element.getAttribute('data-field');
    if (!id || !key) return;
    var item = groupState(id);
    var group = groupDef(id);
    var rule = group.fields.find(function (field) { return field.key === key; });
    var value = element.value;
    if (rule && rule.type === 'number' && value !== '') {
      var number = Number(value);
      value = Number.isFinite(number) ? number : value;
    }
    item.config[key] = value;
    state.dirty = true;
    updateDirty(true);
  }

  function onReveal(button) {
    var groupId = button.getAttribute('data-reveal-group');
    var key = button.getAttribute('data-reveal-field');
    var input = $('[data-group-field="' + groupId + '"][data-field="' + key + '"]', refs.builtinGrid);
    if (!input) return;
    var revealKey = groupId + '.' + key;
    state.revealed[revealKey] = !state.revealed[revealKey];
    input.type = state.revealed[revealKey] ? 'text' : 'password';
    button.textContent = state.revealed[revealKey] ? '隐藏' : '查看';
  }

  /* ---------------- 自定义中间件编辑器 ---------------- */

  function newCustomDraft() {
    return {
      id: '',
      name: '',
      description: '',
      fields: [{ key: '', label: '', type: 'string', secret: false, value: '' }]
    };
  }

  function customFieldRow(field, index) {
    var type = ['string', 'number', 'bool', 'enum'].includes(field.type) ? field.type : 'string';
    var enumText = Array.isArray(field.enum) ? field.enum.join(', ') : '';
    return '<div class="lc-custom-field-row" data-field-row="' + index + '">' +
      '<label class="lc-field is-short"><span class="lc-label">键</span>' +
        '<input class="lc-input" type="text" data-f-key value="' + esc(field.key) + '" placeholder="broker" autocomplete="off"></label>' +
      '<label class="lc-field is-short"><span class="lc-label">显示名</span>' +
        '<input class="lc-input" type="text" data-f-label value="' + esc(field.label) + '" placeholder="Broker 地址" autocomplete="off"></label>' +
      '<label class="lc-field is-short"><span class="lc-label">类型</span>' +
        '<select class="lc-select" data-f-type>' +
          ['string', 'number', 'bool', 'enum'].map(function (option) {
            return '<option value="' + option + '"' + (type === option ? ' selected' : '') + '>' + UI.typeLabel(option) + '</option>';
          }).join('') +
        '</select></label>' +
      '<label class="lc-check"><input type="checkbox" data-f-secret' + (field.secret ? ' checked' : '') + '><span>敏感</span></label>' +
      '<label class="lc-field is-long"><span class="lc-label">值</span>' +
        '<input class="lc-input" type="' + (field.secret ? 'password' : 'text') + '" data-f-value value="' + esc(field.value == null ? '' : field.value) + '" autocomplete="off" spellcheck="false"></label>' +
      '<button class="lc-btn lc-btn-sm lc-btn-danger" type="button" data-f-remove>删除</button>' +
      '<label class="lc-field is-long" data-f-enum-wrap style="grid-column:1/-1;"' + (type === 'enum' ? '' : ' hidden') + '><span class="lc-label">可选值 <small>逗号分隔</small></span>' +
        '<input class="lc-input" type="text" data-f-enum value="' + esc(enumText) + '" placeholder="s3, oss, cos" autocomplete="off"></label>' +
    '</div>';
  }

  function renderCustomFields(container, fields) {
    container.innerHTML = fields.map(customFieldRow).join('');
  }

  function openCustomEditor(index) {
    var editing = index !== undefined && index >= 0;
    var source = editing ? state.data.custom[index] : newCustomDraft();
    var draft = UI.clone(source);
    var dialog = UI.dialog({
      title: editing ? '编辑自定义中间件' : '新增自定义中间件',
      description: '连接方式由后端代码负责，这里只定义要注入的键值。',
      width: '920px'
    });
    dialog.body.innerHTML =
      '<div class="lc-form-grid">' +
        '<label class="lc-field is-medium"><span class="lc-label">名称</span>' +
          '<input class="lc-input" type="text" data-mw-name value="' + esc(draft.name) + '" placeholder="Kafka" autocomplete="off" maxlength="64"></label>' +
        '<label class="lc-field is-short"><span class="lc-label">ID</span>' +
          '<input class="lc-input" type="text" data-mw-id value="' + esc(draft.id) + '" placeholder="kafka" autocomplete="off" maxlength="32"' + (editing ? ' disabled' : '') + '></label>' +
        '<label class="lc-field is-long"><span class="lc-label">说明 <small>可留空</small></span>' +
          '<input class="lc-input" type="text" data-mw-description value="' + esc(draft.description) + '" autocomplete="off" maxlength="512"></label>' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 8px;">' +
        '<strong style="font-size:var(--lc-text-sm);">配置字段</strong>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-add-field>添加字段</button>' +
      '</div>' +
      '<p class="lc-hint" style="margin:0 0 10px;">导出到配置中心的键名是 <code>MW_&lt;ID&gt;_&lt;字段&gt;</code>；空键会被忽略。</p>' +
      '<div class="lc-custom-fields" data-fields></div>' +
      '<div class="lc-warn-box" style="margin-top:12px;">敏感字段默认掩码显示；整份导出默认包含明文，请只保存在安全位置。未填写的字段不会写入配置。</div>';

    var fieldsBox = $('[data-fields]', dialog.body);
    renderCustomFields(fieldsBox, draft.fields);

    function syncFieldValue(row) {
      var secret = $('[data-f-secret]', row).checked;
      var valueInput = $('[data-f-value]', row);
      valueInput.type = secret ? 'password' : 'text';
    }

    dialog.body.addEventListener('change', function (event) {
      var row = event.target.closest('[data-field-row]');
      if (!row) return;
      if (event.target.matches('[data-f-secret]')) syncFieldValue(row);
      if (event.target.matches('[data-f-type]')) {
        var enumWrap = $('[data-f-enum-wrap]', row);
        if (enumWrap) enumWrap.hidden = event.target.value !== 'enum';
      }
    });

    dialog.body.addEventListener('click', function (event) {
      if (event.target.matches('[data-f-remove]')) {
        var row = event.target.closest('[data-field-row]');
        if (fieldsBox.children.length <= 1) {
          UI.toast('至少保留一个字段，或者直接取消', 'warn');
          return;
        }
        row.remove();
        return;
      }
      if (event.target.matches('[data-add-field]')) {
        var fields = readRows();
        fields.push({ key: '', label: '', type: 'string', secret: false, value: '' });
        renderCustomFields(fieldsBox, fields);
      }
    });

    function readRows() {
      return $all('[data-field-row]', fieldsBox).map(function (row) {
        var type = $('[data-f-type]', row).value;
        var enumText = $('[data-f-enum]', row).value;
        return {
          key: $('[data-f-key]', row).value.trim(),
          label: $('[data-f-label]', row).value.trim(),
          type: type,
          secret: $('[data-f-secret]', row).checked,
          value: $('[data-f-value]', row).value,
          enum: type === 'enum'
            ? enumText.split(',').map(function (part) { return part.trim(); }).filter(Boolean)
            : undefined
        };
      });
    }

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
      var id = $('[data-mw-id]', dialog.body).value.trim();
      var name = $('[data-mw-name]', dialog.body).value.trim();
      var description = $('[data-mw-description]', dialog.body).value.trim();
      if (!Catalog.CUSTOM_ID_RE.test(id)) {
        UI.toast('ID 需小写字母开头，可含数字、下划线、短横线', 'error');
        return;
      }
      if (!name) {
        UI.toast('请填写名称', 'error');
        return;
      }
      var rows = readRows().filter(function (row) { return row.key || row.value; });
      if (!rows.length) {
        UI.toast('至少填写一个字段', 'error');
        return;
      }
      var keys = new Set();
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        if (!Catalog.CUSTOM_FIELD_RE.test(row.key)) {
          UI.toast('字段键 ' + (row.key || '(空)') + ' 不合法；字母开头，可含数字和下划线', 'error');
          return;
        }
        var lowered = row.key.toLowerCase();
        if (keys.has(lowered)) {
          UI.toast('字段键重复：' + row.key, 'error');
          return;
        }
        keys.add(lowered);
        if (row.type === 'enum' && (!row.enum || !row.enum.length)) {
          UI.toast('字段 ' + row.key + ' 选择枚举时必须填写可选值', 'error');
          return;
        }
      }
      var next = {
        id: id,
        name: name,
        description: description,
        fields: rows.map(function (row) {
          return {
            key: row.key,
            label: row.label || row.key,
            type: row.type,
            secret: row.secret,
            enum: row.type === 'enum' ? row.enum : undefined,
            value: row.value
          };
        })
      };
      if (editing) state.data.custom[index] = next;
      else state.data.custom.push(next);
      state.dirty = true;
      dialog.close();
      render();
    });
  }

  async function deleteCustom(index) {
    var item = state.data.custom[index];
    if (!item) return;
    var ok = await UI.confirm({
      title: '删除自定义中间件「' + (item.name || item.id) + '」？',
      message: '删除后，这份中间件在导出产物里的 MW_* 键也会消失。',
      detail: '操作需要点击右上角保存后才会写入项目。',
      confirmLabel: '删除',
      danger: true
    });
    if (!ok) return;
    state.data.custom.splice(index, 1);
    state.dirty = true;
    render();
  }

  /* ---------------- 导入导出 ---------------- */

  function buildExport(masked) {
    var data = {
      schemaVersion: 1,
      kind: 'lowcode-middleware',
      exportedAt: new Date().toISOString(),
      siteId: state.siteId,
      groups: UI.clone(state.data.groups),
      custom: UI.clone(state.data.custom),
      secretsIncluded: !masked
    };
    if (masked) {
      state.data.groups && Catalog.BUILTIN_GROUPS.forEach(function (group) {
        group.fields.forEach(function (field) {
          if (field.secret && data.groups[group.id]) data.groups[group.id].config[field.key] = '***';
        });
      });
      data.custom.forEach(function (item) {
        item.fields.forEach(function (field) {
          if (field.secret) field.value = '***';
        });
      });
    }
    return data;
  }

  function exportConfig() {
    if (!state.data) return;
    var dialog = UI.dialog({
      title: '导出中间件配置',
      description: '导出 JSON 可整份迁移到另一个项目；导入时会校验格式并提示冲突。',
      width: '560px'
    });
    dialog.body.innerHTML =
      '<div class="lc-warn-box">默认导出包含敏感值明文。这个文件等同于口令清单，请只放在安全位置，不要提交到仓库或聊天工具。</div>' +
      '<label class="lc-check" style="margin-top:14px;"><input type="checkbox" data-mask><span>导出时把敏感值打码（导入时保留原有密钥）</span></label>' +
      '<p class="lc-hint" style="margin:10px 0 0;">格式：<code>lowcode-middleware</code> v1；内置组按组名存，自定义按 ID 存。</p>';
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
      var filename = 'middleware-' + state.siteId + '-' + new Date().toISOString().slice(0, 10) + '.json';
      UI.download(filename, JSON.stringify(buildExport(masked), null, 2));
      dialog.close();
      UI.toast('已导出 ' + filename, 'success');
    });
  }

  function importPayload(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('文件内容不是对象');
    if (payload.kind !== 'lowcode-middleware') throw new Error('不是低代码中间件配置文件（kind 应为 lowcode-middleware）');
    if (Number(payload.schemaVersion) !== 1) throw new Error('不支持的 schemaVersion：' + payload.schemaVersion);
    if (!payload.groups || typeof payload.groups !== 'object') throw new Error('缺少 groups 对象');
    if (payload.custom !== undefined && !Array.isArray(payload.custom)) throw new Error('custom 必须是数组');

    var conflicts = [];
    var warnings = [];
    Catalog.BUILTIN_GROUPS.forEach(function (group) {
      var incoming = payload.groups[group.id];
      if (!incoming) return;
      if (incoming.enabled === true && state.data.groups[group.id].enabled) {
        var current = JSON.stringify(state.data.groups[group.id].config);
        var next = JSON.stringify(Object.assign(Catalog.defaultConfig(group), incoming.config || {}));
        if (current !== next) conflicts.push('内置 ' + group.label + '：当前已启用且配置不同');
      }
    });
    (payload.custom || []).forEach(function (item) {
      if (state.data.custom.some(function (current) { return current.id === item.id; })) {
        conflicts.push('自定义 ' + item.id + '：同 ID 已存在');
      }
    });
    Object.keys(payload.groups).forEach(function (id) {
      if (!Catalog.builtinGroup(id)) warnings.push('未知内置组 ' + id + '，导入时会被忽略');
    });

    var dialog = UI.dialog({
      title: '导入中间件配置',
      description: '先确认冲突，再决定覆盖还是合并。导入只改界面，点击保存后才写入项目。',
      width: '640px'
    });
    dialog.body.innerHTML =
      (conflicts.length
        ? '<div class="lc-warn-box"><strong>发现 ' + conflicts.length + ' 个冲突</strong><ul class="lc-import-list">' +
            conflicts.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul></div>'
        : '<div class="lc-config-empty" style="min-height:0;padding:12px;">没有发现同名冲突。</div>') +
      (warnings.length
        ? '<ul class="lc-import-list">' + warnings.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>'
        : '') +
      '<div class="lc-layer-editor" style="margin-top:16px;">' +
        '<label class="lc-check"><input type="radio" name="import-mode" value="merge" checked><span>合并：只覆盖导入文件里启用的组；未出现的组保持当前状态</span></label>' +
        '<label class="lc-check"><input type="radio" name="import-mode" value="replace"><span>覆盖：整份替换当前中间件配置（未启用的组会被清空）</span></label>' +
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
      var mode = ($('input[name="import-mode"]:checked', dialog.body) || {}).value || 'merge';
      applyImport(payload, mode);
      dialog.close();
      UI.toast('已导入，请检查后点击保存', 'success');
    });
  }

  function applyImport(payload, mode) {
    var previousGroups = state.data.groups;
    var previousCustom = state.data.custom;
    if (mode === 'replace') {
      state.data.groups = {};
      Catalog.BUILTIN_GROUPS.forEach(function (group) {
        var incoming = payload.groups[group.id];
        var config = Catalog.defaultConfig(group);
        if (incoming && incoming.enabled === true) {
          Object.assign(config, incoming.config || {});
          group.fields.forEach(function (field) {
            if (field.secret && UI.isMasked(config[field.key])) {
              config[field.key] = previousGroups[group.id] ? previousGroups[group.id].config[field.key] : '';
            }
          });
          state.data.groups[group.id] = { enabled: true, config: config };
        } else {
          state.data.groups[group.id] = { enabled: false, config: config };
        }
      });
      state.data.custom = (payload.custom || []).map(function (raw) {
        var item = normalizeImportedCustom(raw);
        item.fields.forEach(function (field) {
          if (!field.secret || !UI.isMasked(field.value)) return;
          var old = previousCustom.find(function (current) { return current.id === item.id; });
          var oldField = old ? old.fields.find(function (current) { return current.key === field.key; }) : null;
          field.value = oldField ? oldField.value : '';
        });
        return item;
      });
    } else {
      Catalog.BUILTIN_GROUPS.forEach(function (group) {
        var incoming = payload.groups[group.id];
        if (!incoming || incoming.enabled !== true) return;
        var config = Object.assign(Catalog.defaultConfig(group), incoming.config || {});
        group.fields.forEach(function (field) {
          if (field.secret && UI.isMasked(config[field.key])) {
            config[field.key] = state.data.groups[group.id].config[field.key] || '';
          }
        });
        state.data.groups[group.id] = { enabled: true, config: config };
      });
      (payload.custom || []).forEach(function (raw) {
        var item = normalizeImportedCustom(raw);
        var index = state.data.custom.findIndex(function (current) { return current.id === item.id; });
        item.fields.forEach(function (field) {
          if (!field.secret || !UI.isMasked(field.value)) return;
          var old = index >= 0 ? state.data.custom[index] : null;
          var oldField = old ? old.fields.find(function (current) { return current.key === field.key; }) : null;
          field.value = oldField ? oldField.value : '';
        });
        if (index >= 0) state.data.custom[index] = item;
        else state.data.custom.push(item);
      });
    }
    state.dirty = true;
    render();
  }

  function normalizeImportedCustom(raw) {
    return {
      id: String(raw.id || ''),
      name: String(raw.name || raw.id || ''),
      description: String(raw.description || ''),
      fields: (Array.isArray(raw.fields) ? raw.fields : []).map(function (field) {
        return {
          key: String(field.key || ''),
          label: String(field.label || field.key || ''),
          type: ['string', 'number', 'bool', 'enum'].includes(field.type) ? field.type : 'string',
          secret: field.secret === true,
          enum: Array.isArray(field.enum) ? field.enum.map(String) : undefined,
          value: field.value == null ? '' : String(field.value)
        };
      })
    };
  }

  /* ---------------- 保存 ---------------- */

  async function save() {
    if (!state.siteId || !state.data || state.busy) return;
    state.busy = true;
    updateDirty();
    try {
      var view = await UI.api('/api/sites/' + encodeURIComponent(state.siteId) + '/middleware', {
        method: 'PUT',
        body: {
          environment: 'dev',
          groups: state.data.groups,
          custom: state.data.custom
        }
      });
      state.data = normalizeView(view);
      state.dirty = false;
      state.revealed = {};
      render();
      UI.toast('中间件配置已保存', 'success');
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

    refs.builtinGrid.addEventListener('change', function (event) {
      if (event.target.matches('[data-group-toggle]')) {
        onToggleGroup(event.target.getAttribute('data-group-toggle'), event.target.checked);
        return;
      }
      if (event.target.matches('[data-group-field]')) {
        onFieldInput(event.target);
      }
    });
    refs.builtinGrid.addEventListener('input', function (event) {
      if (event.target.matches('[data-group-field]')) onFieldInput(event.target);
    });
    refs.builtinGrid.addEventListener('click', function (event) {
      if (event.target.matches('[data-reveal-group]')) onReveal(event.target);
    });

    refs.customList.addEventListener('click', function (event) {
      if (event.target.matches('[data-edit-custom]')) {
        openCustomEditor(Number(event.target.getAttribute('data-edit-custom')));
        return;
      }
      if (event.target.matches('[data-delete-custom]')) {
        deleteCustom(Number(event.target.getAttribute('data-delete-custom')));
      }
    });

    refs.builtinNav.addEventListener('click', function (event) {
      var button = event.target.closest('[data-jump]');
      if (!button) return;
      var target = document.getElementById(button.getAttribute('data-jump'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    refs.customNav.addEventListener('click', function (event) {
      var button = event.target.closest('[data-jump]');
      if (!button) return;
      var target = document.getElementById(button.getAttribute('data-jump'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    [refs.addCustom, refs.addCustom2].forEach(function (button) {
      button.addEventListener('click', function () { openCustomEditor(-1); });
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
    refs.builtinNav = $('[data-builtin-nav]');
    refs.customNav = $('[data-custom-nav]');
    refs.builtinGrid = $('[data-builtin-grid]');
    refs.customList = $('[data-custom-list]');
    refs.addCustom = $('[data-add-custom]');
    refs.addCustom2 = $('[data-add-custom-2]');
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
