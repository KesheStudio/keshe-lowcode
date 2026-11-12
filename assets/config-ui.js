/* 低代码平台 · 中间件 / 配置中心共用前端小工具。
 * 只负责 API、弹窗、提示、下载与转义，不掺业务状态。 */
(function () {
  'use strict';

  var tokenMeta = document.querySelector('meta[name="lc-token"]');
  var token = tokenMeta ? tokenMeta.getAttribute('content') : '';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function api(path, options) {
    var opts = options || {};
    var headers = Object.assign({ accept: 'application/json' }, opts.headers || {});
    if (token) headers['x-lc-token'] = token;
    if (opts.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
    var response;
    try {
      response = await fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body !== undefined
          ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
          : undefined
      });
    } catch (error) {
      throw new Error('无法连接本地服务，请确认应用仍在运行后重试');
    }
    var payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      var message = payload && payload.error && payload.error.message
        ? payload.error.message
        : '请求失败（HTTP ' + response.status + '）';
      var error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload && payload.data !== undefined ? payload.data : payload;
  }

  var toastTimer = null;
  function toast(message, kind) {
    var existing = document.querySelector('.lc-toast[data-lc-dynamic]');
    if (existing) existing.remove();
    var node = document.createElement('div');
    node.className = 'lc-toast' + (kind ? ' is-' + kind : '');
    node.setAttribute('data-lc-dynamic', '1');
    node.setAttribute('role', 'status');
    node.textContent = String(message);
    document.body.appendChild(node);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.remove(); }, 3200);
  }

  function openDialog(options) {
    var opts = options || {};
    var opener = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'lc-dialog-backdrop';
    backdrop.innerHTML =
      '<div class="lc-dialog" role="dialog" aria-modal="true" style="width:' + esc(opts.width || '480px') + '">' +
        '<div class="lc-dialog-head">' +
          '<div style="flex:1 1 auto;min-width:0;">' +
            '<h2 data-dialog-title>' + esc(opts.title || '') + '</h2>' +
            (opts.description ? '<p data-dialog-desc>' + esc(opts.description) + '</p>' : '') +
          '</div>' +
          '<button type="button" class="lc-btn" data-dialog-close aria-label="关闭" style="min-height:28px;padding:0 10px;">×</button>' +
        '</div>' +
        '<div class="lc-dialog-body" data-dialog-body></div>' +
        '<div class="lc-dialog-foot" data-dialog-foot></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    var body = backdrop.querySelector('[data-dialog-body]');
    var foot = backdrop.querySelector('[data-dialog-foot]');
    var closed = false;

    function close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected && !opener.disabled) opener.focus();
    }
    function focusables() {
      return Array.prototype.slice.call(backdrop.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(function (el) { return !el.disabled && el.offsetHeight > 1; });
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      var list = focusables();
      if (!list.length) return;
      var first = list[0];
      var last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !backdrop.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) close();
    });
    backdrop.querySelector('[data-dialog-close]').addEventListener('click', close);
    setTimeout(function () {
      var first = body.querySelector('input, select, textarea, button');
      if (first) first.focus();
    }, 0);

    return { root: backdrop, body: body, foot: foot, close: close };
  }

  function confirmAction(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var dialog = openDialog({
        title: opts.title || '确认操作',
        description: opts.description || '',
        width: opts.width || '480px'
      });
      dialog.body.innerHTML = '<p style="margin:0;color:var(--lc-color-ink-2);font-size:var(--lc-text-sm);line-height:1.7;">' +
        esc(opts.message || '') + '</p>' +
        (opts.detail ? '<div class="lc-warn-box" style="margin-top:12px;">' + esc(opts.detail) + '</div>' : '');
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'lc-btn';
      cancel.textContent = opts.cancelLabel || '取消';
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'lc-btn ' + (opts.danger ? 'lc-btn-danger' : 'lc-btn-primary');
      ok.textContent = opts.confirmLabel || '确认';
      dialog.foot.appendChild(cancel);
      dialog.foot.appendChild(ok);
      cancel.addEventListener('click', function () { dialog.close(); resolve(false); });
      ok.addEventListener('click', function () { dialog.close(); resolve(true); });
      dialog.root.addEventListener('click', function (event) {
        if (event.target === dialog.root) resolve(false);
      });
    });
  }

  function download(filename, text) {
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

  function readJsonFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('没有选择文件'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(JSON.parse(String(reader.result || '')));
        } catch (error) {
          reject(new Error('JSON 解析失败：' + error.message));
        }
      };
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var TYPE_LABELS = { string: '文本', number: '数字', bool: '布尔', enum: '枚举' };
  var SOURCE_LABELS = {
    default: '内置默认',
    generated: '平台生成',
    site: '站点覆盖',
    env: '环境变量',
    cli: '启动参数',
    missing: '缺失'
  };

  function typeLabel(type) {
    return TYPE_LABELS[type] || type || '文本';
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || source || '未知';
  }

  function valueText(value, type) {
    if (value === undefined || value === null || value === '') return '';
    if (type === 'bool') return value === true || value === 'true' ? 'true' : 'false';
    return String(value);
  }

  function mask(value) {
    var text = String(value == null ? '' : value);
    if (!text) return '';
    return '••••••';
  }

  function isMasked(value) {
    var text = String(value == null ? '' : value).trim();
    return text === '***' || text === '••••••' || text === '••••';
  }

  window.LCConfigUI = {
    token: token,
    api: api,
    esc: esc,
    toast: toast,
    dialog: openDialog,
    confirm: confirmAction,
    download: download,
    readJsonFile: readJsonFile,
    clone: clone,
    typeLabel: typeLabel,
    sourceLabel: sourceLabel,
    valueText: valueText,
    mask: mask,
    isMasked: isMasked
  };
})();
