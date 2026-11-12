/* 低代码平台 · 独立代码编辑器（第三步 · 收尾）
 *
 * 在第二步之上补齐：大文件降级、括号匹配、快捷键说明、无障碍与多实例隔离。
 * 自写轻量 tokenizer，不依赖任何第三方库；颜色全部走 --lc-* 变量，随明暗主题切换。
 *
 * 用法：
 *   const editor = window.LC.CodeEditor.create(document.getElementById('box'), {
 *     language: 'javascript',
 *     value: 'const a = 1;',
 *     tabSize: 4,
 *     maxHighlightLines: 5000, // 超过即进入纯文本模式；Infinity 表示不降级
 *     onChange(value, meta) {},
 *     onSave(value) {}
 *   });
 *
 * 已支持快捷键（demo 页面「快捷键对照表」与本注释保持一致）：
 *   Ctrl/Cmd+S       触发 onSave
 *   Ctrl/Cmd+F       打开查找
 *   Ctrl/Cmd+H       打开查找替换
 *   Esc              关闭查找替换并回到编辑区
 *   Enter            查找框：下一个匹配；替换框：替换当前匹配
 *   Shift+Enter      查找框：上一个匹配
 *   Tab              插入缩进 / 多行选区整体缩进
 *   Shift+Tab        多行选区整体反缩进
 *   Enter            编辑区：保持缩进；括号内换行自动补一层缩进
 *   Ctrl/Cmd+Z       撤销（浏览器/系统原生）
 *   Shift+Ctrl/Cmd+Z 重做（浏览器/系统原生）
 *   Ctrl/Cmd+A / C / X / V  全选 / 复制 / 剪切 / 粘贴（原生）
 *   方向键 / Home / End / PageUp / PageDown  光标移动与滚动（原生）
 *
 * 实现方式是 textarea 叠在高亮层上：textarea 的文字透明、只保留光标和选区，
 * 背后的一层 span 负责染色。这样输入、选区、滚动、输入法都交给浏览器原生能力，
 * 高亮层只做展示，不参与输入。
 */
