/* 页面导入 · 独立页面
 *
 * 只调用平台接口，不读写 data/；导入成功后刷新页面列表。
 * 组件库、模板库各有自己的导入页，这里只处理页面（.page.json）。 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var TOKEN = tokenMeta ? tokenMeta.getAttribute('content') : '';
  var IMPORT_RULE = { accept: '.json', maxBytes: 512 * 1024, ext: /\.json$/i };

  var refs = {
    siteSelect: document.querySelector('[data-site-select]'),
    backBuilder: document.querySelector('[data-back-builder]'),
    zone: document.querySelector('[data-drop-zone]'),
    fileInput: document.querySelector('[data-file-input]'),
    summary: document.querySelector('[data-import-summary]'),
    progress: document.querySelector('[data-import-progress]'),
    progressBar: document.querySelector('[data-import-bar]'),
    progressText: document.querySelector('[data-import-text]'),
    log: document.querySelector('[data-import-log]'),
    pageList: document.querySelector('[data-page-list]'),
    pageCount: document.querySelector('[data-page-count]')
  };

  var state = {
    sites: [],
    siteId: '',
    pages: [],
    busy: false
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
    setTimeout(function () { el.remove(); }, 3200);
  }

  function siteApi(path) {
    return '/api/sites/' + encodeURIComponent(state.siteId) + path;
  }

  function renderSiteSelect() {
    var names = state.sites.map(function (site) {
      return '<option value="' + esc(site.siteId) + '"' + (site.siteId === state.siteId ? ' selected' : '') + '>' + esc(site.name || site.siteId) + '</option>';
    }).join('');
    refs.siteSelect.innerHTML = '<option value="">请选择项目</option>' + names;
    if (state.siteId) refs.siteSelect.value = state.siteId;
  }

  function setEnabled(enabled) {
    refs.zone.classList.toggle('is-disabled', !enabled);
    refs.zone.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    refs.fileInput.disabled = !enabled;
  }

  function setSummary(text) {
    refs.summary.textContent = text || '';
  }

  function resetLog() {
    refs.log.innerHTML = '';
    refs.log.hidden = true;
  }

  function logRow(kind, title, detail) {
    refs.log.hidden = false;
    var row = document.createElement('div');
    row.className = 'lc-import-row is-' + kind;
    row.innerHTML = '<b>' + esc(title) + '</b>' + (detail ? '<em>' + esc(detail) + '</em>' : '');
    refs.log.appendChild(row);
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  function setProgress(done, total, text) {
    if (!total) {
      refs.progress.hidden = true;
      return;
    }
    refs.progress.hidden = false;
    refs.progressBar.style.width = Math.round((done / total) * 100) + '%';
    refs.progressText.textContent = text || (done + ' / ' + total);
  }

  function renderPages() {
    refs.pageCount.textContent = String(state.pages.length);
    if (!state.pages.length) {
      refs.pageList.innerHTML = '<p class="lc-import-empty">这个项目还没有页面，先导入一个 .page.json。</p>';
      return;
    }
    refs.pageList.innerHTML = state.pages.map(function (page) {
      var href = 'builder.html?site=' + encodeURIComponent(state.siteId) + '&page=' + encodeURIComponent(page.id);
      return '<div class="lc-page-row">' +
        '<div class="lc-page-row-main">' +
          '<div class="lc-page-row-title">' + esc(page.title || page.id) + '</div>' +
          '<div class="lc-page-row-path">' + esc(page.path || page.id) + '</div>' +
        '</div>' +
        '<a class="lc-btn lc-btn-sm" href="' + esc(href) + '">编辑</a>' +
      '</div>';
    }).join('');
  }

  function loadPages() {
    if (!state.siteId) {
      state.pages = [];
      refs.pageList.innerHTML = '<p class="lc-import-empty">先选择项目，再导入页面。</p>';
      refs.pageCount.textContent = '0';
      return Promise.resolve();
    }
    refs.pageList.innerHTML = '<p class="lc-import-empty">正在读取页面…</p>';
    return api(siteApi('/builder/site')).then(function (info) {
      state.pages = (info && info.pages) || [];
      renderPages();
    }).catch(function (error) {
      refs.pageList.innerHTML = '<p class="lc-import-empty">页面读取失败：' + esc(error.message) + '</p>';
    });
  }

  function selectSite(siteId) {
    state.siteId = siteId;
    resetLog();
    setProgress(0, 0);
    refs.backBuilder.href = 'builder.html' + (siteId ? '?site=' + encodeURIComponent(siteId) : '');
    if (siteId) {
      var url = new URL(window.location.href);
      url.searchParams.set('site', siteId);
      window.history.replaceState(null, '', url.toString());
    }
    setEnabled(Boolean(siteId));
    setSummary(siteId ? '还没有导入记录' : '先选择项目');
    loadPages();
  }

  function loadSites() {
    return api('/api/sites').then(function (sites) {
      state.sites = Array.isArray(sites) ? sites : [];
      var wanted = new URLSearchParams(window.location.search).get('site') || '';
      var valid = state.sites.some(function (site) { return site.siteId === wanted; });
      state.siteId = valid ? wanted : '';
      renderSiteSelect();
      selectSite(state.siteId);
    }).catch(function (error) {
      refs.pageList.innerHTML = '<p class="lc-import-empty">项目读取失败：' + esc(error.message) + '</p>';
      setSummary('项目读取失败');
      setEnabled(false);
    });
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  function handleFiles(files) {
    if (!state.siteId) {
      toast('先选择项目再导入页面', 'warn');
      return;
    }
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) {
      toast('没有可导入的文件', 'warn');
      return;
    }
    if (state.busy) {
      toast('有导入正在进行，请稍候', 'warn');
      return;
    }
    resetLog();
    var accepted = [];
    var rejected = 0;
    list.forEach(function (file) {
      if (!IMPORT_RULE.ext.test(file.name)) {
        logRow('fail', file.name, '格式不支持：需要 ' + IMPORT_RULE.accept);
        rejected += 1;
        return;
      }
      if (file.size > IMPORT_RULE.maxBytes) {
        logRow('fail', file.name, '体积超限：' + Math.ceil(file.size / 1024) + ' KB，上限 512 KB');
        rejected += 1;
        return;
      }
      accepted.push(file);
    });
    var total = accepted.length + rejected;
    if (!accepted.length) {
      setSummary('未导入：' + rejected + ' 个文件未通过校验');
      logRow('note', '完成', '成功 0 个，校验拦截 ' + rejected + ' 个。');
      toast('没有文件通过校验', 'error');
      return;
    }
    state.busy = true;
    var ok = 0;
    var failed = 0;
    setProgress(0, total, '准备导入 ' + accepted.length + ' 个页面…');
    var chain = Promise.resolve();
    accepted.forEach(function (file, index) {
      chain = chain.then(function () {
        setProgress(index + rejected, total, '正在导入 ' + (index + 1) + '/' + accepted.length + '：' + file.name);
        return readFileText(file).then(function (text) {
          return api(siteApi('/builder/import'), {
            method: 'POST',
            body: { kind: 'page', filename: file.name, content: text }
          });
        }).then(function (data) {
          ok += 1;
          logRow('ok', file.name, '已导入「' + data.name + '」' + (data.notices && data.notices.length ? '；' + data.notices.join('；') : ''));
        }).catch(function (error) {
          failed += 1;
          logRow('fail', file.name, error.message);
        });
      });
    });
    chain.then(function () {
      state.busy = false;
      setProgress(total, total, '完成');
      var missed = failed + rejected;
      setSummary('成功 ' + ok + ' 个，未导入 ' + missed + ' 个 / 共 ' + total + ' 个');
      logRow('note', '完成', '成功 ' + ok + ' 个，失败 ' + failed + ' 个' + (rejected ? '，校验拦截 ' + rejected + ' 个' : '') + '。');
      toast('导入完成：成功 ' + ok + ' 个' + (missed ? '，未导入 ' + missed + ' 个' : ''), ok ? 'ok' : 'error');
      return loadPages();
    });
  }

  function bind() {
    refs.siteSelect.addEventListener('change', function () {
      selectSite(refs.siteSelect.value || '');
    });

    refs.zone.addEventListener('click', function () {
      if (!state.siteId) {
        toast('先选择项目再导入页面', 'warn');
        return;
      }
      refs.fileInput.click();
    });
    refs.zone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        refs.zone.click();
      }
    });
    refs.fileInput.addEventListener('change', function () {
      handleFiles(refs.fileInput.files);
      refs.fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (name) {
      refs.zone.addEventListener(name, function (event) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        if (state.siteId) refs.zone.classList.add('is-dragging');
      });
    });
    refs.zone.addEventListener('dragleave', function (event) {
      if (!refs.zone.contains(event.relatedTarget)) refs.zone.classList.remove('is-dragging');
    });
    refs.zone.addEventListener('drop', function (event) {
      event.preventDefault();
      event.stopPropagation();
      refs.zone.classList.remove('is-dragging');
      if (!state.siteId) {
        toast('先选择项目再导入页面', 'warn');
        return;
      }
      handleFiles(event.dataTransfer ? event.dataTransfer.files : null);
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    bind();
    loadSites();
  });
})();
