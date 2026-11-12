/* 构建记录 · 站点构建历史与产物
 *
 * 只读取 /api/sites/:siteId/builds；不在浏览器里读取磁盘，也不默认选择第一个站点。
 * 入口统一带 ?site=，缺参数或站点不存在时给项目选择态。 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var TOKEN = tokenMeta ? tokenMeta.getAttribute('content') : '';

  var refs = {
    siteSelect: document.querySelector('[data-site-select]'),
    siteMeta: document.querySelector('[data-site-meta]'),
    backBuilder: document.querySelector('[data-back-builder]'),
    exportEntry: document.querySelector('[data-export]'),
    exportEmpty: document.querySelector('[data-export-empty]'),
    refresh: document.querySelector('[data-refresh]'),
    gate: document.querySelector('[data-gate]'),
    gateTitle: document.querySelector('[data-gate-title]'),
    gateText: document.querySelector('[data-gate-text]'),
    gateList: document.querySelector('[data-gate-list]'),
    body: document.querySelector('[data-body]'),
    empty: document.querySelector('[data-empty]'),
    list: document.querySelector('[data-build-list]'),
    dialog: document.querySelector('[data-dialog]'),
    dialogTitle: document.querySelector('[data-dialog-title]'),
    dialogBody: document.querySelector('[data-dialog-body]'),
    dialogDownload: document.querySelector('[data-dialog-download]'),
    dialogClose: document.querySelector('[data-dialog-close]'),
    statusText: document.querySelector('[data-status-text]'),
    statusRev: document.querySelector('[data-status-rev]')
  };

  var state = {
    sites: [],
    siteId: '',
    builds: [],
    highlighted: ''
  };

  var EMPTY_HTML = refs.empty ? refs.empty.innerHTML : '';

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

  function fmtTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    function pad(num) { return num < 10 ? '0' + num : String(num); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function targetLabel(target) {
    return target === 'tauri-desktop' ? 'Tauri 桌面' : 'Web 静态';
  }

  function statusLabel(status) {
    if (status === 'success') return '成功';
    if (status === 'failed') return '失败';
    return status || '未知';
  }

  function statusBadge(status) {
    var cls = status === 'success' ? 'lc-badge-success' : (status === 'failed' ? 'lc-badge-danger' : '');
    return '<span class="lc-badge ' + cls + '">' + esc(statusLabel(status)) + '</span>';
  }

  function typeLabel(site) {
    if (!site || site.type !== 'backend') return '纯静态';
    var lang = { rust: 'Rust', node: 'Node', go: 'Go' }[site.backendLanguage] || 'Rust';
    return '带后端 · ' + lang;
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

  function api(path) {
    return fetch(path, {
      method: 'GET',
      headers: { 'x-lc-token': TOKEN },
      cache: 'no-store'
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

  function siteBuildsUrl() {
    return '/api/sites/' + encodeURIComponent(state.siteId) + '/builds';
  }

  function artifactUrl(buildId) {
    return '/api/sites/' + encodeURIComponent(state.siteId) + '/builds/' +
      encodeURIComponent(buildId) + '/artifact.zip?token=' + encodeURIComponent(TOKEN);
  }

  function renderSiteSelect() {
    if (!state.sites.length) {
      refs.siteSelect.innerHTML = '<option value="">还没有项目</option>';
      return;
    }
    var placeholder = state.siteId ? '' : '<option value="">选择项目…</option>';
    refs.siteSelect.innerHTML = placeholder + state.sites.map(function (site) {
      return '<option value="' + esc(site.siteId) + '"' + (site.siteId === state.siteId ? ' selected' : '') + '>' +
        esc(site.name || site.siteId) + '</option>';
    }).join('');
  }

  function renderGate(title, text) {
    state.siteId = '';
    renderSiteSelect();
    refs.gate.hidden = false;
    refs.body.hidden = true;
    refs.dialog.hidden = true;
    refs.gateTitle.textContent = title;
    refs.gateText.textContent = text;
    refs.siteMeta.textContent = title;
    refs.backBuilder.href = 'home.html';
    refs.exportEntry.href = 'export.html';
    refs.exportEmpty = document.querySelector('[data-export-empty]');
    if (refs.exportEmpty) refs.exportEmpty.href = 'export.html';
    if (!state.sites.length) {
      refs.gateList.innerHTML = '<p class="lc-hint">还没有项目。先到 <a href="home.html">工作台</a> 新建一个项目，再回来查看构建记录。</p>';
      return;
    }
    refs.gateList.innerHTML = state.sites.map(function (site) {
      return '<a class="lc-builds-project" href="builds.html?site=' + encodeURIComponent(site.siteId) + '">' +
        '<strong>' + esc(site.name || site.siteId) + '</strong>' +
        '<small>' + esc(typeLabel(site)) + ' · ' + (Number(site.pageCount) || 0) + ' 个页面</small>' +
        '<small>' + esc(site.siteId) + '</small>' +
      '</a>';
    }).join('');
    setStatus(title, 'error');
  }

  function renderBuilds() {
    refs.body.hidden = false;
    refs.gate.hidden = true;
    refs.siteMeta.textContent = state.builds.length + ' 次构建 · 按开始时间倒序';
    if (!state.builds.length) {
      refs.empty.hidden = false;
      refs.empty.innerHTML = EMPTY_HTML;
      refs.exportEmpty = refs.empty.querySelector('[data-export-empty]');
      if (refs.exportEmpty) {
        refs.exportEmpty.href = 'export.html' + (state.siteId ? '?site=' + encodeURIComponent(state.siteId) : '');
      }
      refs.list.innerHTML = '';
      setStatus('这个项目还没有构建记录');
      return;
    }
    refs.empty.hidden = true;
    refs.list.innerHTML = state.builds.map(function (build) {
      var warnings = Number(build.warningCount) || 0;
      var canDownload = (Number(build.artifactBytes) || 0) > 0;
      return '<tr' + (build.buildId === state.highlighted ? ' style="background: var(--lc-color-accent-soft);"' : '') + '>' +
        '<td><span class="lc-builds-id">' + esc(build.buildId) + '</span>' +
          '<span class="lc-builds-version">' + (build.version ? '版本 ' + esc(build.version) : '无版本号') + '</span></td>' +
        '<td>' + esc(fmtTime(build.startedAt)) + '</td>' +
        '<td class="is-num">' + (Number(build.pageCount) || 0) + '</td>' +
        '<td class="is-num">' + esc(fmtBytes(build.artifactBytes)) + '</td>' +
        '<td>' + statusBadge(build.status) + '</td>' +
        '<td class="is-num">' + (warnings
          ? '<span class="lc-badge lc-badge-warn">' + warnings + '</span>'
          : '0') + '</td>' +
        '<td><div class="lc-builds-actions">' +
          '<button class="lc-btn lc-btn-sm" type="button" data-build-open="' + esc(build.buildId) + '">详情</button>' +
          (canDownload
            ? '<a class="lc-btn lc-btn-sm" data-build-download href="' + esc(artifactUrl(build.buildId)) + '">下载</a>'
            : '<span class="lc-badge">无产物</span>') +
        '</div></td>' +
      '</tr>';
    }).join('');
    setStatus('已加载 ' + state.builds.length + ' 条构建记录', 'ok');
  }

  function loadSite(siteId) {
    state.siteId = siteId;
    renderSiteSelect();
    refs.backBuilder.href = 'builder.html?site=' + encodeURIComponent(siteId);
    refs.exportEntry.href = 'export.html?site=' + encodeURIComponent(siteId);
    refs.exportEmpty = document.querySelector('[data-export-empty]');
    if (refs.exportEmpty) refs.exportEmpty.href = 'export.html?site=' + encodeURIComponent(siteId);
    refs.siteMeta.textContent = '读取构建记录…';
    setStatus('读取构建记录…');
    return api(siteBuildsUrl()).then(function (data) {
      state.builds = Array.isArray(data && data.builds) ? data.builds : [];
      if (state.highlighted) {
        var target = state.builds.filter(function (item) { return item.buildId === state.highlighted; })[0];
        if (target) openDetail(state.highlighted, { silent: true });
      }
      renderBuilds();
    }).catch(function (error) {
      state.builds = [];
      refs.body.hidden = false;
      refs.gate.hidden = true;
      refs.empty.hidden = false;
      refs.empty.innerHTML = '构建记录读取失败：' + esc(error.message) + '。<a href="#" data-retry>重试</a>';
      refs.list.innerHTML = '';
      refs.siteMeta.textContent = '读取失败';
      setStatus('构建记录读取失败：' + error.message, 'error');
      toast('构建记录读取失败：' + error.message, 'error');
    });
  }

  function detailRow(label, value) {
    return '<div class="lc-builds-metric"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  function renderDetail(record) {
    var manifest = record.manifest || {};
    var artifact = record.artifact || {};
    var scope = record.scope || {};
    var pageCount = Array.isArray(scope.pageIds) ? scope.pageIds.length : 0;
    var warnings = Array.isArray(manifest.warnings) ? manifest.warnings : [];
    var checks = Array.isArray(manifest.checks) ? manifest.checks : [];
    var totalBytes = Number(artifact.bytes) || (manifest.size && Number(manifest.size.total)) || 0;
    var html = '<div class="lc-builds-metrics">' +
      detailRow('状态', statusLabel(record.status)) +
      detailRow('目标', targetLabel(record.target)) +
      detailRow('版本', record.version || '无版本号') +
      detailRow('页面数', String(pageCount)) +
      detailRow('压缩包', totalBytes ? fmtBytes(totalBytes) : '无产物') +
      detailRow('文件数', String(Number(manifest.fileCount) || 0)) +
      detailRow('开始时间', fmtTime(record.startedAt)) +
      detailRow('结束时间', fmtTime(record.endedAt)) +
      detailRow('范围', scope.mode === 'selected' ? '选定页面' : '全部页面') +
      detailRow('sha256', artifact.sha256 ? artifact.sha256.slice(0, 16) + '…' : '—') +
    '</div>';

    if (warnings.length) {
      html += '<div><h3 class="lc-builds-section-title">警告（' + warnings.length + '）</h3><div class="lc-builds-issues">' +
        warnings.map(function (item) {
          return '<div class="lc-builds-issue is-warn"><b>' + esc(item.code || '警告') + '</b><em>' + esc(item.message || '') + '</em></div>';
        }).join('') + '</div></div>';
    }

    if (checks.length) {
      html += '<div><h3 class="lc-builds-section-title">校验（' + checks.length + '）</h3><div class="lc-builds-checks">' +
        checks.map(function (item) {
          var kind = item.status === 'pass' ? 'is-pass' : (item.status === 'fail' ? 'is-fail' : 'is-skip');
          return '<div class="lc-builds-check ' + kind + '"><b>' + esc(item.status || 'skip') + '</b>' +
            '<span><code>' + esc(item.id || '') + '</code> ' + esc(item.message || '') + '</span></div>';
        }).join('') + '</div></div>';
    }

    refs.dialogBody.innerHTML = html;
    refs.dialogTitle.textContent = '构建详情 · ' + record.buildId;
    var downloadable = (Number(record.artifact && record.artifact.bytes) || 0) > 0;
    refs.dialogDownload.hidden = !downloadable;
    if (downloadable) refs.dialogDownload.href = artifactUrl(record.buildId);
  }

  function openDetail(buildId, options) {
    var opts = options || {};
    if (!state.siteId || !buildId) return;
    if (!opts.silent) {
      refs.dialogBody.innerHTML = '<p class="lc-hint">正在读取构建记录…</p>';
      refs.dialog.hidden = false;
      refs.dialogDownload.hidden = true;
    }
    api('/api/sites/' + encodeURIComponent(state.siteId) + '/builds/' + encodeURIComponent(buildId)).then(function (data) {
      var record = data && data.record;
      if (!record) throw new Error('构建记录不存在');
      refs.dialog.hidden = false;
      renderDetail(record);
    }).catch(function (error) {
      refs.dialog.hidden = false;
      refs.dialogTitle.textContent = '构建详情';
      refs.dialogBody.innerHTML = '<p class="lc-builds-issue is-fail">读取失败：' + esc(error.message) + '</p>';
      refs.dialogDownload.hidden = true;
      toast('构建详情读取失败：' + error.message, 'error');
    });
  }

  function bind() {
    refs.siteSelect.addEventListener('change', function () {
      var next = refs.siteSelect.value;
      if (!next) {
        renderGate('选择要查看构建记录的项目', '从下面的项目列表进入，或在右上角「项目」里选一个项目。');
        return;
      }
      window.location.href = 'builds.html?site=' + encodeURIComponent(next);
    });

    refs.refresh.addEventListener('click', function () {
      if (!state.siteId) {
        loadSites();
        return;
      }
      loadSite(state.siteId);
    });

    refs.list.addEventListener('click', function (event) {
      var open = event.target.closest ? event.target.closest('[data-build-open]') : null;
      if (open) {
        openDetail(open.getAttribute('data-build-open'));
      }
    });

    refs.dialogClose.addEventListener('click', function () { refs.dialog.hidden = true; });
    refs.dialog.addEventListener('click', function (event) {
      if (event.target === refs.dialog) refs.dialog.hidden = true;
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !refs.dialog.hidden) refs.dialog.hidden = true;
    });
    refs.empty.addEventListener('click', function (event) {
      var retry = event.target.closest ? event.target.closest('[data-retry]') : null;
      if (!retry) return;
      event.preventDefault();
      loadSite(state.siteId);
    });
  }

  function loadSites() {
    return api('/api/sites').then(function (sites) {
      state.sites = Array.isArray(sites) ? sites : [];
      renderSiteSelect();
      if (!state.sites.length) {
        renderGate('还没有项目', '先到工作台新建一个项目并发起导出，构建记录会出现在这里。');
        return;
      }
      var params = new URLSearchParams(window.location.search);
      var requested = params.get('site') || '';
      state.highlighted = params.get('build') || '';
      if (!requested) {
        renderGate('选择要查看构建记录的项目', 'URL 缺少 site 参数；从下面的项目列表进入，或在右上角「站点」里选一个项目。');
        return;
      }
      if (!state.sites.some(function (site) { return site.siteId === requested; })) {
        renderGate('站点不存在', '请求的站点「' + requested + '」不存在，不会自动切换到第一个项目。请从下面的项目列表重新进入。');
        return;
      }
      return loadSite(requested);
    }).catch(function (error) {
      refs.siteMeta.textContent = '项目列表读取失败';
      refs.gate.hidden = false;
      refs.body.hidden = true;
      refs.gateTitle.textContent = '无法读取项目';
      refs.gateText.textContent = error.message;
      refs.gateList.innerHTML = '';
      setStatus('项目列表读取失败：' + error.message, 'error');
      toast('项目列表读取失败：' + error.message, 'error');
    });
  }

  bind();
  loadSites();
}());