(function (global) {
  'use strict';

  var VERSION = '0.1.0-step3';

  /* 大文件阈值：按行数而不是字节数，因为渲染成本主要来自逐行 DOM 和 tokenizer。
   * 5000 行实测正常高亮仍在百毫秒级；再往上滚动的 DOM 节点数和输入时的重排成本
   * 会明显增加，所以以 5000 行为分界，超过后关闭逐行高亮，只保留 textarea。 */
  var DEFAULT_MAX_HIGHLIGHT_LINES = 5000;

  var instanceSeq = 0;

  var LABELS = {
    javascript: 'JavaScript',
    json: 'JSON',
    css: 'CSS',
    html: 'HTML',
    markdown: 'Markdown',
    rust: 'Rust',
    go: 'Go',
    java: 'Java'
  };

  var ALIASES = {
    js: 'javascript',
    javascript: 'javascript',
    json: 'json',
    css: 'css',
    html: 'html',
    markdown: 'markdown',
    md: 'markdown',
    rust: 'rust',
    rs: 'rust',
    go: 'go',
    golang: 'go',
    java: 'java'
  };

  var BRACKET_OPEN = { '(': ')', '[': ']', '{': '}' };
  var BRACKET_CLOSE = { ')': '(', ']': '[', '}': '{' };

  function normalizeHighlightLimit(value) {
    if (value == null) return DEFAULT_MAX_HIGHLIGHT_LINES;
    if (value === Infinity) return Infinity;
    var limit = parseInt(value, 10);
    if (limit >= 0) return limit;
    return DEFAULT_MAX_HIGHLIGHT_LINES;
  }

  /* ---------------- token 与语言 ---------------- */

  var TOKEN_CLASS = {
    keyword: 'lce-tok-keyword',
    string: 'lce-tok-string',
    comment: 'lce-tok-comment',
    number: 'lce-tok-number',
    constant: 'lce-tok-constant',
    function: 'lce-tok-function',
    tag: 'lce-tok-tag',
    attr: 'lce-tok-attr',
    prop: 'lce-tok-prop',
    type: 'lce-tok-type',
    heading: 'lce-tok-heading',
    emphasis: 'lce-tok-emphasis',
    code: 'lce-tok-code',
    link: 'lce-tok-link'
  };

  var JS_KEYWORDS = makeSet(
    'as async await break case catch class const continue debugger default delete do else ' +
    'export extends finally for from function get if import in instanceof let new of return ' +
    'set static super switch this throw try typeof var void while with yield'
  );

  var JS_CONSTANTS = makeSet('true false null undefined NaN Infinity');

  var CSS_VALUE_HINT = makeSet(''); // 本步不单独着色 CSS 值关键字，留作后续扩展

  var RUST_KEYWORDS = makeSet(
    'as async await break const continue crate dyn else enum extern fn for if impl in let loop ' +
    'match mod move mut pub ref return self Self static struct super trait type unsafe use where while'
  );
  var RUST_TYPES = makeSet(
    'bool char str String i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 ' +
    'Option Result Vec Box Rc Arc HashMap HashSet BTreeMap'
  );
  var RUST_CONSTANTS = makeSet('true false None Some Ok Err');

  var GO_KEYWORDS = makeSet(
    'break case chan const continue default defer else fallthrough for func go goto if import ' +
    'interface map package range return select struct switch type var'
  );
  var GO_TYPES = makeSet(
    'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string ' +
    'uint uint8 uint16 uint32 uint64 uintptr any'
  );
  var GO_CONSTANTS = makeSet('true false nil iota');

  var JAVA_KEYWORDS = makeSet(
    'abstract assert break case catch class continue default do else enum extends final finally ' +
    'for goto if implements import instanceof interface native new package private protected public ' +
    'return static strictfp super switch synchronized this throw throws transient try volatile while ' +
    'var record sealed permits yield'
  );
  var JAVA_TYPES = makeSet(
    'boolean byte char short int long float double void String Object Integer Long Double Boolean ' +
    'Character List Map Set Optional Stream Collectors'
  );
  var JAVA_CONSTANTS = makeSet('true false null');

  function makeSet(words) {
    var map = Object.create(null);
    words.split(/\s+/).forEach(function (word) {
      if (word) map[word] = true;
    });
    return map;
  }

  function normalizeLanguage(language) {
    if (!language) return null;
    return ALIASES[String(language).toLowerCase()] || null;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ---------------- tokenizer 公共工具 ---------------- */

  function makeSink() {
    var out = [];
    return {
      tokens: out,
      push: function (type, text) {
        if (!text) return;
        var last = out[out.length - 1];
        if (last && last.type === type) {
          last.text += text;
        } else {
          out.push({ type: type, text: text });
        }
      }
    };
  }

  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  function isWordStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
  }

  function isWordPart(ch) {
    return isWordStart(ch) || isDigit(ch);
  }

  function scanString(text, start, quote, allowNewline) {
    var i = start + 1;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) return i + 1;
      if (!allowNewline && (ch === '\n' || ch === '\r')) return i;
      i += 1;
    }
    return n;
  }

  /* ---------------- JavaScript ---------------- */

  function tokenizeJavaScript(text) {
    var sink = makeSink();
    var i = 0;
    var n = text.length;

    while (i < n) {
      var ch = text[i];
      var next = text[i + 1];

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
        var ws = i + 1;
        while (ws < n && /[\s]/.test(text[ws])) ws += 1;
        sink.push('plain', text.slice(i, ws));
        i = ws;
        continue;
      }

      if (ch === '/' && next === '/') {
        var lineEnd = text.indexOf('\n', i + 2);
        if (lineEnd === -1) lineEnd = n;
        sink.push('comment', text.slice(i, lineEnd));
        i = lineEnd;
        continue;
      }

      if (ch === '/' && next === '*') {
        var blockEnd = text.indexOf('*/', i + 2);
        blockEnd = blockEnd === -1 ? n : blockEnd + 2;
        sink.push('comment', text.slice(i, blockEnd));
        i = blockEnd;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        var strEnd = scanString(text, i, ch, ch === '`');
        sink.push('string', text.slice(i, strEnd));
        i = strEnd;
        continue;
      }

      if (isDigit(ch) || (ch === '.' && isDigit(next || ''))) {
        var num = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
        if (num) {
          sink.push('number', num[0]);
          i += num[0].length;
          continue;
        }
      }

      if (isWordStart(ch)) {
        var wordEnd = i + 1;
        while (wordEnd < n && isWordPart(text[wordEnd])) wordEnd += 1;
        var word = text.slice(i, wordEnd);
        var type = 'plain';
        if (JS_KEYWORDS[word]) {
          type = 'keyword';
        } else if (JS_CONSTANTS[word]) {
          type = 'constant';
        } else {
          var look = wordEnd;
          while (look < n && (text[look] === ' ' || text[look] === '\t')) look += 1;
          if (text[look] === '(') type = 'function';
        }
        sink.push(type, word);
        i = wordEnd;
        continue;
      }

      sink.push('plain', ch);
      i += 1;
    }

    return sink.tokens;
  }

  /* ---------------- JSON ---------------- */

  function tokenizeJSON(text) {
    var sink = makeSink();
    var i = 0;
    var n = text.length;

    while (i < n) {
      var ch = text[i];
      var next = text[i + 1];

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
        var ws = i + 1;
        while (ws < n && /[\s]/.test(text[ws])) ws += 1;
        sink.push('plain', text.slice(i, ws));
        i = ws;
        continue;
      }

      if (ch === '"') {
        var strEnd = scanString(text, i, '"', false);
        var look = strEnd;
        while (look < n && /[\s]/.test(text[look])) look += 1;
        sink.push(text[look] === ':' ? 'prop' : 'string', text.slice(i, strEnd));
        i = strEnd;
        continue;
      }

      if (ch === '-' && isDigit(next || '')) {
        var negNum = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
        if (negNum) {
          sink.push('number', negNum[0]);
          i += negNum[0].length;
          continue;
        }
      }

      if (isDigit(ch)) {
        var posNum = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
        if (posNum) {
          sink.push('number', posNum[0]);
          i += posNum[0].length;
          continue;
        }
      }

      if (isWordStart(ch)) {
        var wordEnd = i + 1;
        while (wordEnd < n && isWordPart(text[wordEnd])) wordEnd += 1;
        var word = text.slice(i, wordEnd);
        sink.push(word === 'true' || word === 'false' || word === 'null' ? 'constant' : 'plain', word);
        i = wordEnd;
        continue;
      }

      sink.push('plain', ch);
      i += 1;
    }

    return sink.tokens;
  }

  /* ---------------- CSS ----------------
   *
   * 简化规则：顶层标识符按选择器处理，块内“标识符 + 冒号”按属性处理。
   * 不做 SCSS/Less、CSS 嵌套与复杂选择器语义分析。
   */

  function tokenizeCSS(text) {
    var sink = makeSink();
    var i = 0;
    var n = text.length;
    var depth = 0;

    while (i < n) {
      var ch = text[i];
      var next = text[i + 1];

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
        var ws = i + 1;
        while (ws < n && /[\s]/.test(text[ws])) ws += 1;
        sink.push('plain', text.slice(i, ws));
        i = ws;
        continue;
      }

      if (ch === '/' && next === '*') {
        var blockEnd = text.indexOf('*/', i + 2);
        blockEnd = blockEnd === -1 ? n : blockEnd + 2;
        sink.push('comment', text.slice(i, blockEnd));
        i = blockEnd;
        continue;
      }

      if (ch === '"' || ch === "'") {
        var strEnd = scanString(text, i, ch, false);
        sink.push('string', text.slice(i, strEnd));
        i = strEnd;
        continue;
      }

      if (ch === '@') {
        var atEnd = i + 1;
        while (atEnd < n && /[-\w]/.test(text[atEnd])) atEnd += 1;
        sink.push('keyword', text.slice(i, atEnd));
        i = atEnd;
        continue;
      }

      if (ch === '!') {
        var important = /^!important\b/i.exec(text.slice(i));
        if (important) {
          sink.push('keyword', important[0]);
          i += important[0].length;
          continue;
        }
      }

      if (ch === '#' && /^#[0-9a-fA-F]{3,8}\b/.test(text.slice(i, i + 9))) {
        var hex = /^#[0-9a-fA-F]{3,8}\b/.exec(text.slice(i));
        sink.push('number', hex[0]);
        i += hex[0].length;
        continue;
      }

      if (isDigit(ch) || (ch === '.' && isDigit(next || ''))) {
        var num = /^(?:\d+(?:\.\d+)?|\.\d+)(?:%|[a-zA-Z]+)?/.exec(text.slice(i));
        if (num) {
          sink.push('number', num[0]);
          i += num[0].length;
          continue;
        }
      }

      if ((ch === '.' || ch === '#') && next && /[A-Za-z_-]/.test(next)) {
        sink.push('plain', ch);
        i += 1;
        var classEnd = i + 1;
        while (classEnd < n && /[-\w]/.test(text[classEnd])) classEnd += 1;
        sink.push('attr', text.slice(i, classEnd));
        i = classEnd;
        continue;
      }

      if (ch === ':') {
        sink.push('plain', ':');
        i += 1;
        if (depth === 0 && text[i] && /[A-Za-z_-]/.test(text[i])) {
          var pseudoEnd = i + 1;
          while (pseudoEnd < n && /[-\w]/.test(text[pseudoEnd])) pseudoEnd += 1;
          sink.push('keyword', text.slice(i, pseudoEnd));
          i = pseudoEnd;
        }
        continue;
      }

      if (isWordStart(ch) || (ch === '-' && next && /[-\w]/.test(next))) {
        var wordEnd = i + 1;
        while (wordEnd < n && /[-\w]/.test(text[wordEnd])) wordEnd += 1;
        var word = text.slice(i, wordEnd);
        var probe = wordEnd;
        while (probe < n && /[ \t]/.test(text[probe])) probe += 1;

        if (text[probe] === ':') {
          sink.push('prop', word);
        } else if (text[probe] === '(') {
          sink.push('function', word);
        } else if (depth === 0) {
          sink.push('tag', word);
        } else if (CSS_VALUE_HINT[word.toLowerCase()]) {
          sink.push('constant', word);
        } else {
          sink.push('plain', word);
        }
        i = wordEnd;
        continue;
      }

      if (ch === '{') {
        depth += 1;
        sink.push('plain', ch);
        i += 1;
        continue;
      }

      if (ch === '}') {
        if (depth > 0) depth -= 1;
        sink.push('plain', ch);
        i += 1;
        continue;
      }

      sink.push('plain', ch);
      i += 1;
    }

    return sink.tokens;
  }

  /* ---------------- Rust / Go / Java ----------------
   *
   * 三者按 C 系语法处理：注释、字符串、数字、关键字、内建类型、常量、函数调用。
   * 不做类型推导、泛型嵌套、宏展开等语义分析。
   */

  function scanQuoted(text, start, quote, allowEscape, allowNewline) {
    var i = start + 1;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      if (allowEscape && ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) return i + 1;
      if (!allowNewline && (ch === '\n' || ch === '\r')) return i;
      i += 1;
    }
    return n;
  }

  function scanRustRaw(text, start) {
    var i = start + 1;
    var hashes = 0;
    while (i < text.length && text[i] === '#') {
      hashes += 1;
      i += 1;
    }
    if (text[i] !== '"') return -1;
    i += 1;
    var closing = '"';
    for (var h = 0; h < hashes; h += 1) closing += '#';
    var end = text.indexOf(closing, i);
    return end === -1 ? text.length : end + closing.length;
  }

  function tokenizeCLike(text, lang) {
    var sink = makeSink();
    var i = 0;
    var n = text.length;
    var keywords = lang === 'rust' ? RUST_KEYWORDS : (lang === 'go' ? GO_KEYWORDS : JAVA_KEYWORDS);
    var types = lang === 'rust' ? RUST_TYPES : (lang === 'go' ? GO_TYPES : JAVA_TYPES);
    var constants = lang === 'rust' ? RUST_CONSTANTS : (lang === 'go' ? GO_CONSTANTS : JAVA_CONSTANTS);

    while (i < n) {
      var ch = text[i];
      var next = text[i + 1];

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
        var ws = i + 1;
        while (ws < n && /[\s]/.test(text[ws])) ws += 1;
        sink.push('plain', text.slice(i, ws));
        i = ws;
        continue;
      }

      if (ch === '/' && next === '/') {
        var lineEnd = text.indexOf('\n', i + 2);
        if (lineEnd === -1) lineEnd = n;
        sink.push('comment', text.slice(i, lineEnd));
        i = lineEnd;
        continue;
      }

      if (ch === '/' && next === '*') {
        var blockEnd = text.indexOf('*/', i + 2);
        blockEnd = blockEnd === -1 ? n : blockEnd + 2;
        sink.push('comment', text.slice(i, blockEnd));
        i = blockEnd;
        continue;
      }

      if (lang === 'rust' && ch === 'r' && (next === '"' || next === '#')) {
        var rawEnd = scanRustRaw(text, i);
        if (rawEnd !== -1) {
          sink.push('string', text.slice(i, rawEnd));
          i = rawEnd;
          continue;
        }
      }

      if (lang === 'go' && ch === '`') {
        var goRawEnd = scanQuoted(text, i, '`', false, true);
        sink.push('string', text.slice(i, goRawEnd));
        i = goRawEnd;
        continue;
      }

      if (lang === 'java' && ch === '"' && text.slice(i, i + 3) === '"""') {
        var textBlockEnd = text.indexOf('"""', i + 3);
        textBlockEnd = textBlockEnd === -1 ? n : textBlockEnd + 3;
        sink.push('string', text.slice(i, textBlockEnd));
        i = textBlockEnd;
        continue;
      }

      if (ch === '"') {
        var strEnd = scanQuoted(text, i, '"', true, false);
        sink.push('string', text.slice(i, strEnd));
        i = strEnd;
        continue;
      }

      if (ch === "'") {
        if (next === '\\') {
          var escEnd = scanQuoted(text, i, "'", true, false);
          sink.push('string', text.slice(i, escEnd));
          i = escEnd;
          continue;
        }
        if (next && text[i + 2] === "'") {
          sink.push('string', text.slice(i, i + 3));
          i += 3;
          continue;
        }
        if (lang === 'rust' && isWordStart(next || '')) {
          var lifeEnd = i + 2;
          while (lifeEnd < n && isWordPart(text[lifeEnd])) lifeEnd += 1;
          sink.push('plain', "'");
          sink.push('type', text.slice(i + 1, lifeEnd));
          i = lifeEnd;
          continue;
        }
        sink.push('plain', ch);
        i += 1;
        continue;
      }

      if (lang === 'java' && ch === '@' && isWordStart(next || '')) {
        var annEnd = i + 2;
        while (annEnd < n && isWordPart(text[annEnd])) annEnd += 1;
        sink.push('keyword', text.slice(i, annEnd));
        i = annEnd;
        continue;
      }

      if (isDigit(ch) || (ch === '.' && isDigit(next || ''))) {
        var num = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(?:[uUlLiIfFdD])?/.exec(text.slice(i));
        if (num) {
          sink.push('number', num[0]);
          i += num[0].length;
          continue;
        }
      }

      if (isWordStart(ch)) {
        var wordEnd = i + 1;
        while (wordEnd < n && isWordPart(text[wordEnd])) wordEnd += 1;
        var word = text.slice(i, wordEnd);
        var type = 'plain';
        if (constants[word]) {
          type = 'constant';
        } else if (keywords[word]) {
          type = 'keyword';
        } else if (types[word]) {
          type = 'type';
        } else {
          var probe = wordEnd;
          while (probe < n && (text[probe] === ' ' || text[probe] === '\t')) probe += 1;
          if (text[probe] === '(') {
            type = 'function';
          } else if (lang === 'rust' && text[probe] === '!') {
            var afterBang = probe + 1;
            while (afterBang < n && /\s/.test(text[afterBang])) afterBang += 1;
            if (text[afterBang] === '(') type = 'function';
          }
        }
        sink.push(type, word);
        i = wordEnd;
        continue;
      }

      sink.push('plain', ch);
      i += 1;
    }

    return sink.tokens;
  }

  /* ---------------- HTML ----------------
   *
   * 只区分：注释、DOCTYPE、标签名、属性名、属性值、实体、普通文本。
   * <script> / <style> 内部不进入子语言，避免一个 tokenizer 里再套两套规则。
   */

  function tokenizeHTML(text) {
    var sink = makeSink();
    var i = 0;
    var n = text.length;
    var inTag = false;
    var tagPending = false;
    var expectValue = false;

    while (i < n) {
      var ch = text[i];

      if (!inTag) {
        if (text.slice(i, i + 4) === '<!--') {
          var commentEnd = text.indexOf('-->', i + 4);
          commentEnd = commentEnd === -1 ? n : commentEnd + 3;
          sink.push('comment', text.slice(i, commentEnd));
          i = commentEnd;
          continue;
        }

        if (ch === '<') {
          if (text.slice(i, i + 9).toLowerCase() === '<!doctype') {
            var doctypeEnd = text.indexOf('>', i);
            doctypeEnd = doctypeEnd === -1 ? n : doctypeEnd + 1;
            sink.push('keyword', text.slice(i, doctypeEnd));
            i = doctypeEnd;
            continue;
          }
          sink.push('plain', '<');
          i += 1;
          if (text[i] === '/') {
            sink.push('plain', '/');
            i += 1;
          }
          inTag = true;
          tagPending = true;
          expectValue = false;
          continue;
        }

        if (ch === '&') {
          var entity = /^&[#A-Za-z0-9]+;/.exec(text.slice(i));
          if (entity) {
            sink.push('constant', entity[0]);
            i += entity[0].length;
            continue;
          }
          sink.push('plain', '&');
          i += 1;
          continue;
        }

        var textEnd = i + 1;
        while (textEnd < n && text[textEnd] !== '<' && text[textEnd] !== '&') textEnd += 1;
        sink.push('plain', text.slice(i, textEnd));
        i = textEnd;
        continue;
      }

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
        var tagWs = i + 1;
        while (tagWs < n && /[\s]/.test(text[tagWs])) tagWs += 1;
        sink.push('plain', text.slice(i, tagWs));
        i = tagWs;
        continue;
      }

      if (ch === '>') {
        sink.push('plain', '>');
        inTag = false;
        tagPending = false;
        expectValue = false;
        i += 1;
        continue;
      }

      if (ch === '/' && text[i + 1] === '>') {
        sink.push('plain', '/>');
        inTag = false;
        tagPending = false;
        expectValue = false;
        i += 2;
        continue;
      }

      if (ch === '=') {
        sink.push('plain', '=');
        expectValue = true;
        i += 1;
        continue;
      }

      if (ch === '"' || ch === "'") {
        var attrEnd = scanQuoted(text, i, ch, false, true);
        sink.push('string', text.slice(i, attrEnd));
        expectValue = false;
        i = attrEnd;
        continue;
      }

      if (ch === '<') {
        sink.push('plain', '<');
        inTag = false;
        i += 1;
        continue;
      }

      var tokenEnd = i + 1;
      while (tokenEnd < n && !/[\s=/>]/.test(text[tokenEnd])) tokenEnd += 1;
      var token = text.slice(i, tokenEnd);
      if (expectValue) {
        sink.push('string', token);
        expectValue = false;
      } else if (tagPending) {
        sink.push('tag', token);
        tagPending = false;
      } else {
        sink.push('attr', token);
      }
      i = tokenEnd;
    }

    return sink.tokens;
  }

  /* ---------------- Markdown ----------------
   *
   * 行级规则：标题、引用、分隔线、列表、代码块。
   * 行内规则：反引号代码、链接、** / * / _ 强调。
   */

  function scanMarkdownInline(sink, line) {
    var i = 0;
    var n = line.length;

    while (i < n) {
      var ch = line[i];

      if (ch === '`') {
        var tickEnd = line.indexOf('`', i + 1);
        if (tickEnd !== -1) {
          sink.push('code', line.slice(i, tickEnd + 1));
          i = tickEnd + 1;
          continue;
        }
      }

      if (ch === '[' || (ch === '!' && line[i + 1] === '[')) {
        var open = ch === '!' ? i + 1 : i;
        var close = line.indexOf(']', open + 1);
        if (close !== -1 && line[close + 1] === '(') {
          var paren = line.indexOf(')', close + 2);
          if (paren !== -1) {
            if (ch === '!') sink.push('plain', '!');
            sink.push('plain', '[');
            sink.push('link', line.slice(open + 1, close));
            sink.push('plain', '](');
            sink.push('string', line.slice(close + 2, paren));
            sink.push('plain', ')');
            i = paren + 1;
            continue;
          }
        }
      }

      if (ch === '*') {
        if (line[i + 1] === '*') {
          var boldEnd = line.indexOf('**', i + 2);
          if (boldEnd !== -1) {
            sink.push('emphasis', line.slice(i, boldEnd + 2));
            i = boldEnd + 2;
            continue;
          }
        }
        var italicEnd = line.indexOf('*', i + 1);
        if (italicEnd !== -1) {
          sink.push('emphasis', line.slice(i, italicEnd + 1));
          i = italicEnd + 1;
          continue;
        }
      }

      if (ch === '_') {
        var prev = i > 0 ? line[i - 1] : '';
        if (!prev || /\s/.test(prev)) {
          if (line[i + 1] === '_') {
            var uBoldEnd = line.indexOf('__', i + 2);
            if (uBoldEnd !== -1) {
              sink.push('emphasis', line.slice(i, uBoldEnd + 2));
              i = uBoldEnd + 2;
              continue;
            }
          }
          var uItalicEnd = line.indexOf('_', i + 1);
          if (uItalicEnd !== -1) {
            sink.push('emphasis', line.slice(i, uItalicEnd + 1));
            i = uItalicEnd + 1;
            continue;
          }
        }
      }

      sink.push('plain', ch);
      i += 1;
    }
  }

  function tokenizeMarkdown(text) {
    var sink = makeSink();
    var lines = text.split('\n');
    var inFence = false;

    for (var li = 0; li < lines.length; li += 1) {
      var line = lines[li];
      if (li > 0) sink.push('plain', '\n');

      if (inFence) {
        sink.push('code', line);
        if (/^\s*(```|~~~)\s*$/.test(line)) inFence = false;
        continue;
      }

      if (/^\s{0,3}(```|~~~)/.test(line)) {
        inFence = true;
        sink.push('code', line);
        continue;
      }

      if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) {
        sink.push('heading', line);
        continue;
      }

      if (/^\s{0,3}>/.test(line)) {
        sink.push('comment', line);
        continue;
      }

      if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        sink.push('comment', line);
        continue;
      }

      if (/^ {4}/.test(line)) {
        sink.push('code', line);
        continue;
      }

      var list = /^(\s*)([-*+]|\d+\.)(\s+)/.exec(line);
      if (list) {
        if (list[1]) sink.push('plain', list[1]);
        sink.push('number', list[2]);
        sink.push('plain', list[3]);
        scanMarkdownInline(sink, line.slice(list[0].length));
        continue;
      }

      scanMarkdownInline(sink, line);
    }

    return sink.tokens;
  }

  /* ---------------- 行拆分与渲染 ---------------- */

  function tokenize(text, language) {
    if (language === 'json') return tokenizeJSON(text);
    if (language === 'css') return tokenizeCSS(text);
    if (language === 'html') return tokenizeHTML(text);
    if (language === 'markdown') return tokenizeMarkdown(text);
    if (language === 'rust' || language === 'go' || language === 'java') {
      return tokenizeCLike(text, language);
    }
    return tokenizeJavaScript(text);
  }

  function tokensToLines(tokens) {
    var lines = [[]];
    var current = lines[0];

    for (var i = 0; i < tokens.length; i += 1) {
      var parts = tokens[i].text.split('\n');
      for (var k = 0; k < parts.length; k += 1) {
        if (k > 0) {
          current = [];
          lines.push(current);
        }
        if (parts[k]) current.push({ type: tokens[i].type, text: parts[k] });
      }
    }

    return lines;
  }

  function lineHtml(line) {
    var html = '';
    for (var i = 0; i < line.length; i += 1) {
      var seg = line[i];
      var cls = TOKEN_CLASS[seg.type];
      var text = escapeHtml(seg.text);
      html += cls ? '<span class="' + cls + '">' + text + '</span>' : text;
    }
    return html;
  }

  /* ---------------- 编辑器 ---------------- */

  function clampTabSize(size) {
    var n = parseInt(size, 10);
    if (!n || n < 1) n = 4;
    if (n > 8) n = 8;
    return n;
  }

  function CodeEditor(container, options) {
    options = options || {};

    var element = typeof container === 'string' ? document.querySelector(container) : container;
    if (!element) throw new Error('LC.CodeEditor: 找不到容器元素');

    this.container = element;
    this.language = normalizeLanguage(options.language) || 'javascript';
    this.tabSize = clampTabSize(options.tabSize);
    this.maxHighlightLines = normalizeHighlightLimit(options.maxHighlightLines);
    this.options = {
      onChange: typeof options.onChange === 'function' ? options.onChange : null,
      onSave: typeof options.onSave === 'function' ? options.onSave : null
    };

    this._uid = ++instanceSeq;
    this._raf = 0;
    this._destroyed = false;
    this._lineHeight = 20;
    this._padTop = 10;
    this._currentLine = 0;
    this._gutterCurrent = null;
    this._gutterWindow = null;
    this._lineCount = 1;
    this._degraded = false;
    this._degradeLines = -1;
    this._bracketTimer = 0;
    this._bracketText = null;
    this._bracketPairs = null;
    this._bracketLayerHtml = '';
    this._find = {
      open: false,
      mode: 'find',
      regex: false,
      caseSensitive: false,
      matches: [],
      index: -1,
      total: 0,
      truncated: false,
      invalid: false
    };

    this._build();
    this._bind();

    this.textarea.value = options.value == null ? '' : String(options.value);
    this.textarea.setSelectionRange(0, 0);
    this.textarea.scrollTop = 0;
    this.textarea.scrollLeft = 0;
    this._render();
    this._updateCaret();
  }

  CodeEditor.prototype._build = function () {
    var root = document.createElement('div');
    root.className = 'lc-code-editor';
    root.style.setProperty('--lce-tab-size', String(this.tabSize));

    root.innerHTML =
      '<span class="lce-sr-only" id="lce-help-' + this._uid + '">代码编辑器快捷键：Ctrl 或 Cmd 加 S 保存，加 F 查找，加 H 查找替换；Esc 关闭查找；Tab 缩进，Shift 加 Tab 反缩进；Enter 自动缩进。</span>' +
      '<div class="lce-degrade" role="status" aria-live="polite" hidden>' +
        '<strong>大文件模式</strong>' +
        '<span class="lce-degrade-text"></span>' +
      '</div>' +
      '<div class="lce-find" hidden role="search" aria-label="查找替换">' +
        '<div class="lce-find-row">' +
          '<input type="text" class="lce-find-input" placeholder="查找" aria-label="查找内容" aria-describedby="lce-find-msg-' + this._uid + '" spellcheck="false" autocomplete="off">' +
          '<span class="lce-find-count" aria-label="匹配计数" aria-live="polite"></span>' +
          '<button type="button" class="lce-find-btn" data-find-action="prev" title="上一个（Shift+Enter）">上一个</button>' +
          '<button type="button" class="lce-find-btn" data-find-action="next" title="下一个（Enter）">下一个</button>' +
          '<label class="lce-find-opt"><input type="checkbox" class="lce-find-regex"> 正则</label>' +
          '<label class="lce-find-opt"><input type="checkbox" class="lce-find-case"> 区分大小写</label>' +
          '<button type="button" class="lce-find-close" data-find-action="close" aria-label="关闭查找">×</button>' +
        '</div>' +
        '<div class="lce-find-row lce-find-replace-row">' +
          '<input type="text" class="lce-replace-input" placeholder="替换为" aria-label="替换内容" spellcheck="false" autocomplete="off">' +
          '<button type="button" class="lce-find-btn" data-find-action="replace">替换</button>' +
          '<button type="button" class="lce-find-btn" data-find-action="replace-all">全部替换</button>' +
          '<span class="lce-find-msg" id="lce-find-msg-' + this._uid + '" role="status" aria-live="polite"></span>' +
        '</div>' +
      '</div>' +
      '<div class="lce-body">' +
        '<div class="lce-gutter" aria-hidden="true"><div class="lce-gutter-inner"></div></div>' +
        '<div class="lce-code">' +
          '<div class="lce-activeline" aria-hidden="true"></div>' +
          '<div class="lce-bracketlayer" aria-hidden="true"><div class="lce-bracketlayer-inner"></div></div>' +
          '<div class="lce-matchlayer" aria-hidden="true"><div class="lce-matchlayer-inner"></div></div>' +
          '<div class="lce-highlight" aria-hidden="true"><div class="lce-highlight-inner"></div></div>' +
          '<textarea class="lce-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-multiline="true" aria-describedby="lce-help-' + this._uid + '" aria-keyshortcuts="Control+S Control+F Control+H"></textarea>' +
        '</div>' +
      '</div>' +
      '<div class="lce-statusbar">' +
        '<span class="lce-status-left"></span>' +
        '<span class="lce-status-notice" role="status" aria-live="polite"></span>' +
        '<span class="lce-status-right"></span>' +
      '</div>';

    this.root = root;
    this.textarea = root.querySelector('.lce-input');
    this.gutter = root.querySelector('.lce-gutter');
    this.gutterInner = root.querySelector('.lce-gutter-inner');
    this.highlightInner = root.querySelector('.lce-highlight-inner');
    this.activeBar = root.querySelector('.lce-activeline');
    this.bracketLayer = root.querySelector('.lce-bracketlayer');
    this.bracketLayerInner = root.querySelector('.lce-bracketlayer-inner');
    this.matchLayerInner = root.querySelector('.lce-matchlayer-inner');
    this.degradeNotice = root.querySelector('.lce-degrade');
    this.degradeText = root.querySelector('.lce-degrade-text');
    this.findBar = root.querySelector('.lce-find');
    this.findInput = root.querySelector('.lce-find-input');
    this.findCount = root.querySelector('.lce-find-count');
    this.findMsg = root.querySelector('.lce-find-msg');
    this.replaceInput = root.querySelector('.lce-replace-input');
    this.regexToggle = root.querySelector('.lce-find-regex');
    this.caseToggle = root.querySelector('.lce-find-case');
    this.statusLeft = root.querySelector('.lce-status-left');
    this.statusNotice = root.querySelector('.lce-status-notice');
    this.statusRight = root.querySelector('.lce-status-right');

    root.setAttribute('data-find-mode', 'find');
    root.setAttribute('data-degraded', '0');

    this.textarea.setAttribute('aria-label', '代码编辑器（' + LABELS[this.language] + '）');

    this.container.innerHTML = '';
    this.container.appendChild(root);

    var style = global.getComputedStyle(this.textarea);
    var lineHeight = parseFloat(style.lineHeight);
    if (lineHeight && lineHeight > 0) this._lineHeight = lineHeight;
    var padTop = parseFloat(style.paddingTop);
    if (padTop && padTop > 0) this._padTop = padTop;
  };

  CodeEditor.prototype._bind = function () {
    var self = this;

    this._onInput = function () {
      if (self._destroyed) return;
      if (!self._composing) {
        self._scheduleRender();
        if (self._find.open && self.findInput.value) self._runSearch(true, false);
      }
      self._emitChange('input');
      if (self._composing) self._updateStatus();
    };

    this._onKeyDown = function (event) {
      if (self._destroyed) return;
      if (event.isComposing) return;

      var meta = event.ctrlKey || event.metaKey;
      var key = event.key;

      if (meta && !event.altKey && (key === 's' || key === 'S')) {
        event.preventDefault();
        self.save();
        return;
      }

      if (key === 'Escape') {
        /* 代码编辑器把 Tab 用作缩进，必须留一个键盘出口，避免形成键盘陷阱（WCAG 2.1.2）。 */
        event.preventDefault();
        self.textarea.blur();
        return;
      }

      if (key === 'Tab' && !meta && !event.altKey) {
        event.preventDefault();
        self._handleTab(event.shiftKey);
        return;
      }

      if (key === 'Enter' && !meta && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        self._autoIndent();
      }
    };

    this._onScroll = function () {
      self._syncScroll();
    };

    this._onCaret = function () {
      self._updateCaret();
    };

    this._onSelectionChange = function () {
      if (document.activeElement === self.textarea) self._updateCaret();
      else self._clearBracketHighlight();
    };

    this._onCompositionStart = function () {
      self._composing = true;
      self.root.classList.add('is-composing');
    };

    this._onCompositionEnd = function () {
      self._composing = false;
      self.root.classList.remove('is-composing');
      self._scheduleRender();
      self._updateCaret();
    };

    this.textarea.addEventListener('input', this._onInput);
    this.textarea.addEventListener('keydown', this._onKeyDown);
    this.textarea.addEventListener('scroll', this._onScroll);
    this.textarea.addEventListener('keyup', this._onCaret);
    this.textarea.addEventListener('click', this._onCaret);
    this.textarea.addEventListener('mouseup', this._onCaret);
    this.textarea.addEventListener('select', this._onCaret);
    this.textarea.addEventListener('compositionstart', this._onCompositionStart);
    this.textarea.addEventListener('compositionend', this._onCompositionEnd);
    document.addEventListener('selectionchange', this._onSelectionChange);

    this._onRootKeyDown = function (event) {
      if (self._destroyed) return;
      var meta = event.ctrlKey || event.metaKey;
      var key = event.key;

      if (meta && !event.altKey && (key === 'f' || key === 'F')) {
        event.preventDefault();
        self.openFind('find');
        return;
      }

      if (meta && !event.altKey && (key === 'h' || key === 'H')) {
        event.preventDefault();
        self.openFind('replace');
        return;
      }

      if (key === 'Escape' && self._find.open) {
        event.preventDefault();
        self.closeFind();
      }
    };

    this._onFindInput = function () {
      if (self._find.open) self._runSearch(false, true);
    };

    this._onFindKeyDown = function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) self.findPrev();
        else self.findNext();
      }
    };

    this._onReplaceKeyDown = function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        self.replaceOne();
      }
    };

    this._onFindOption = function () {
      self._find.regex = self.regexToggle.checked;
      self._find.caseSensitive = self.caseToggle.checked;
      if (self._find.open) self._runSearch(true, false);
    };

    this._onFindClick = function (event) {
      var target = event.target;
      var actionButton = target && target.closest ? target.closest('[data-find-action]') : null;
      if (!actionButton || !self.root.contains(actionButton)) return;

      var action = actionButton.getAttribute('data-find-action');
      if (action === 'prev') self.findPrev();
      else if (action === 'next') self.findNext();
      else if (action === 'replace') self.replaceOne();
      else if (action === 'replace-all') self.replaceAll();
      else if (action === 'close') self.closeFind();
    };

    this.root.addEventListener('keydown', this._onRootKeyDown);
    this.findBar.addEventListener('click', this._onFindClick);
    this.findInput.addEventListener('input', this._onFindInput);
    this.findInput.addEventListener('keydown', this._onFindKeyDown);
    this.replaceInput.addEventListener('keydown', this._onReplaceKeyDown);
    this.regexToggle.addEventListener('change', this._onFindOption);
    this.caseToggle.addEventListener('change', this._onFindOption);
  };

  CodeEditor.prototype._scheduleRender = function () {
    var self = this;
    if (this._raf) return;

    var raf = global.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    this._raf = raf(function () {
      self._raf = 0;
      if (!self._destroyed) self._render();
    });
  };

  CodeEditor.prototype._render = function () {
    if (this._destroyed) return;

    var value = this.textarea.value;
    var lineCount = value.split('\n').length;
    this._lineCount = lineCount;

    var shouldDegrade = this.maxHighlightLines !== Infinity && lineCount > this.maxHighlightLines;
    this._degraded = shouldDegrade;
    this.root.classList.toggle('is-degraded', shouldDegrade);
    this.root.setAttribute('data-degraded', shouldDegrade ? '1' : '0');
    this._updateDegradeNotice(lineCount);

    var digits = Math.max(2, String(lineCount).length);
    this.gutter.style.width = 'calc(' + digits + 'ch + 24px)';

    if (shouldDegrade) {
      this._lines = null;
      this.highlightInner.innerHTML = '';
      this.matchLayerInner.innerHTML = '';
      this._renderGutterWindow(true);
      this._updateCaret();
      this._syncScroll();
      this._updateStatus();
      return;
    }

    this.gutterInner.style.height = '';
    this._gutterWindow = null;

    var lines = tokensToLines(tokenize(value, this.language));
    this._lines = lines;
    this._lineCount = lines.length;

    var html = '';
    for (var i = 0; i < lines.length; i += 1) {
      html += '<div class="lce-line">' + lineHtml(lines[i]) + '</div>';
    }
    this.highlightInner.innerHTML = html;

    var gutterHtml = '';
    for (var j = 0; j < lines.length; j += 1) {
      gutterHtml += '<div class="lce-line-number">' + (j + 1) + '</div>';
    }
    this.gutterInner.innerHTML = gutterHtml;
    this._gutterCurrent = null;

    this._renderMatchLayer();
    this._updateCaret();
    this._syncScroll();
    this._updateStatus();
  };

  CodeEditor.prototype._updateDegradeNotice = function (lineCount) {
    if (!this.degradeNotice) return;

    if (!this._degraded) {
      if (!this.degradeNotice.hidden) this.degradeNotice.hidden = true;
      this.degradeText.textContent = '';
      this._degradeLines = -1;
      return;
    }

    if (!this.degradeNotice.hidden && this._degradeLines === lineCount) return;
    this._degradeLines = lineCount;
    this.degradeNotice.hidden = false;
    this.degradeText.textContent =
      '文档 ' + lineCount.toLocaleString('zh-CN') + ' 行，超过 ' +
      this.maxHighlightLines.toLocaleString('zh-CN') +
      ' 行阈值：已关闭语法高亮和查找命中底色，行号只渲染可见区域，避免逐行 DOM 拖慢输入。' +
      '纯文本编辑、查找替换计数、保存仍可用；括号匹配在此模式下暂停。';
  };

  CodeEditor.prototype._renderGutterWindow = function (force) {
    var total = Math.max(1, this._lineCount);
    var ta = this.textarea;
    var first = Math.max(0, Math.floor((ta.scrollTop - this._padTop) / this._lineHeight) - 2);
    var visible = Math.ceil(ta.clientHeight / this._lineHeight) + 5;
    var last = Math.min(total - 1, first + visible);

    if (!force && this._gutterWindow &&
        this._gutterWindow.first === first && this._gutterWindow.last === last) {
      return;
    }
    this._gutterWindow = { first: first, last: last };

    var html = '';
    for (var n = first; n <= last; n += 1) {
      html += '<div class="lce-gutter-line" data-line="' + n + '" style="top:' +
        (this._padTop + n * this._lineHeight) + 'px">' + (n + 1) + '</div>';
    }
    this.gutterInner.innerHTML = html;
    this.gutterInner.style.height = (this._padTop * 2 + total * this._lineHeight) + 'px';
    this._gutterCurrent = null;
  };

  CodeEditor.prototype._syncScroll = function () {
    var ta = this.textarea;
    var scrollTop = ta.scrollTop;
    var scrollLeft = ta.scrollLeft;

    if (this._degraded) this._renderGutterWindow(false);

    this.highlightInner.style.transform = 'translate(' + (-scrollLeft) + 'px,' + (-scrollTop) + 'px)';
    this.gutterInner.style.transform = 'translateY(' + (-scrollTop) + 'px)';
    if (this.matchLayerInner) {
      this.matchLayerInner.style.transform = 'translate(' + (-scrollLeft) + 'px,' + (-scrollTop) + 'px)';
    }
    if (this.bracketLayerInner) {
      this.bracketLayerInner.style.transform = 'translate(' + (-scrollLeft) + 'px,' + (-scrollTop) + 'px)';
    }

    var top = this._padTop + this._currentLine * this._lineHeight - scrollTop;
    this.activeBar.style.transform = 'translateY(' + top + 'px)';
  };

  CodeEditor.prototype._updateCaret = function () {
    if (this._destroyed) return;

    var ta = this.textarea;
    var value = ta.value;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;

    var before = value.slice(0, start);
    var line = before.split('\n').length - 1;
    var lastBreak = before.lastIndexOf('\n');
    var col = start - lastBreak;
    var selected = Math.max(0, end - start);

    this._currentLine = line;

    if (this._gutterCurrent && this._gutterCurrent.parentNode !== this.gutterInner) {
      this._gutterCurrent = null;
    }
    if (this._gutterCurrent) this._gutterCurrent.classList.remove('is-current');
    var next = null;
    if (this._degraded) {
      next = this.gutterInner.querySelector('.lce-gutter-line[data-line="' + line + '"]');
    } else {
      next = this.gutterInner.children[line];
    }
    if (next) {
      next.classList.add('is-current');
      this._gutterCurrent = next;
    }

    var top = this._padTop + line * this._lineHeight - ta.scrollTop;
    this.activeBar.style.transform = 'translateY(' + top + 'px)';

    this._updateStatus(line, col, selected);
    this._scheduleBracketMatch();
  };

  CodeEditor.prototype._updateStatus = function (line, col, selected) {
    if (this._destroyed) return;

    if (line == null) {
      var value = this.textarea.value;
      var pos = this.textarea.selectionStart;
      var before = value.slice(0, pos);
      line = before.split('\n').length - 1;
      col = pos - before.lastIndexOf('\n');
      selected = this.textarea.selectionEnd - pos;
    }

    var left = '行 ' + (line + 1) + '，列 ' + col;
    if (selected > 0) left += ' · 选中 ' + selected + ' 字符';
    this.statusLeft.textContent = left;

    var chars = this.textarea.value.length;
    this.statusRight.textContent =
      LABELS[this.language] + ' · Tab ' + this.tabSize + ' · ' +
      this._lineCount + ' 行 · ' + chars + ' 字符' +
      (this._degraded ? ' · 大文件模式' : '');
  };

  /* ---------------- 括号匹配 ---------------- */

  CodeEditor.prototype._scheduleBracketMatch = function () {
    if (this._destroyed) return;
    if (this._bracketTimer) {
      clearTimeout(this._bracketTimer);
      this._bracketTimer = 0;
    }
    var self = this;
    this._bracketTimer = setTimeout(function () {
      self._bracketTimer = 0;
      if (!self._destroyed) self._updateBracketMatch();
    }, 32);
  };

  CodeEditor.prototype._ensureBracketPairs = function (text) {
    if (this._bracketText === text && this._bracketPairs) return this._bracketPairs;

    var pairs = new Map();
    var skipped = new Set();
    var stack = [];
    var mode = '';

    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      var next = text[i + 1];

      if (mode === 'line') {
        if (BRACKET_OPEN[ch] || BRACKET_CLOSE[ch]) skipped.add(i);
        if (ch === '\n') mode = '';
        continue;
      }
      if (mode === 'block') {
        if (BRACKET_OPEN[ch] || BRACKET_CLOSE[ch]) skipped.add(i);
        if (ch === '*' && next === '/') {
          mode = '';
          i += 1;
        }
        continue;
      }
      if (mode === 'single' || mode === 'double' || mode === 'backtick') {
        if (BRACKET_OPEN[ch] || BRACKET_CLOSE[ch]) skipped.add(i);
        if (mode !== 'backtick' && ch === '\\') {
          i += 1;
          continue;
        }
        if ((mode === 'single' && ch === "'") ||
            (mode === 'double' && ch === '"') ||
            (mode === 'backtick' && ch === '`')) {
          mode = '';
        }
        continue;
      }

      if (this.language === 'html' && text.slice(i, i + 4) === '<!--') {
        var htmlCommentEnd = text.indexOf('-->', i + 4);
        i = htmlCommentEnd === -1 ? text.length - 1 : htmlCommentEnd + 2;
        continue;
      }
      if (ch === '/' && next === '/') {
        mode = 'line';
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        i += 1;
        continue;
      }
      if (this.language === 'java' && text.slice(i, i + 3) === '"""') {
        var textBlockEnd = text.indexOf('"""', i + 3);
        i = textBlockEnd === -1 ? text.length - 1 : textBlockEnd + 2;
        continue;
      }
      if (ch === '"') {
        mode = 'double';
        continue;
      }
      if (ch === "'") {
        if (this.language === 'rust' && isWordStart(next || '') && text[i + 2] !== "'") {
          continue;
        }
        mode = 'single';
        continue;
      }
      if (ch === '`' &&
          (this.language === 'javascript' || this.language === 'go' || this.language === 'markdown')) {
        mode = 'backtick';
        continue;
      }

      if (BRACKET_OPEN[ch]) {
        stack.push({ ch: ch, index: i });
        continue;
      }

      if (BRACKET_CLOSE[ch]) {
        var top = stack[stack.length - 1];
        if (top && top.ch === BRACKET_CLOSE[ch]) {
          stack.pop();
          pairs.set(top.index, i);
          pairs.set(i, top.index);
        }
      }
    }

    this._bracketText = text;
    this._bracketPairs = pairs;
    this._bracketSkipped = skipped;
    return pairs;
  };

  CodeEditor.prototype._offsetInfo = function (text, index) {
    var before = text.slice(0, index);
    var line = before.split('\n').length - 1;
    var lineStart = before.lastIndexOf('\n') + 1;
    return { line: line, col: index - lineStart, lineStart: lineStart };
  };

  CodeEditor.prototype._setBracketNotice = function (text) {
    if (!this.statusNotice) return;
    if (this.statusNotice.textContent === text) return;
    this.statusNotice.textContent = text;
    this.statusNotice.classList.toggle('is-warn', Boolean(text));
  };

  CodeEditor.prototype._clearBracketHighlight = function () {
    if (this.bracketLayerInner && this._bracketLayerHtml) {
      this.bracketLayerInner.innerHTML = '';
      this._bracketLayerHtml = '';
    }
    this._setBracketNotice('');
  };

  CodeEditor.prototype._renderBracketLayer = function (text, index, pairIndex) {
    if (!this.bracketLayerInner) return;

    var locations = [{ index: index, matched: pairIndex >= 0 }];
    if (pairIndex >= 0) locations.push({ index: pairIndex, matched: true });

    var byLine = {};
    for (var i = 0; i < locations.length; i += 1) {
      var loc = locations[i];
      var info = this._offsetInfo(text, loc.index);
      if (!byLine[info.line]) {
        byLine[info.line] = {
          line: info.line,
          lineStart: info.lineStart,
          markers: []
        };
      }
      byLine[info.line].markers.push({
        col: info.col,
        matched: loc.matched
      });
    }

    var html = '';
    var lineHeight = this._lineHeight;
    var padTop = this._padTop;
    Object.keys(byLine).forEach(function (key) {
      var group = byLine[key];
      var lineEnd = text.indexOf('\n', group.lineStart);
      if (lineEnd === -1) lineEnd = text.length;
      var lineText = text.slice(group.lineStart, lineEnd);
      group.markers.sort(function (a, b) { return a.col - b.col; });

      var cursor = 0;
      var segment = '';
      for (var m = 0; m < group.markers.length; m += 1) {
        var marker = group.markers[m];
        if (marker.col > cursor) segment += escapeHtml(lineText.slice(cursor, marker.col));
        segment += '<span class="lce-bracket ' +
          (marker.matched ? 'is-matched' : 'is-unmatched') + '">' +
          escapeHtml(lineText.slice(marker.col, marker.col + 1)) + '</span>';
        cursor = marker.col + 1;
      }
      if (cursor < lineText.length) segment += escapeHtml(lineText.slice(cursor));

      html += '<div class="lce-bracket-line" style="top:' +
        (padTop + group.line * lineHeight) + 'px">' + segment + '</div>';
    });

    if (this._bracketLayerHtml !== html) {
      this._bracketLayerHtml = html;
      this.bracketLayerInner.innerHTML = html;
    }
  };

  CodeEditor.prototype._updateBracketMatch = function () {
    if (this._destroyed) return;
    if (this._degraded || document.activeElement !== this.textarea) {
      this._clearBracketHighlight();
      return;
    }

    var ta = this.textarea;
    var start = ta.selectionStart;
    if (start !== ta.selectionEnd) {
      this._clearBracketHighlight();
      return;
    }

    var text = ta.value;
    var index = -1;
    var bracket = '';

    if (start > 0 && (BRACKET_OPEN[text[start - 1]] || BRACKET_CLOSE[text[start - 1]])) {
      index = start - 1;
      bracket = text[index];
    } else if (BRACKET_OPEN[text[start]] || BRACKET_CLOSE[text[start]]) {
      index = start;
      bracket = text[index];
    }

    if (index < 0) {
      this._clearBracketHighlight();
      return;
    }

    var pairs = this._ensureBracketPairs(text);
    var pairIndex = pairs.get(index);

    if (pairIndex === undefined && this._bracketSkipped && this._bracketSkipped.has(index)) {
      this._clearBracketHighlight();
      return;
    }

    if (pairIndex === undefined) {
      this._renderBracketLayer(text, index, -1);
      var info = this._offsetInfo(text, index);
      this._setBracketNotice(
        '第 ' + (info.line + 1) + ' 行第 ' + (info.col + 1) +
        ' 列的「' + bracket + '」未找到配对'
      );
      return;
    }

    this._renderBracketLayer(text, index, pairIndex);
    this._setBracketNotice('');
  };

  CodeEditor.prototype._emitChange = function (source) {
    if (this.options.onChange) {
      var value = this.textarea.value;
      this.options.onChange(value, {
        language: this.language,
        length: value.length,
        lines: value.split('\n').length,
        source: source
      });
    }
  };

  CodeEditor.prototype._replace = function (start, end, text, selStart, selEnd, source) {
    var ta = this.textarea;
    ta.setRangeText(text, start, end, 'end');
    ta.setSelectionRange(selStart, selEnd);
    this._scheduleRender();
    if (this._find.open && this.findInput.value) this._runSearch(true, false);
    this._updateCaret();
    this._emitChange(source || 'edit');
  };

  CodeEditor.prototype._autoIndent = function () {
    var ta = this.textarea;
    var value = ta.value;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var leading = /^[ \t]*/.exec(value.slice(lineStart))[0];
    var unit = new Array(this.tabSize + 1).join(' ');
    var prev = start > 0 ? value[start - 1] : '';
    var next = value[end] || '';
    var pairs = { '{': '}', '[': ']', '(': ')' };
    var insert;
    var caret;

    if (pairs[prev] && next === pairs[prev]) {
      insert = '\n' + leading + unit + '\n' + leading;
      caret = start + ('\n' + leading + unit).length;
    } else {
      insert = '\n' + leading + (pairs[prev] ? unit : '');
      caret = start + insert.length;
    }

    this._replace(start, end, insert, caret, caret, 'auto-indent');
  };

  CodeEditor.prototype._visualColumn = function (text) {
    var col = 0;
    for (var i = 0; i < text.length; i += 1) {
      if (text[i] === '\t') {
        col += this.tabSize - (col % this.tabSize);
      } else {
        col += 1;
      }
    }
    return col;
  };

  CodeEditor.prototype._outdentMatch = function (line) {
    return new RegExp('^( {1,' + this.tabSize + '}|\\t)').exec(line);
  };

  CodeEditor.prototype._handleTab = function (outdent) {
    var ta = this.textarea;
    var value = ta.value;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var unit = new Array(this.tabSize + 1).join(' ');

    if (start === end) {
      if (!outdent) {
        var lineStart = value.lastIndexOf('\n', start - 1) + 1;
        var col = this._visualColumn(value.slice(lineStart, start));
        var spaces = this.tabSize - (col % this.tabSize);
        var pad = new Array(spaces + 1).join(' ');
        this._replace(start, end, pad, start + spaces, start + spaces, 'tab');
        return;
      }

      var currentStart = value.lastIndexOf('\n', start - 1) + 1;
      var match = this._outdentMatch(value.slice(currentStart));
      if (!match) return;
      var removeLength = match[0].length;
      var newCaret = Math.max(currentStart, start - removeLength);
      this._replace(currentStart, currentStart + removeLength, '', newCaret, newCaret, 'outdent');
      return;
    }

    var blockStart = value.lastIndexOf('\n', start - 1) + 1;
    var blockEnd = end;
    if (blockEnd > blockStart && value[blockEnd - 1] === '\n') blockEnd -= 1;

    var segment = value.slice(blockStart, blockEnd);
    var lines = segment.split('\n');
    var totalDelta = 0;
    var firstDelta = 0;

    var changed = lines.map(function (line, index) {
      if (!outdent) {
        totalDelta += unit.length;
        if (index === 0) firstDelta = unit.length;
        return unit + line;
      }
      var dedentMatch = this._outdentMatch(line);
      var removed = dedentMatch ? dedentMatch[0].length : 0;
      totalDelta -= removed;
      if (index === 0) firstDelta = -removed;
      return line.slice(removed);
    }).join('\n');

    var newStart = Math.max(blockStart, start + firstDelta);
    var newEnd = end + totalDelta;
    if (newEnd < newStart) newEnd = newStart;

    this._replace(blockStart, blockEnd, changed, newStart, newEnd, outdent ? 'outdent' : 'indent');
  };

  /* ---------------- 查找替换 ---------------- */

  CodeEditor.prototype._compileFindRegex = function (term) {
    var source = this._find.regex
      ? term
      : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var flags = 'g' + (this._find.caseSensitive ? '' : 'i');
    return new RegExp(source, flags);
  };

  CodeEditor.prototype._setFindMessage = function (text, kind) {
    if (!this.findMsg) return;
    this.findMsg.textContent = text || '';
    this.findMsg.classList.remove('is-empty', 'is-invalid', 'is-ok');
    if (kind) this.findMsg.classList.add('is-' + kind);
  };

  CodeEditor.prototype._updateFindCount = function () {
    if (!this.findCount) return;
    var st = this._find;
    this.findCount.classList.remove('is-empty', 'is-invalid');

    if (st.invalid) {
      this.findCount.textContent = '—';
      this.findCount.classList.add('is-invalid');
      return;
    }
    if (!this.findInput.value) {
      this.findCount.textContent = '';
      return;
    }
    if (st.total === 0) {
      this.findCount.textContent = '0/0';
      this.findCount.classList.add('is-empty');
      return;
    }
    this.findCount.textContent = (st.index + 1) + '/' + st.total + (st.truncated ? '+' : '');
  };

  CodeEditor.prototype._renderMatchLayer = function () {
    if (!this.matchLayerInner) return;
    var st = this._find;
    if (this._degraded || !st.matches.length) {
      this.matchLayerInner.innerHTML = '';
      return;
    }

    var value = this.textarea.value;
    var lines = value.split('\n');
    var starts = [];
    var offset = 0;
    for (var i = 0; i < lines.length; i += 1) {
      starts.push(offset);
      offset += lines[i].length + 1;
    }

    function lineAt(pos) {
      var lo = 0;
      var hi = starts.length - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }

    var ranges = [];
    for (var j = 0; j < lines.length; j += 1) ranges.push(null);

    for (var mi = 0; mi < st.matches.length; mi += 1) {
      var match = st.matches[mi];
      if (!match.length) continue;
      var start = match.index;
      var end = start + match.length;
      var first = lineAt(start);
      var last = lineAt(end);
      for (var ln = first; ln <= last; ln += 1) {
        var lineStart = starts[ln];
        var lineEnd = lineStart + lines[ln].length;
        var rs = Math.max(start, lineStart) - lineStart;
        var re = Math.min(end, lineEnd) - lineStart;
        if (re <= rs) continue;
        if (!ranges[ln]) ranges[ln] = [];
        ranges[ln].push({ start: rs, end: re, active: mi === st.index });
      }
    }

    var html = '';
    for (var li = 0; li < lines.length; li += 1) {
      var line = lines[li];
      var list = ranges[li];
      var cursor = 0;
      var segment = '';
      if (list) {
        list.sort(function (a, b) { return a.start - b.start; });
        for (var q = 0; q < list.length; q += 1) {
          var range = list[q];
          if (range.start > cursor) segment += escapeHtml(line.slice(cursor, range.start));
          segment += '<span class="lce-match' + (range.active ? ' is-active' : '') + '">' +
            escapeHtml(line.slice(range.start, range.end)) + '</span>';
          cursor = range.end;
        }
      }
      if (cursor < line.length) segment += escapeHtml(line.slice(cursor));
      html += '<div class="lce-line">' + segment + '</div>';
    }
    this.matchLayerInner.innerHTML = html;
  };

  CodeEditor.prototype._scrollToOffset = function (pos) {
    var ta = this.textarea;
    var before = ta.value.slice(0, pos);
    var line = before.split('\n').length - 1;
    var top = this._padTop + line * this._lineHeight;
    var viewTop = ta.scrollTop;
    var viewBottom = viewTop + ta.clientHeight;

    if (top < viewTop) {
      ta.scrollTop = top;
    } else if (top + this._lineHeight > viewBottom) {
      ta.scrollTop = top + this._lineHeight - ta.clientHeight;
    }
    this._syncScroll();
  };

  CodeEditor.prototype._setActiveMatch = function (index, scroll) {
    var st = this._find;
    if (st.total === 0 || !st.matches.length) {
      st.index = -1;
      this._renderMatchLayer();
      this._updateFindCount();
      return;
    }
    st.index = (index % st.total + st.total) % st.total;
    this._renderMatchLayer();
    if (scroll) this._scrollToOffset(st.matches[st.index].index);
    this._updateFindCount();
  };

  CodeEditor.prototype._runSearch = function (keepIndex, scroll) {
    var st = this._find;
    var term = this.findInput ? this.findInput.value : '';
    var previousIndex = st.index;

    st.matches = [];
    st.index = -1;
    st.total = 0;
    st.truncated = false;
    st.invalid = false;

    if (!term) {
      this.findInput && this.findInput.removeAttribute('aria-invalid');
      this._setFindMessage('');
      this._updateFindCount();
      this._renderMatchLayer();
      return;
    }

    var regex;
    try {
      regex = this._compileFindRegex(term);
    } catch (error) {
      st.invalid = true;
      if (this.findInput) this.findInput.setAttribute('aria-invalid', 'true');
      this._setFindMessage('正则表达式无效', 'invalid');
      this._updateFindCount();
      this._renderMatchLayer();
      return;
    }
    if (this.findInput) this.findInput.removeAttribute('aria-invalid');

    var value = this.textarea.value;
    var match;
    var limit = 10000;
    while ((match = regex.exec(value)) !== null) {
      if (st.matches.length >= limit) {
        st.truncated = true;
        break;
      }
      st.matches.push({
        index: match.index,
        length: match[0].length,
        groups: match.slice(0)
      });
      if (match[0].length === 0) {
        regex.lastIndex = match.index + 1;
        if (regex.lastIndex > value.length) break;
      }
    }

    st.total = st.matches.length;
    if (st.total === 0) {
      this._setFindMessage('无结果（已搜索全文 ' + this._lineCount + ' 行）', 'empty');
    } else {
      this._setFindMessage('');
      var nextIndex = 0;
      if (keepIndex && previousIndex >= 0 && previousIndex < st.total) {
        nextIndex = previousIndex;
      } else {
        var caret = this.textarea.selectionStart;
        for (var k = 0; k < st.matches.length; k += 1) {
          if (st.matches[k].index >= caret) {
            nextIndex = k;
            break;
          }
        }
      }
      st.index = nextIndex;
      if (scroll !== false) this._scrollToOffset(st.matches[nextIndex].index);
    }

    this._updateFindCount();
    this._renderMatchLayer();
  };

  CodeEditor.prototype.openFind = function (mode) {
    if (this._destroyed) return;
    var st = this._find;
    st.open = true;
    st.mode = mode === 'replace' ? 'replace' : 'find';
    this.root.setAttribute('data-find-mode', st.mode);
    this.findBar.hidden = false;

    var selected = this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd);
    if (selected && selected.indexOf('\n') === -1) this.findInput.value = selected;

    this._runSearch(false, false);

    if (st.mode === 'replace') {
      this.replaceInput.focus();
      this.replaceInput.select();
    } else {
      this.findInput.focus();
      this.findInput.select();
    }
  };

  CodeEditor.prototype.closeFind = function () {
    var st = this._find;
    st.open = false;
    st.matches = [];
    st.index = -1;
    st.total = 0;
    st.truncated = false;
    st.invalid = false;
    if (this.findBar) this.findBar.hidden = true;
    if (this.matchLayerInner) this.matchLayerInner.innerHTML = '';
    if (this.findInput) this.findInput.removeAttribute('aria-invalid');
    this._setFindMessage('');
    this._updateFindCount();
    this.textarea.focus();
  };

  CodeEditor.prototype.findNext = function () {
    if (!this._find.open) {
      this.openFind('find');
      return this._find.total > 0;
    }
    if (this._find.total === 0) {
      this._setFindMessage('无结果', 'empty');
      return false;
    }
    this._setActiveMatch(this._find.index + 1, true);
    return true;
  };

  CodeEditor.prototype.findPrev = function () {
    if (!this._find.open) {
      this.openFind('find');
      return this._find.total > 0;
    }
    if (this._find.total === 0) {
      this._setFindMessage('无结果', 'empty');
      return false;
    }
    this._setActiveMatch(this._find.index - 1, true);
    return true;
  };

  CodeEditor.prototype._expandReplacement = function (template, groups) {
    if (!this._find.regex) return template;
    return template.replace(/\$(\$|&|\d{1,2})/g, function (all, token) {
      if (token === '$') return '$';
      if (token === '&') return groups[0] || '';
      var n = parseInt(token, 10);
      return groups[n] == null ? '' : groups[n];
    });
  };

  CodeEditor.prototype.replaceOne = function () {
    var st = this._find;
    if (!st.open) this.openFind('replace');
    if (st.invalid) {
      this._setFindMessage('正则表达式无效', 'invalid');
      return false;
    }
    if (st.total === 0 || st.index < 0) {
      this._setFindMessage('无结果', 'empty');
      return false;
    }

    var match = st.matches[st.index];
    var replacement = this._expandReplacement(this.replaceInput.value, match.groups);
    this._replace(
      match.index,
      match.index + match.length,
      replacement,
      match.index + replacement.length,
      match.index + replacement.length,
      'find-replace'
    );
    this._setFindMessage('已替换 1 处', 'ok');
    return true;
  };

  CodeEditor.prototype.replaceAll = function () {
    var st = this._find;
    if (!st.open) this.openFind('replace');
    if (st.invalid) {
      this._setFindMessage('正则表达式无效', 'invalid');
      return 0;
    }
    if (st.total === 0) {
      this._setFindMessage('无结果', 'empty');
      return 0;
    }

    var count = st.total;
    var value = this.textarea.value;
    var pieces = [];
    var last = 0;
    for (var i = 0; i < st.matches.length; i += 1) {
      var match = st.matches[i];
      pieces.push(value.slice(last, match.index));
      pieces.push(this._expandReplacement(this.replaceInput.value, match.groups));
      last = match.index + match.length;
    }
    pieces.push(value.slice(last));
    var nextValue = pieces.join('');

    var ta = this.textarea;
    var scrollTop = ta.scrollTop;
    var scrollLeft = ta.scrollLeft;
    var caret = Math.min(ta.selectionStart, nextValue.length);
    ta.value = nextValue;
    ta.setSelectionRange(caret, caret);
    ta.scrollTop = scrollTop;
    ta.scrollLeft = scrollLeft;

    this._render();
    this._emitChange('find-replace-all');
    this._runSearch(false, false);
    this._setFindMessage(
      '已替换 ' + count + ' 处' + (st.truncated ? '（仅前 10000 处）' : ''),
      'ok'
    );
    return count;
  };

  CodeEditor.prototype.getFindState = function () {
    var st = this._find;
    return {
      open: st.open,
      mode: st.mode,
      regex: st.regex,
      caseSensitive: st.caseSensitive,
      term: this.findInput ? this.findInput.value : '',
      total: st.total,
      index: st.index,
      truncated: st.truncated,
      invalid: st.invalid
    };
  };

  /* ---------------- 对外方法 ---------------- */

  CodeEditor.prototype.getValue = function () {
    return this.textarea.value;
  };

  CodeEditor.prototype.setValue = function (value, options) {
    options = options || {};
    this.textarea.value = value == null ? '' : String(value);
    this.textarea.scrollTop = 0;
    this.textarea.scrollLeft = 0;
    this.textarea.setSelectionRange(0, 0);
    this._render();
    if (this._find.open && this.findInput.value) this._runSearch(false, false);
    if (!options.silent) this._emitChange('setValue');
  };

  CodeEditor.prototype.setLanguage = function (language) {
    var next = normalizeLanguage(language);
    if (!next) return false;
    this.language = next;
    this.textarea.setAttribute('aria-label', '代码编辑器（' + LABELS[next] + '）');
    this._render();
    return true;
  };

  CodeEditor.prototype.setTabSize = function (size) {
    this.tabSize = clampTabSize(size);
    this.root.style.setProperty('--lce-tab-size', String(this.tabSize));
    this._updateStatus();
    return this.tabSize;
  };

  CodeEditor.prototype.save = function () {
    if (this.options.onSave) this.options.onSave(this.textarea.value);
  };

  CodeEditor.prototype.focus = function () {
    this.textarea.focus();
  };

  CodeEditor.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;

    this.textarea.removeEventListener('input', this._onInput);
    this.textarea.removeEventListener('keydown', this._onKeyDown);
    this.textarea.removeEventListener('scroll', this._onScroll);
    this.textarea.removeEventListener('keyup', this._onCaret);
    this.textarea.removeEventListener('click', this._onCaret);
    this.textarea.removeEventListener('mouseup', this._onCaret);
    this.textarea.removeEventListener('select', this._onCaret);
    this.textarea.removeEventListener('compositionstart', this._onCompositionStart);
    this.textarea.removeEventListener('compositionend', this._onCompositionEnd);
    document.removeEventListener('selectionchange', this._onSelectionChange);
    this.root.removeEventListener('keydown', this._onRootKeyDown);
    this.findBar.removeEventListener('click', this._onFindClick);
    this.findInput.removeEventListener('input', this._onFindInput);
    this.findInput.removeEventListener('keydown', this._onFindKeyDown);
    this.replaceInput.removeEventListener('keydown', this._onReplaceKeyDown);
    this.regexToggle.removeEventListener('change', this._onFindOption);
    this.caseToggle.removeEventListener('change', this._onFindOption);

    if (this._bracketTimer) {
      clearTimeout(this._bracketTimer);
      this._bracketTimer = 0;
    }

    if (this._raf) {
      var caf = global.cancelAnimationFrame || clearTimeout;
      caf(this._raf);
      this._raf = 0;
    }

    this.root.parentNode && this.root.parentNode.removeChild(this.root);
  };

  var api = {
    version: VERSION,
    languages: ['javascript', 'json', 'css', 'html', 'markdown', 'rust', 'go', 'java'],
    defaults: { maxHighlightLines: DEFAULT_MAX_HIGHLIGHT_LINES },
    labels: LABELS,
    create: function (container, options) {
      return new CodeEditor(container, options);
    }
  };

  global.LC = global.LC || {};
  global.LC.CodeEditor = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : this);
