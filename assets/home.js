(function () {
  'use strict';

  var TOKEN = (document.querySelector('meta[name="lc-token"]') || {}).content || '';
  var refs = {
    list: document.querySelector('[data-project-list]'),
    empty: document.querySelector('[data-empty]'),
    newProject: document.querySelector('[data-new-project]'),
    refresh: document.querySelector('[data-refresh]'),
    dialog: document.querySelector('[data-new-dialog]'),
    form: document.querySelector('[data-new-form]'),
    formError: document.querySelector('[data-form-error]'),
    submit: document.querySelector('[data-submit]'),
    backendField: document.querySelector('[data-backend-field]'),
    backendSelect: document.querySelector('select[name="backendLanguage"]'),
    starterSelect: document.querySelector('[data-starter-select]'),
    trashList: document.querySelector('[data-trash-list]'),
    trashCount: document.querySelector('[data-trash-count]'),
    restoreDialog: document.querySelector('[data-restore-dialog]'),
    restoreMessage: document.querySelector('[data-restore-message]'),
    restoreRename: document.querySelector('[data-restore-rename]'),
    restoreOverwrite: document.querySelector('[data-restore-overwrite]'),
    backupDialog: document.querySelector('[data-backup-dialog]'),
    backupSiteName: document.querySelector('[data-backup-site-name]'),
    backupList: document.querySelector('[data-backup-list]'),
    backupStatus: document.querySelector('[data-backup-status]'),
    createBackup: document.querySelector('[data-create-backup]'),
    backupConfirm: document.querySelector('[data-backup-confirm]'),
    backupConfirmMessage: document.querySelector('[data-backup-confirm-message]'),
    confirmBackupRestore: document.querySelector('[data-confirm-backup-restore]')
  };
  var state = { sites: [], starters: [], trash: [], busy: false, pendingTrash: null, backupSite: null, pendingBackup: '' };

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
          error.status = response.status;
          error.detail = payload.error && payload.error.detail;
          throw error;
        }
        return payload.data;
      });
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&#39;';
    });
  }

  function formatTime(iso) {
    if (!iso) return '未记录';
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '未记录';
    var now = new Date();
    var diff = now.getTime() - date.getTime();
    if (diff >= 0 && diff < 60 * 1000) return '刚刚';
    if (diff >= 0 && diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function typeLabel(site) {
    if (site.type !== 'backend') return '纯静态';
    var lang = { rust: 'Rust', node: 'Node', go: 'Go' }[site.backendLanguage] || 'Rust';
    return '带后端 · ' + lang;
  }

  function render() {
    if (!state.sites.length) {
      refs.list.innerHTML = '<p class="lc-home-empty">还没有项目。点右上角「新建项目」开始；也可以先去<a href="templates.html">模板库</a>看看。</p>';
      return;
    }
    refs.list.innerHTML = state.sites.map(function (site) {
      var builderHref = 'builder.html?site=' + encodeURIComponent(site.siteId);
      var exportHref = 'export.html?site=' + encodeURIComponent(site.siteId);
      var repair = site.status === 'needs-repair';
      return '<div class="lc-home-card">' +
        '<span class="lc-home-card-head">' +
          '<a class="lc-home-card-title" href="' + escapeHtml(builderHref) + '">' + escapeHtml(site.name || site.siteId) + '</a>' +
          '<span class="lc-home-badge ' + (site.type === 'backend' ? 'is-backend' : '') + '">' + escapeHtml(typeLabel(site)) + '</span>' +
        '</span>' +
        '<span class="lc-home-card-meta">' +
          '<span>最近修改 ' + escapeHtml(formatTime(site.lastModified || site.updatedAt)) + '</span>' +
          '<span>' + (Number(site.pageCount) || 0) + ' 个页面</span>' +
          (repair ? '<span class="lc-home-badge is-warn">需要修复</span>' : '') +
        '</span>' +
        '<span class="lc-home-card-foot">' +
          '<a href="' + escapeHtml(builderHref) + '">进入编辑器</a>' +
          '<a href="' + escapeHtml(exportHref) + '">导出</a>' +
          '<button class="lc-home-link-btn" type="button" data-backup-site="' + escapeHtml(site.siteId) + '">备份</button>' +
          '<button class="lc-home-link-btn is-danger" type="button" data-delete-site="' + escapeHtml(site.siteId) + '">删除</button>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  function formatSize(bytes) {
    var size = Number(bytes) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function reasonLabel(reason) {
    var map = {
      manual: '手动备份',
      'pre-import': '覆盖导入前',
      'pre-restore': '恢复前安全备份',
      'collection-delete': '删除集合前'
    };
    return map[reason] || reason || '备份';
  }

  function renderTrash() {
    if (!refs.trashList) return;
    if (refs.trashCount) refs.trashCount.textContent = state.trash.length ? state.trash.length + ' 项' : '';
    if (!state.trash.length) {
      refs.trashList.innerHTML = '<p class="lc-home-empty">回收站为空。</p>';
      return;
    }
    refs.trashList.innerHTML = state.trash.map(function (item) {
      var conflict = item.conflict
        ? '<span class="lc-home-badge is-warn">同名项目已存在</span>'
        : '';
      return '<div class="lc-home-trash-item">' +
        '<div class="lc-home-trash-main">' +
          '<span class="lc-home-trash-title">' + escapeHtml(item.name || item.siteId) + '</span>' +
          '<span class="lc-home-trash-meta">' + escapeHtml(item.siteId) + ' · 删除于 ' + escapeHtml(formatTime(item.deletedAt)) + ' · ' + (Number(item.pageCount) || 0) + ' 个页面</span>' +
        '</div>' +
        conflict +
        '<button class="lc-btn lc-btn-sm" type="button" data-restore-trash="' + escapeHtml(item.trashId) + '">恢复</button>' +
      '</div>';
    }).join('');
  }

  function loadTrash() {
    api('/api/sites/trash').then(function (data) {
      state.trash = (data && data.items) || [];
      renderTrash();
    }).catch(function (error) {
      refs.trashList.innerHTML = '<p class="lc-home-empty">回收站加载失败：' + escapeHtml(error.message) + '</p>';
    });
  }

  function openRestoreDialog(item) {
    state.pendingTrash = item;
    refs.restoreMessage.innerHTML = '「' + escapeHtml(item.name || item.siteId) + '」的项目 ID 是 ' +
      escapeHtml(item.siteId) + '，同名项目「' + escapeHtml((item.conflict && item.conflict.name) || item.siteId) +
      '」已存在。请选择改名恢复，或明确覆盖同名项目。';
    refs.restoreDialog.hidden = false;
    document.body.classList.add('lc-modal-open');
  }

  function closeRestoreDialog() {
    state.pendingTrash = null;
    refs.restoreDialog.hidden = true;
    document.body.classList.remove('lc-modal-open');
  }

  function performTrashRestore(mode) {
    var item = state.pendingTrash;
    if (!item || state.busy) return;
    if (mode === 'overwrite' && !window.confirm('确认覆盖同名项目「' + item.siteId + '」？\n现有项目会先整体移入回收站，仍可再次恢复。')) return;
    state.busy = true;
    var buttons = refs.restoreDialog.querySelectorAll('button');
    buttons.forEach(function (button) { button.disabled = true; });
    api('/api/sites/trash/' + encodeURIComponent(item.trashId) + '/restore', {
      method: 'POST',
      body: mode ? { mode: mode } : {}
    }).then(function (data) {
      state.busy = false;
      buttons.forEach(function (button) { button.disabled = false; });
      closeRestoreDialog();
      window.alert('已恢复「' + data.name + '」为项目 ' + data.siteId + (data.replacedTrashId ? '；原同名项目已移入回收站。' : '。'));
      load();
    }, function (error) {
      state.busy = false;
      buttons.forEach(function (button) { button.disabled = false; });
      if (error.code === 'LC_E_SITE_EXISTS') {
        item.conflict = (error.detail && error.detail.conflict) || error.detail || item.conflict;
        openRestoreDialog(item);
        return;
      }
      window.alert('恢复失败：' + error.message);
    });
  }

  function renderBackupList(items) {
    if (!items.length) {
      refs.backupList.innerHTML = '<p class="lc-home-empty">还没有备份。点「立即备份」生成一份。</p>';
      return;
    }
    refs.backupList.innerHTML = items.map(function (item) {
      return '<div class="lc-home-backup-item">' +
        '<div class="lc-home-backup-main">' +
          '<span class="lc-home-backup-title">' + escapeHtml(formatTime(item.createdAt)) + ' · ' + escapeHtml(reasonLabel(item.reason)) + '</span>' +
          '<span class="lc-home-backup-meta">' + (Number(item.fileCount) || 0) + ' 个文件 · ' + formatSize(item.bytes) + (item.invalid ? ' · 清单损坏' : '') + '</span>' +
        '</div>' +
        '<button class="lc-btn lc-btn-sm" type="button" data-restore-backup="' + escapeHtml(item.name) + '"' + (item.invalid ? ' disabled' : '') + '>恢复</button>' +
      '</div>';
    }).join('');
  }

  function loadBackups() {
    if (!state.backupSite) return;
    refs.backupStatus.textContent = '正在加载备份…';
    api('/api/sites/' + encodeURIComponent(state.backupSite.siteId) + '/backups').then(function (data) {
      refs.backupStatus.textContent = '';
      renderBackupList((data && data.items) || []);
    }).catch(function (error) {
      refs.backupStatus.textContent = '备份加载失败：' + error.message;
      refs.backupList.innerHTML = '';
    });
  }

  function openBackupDialog(siteId, name) {
    state.backupSite = { siteId: siteId, name: name };
    state.pendingBackup = '';
    refs.backupSiteName.textContent = name || siteId;
    refs.backupConfirm.hidden = true;
    refs.backupDialog.hidden = false;
    document.body.classList.add('lc-modal-open');
    loadBackups();
  }

  function closeBackupDialog() {
    state.backupSite = null;
    state.pendingBackup = '';
    refs.backupDialog.hidden = true;
    refs.backupConfirm.hidden = true;
    document.body.classList.remove('lc-modal-open');
  }

  function beginBackupRestore(name) {
    if (!state.backupSite) return;
    refs.backupStatus.textContent = '正在检查备份…';
    api('/api/sites/' + encodeURIComponent(state.backupSite.siteId) + '/backups/' + encodeURIComponent(name)).then(function (detail) {
      if (!detail.valid) {
        refs.backupStatus.textContent = '备份不完整或已损坏，不能恢复：' +
          (detail.problems || []).map(function (item) { return item.path + '（' + item.reason + '）'; }).join('、');
        return;
      }
      state.pendingBackup = name;
      var scope = detail.scope || {};
      refs.backupStatus.textContent = '';
      refs.backupConfirmMessage.textContent = '将恢复 ' + (scope.total || 0) + ' 个文件：覆盖 ' +
        (scope.overwrite || 0) + ' 个现有文件（其中 ' + (scope.changed || 0) + ' 个内容不同），新增 ' +
        (scope.create || 0) + ' 个。备份之外的文件不会被删除；恢复前会自动备份当前状态，失败会自动退回。';
      refs.backupConfirm.hidden = false;
    }).catch(function (error) {
      refs.backupStatus.textContent = '读取备份失败：' + error.message;
    });
  }

  function runBackupRestore() {
    if (!state.backupSite || !state.pendingBackup) return;
    var siteId = state.backupSite.siteId;
    var name = state.pendingBackup;
    refs.confirmBackupRestore.disabled = true;
    refs.backupStatus.textContent = '正在恢复，请勿关闭页面…';
    api('/api/sites/' + encodeURIComponent(siteId) + '/backups/' + encodeURIComponent(name) + '/restore', {
      method: 'POST',
      body: {}
    }).then(function (data) {
      refs.confirmBackupRestore.disabled = false;
      refs.backupConfirm.hidden = true;
      state.pendingBackup = '';
      refs.backupStatus.textContent = '已恢复 ' + data.restored + ' 个文件；恢复前安全备份：' + data.safetyBackup;
      window.alert('备份恢复完成：覆盖 ' + data.overwritten + ' 个文件，新增 ' + data.created + ' 个。\n恢复前状态已保存到 ' + data.safetyBackup);
      loadBackups();
      load();
    }).catch(function (error) {
      refs.confirmBackupRestore.disabled = false;
      refs.backupStatus.textContent = error.message;
      if (error.detail && error.detail.safetyBackup) {
        window.alert(error.message + '\n安全备份：' + error.detail.safetyBackup);
      } else {
        window.alert(error.message);
      }
      loadBackups();
    });
  }

  function deleteSite(siteId, name) {
    if (!window.confirm('将「' + (name || siteId) + '」移入回收站？\n之后可在首页回收站恢复。')) return;
    api('/api/sites/' + encodeURIComponent(siteId), { method: 'DELETE' }).then(function () {
      load();
      window.alert('已移入回收站，可在首页恢复。');
    }).catch(function (error) {
      window.alert('删除失败：' + error.message);
    });
  }

  function load() {
    refs.empty && (refs.empty.textContent = '正在加载项目…');
    api('/api/sites').then(function (sites) {
      state.sites = Array.isArray(sites) ? sites : [];
      render();
      syncSiteNav();
      loadTrash();
    }).catch(function (error) {
      refs.list.innerHTML = '<p class="lc-home-empty">项目加载失败：' + escapeHtml(error.message) + '</p>';
      loadTrash();
    });
  }

  function renderStarterOptions() {
    if (!refs.starterSelect) return;
    refs.starterSelect.innerHTML = '<option value="">空白项目</option>' + state.starters.map(function (item) {
      return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name + ' · ' + item.pageCount + ' 页') + '</option>';
    }).join('');
  }

  function loadStarters() {
    if (state.starters.length) {
      renderStarterOptions();
      return;
    }
    api('/api/templates/starters').then(function (data) {
      state.starters = (data && data.items) || [];
      renderStarterOptions();
    }).catch(function () {
      /* 起步模板加载失败不影响空白站点创建。 */
    });
  }

  /* 纯静态时不显示后端语言，并清空旧选择；切回带后端时回到默认 Rust。 */
  function toggleBackendField(wasSwitched) {
    var type = refs.form.querySelector('input[name="type"]:checked');
    var isBackend = !!(type && type.value === 'backend');
    refs.backendField.hidden = !isBackend;
    if (refs.backendSelect) {
      if (!isBackend) refs.backendSelect.value = '';
      else if (wasSwitched) refs.backendSelect.value = 'rust';
    }
  }

  function showError(message) {
    refs.formError.textContent = message || '';
    refs.formError.hidden = !message;
  }

  var dialogOpener = null;

  function dialogFocusable() {
    return Array.prototype.slice.call(refs.dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return !el.disabled && el.offsetHeight > 1; });
  }

  function onDialogKeydown(event) {
    if (event.key !== 'Tab') return;
    var list = dialogFocusable();
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !refs.dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDialog() {
    dialogOpener = document.activeElement;
    refs.dialog.hidden = false;
    document.body.classList.add('lc-modal-open');
    document.addEventListener('keydown', onDialogKeydown, true);
    showError('');
    refs.form.reset();
    var first = refs.form.querySelector('input[name="type"][value="static"]');
    if (first) first.checked = true;
    toggleBackendField(true);
    loadStarters();
    var name = refs.form.querySelector('input[name="name"]');
    if (name) setTimeout(function () { name.focus(); }, 40);
  }

  function closeDialog() {
    refs.dialog.hidden = true;
    document.body.classList.remove('lc-modal-open');
    document.removeEventListener('keydown', onDialogKeydown, true);
    showError('');
    if (dialogOpener && dialogOpener.isConnected) dialogOpener.focus();
    dialogOpener = null;
  }

  function submit(event) {
    event.preventDefault();
    if (state.busy) return;
    var data = new FormData(refs.form);
    var name = String(data.get('name') || '').trim();
    if (!name) {
      showError('项目名称不能为空');
      return;
    }
    var type = data.get('type') === 'backend' ? 'backend' : 'static';
    state.busy = true;
    refs.submit.disabled = true;
    refs.submit.textContent = '创建中…';
    var starter = String(data.get('starter') || '');
    var body = { name: name, type: type };
    if (type === 'backend') body.backendLanguage = String(data.get('backendLanguage') || 'rust');
    api('/api/sites', { method: 'POST', body: body })
      .then(function (created) {
        var apply = starter
          ? api('/api/sites/' + encodeURIComponent(created.siteId) + '/templates/starters/' +
              encodeURIComponent(starter) + '/apply', { method: 'POST' }).catch(function (error) {
            window.alert('起步模板套用失败：' + error.message + '。已创建空白项目，可在模板库重试。');
          })
          : Promise.resolve();
        return apply.then(function () { return created; });
      })
      .then(function (created) {
        location.href = 'builder.html?site=' + encodeURIComponent(created.siteId);
      })
      .catch(function (error) {
        state.busy = false;
        refs.submit.disabled = false;
        refs.submit.textContent = '创建并进入编辑器';
        showError(error.message);
      });
  }

  refs.newProject.addEventListener('click', openDialog);
  refs.refresh.addEventListener('click', load);
  refs.form.addEventListener('submit', submit);
  refs.form.querySelectorAll('input[name="type"]').forEach(function (input) {
    input.addEventListener('change', function () { toggleBackendField(true); });
  });
  refs.dialog.querySelectorAll('[data-close-dialog]').forEach(function (button) {
    button.addEventListener('click', closeDialog);
  });
  refs.dialog.addEventListener('click', function (event) {
    if (event.target === refs.dialog) closeDialog();
  });
  refs.list.addEventListener('click', function (event) {
    var backup = event.target.closest && event.target.closest('[data-backup-site]');
    if (backup) {
      var site = state.sites.find(function (item) { return item.siteId === backup.getAttribute('data-backup-site'); });
      openBackupDialog(backup.getAttribute('data-backup-site'), site && site.name);
      return;
    }
    var remove = event.target.closest && event.target.closest('[data-delete-site]');
    if (remove) {
      var target = state.sites.find(function (item) { return item.siteId === remove.getAttribute('data-delete-site'); });
      deleteSite(remove.getAttribute('data-delete-site'), target && target.name);
    }
  });

  refs.trashList.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-restore-trash]');
    if (!button) return;
    var item = state.trash.find(function (entry) { return entry.trashId === button.getAttribute('data-restore-trash'); });
    if (!item) return;
    if (item.conflict) {
      openRestoreDialog(item);
      return;
    }
    if (!window.confirm('恢复项目「' + (item.name || item.siteId) + '」到原位置？')) return;
    state.pendingTrash = item;
    performTrashRestore('');
  });

  refs.restoreRename.addEventListener('click', function () { performTrashRestore('rename'); });
  refs.restoreOverwrite.addEventListener('click', function () { performTrashRestore('overwrite'); });
  refs.restoreDialog.querySelectorAll('[data-close-restore]').forEach(function (button) {
    button.addEventListener('click', closeRestoreDialog);
  });
  refs.restoreDialog.addEventListener('click', function (event) {
    if (event.target === refs.restoreDialog) closeRestoreDialog();
  });

  refs.createBackup.addEventListener('click', function () {
    if (!state.backupSite) return;
    refs.createBackup.disabled = true;
    refs.backupStatus.textContent = '正在生成备份…';
    api('/api/sites/' + encodeURIComponent(state.backupSite.siteId) + '/backup', { method: 'POST', body: { reason: 'manual' } })
      .then(function () {
        refs.createBackup.disabled = false;
        refs.backupStatus.textContent = '备份已生成';
        loadBackups();
      })
      .catch(function (error) {
        refs.createBackup.disabled = false;
        refs.backupStatus.textContent = '备份失败：' + error.message;
      });
  });
  refs.backupList.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-restore-backup]');
    if (button) beginBackupRestore(button.getAttribute('data-restore-backup'));
  });
  refs.confirmBackupRestore.addEventListener('click', runBackupRestore);
  refs.backupDialog.querySelector('[data-cancel-backup-restore]').addEventListener('click', function () {
    state.pendingBackup = '';
    refs.backupConfirm.hidden = true;
  });
  refs.backupDialog.querySelectorAll('[data-close-backup]').forEach(function (button) {
    button.addEventListener('click', closeBackupDialog);
  });
  refs.backupDialog.addEventListener('click', function (event) {
    if (event.target === refs.backupDialog) closeBackupDialog();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!refs.backupDialog.hidden) closeBackupDialog();
    else if (!refs.restoreDialog.hidden) closeRestoreDialog();
    else if (!refs.dialog.hidden) closeDialog();
  });

  /* 带着最近一次打开的项目进入数据/组件/模板等页面；没有则留给目标页提示选择项目。
     中间件、配置中心、后端积木是后端专属入口，最近项目不是后端时从首页一并收起。 */
  function syncSiteNav() {
    var lastSite = '';
    try { lastSite = localStorage.getItem('lc.lastSite') || ''; } catch (error) { lastSite = ''; }
    var site = state.sites.find(function (item) { return item.siteId === lastSite; });
    var validLast = site ? site.siteId : '';
    var backendSite = Boolean(site && site.type === 'backend');
    document.querySelectorAll('[data-site-nav]').forEach(function (link) {
      var base = link.getAttribute('href').split('?')[0];
      if (validLast) link.href = base + '?site=' + encodeURIComponent(validLast);
      /* 中间件、配置中心、后端积木都是后端专属入口；没有最近的后端项目时不显示。 */
      if (base === 'middleware.html' || base === 'config-center.html' || base === 'backend-flow.html') {
        link.hidden = !backendSite;
      }
    });
  }

  load();
})();
