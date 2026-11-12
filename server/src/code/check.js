/* 代码覆盖 · 检查
 *
 * 统一入口：语法检查 + 最小运行验证。
 * - HTML / CSS / JS 复用渲染层的检查器（与 Builder 预览、导出渲染同一套规则）。
 * - JS 额外在 vm 里跑一次：给 root / document / fetch 假实现，禁止 require、process、Buffer。
 * - Rust / Go 只做结构检查（括号、引号、注释闭合）；真正的编译在导出时由
 *   cargo check / go vet 拦截，界面明确说明「未编译」。
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Render = require('../../../src/render/node.cjs');

const MAX_CODE_BYTES = 256 * 1024;
const RUN_TIMEOUT_MS = 600;

function lineColumnAt(text, index) {
  const source = String(text == null ? '' : text);
  const limit = Math.max(0, Math.min(index, source.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < limit; i += 1) {
    if (source.charAt(i) === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/* 结构检查：跳过字符串与注释后，括号必须成对闭合。 */
function checkStructure(source, label) {
  const text = String(source == null ? '' : source);
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  let quote = null;
  let quoteIndex = -1;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    const next = text.charAt(i + 1);
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; quoteIndex = i; i += 1; continue; }
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        const pos = lineColumnAt(text, i);
        return { message: `${label}注释没有闭合。`, line: pos.line, column: pos.column };
      }
      i = end + 2;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { stack.push({ ch, index: i }); i += 1; continue; }
    if (pairs[ch]) {
      const top = stack.pop();
      if (!top || top.ch !== pairs[ch]) {
        const pos = lineColumnAt(text, i);
        return { message: `${label}括号不匹配：多余的 ${ch}。`, line: pos.line, column: pos.column };
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  if (quote) {
    const pos = lineColumnAt(text, quoteIndex);
    return { message: `${label}字符串引号没有闭合。`, line: pos.line, column: pos.column };
  }
  if (stack.length) {
    const top = stack[stack.length - 1];
    const pos = lineColumnAt(text, top.index);
    return { message: `${label}括号没有闭合，缺少对应的 ${top.ch} 闭合符。`, line: pos.line, column: pos.column };
  }
  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* 经典脚本检查器解析不了模块级的 import / export（BLD-04）。
   模块代码改用 node --check 临时文件校验，和导出流水线保持同一套规则。 */
function checkEsModule(text) {
  const file = path.join(os.tmpdir(), 'lc-esm-' + randomUUID() + '.mjs');
  try {
    fs.writeFileSync(file, text, 'utf8');
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status === 0) return null;
    const stderr = String(result.stderr || '');
    const lineMatch = stderr.match(new RegExp(escapeRegExp(file) + ':(\\d+)'));
    const detail = stderr.split('\n').map((line) => line.trim()).find((line) => /SyntaxError|Error:/.test(line));
    return {
      message: detail || 'ESM 语法错误。',
      line: lineMatch ? Number(lineMatch[1]) : 1,
      column: 1
    };
  } finally {
    try { fs.unlinkSync(file); } catch { /* 临时文件清理失败不影响检查结果 */ }
  }
}

function scriptLanguageName(language) {
  const key = String(language || '').toLowerCase();
  if (key === 'rust' || key === 'rs') return 'Rust';
  if (key === 'go' || key === 'golang') return 'Go';
  return '代码';
}

function makeRootStub() {
  const stub = {
    tagName: 'DIV',
    className: 'lc-component',
    dataset: {},
    attributes: {},
    children: [],
    style: {},
    setAttribute(name, value) { stub.attributes[name] = String(value); },
    getAttribute(name) { return stub.attributes[name] == null ? null : stub.attributes[name]; },
    removeAttribute(name) { delete stub.attributes[name]; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild(child) { stub.children.push(child); return child; },
    insertAdjacentHTML() {},
    textContent: '',
    innerHTML: ''
  };
  return stub;
}

function makeFetchStub() {
  return function fetchStub(url) {
    return Promise.resolve({
      ok: true,
      status: 200,
      url: String(url),
      headers: { get() { return 'application/json'; } },
      json: () => Promise.resolve({ items: [] }),
      text: () => Promise.resolve('')
    });
  };
}

function runJsMinimal(code) {
  const sandbox = {
    console: {
      log() {}, info() {}, warn() {}, error() {}, debug() {}
    },
    setTimeout,
    clearTimeout,
    setInterval() { return 0; },
    clearInterval() {},
    fetch: makeFetchStub(),
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = {
    readyState: 'complete',
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) {
      return { tagName: String(tag || 'div').toUpperCase(), setAttribute() {}, appendChild() {}, style: {} };
    },
    body: { appendChild() {}, classList: { add() {}, remove() {} } }
  };
  sandbox.root = makeRootStub();
  sandbox.page = makeRootStub();
  sandbox.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  };
  vm.createContext(sandbox);
  const wrapped = '(function () {\n"use strict";\n' + code + '\n})()';
  const script = new vm.Script(wrapped, { filename: 'override-check.js' });
  script.runInContext(sandbox, { timeout: RUN_TIMEOUT_MS });
  return { ok: true, message: '已在隔离 vm 中跑通（root / fetch 为假实现，无 require / process）。' };
}

function syntaxCheck(language, code) {
  const text = String(code == null ? '' : code);
  if (text.length > MAX_CODE_BYTES) {
    return { ok: false, message: `代码超过 ${MAX_CODE_BYTES / 1024} KB，请拆到用户区文件。`, line: 1, column: 1 };
  }
  if (language === 'json') {
    try {
      JSON.parse(text);
      return { ok: true, message: 'JSON 语法正确。' };
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      const match = message.match(/position (\d+)/);
      if (match) {
        const pos = lineColumnAt(text, Number(match[1]));
        return { ok: false, message, line: pos.line, column: pos.column };
      }
      return { ok: false, message, line: 1, column: 1 };
    }
  }
  if (language === 'javascript') {
    const error = Render.checkJs(text);
    if (!error) return { ok: true, message: '语法检查通过。' };
    if (/(^|\n)\s*(?:import|export)\s/.test(text)) {
      const moduleError = checkEsModule(text);
      if (!moduleError) return { ok: true, message: '模块语法检查通过（ESM）。', module: true };
      return { ok: false, message: moduleError.message, line: moduleError.line, column: moduleError.column, module: true };
    }
    return { ok: false, message: error.message, line: error.line, column: error.column };
  }
  const checker = language === 'css' ? Render.checkCss : Render.checkHtml;
  const error = checker(text);
  return error
    ? { ok: false, message: error.message, line: error.line, column: error.column }
    : { ok: true, message: '语法检查通过。' };
}

/**
 * @param {{language?: string, code?: string, run?: boolean}} input
 * @returns {{ok: boolean, language: string, checks: Array<{id: string, status: string, message: string, line?: number, column?: number}>}}
 */
export function checkCode(input) {
  const opts = input && typeof input === 'object' ? input : {};
  let language = String(opts.language || '').toLowerCase();
  if (language === 'js') language = 'javascript';
  if (language === 'html5') language = 'html';
  const code = String(opts.code == null ? '' : opts.code);
  const checks = [];
  if (!['javascript', 'json', 'css', 'html', 'rust', 'go'].includes(language)) {
    return {
      ok: false,
      language,
      checks: [{ id: 'language', status: 'fail', message: `不支持的检查语言：${language || '(空)'}` }]
    };
  }

  if (language === 'rust' || language === 'go') {
    const label = scriptLanguageName(language);
    const structural = checkStructure(code, label);
    if (structural) {
      checks.push({ id: 'syntax', status: 'fail', message: structural.message, line: structural.line, column: structural.column });
      return { ok: false, language, checks };
    }
    checks.push({
      id: 'syntax',
      status: 'pass',
      message: `${label} 结构检查通过（括号/引号/注释闭合）。`
    });
    checks.push({
      id: 'compile',
      status: 'skipped',
      message: `${label} 未编译：导出时会做真实编译检查，界面只做结构检查，避免在编辑器里起编译进程。`
    });
    return { ok: true, language, checks };
  }

  const syntax = syntaxCheck(language, code);
  checks.push({
    id: 'syntax',
    status: syntax.ok ? 'pass' : 'fail',
    message: syntax.message,
    ...(syntax.ok ? {} : { line: syntax.line, column: syntax.column })
  });
  if (!syntax.ok) return { ok: false, language, checks };

  if (language === 'javascript' && opts.run !== false) {
    if (syntax.module) {
      checks.push({
        id: 'run',
        status: 'skipped',
        message: 'ESM 模块代码按 node --check 做语法检查，不放进经典脚本上下文执行。'
      });
    } else {
      try {
        const run = runJsMinimal(code);
        checks.push({ id: 'run', status: 'pass', message: run.message });
      } catch (error) {
        checks.push({
          id: 'run',
          status: 'fail',
          message: `最小运行失败：${error && error.message ? error.message : String(error)}`
        });
        return { ok: false, language, checks };
      }
    }
  }
  return { ok: true, language, checks };
}

export const CHECK_LANGUAGES = ['javascript', 'json', 'css', 'html', 'rust', 'go'];
