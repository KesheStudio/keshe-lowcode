/* 项目归属门禁：数据管理 / 组件库 / 模板库都归属具体项目。
   未指定 ?site= 时不静默落到第一个站点，先要求用户选项目。 */
(function () {
  'use strict';

  var current = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function hide() {
    if (current && current.parentNode) current.parentNode.removeChild(current);
    current = null;
  }

  function show(anchor, sites, onPick, reason) {
    hide();
    if (!anchor) return;
    var list = Array.isArray(sites) ? sites : [];
    var options = list.map(function (site) {
      return '<option value="' + esc(site.siteId) + '">' +
        esc(site.name || site.siteId) + ' · ' + esc(site.type === 'backend' ? '带后端' : '纯静态') +
        '</option>';
    }).join('');
    var gate = document.createElement('div');
    gate.className = 'lc-project-gate';
    gate.innerHTML =
      '<div class="lc-project-gate-card">' +
      '<h2>先选择项目</h2>' +
      '<p>数据集合、自定义组件、模板都归属具体项目，跨项目不共享。未选择项目前不能新建或编辑。</p>' +
      (reason ? '<p class="lc-project-gate-reason">' + esc(reason) + '</p>' : '') +
      (list.length
        ? '<label class="lc-field"><span class="lc-label">当前项目</span>' +
          '<select class="lc-select" data-gate-select>' + options + '</select></label>' +
          '<div class="lc-project-gate-actions">' +
          '<a class="lc-btn" href="home.html">返回工作台</a>' +
          '<button class="lc-btn lc-btn-primary" type="button" data-gate-confirm>进入项目</button>' +
          '</div>'
        : '<div class="lc-project-gate-actions"><a class="lc-btn lc-btn-primary" href="home.html">回工作台新建项目</a></div>') +
      '</div>';
    anchor.appendChild(gate);
    current = gate;

    var confirm = gate.querySelector('[data-gate-confirm]');
    var select = gate.querySelector('[data-gate-select]');
    if (confirm && select) {
      confirm.addEventListener('click', function () {
        var value = select.value;
        if (!value) return;
        hide();
        onPick(value);
      });
    }
  }

  window.LCProjectGate = { show: show, hide: hide };
}());
