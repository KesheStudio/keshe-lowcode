/* 画布桥脚本：由预览文档以同源地址 /assets/canvas-bridge.js 加载。
 *
 * 预览文档不再使用 srcdoc（不透明源），而是跑在平台同源的真实地址上；
 * 点选、拖拽、自由定位、快捷键与滚动仍通过 postMessage 上报给 builder 父页。
 * 父子两侧都校验 origin 与 source，不信任任意来源。
 */
(function () {
  'use strict';

  var dragging = null;
  var pointerDrag = null;
  var autoScrollState = null;
  var hoverPoint = { x: 0, y: 0 };

  function post(message) {
    message.__lc = 'canvas';
    try {
      /* 预览文档与 builder 同源，目标 origin 用当前页面 origin，不再用 *。 */
      parent.postMessage(message, window.location.origin);
    } catch (error) { /* 父页不在时忽略 */ }
  }

  function isEditable(el) {
    if (!el) return false;
    var tag = String(el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function blockElement(target) {
    return target && target.closest ? target.closest('[data-lc-block]') : null;
  }

  function isFreeBlock(el) {
    /* 自由页面的根级区块同样是绝对定位（父级 .lc-free 高度为 0），
       不能只认自由容器内的子块，否则根级自由块会被当成流式块走 HTML5 拖拽。 */
    return !!(el && el.getAttribute('data-lc-positioned') === 'abs');
  }

  function markDraggable() {
    var nodes = document.querySelectorAll('[data-lc-block]');
    for (var i = 0; i < nodes.length; i += 1) {
      if (isFreeBlock(nodes[i])) nodes[i].removeAttribute('draggable');
      else nodes[i].setAttribute('draggable', 'true');
    }
  }

  function clearDropMarks() {
    var marked = document.querySelectorAll('[data-lc-drop]');
    for (var i = 0; i < marked.length; i += 1) marked[i].removeAttribute('data-lc-drop');
  }

  /* ---------- 拖拽辅助：判断溢出、找真正滚动容器、边缘自动滚动 ---------- */

  /* 画布整份重渲染会换掉预览会话，这里的变量活不过一次渲染，
     所以溢出的「拖拽前基线」由父页保存（来自每次 ready 上报的 overflowX/Y）。
     这里只负责在父页请求时回报当前文档的真实溢出。 */
  function measureOverflow(token) {
    var html = document.documentElement;
    post({
      type: 'overflow-result',
      token: token,
      overflowX: html.scrollWidth > html.clientWidth + 1,
      overflowY: html.scrollHeight > html.clientHeight + 1
    });
  }

  function isScrollHost(node) {
    if (!node || node === document.body || node === document.documentElement) return false;
    var style = getComputedStyle(node);
    var canY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
    var canX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;
    return canY || canX;
  }

  /* 嵌套容器场景取最近的可用滚动祖级；都没有时退回文档滚动层。 */
  function scrollHostFor(node) {
    var current = node;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isScrollHost(current)) return current;
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function stopAutoScroll() {
    if (autoScrollState && autoScrollState.raf) cancelAnimationFrame(autoScrollState.raf);
    autoScrollState = null;
  }

  /* rAF 驱动：越靠近可视区边缘速度越快，离开触发带立即归零。 */
  function autoScrollTick() {
    var session = autoScrollState;
    if (!session) return;
    var host = session.host || document.scrollingElement || document.documentElement;
    var docHost = host === (document.scrollingElement || document.documentElement);
    var rect = docHost
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : host.getBoundingClientRect();
    var band = 72;
    var maxSpeed = 22;
    var vx = 0;
    var vy = 0;
    var left = session.x - rect.left;
    var right = rect.right - session.x;
    var top = session.y - rect.top;
    var bottom = rect.bottom - session.y;
    if (left >= 0 && left < band) vx = -Math.ceil((band - left) / band * maxSpeed);
    else if (right >= 0 && right < band) vx = Math.ceil((band - right) / band * maxSpeed);
    if (top >= 0 && top < band) vy = -Math.ceil((band - top) / band * maxSpeed);
    else if (bottom >= 0 && bottom < band) vy = Math.ceil((band - bottom) / band * maxSpeed);
    if (vx || vy) {
      if (docHost) {
        window.scrollBy(vx, vy);
      } else {
        if (vx) host.scrollLeft += vx;
        if (vy) host.scrollTop += vy;
      }
      if (session.onScroll) session.onScroll();
    }
    session.raf = requestAnimationFrame(autoScrollTick);
  }

  function updateAutoScroll(x, y, node, onScroll) {
    if (!autoScrollState) autoScrollState = { raf: 0 };
    autoScrollState.x = x;
    autoScrollState.y = y;
    autoScrollState.host = scrollHostFor(node);
    autoScrollState.onScroll = onScroll || null;
    if (!autoScrollState.raf) autoScrollState.raf = requestAnimationFrame(autoScrollTick);
  }

  function markDropAt(target, x, y) {
    var el = blockElement(target);
    if (!el || !dragging || el.getAttribute('data-lc-block') === dragging) {
      clearDropMarks();
      return;
    }
    var rect = el.getBoundingClientRect();
    var ratio = rect.height ? (y - rect.top) / rect.height : 0.5;
    /* 区块外层是 div.lc-block，容器 section.lc-container 是它的子节点，
       所以不能只看外层 class，否则容器永远只能插在前后、进不去内部。 */
    var isContainer = el.getAttribute('data-lc-type') === 'container' ||
      el.classList.contains('lc-container');
    var freeContainer = el.getAttribute('data-lc-type') === 'container' &&
      (el.classList.contains('lc-container-free') || !!el.querySelector('.lc-container-free'));
    var position;
    /* 自由定位容器的子元素由 pos 摆放，不再按顺序插到前/后。 */
    if (isContainer && !freeContainer) {
      position = ratio < 0.3 ? 'before' : (ratio > 0.7 ? 'after' : 'inside');
    } else {
      position = ratio < 0.5 ? 'before' : 'after';
    }
    clearDropMarks();
    el.setAttribute('data-lc-drop', position);
  }

  /* 自动滚动后指针下的元素变了，落点指示必须跟着滚动结果重算。 */
  function refreshDrop() {
    if (!dragging) return;
    var target = document.elementFromPoint(hoverPoint.x, hoverPoint.y);
    markDropAt(target, hoverPoint.x, hoverPoint.y);
  }

  function endDragSession() {
    var wasDragging = !!dragging;
    stopAutoScroll();
    var active = document.querySelector('[data-lc-dragging="true"]');
    if (active) active.removeAttribute('data-lc-dragging');
    clearDropMarks();
    dragging = null;
    pointerDrag = null;
    if (wasDragging) post({ type: 'drag-end' });
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function geometry(el) {
    var style = getComputedStyle(el);
    return {
      left: parseFloat(style.left) || 0,
      top: parseFloat(style.top) || 0,
      width: el.offsetWidth,
      height: el.offsetHeight
    };
  }

  /* 拖动边界与夹取范围。
     自由列表 .lc-free 的子节点全是绝对定位，容器自身高度为 0；
     若直接拿父元素做边界，任何拖动都会被判成“拖出边界”并取消，
     纵向也会被夹到 0。这里对零尺寸父级回退到页面容器，
     用页面的内容高度作为可拖范围。 */
  function containment(el) {
    var host = el.parentElement;
    if (host) {
      var hostRect = host.getBoundingClientRect();
      if (hostRect.width > 8 && hostRect.height > 8) {
        return {
          rect: hostRect,
          width: Math.max(host.clientWidth, hostRect.width),
          height: Math.max(host.clientHeight, host.scrollHeight, hostRect.height)
        };
      }
    }
    var page = el.closest('[data-lc-page]') || document.documentElement;
    var pageRect = page.getBoundingClientRect();
    var contentHeight = Math.max(page.scrollHeight, page.clientHeight, pageRect.height);
    return {
      rect: {
        left: pageRect.left,
        right: pageRect.right,
        top: pageRect.top,
        bottom: pageRect.top + contentHeight
      },
      width: page.clientWidth || document.documentElement.clientWidth,
      height: contentHeight
    };
  }

  function attachFreeHandles(el, id) {
    var handle = document.createElement('div');
    handle.className = 'lc-builder-resize';
    handle.style.cssText = 'position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;border-radius:3px;' +
      'background:var(--lc-color-accent,#3e6a56);cursor:nwse-resize;z-index:4;touch-action:none;';
    el.appendChild(handle);

    function begin(event, mode) {
      if (event.button !== undefined && event.button !== 0) return;
      if (isEditable(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      var box = geometry(el);
      var bounds = containment(el);
      var startX = event.clientX;
      var startY = event.clientY;
      var origin = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
      var pos = { left: box.left, top: box.top, width: box.width, height: box.height };
      var moved = false;
      var escaped = false;
      updateAutoScroll(event.clientX, event.clientY, el, null);
      post({ type: 'free-start', id: id });

      function insideHost(x, y) {
        var rect = bounds.rect;
        return x >= rect.left - 4 && x <= rect.right + 4 && y >= rect.top - 4 && y <= rect.bottom + 4;
      }

      function move(moveEvent) {
        var dx = moveEvent.clientX - startX;
        var dy = moveEvent.clientY - startY;
        moved = true;
        if (!insideHost(moveEvent.clientX, moveEvent.clientY)) escaped = true;
        updateAutoScroll(moveEvent.clientX, moveEvent.clientY, el, null);
        if (mode === 'drag') {
          var maxLeft = Math.max(0, bounds.width - pos.width);
          var maxTop = Math.max(0, bounds.height - pos.height);
          /* 位置夹在可拖范围内：拖到边界外也不会把文档撑出滚动条。 */
          pos.left = Math.min(maxLeft, Math.max(0, Math.round(box.left + dx)));
          pos.top = Math.min(maxTop, Math.max(0, Math.round(box.top + dy)));
          el.style.left = pos.left + 'px';
          el.style.top = pos.top + 'px';
        } else {
          var maxWidth = Math.max(40, bounds.width - box.left);
          var maxHeight = Math.max(40, bounds.height - box.top);
          pos.width = Math.min(maxWidth, Math.max(40, Math.round(box.width + dx)));
          pos.height = Math.min(maxHeight, Math.max(40, Math.round(box.height + dy)));
          el.style.width = pos.width + 'px';
          el.style.height = pos.height + 'px';
        }
      }

      function finish(commit) {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onCancel);
        stopAutoScroll();
        pointerDrag = null;
        if (commit && moved && !escaped) {
          post({ type: 'free-end', id: id, pos: pos });
          return;
        }
        /* 取消：恢复拖动前的内联样式，不写回页面数据。 */
        el.style.left = origin.left;
        el.style.top = origin.top;
        el.style.width = origin.width;
        el.style.height = origin.height;
        post({ type: 'free-cancel', id: id });
      }

      function onUp() { finish(true); }
      function onCancel() { finish(false); }

      pointerDrag = { cancel: onCancel };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onCancel);
    }

    handle.addEventListener('pointerdown', function (event) { begin(event, 'resize'); });
    if (!el.__lcFreeBound) {
      el.__lcFreeBound = true;
      el.addEventListener('pointerdown', function (event) {
        if (el.getAttribute('data-lc-selected') !== 'true') return;
        if (event.target === handle || handle.contains(event.target)) return;
        begin(event, 'drag');
      });
    }
  }

  function clearSelection() {
    var selected = document.querySelectorAll('[data-lc-selected="true"]');
    for (var i = 0; i < selected.length; i += 1) selected[i].removeAttribute('data-lc-selected');
    var handles = document.querySelectorAll('.lc-builder-resize');
    for (var j = 0; j < handles.length; j += 1) handles[j].remove();
  }

  function select(id, free) {
    clearSelection();
    if (!id) return;
    var el = document.querySelector('[data-lc-block="' + cssEscape(id) + '"]');
    if (!el) return;
    el.setAttribute('data-lc-selected', 'true');
    if (free) attachFreeHandles(el, id);
    else if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  document.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    var el = blockElement(event.target);
    /* 导航/页脚这类公共外壳区块不属于当前页，选中后也没有可改字段，直接提示去配置中心改（BLD-05）。 */
    if (el && el.closest && el.closest('[data-lc-shell="true"]')) {
      post({ type: 'shell-block' });
      return;
    }
    post({
      type: 'pick',
      id: el ? (el.getAttribute('data-lc-block') || '') : '',
      free: isFreeBlock(el)
    });
  }, true);

  document.addEventListener('dragstart', function (event) {
    var el = blockElement(event.target);
    if (el && el.closest && el.closest('[data-lc-shell="true"]')) {
      event.preventDefault();
      return;
    }
    if (!el || !el.getAttribute('draggable') || isFreeBlock(el)) {
      event.preventDefault();
      return;
    }
    dragging = el.getAttribute('data-lc-block');
    hoverPoint.x = event.clientX;
    hoverPoint.y = event.clientY;
    el.setAttribute('data-lc-dragging', 'true');
    updateAutoScroll(event.clientX, event.clientY, el, refreshDrop);
    post({ type: 'drag-begin' });
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragging);
    }
  });

  document.addEventListener('dragover', function (event) {
    if (!dragging) return;
    var el = blockElement(event.target);
    hoverPoint.x = event.clientX;
    hoverPoint.y = event.clientY;
    /* 指针在页面空白处也要保持边缘自动滚动，不能因为没命中区块就停。 */
    updateAutoScroll(event.clientX, event.clientY, el || event.target, refreshDrop);
    if (!el) {
      clearDropMarks();
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    markDropAt(el, event.clientX, event.clientY);
  });

  document.addEventListener('dragleave', function (event) {
    var el = blockElement(event.target);
    if (el && !el.contains(event.relatedTarget)) el.removeAttribute('data-lc-drop');
    /* 指针离开窗口时立即停掉自动滚动；重新进入后 dragover 会恢复。 */
    if (!event.relatedTarget) stopAutoScroll();
  });

  document.addEventListener('drop', function (event) {
    var el = blockElement(event.target);
    if (!el || !dragging) return;
    event.preventDefault();
    var position = el.getAttribute('data-lc-drop');
    var from = dragging;
    stopAutoScroll();
    clearDropMarks();
    dragging = null;
    post({ type: 'drag-end' });
    /* 没命中落点（拖到容器外松手）一律取消，不插到页面根。 */
    if (position) post({ type: 'drop', from: from, to: el.getAttribute('data-lc-block'), position: position });
  });

  document.addEventListener('dragend', function () {
    endDragSession();
  });

  window.addEventListener('blur', function () {
    if (pointerDrag && pointerDrag.cancel) pointerDrag.cancel();
    if (dragging) endDragSession();
  });

  document.addEventListener('keydown', function (event) {
    var key = String(event.key || '').toLowerCase();
    var mod = event.ctrlKey || event.metaKey;
    var editable = isEditable(event.target);
    if (key === 'escape' && (dragging || (pointerDrag && pointerDrag.cancel))) {
      if (pointerDrag && pointerDrag.cancel) pointerDrag.cancel();
      if (dragging) endDragSession();
      event.preventDefault();
      return;
    }
    var payload = {
      type: 'key',
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey
    };
    if (mod && key === 's') {
      event.preventDefault();
      post(payload);
      return;
    }
    if (editable) return;
    if (mod && (key === 'z' || key === 'y' || key === 'd' || key === 'c' || key === 'v')) {
      event.preventDefault();
      post(payload);
      return;
    }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      post(payload);
    }
  });

  /* 页面根容器可能因为限高而内部滚动，和 window 一起上报，重渲染后都能还原。 */
  window.addEventListener('scroll', function () {
    var page = document.querySelector('.lc-page');
    post({ type: 'scroll', y: window.scrollY || 0, pageY: page ? (page.scrollTop || 0) : 0 });
  }, { passive: true, capture: true });

  window.addEventListener('message', function (event) {
    /* 只接受同源父页投递的消息。 */
    if (event.source !== parent) return;
    if (event.origin !== window.location.origin) return;
    var message = event.data;
    if (!message || message.__lc !== 'parent') return;
    if (message.type === 'select') select(message.id, message.free);
    else if (message.type === 'scroll') {
      window.scrollTo(0, Number(message.y) || 0);
      var page = document.querySelector('.lc-page');
      if (page && message.pageY != null) page.scrollTop = Number(message.pageY) || 0;
    } else if (message.type === 'cancel-drag') {
      if (pointerDrag && pointerDrag.cancel) pointerDrag.cancel();
      if (dragging) endDragSession();
    } else if (message.type === 'measure-overflow') {
      measureOverflow(message.token);
    }
  });

  function ready() {
    markDraggable();
    var page = document.querySelector('.lc-page');
    var html = document.documentElement;
    post({
      type: 'ready',
      y: window.scrollY || 0,
      pageY: page ? (page.scrollTop || 0) : 0,
      /* 父页拿这个作为「拖拽前」的溢出基线。 */
      overflowX: html.scrollWidth > html.clientWidth + 1,
      overflowY: html.scrollHeight > html.clientHeight + 1
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
