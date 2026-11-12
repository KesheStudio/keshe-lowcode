/* 低代码平台 · Mermaid 外部渲染器适配
 *
 * 边界（D-48 / CONTRACTS 第 7 节）：
 * - 渲染层不 require/import mermaid，也不认识 `mermaid` 包；
 * - 调用方把 codeRenderers() 注入 Markdown 代码块钩子，渲染层只拿到 HTML 字符串；
 * - 导出器用 hasMermaidInSite() 判断是否按需把 vendor/mermaid.min.js 打进产物；
 * - 浏览器里作为经典脚本加载（window.LC.Mermaid），Node 里可直接 require。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LC = root.LC || {};
    root.LC.Mermaid = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LANGS = { mermaid: true, mmd: true };
  var FENCE_RE = /(?:^|\n)[ \t]*```[ \t]*(?:mermaid|mmd)\b/;

  /* 产物内只有命中这个围栏时才需要 mermaid 运行时 */
  function hasMermaid(text) {
    return FENCE_RE.test(String(text == null ? '' : text));
  }

  function isFenceLang(lang) {
    return LANGS[String(lang == null ? '' : lang).trim().toLowerCase()] === true;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\n/g, '&#10;');
  }

  /* 与渲染层 markdown.js 的 mermaidBlock 同构：源码放 [data-lc-mermaid-source]，
     画布放 [data-lc-mermaid-canvas]，失败信息放 [data-lc-mermaid-error]。
     没有运行时时源码仍然可读，不会整块消失。 */
  function renderCode(code, options) {
    var opts = options || {};
    var idAttr = opts.id ? ' id="' + escapeAttr(opts.id) + '"' : '';
    return '<div class="lc-mermaid" data-lc-mermaid="true" data-lc-mermaid-status="pending"' + idAttr + '>' +
      '<pre class="lc-mermaid-source" data-lc-mermaid-source><code>' +
      escapeHtml(String(code == null ? '' : code).replace(/\r\n?/g, '\n')) +
      '</code></pre>' +
      '<div class="lc-mermaid-canvas" data-lc-mermaid-canvas></div>' +
      '<p class="lc-mermaid-error" data-lc-mermaid-error hidden></p>' +
      '</div>';
  }

  function codeRenderers() {
    return { mermaid: renderCode, mmd: renderCode };
  }

  /* 站点 JSON 任意层级出现 mermaid 围栏就返回 true。
     只看字符串值，不误判键名；遇到第一个命中即停止。 */
  function hasMermaidInSite(data) {
    var found = false;

    function walk(value) {
      if (found || value == null) return;
      if (typeof value === 'string') {
        if (hasMermaid(value)) found = true;
        return;
      }
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length && !found; i += 1) walk(value[i]);
        return;
      }
      if (typeof value === 'object') {
        var keys = Object.keys(value);
        for (var j = 0; j < keys.length && !found; j += 1) walk(value[keys[j]]);
      }
    }

    walk(data);
    return found;
  }

  /* 产物页面里“这页有没有 mermaid 块”的运行时判断 */
  function hasMermaidMarkup(html) {
    var text = String(html == null ? '' : html);
    return text.indexOf('data-lc-mermaid') !== -1 || text.indexOf('class="mermaid"') !== -1;
  }

  /* mermaid.min.js 已在本页加载后执行：把主题令牌映射成官方 themeVariables，
     把占位结构里的源码异步渲染成 SVG。官方 API 是 Promise，逐块失败不影响其它块。
     运行时缺失或渲染失败时保留源码块并给一行可见提示，不出现白屏。 */
  function bootstrap() {
    return '<script>(function(){\n' +
      'var doc=document,win=window;\n' +
      'var lib=win.mermaid;\n' +
      'var seq=0;\n' +
      'function cssVar(name,fallback){try{var v=win.getComputedStyle(doc.documentElement).getPropertyValue(name);return (v||"").trim()||fallback;}catch(e){return fallback;}}\n' +
      'function palette(){\n' +
      '  var nodeFill=cssVar("--lc-mermaid-node-fill",cssVar("--lc-color-surface","#ffffff"));\n' +
      '  var nodeStroke=cssVar("--lc-mermaid-node-stroke",cssVar("--lc-color-line","#d9d2c2"));\n' +
      '  var line=cssVar("--lc-mermaid-line",cssVar("--lc-color-muted","#626a63"));\n' +
      '  var label=cssVar("--lc-mermaid-label",cssVar("--lc-color-ink","#1d2320"));\n' +
      '  var noteFill=cssVar("--lc-mermaid-note-fill",cssVar("--lc-color-surface-2","#f1ece0"));\n' +
      '  var labelBg=cssVar("--lc-mermaid-label-bg",cssVar("--lc-color-bg","#f4f0e6"));\n' +
      '  var bg=cssVar("--lc-color-bg","#f4f0e6");\n' +
      '  var softAccent=cssVar("--lc-color-accent-soft",noteFill);\n' +
      '  var softInfo=cssVar("--lc-color-info-soft",noteFill);\n' +
      '  var softWarn=cssVar("--lc-color-warn-soft",noteFill);\n' +
      '  var softSuccess=cssVar("--lc-color-success-soft",noteFill);\n' +
      '  var softDanger=cssVar("--lc-color-danger-soft",noteFill);\n' +
      '  var dark=doc.documentElement.getAttribute("data-lc-mode")==="dark";\n' +
      '  return {\n' +
      '    darkMode:dark,background:bg,fontFamily:cssVar("--lc-font-sans","sans-serif"),\n' +
      '    primaryColor:nodeFill,primaryTextColor:label,primaryBorderColor:nodeStroke,secondaryColor:noteFill,tertiaryColor:labelBg,\n' +
      '    mainBkg:nodeFill,nodeBorder:nodeStroke,clusterBkg:labelBg,clusterBorder:nodeStroke,lineColor:line,textColor:label,\n' +
      '    edgeLabelBackground:labelBg,labelBackgroundColor:labelBg,\n' +
      '    noteBkgColor:noteFill,noteTextColor:label,noteBorderColor:nodeStroke,\n' +
      '    actorBkg:nodeFill,actorBorder:nodeStroke,actorTextColor:label,actorLineColor:line,\n' +
      '    signalColor:line,signalTextColor:label,labelBoxBkgColor:labelBg,labelBoxBorderColor:nodeStroke,labelTextColor:label,\n' +
      '    loopTextColor:label,activationBkgColor:noteFill,activationBorderColor:nodeStroke,sequenceNumberColor:label,\n' +
      '    sectionBkgColor:labelBg,altSectionBkgColor:nodeFill,gridColor:line,\n' +
      '    taskBkgColor:nodeFill,taskBorderColor:nodeStroke,taskTextColor:label,taskTextOutsideColor:label,\n' +
      '    activeTaskBkgColor:noteFill,activeTaskBorderColor:nodeStroke,activeTaskTextColor:label,\n' +
      '    doneTaskBkgColor:noteFill,doneTaskBorderColor:nodeStroke,doneTaskTextColor:label,\n' +
      '    critBkgColor:softDanger, critBorderColor:nodeStroke,todayLineColor:cssVar("--lc-color-accent",line),\n' +
      '    classText:label,attributeBackgroundColorOdd:nodeFill,attributeBackgroundColorEven:labelBg,\n' +
      '    labelTextColor:label,\n' +
      '    pie1:nodeFill,pie2:noteFill,pie3:labelBg,pie4:softInfo,pie5:softWarn,pie6:softSuccess,pie7:softAccent,pie8:softDanger,pie9:nodeFill,pie10:noteFill,pie11:labelBg,pie12:softAccent,\n' +
      '    pieTitleTextColor:label,pieSectionTextColor:label,pieLegendTextColor:label,pieStrokeColor:nodeStroke,pieOuterStrokeColor:nodeStroke,pieOpacity:"1"\n' +
      '  };\n' +
      '}\n' +
      'function applyTheme(){try{lib.initialize({startOnLoad:false,theme:"base",securityLevel:"strict",themeVariables:palette()});}catch(e){}}\n' +
      'function brief(value){var text=String(value==null?"":value).replace(/<[^>]*>/g," ").replace(/\\s+/g," ").trim();return text.slice(0,180);}\n' +
      'function setError(block,message){block.setAttribute("data-lc-mermaid-status","error");var err=block.querySelector("[data-lc-mermaid-error]");if(err){err.hidden=false;err.textContent=message;}var canvas=block.querySelector("[data-lc-mermaid-canvas]");if(canvas)canvas.innerHTML="";}\n' +
      'function renderBlock(block){\n' +
      '  var token=(parseInt(block.getAttribute("data-lc-mm-token")||"0",10)||0)+1;block.setAttribute("data-lc-mm-token",String(token));\n' +
      '  var src=block.querySelector("[data-lc-mermaid-source]");\n' +
      '  var canvas=block.querySelector("[data-lc-mermaid-canvas]");\n' +
      '  var err=block.querySelector("[data-lc-mermaid-error]");\n' +
      '  var code=src?src.textContent.replace(/^\\s+|\\s+$/g,""):"";\n' +
      '  if(!code){setError(block,"图表源码为空。");return;}\n' +
      '  if(!lib||!lib.render){setError(block,"图表库未加载，已保留源码。");return;}\n' +
      '  applyTheme();\n' +
      '  var id="lc-mm-"+(seq+=1);\n' +
      '  Promise.resolve().then(function(){return lib.render(id,code);}).then(function(out){\n' +
      '    if((parseInt(block.getAttribute("data-lc-mm-token")||"0",10)||0)!==token)return;\n' +
      '    var svg=typeof out==="string"?out:(out&&out.svg)||"";\n' +
      '    if(!svg){setError(block,"图表渲染结果为空，已保留源码。");return;}\n' +
      '    if(canvas)canvas.innerHTML=svg;\n' +
      '    block.setAttribute("data-lc-mermaid-status","ready");\n' +
      '    if(err){err.hidden=true;err.textContent="";}\n' +
      '  },function(reason){\n' +
      '    if((parseInt(block.getAttribute("data-lc-mm-token")||"0",10)||0)!==token)return;\n' +
      '    setError(block,"图表渲染失败："+brief(reason&&reason.message?reason.message:reason));\n' +
      '  });\n' +
      '}\n' +
      'function run(force){\n' +
      '  var blocks=doc.querySelectorAll(".lc-mermaid[data-lc-mermaid=true]");\n' +
      '  Array.prototype.forEach.call(blocks,function(block){\n' +
      '    if(!force&&block.getAttribute("data-lc-mermaid-status")==="ready")return;\n' +
      '    renderBlock(block);\n' +
      '  });\n' +
      '}\n' +
      'function installCss(){\n' +
      '  if(doc.getElementById("lc-mermaid-style"))return;\n' +
      '  var css=".lc-mermaid{margin:20px 0;overflow-x:auto}"\n' +
      '  +".lc-mermaid[data-lc-mermaid-status=ready] .lc-mermaid-source{display:none}"\n' +
      '  +".lc-mermaid-source{margin:0;padding:12px 14px;overflow:auto;border:1px solid var(--lc-color-line,#ddd);border-radius:8px;background:var(--lc-color-code-bg,#eeece3);color:var(--lc-color-ink-2,#222)}"\n' +
      '  +".lc-mermaid-canvas{text-align:center}"\n' +
      '  +".lc-mermaid-canvas svg{display:inline-block;max-width:100%;height:auto;background:transparent}"\n' +
      '  +".lc-mermaid[data-lc-mermaid-status=error] .lc-mermaid-canvas{display:none}"\n' +
      '  +".lc-mermaid-error{margin:8px 0 0;padding:8px 10px;border-left:3px solid var(--lc-color-danger,#b3261e);background:var(--lc-color-surface-2,#f9f5ed);color:var(--lc-color-ink,#1d2320);font-size:12px}"\n' +
      '  +".lc-mermaid-error[hidden]{display:none}";\n' +
      '  var style=doc.createElement("style");style.id="lc-mermaid-style";style.setAttribute("data-lc-mermaid","");style.textContent=css;(doc.head||doc.documentElement).appendChild(style);\n' +
      '}\n' +
      'function start(){installCss();run(false);}\n' +
      'if(doc.readyState==="loading")doc.addEventListener("DOMContentLoaded",start);else start();\n' +
      'if(typeof win.MutationObserver==="function"){var timer=0;var watch=function(){clearTimeout(timer);timer=setTimeout(function(){run(true);},180);};try{new win.MutationObserver(watch).observe(doc.documentElement,{attributes:true,attributeFilter:["data-lc-mode","data-lc-theme"]});}catch(e){}}\n' +
      '})();</script>';
  }

  return {
    hasMermaid: hasMermaid,
    hasMermaidInSite: hasMermaidInSite,
    hasMermaidMarkup: hasMermaidMarkup,
    isFenceLang: isFenceLang,
    renderCode: renderCode,
    codeRenderers: codeRenderers,
    bootstrap: bootstrap,
    LANGS: LANGS
  };
}));
