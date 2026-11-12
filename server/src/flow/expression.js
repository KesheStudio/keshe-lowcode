/* 后端积木 · 表达式 AST
 *
 * 流程里的条件、参数、模板占位符最后都要变成可执行代码，但绝不直接把用户文本
 * 拼进生成的代码。这里做两件事：
 *   1. 只允许受限语法：路径、字面量、比较、逻辑、算术、三元、下标；
 *   2. 把表达式解析成语言无关的 AST（IR 的表达式部分），再由各语言 codegen 输出。
 *
 * 禁止函数调用、赋值、模板字符串、对象/数组字面量、分号，避免生成出意料之外的语句。
 * compileExpression 是旧入口，内部等价于 parseExpression + emitJsExpression。
 */

const KEYWORDS = new Set(['true', 'false', 'null', 'undefined']);
const RESERVED_PROPS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_SOURCE = 2000;

export class ExpressionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/* ------------------------------------------------------------------ 词法 */

function tokenize(text) {
  const tokens = [];
  let i = 0;
  let depth = { paren: 0, bracket: 0 };
  let last = '';

  const push = (type, value, pos) => {
    tokens.push({ type, value, pos });
    last = type === 'op' ? value : type;
  };

  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let raw = ch;
      let closed = false;
      while (j < text.length) {
        const c = text[j];
        raw += c;
        if (c === '\\') {
          raw += text[j + 1] == null ? '' : text[j + 1];
          j += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (!closed) throw new ExpressionError('字符串没有闭合');
      push('str', raw, i);
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9._]/.test(text[j])) j += 1;
      push('num', text.slice(i, j), i);
      i = j;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j += 1;
      push('ident', text.slice(i, j), i);
      i = j;
      continue;
    }

    const three = text.slice(i, i + 3);
    if (three === '===' || three === '!==') {
      push('op', three, i);
      i += 3;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      push('op', two, i);
      i += 2;
      continue;
    }

    if (ch === '(') {
      if (last === 'ident' || last === 'property') throw new ExpressionError('不支持函数调用');
      depth.paren += 1;
      push('op', ch, i);
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth.paren -= 1;
      if (depth.paren < 0) throw new ExpressionError('括号不匹配');
      push('op', ch, i);
      i += 1;
      continue;
    }
    if (ch === '[') {
      depth.bracket += 1;
      push('op', ch, i);
      i += 1;
      continue;
    }
    if (ch === ']') {
      depth.bracket -= 1;
      if (depth.bracket < 0) throw new ExpressionError('方括号不匹配');
      push('op', ch, i);
      i += 1;
      continue;
    }
    if (['+', '-', '*', '/', '%', '!', '?', ':', '.', '<', '>'].includes(ch)) {
      if (ch === '.' && last !== 'ident' && last !== 'property' && last !== ')' && last !== ']') {
        throw new ExpressionError('属性访问前缺少变量');
      }
      push('op', ch, i);
      i += 1;
      continue;
    }
    if (ch === '=') throw new ExpressionError('不支持赋值运算符 =');
    if (ch === ',') throw new ExpressionError('不支持逗号或函数调用');
    if (ch === '{' || ch === '}') throw new ExpressionError('不支持对象字面量');
    if (ch === '`') throw new ExpressionError('不支持模板字符串');
    if (ch === ';') throw new ExpressionError('不支持分号');

    throw new ExpressionError(`不支持的字符「${ch}」`);
  }

  if (depth.paren !== 0) throw new ExpressionError('括号不匹配');
  if (depth.bracket !== 0) throw new ExpressionError('方括号不匹配');
  tokens.push({ type: 'eof', value: '', pos: text.length });
  return tokens;
}

/* ------------------------------------------------------------------ 语法 */

class Parser {
  constructor(tokens, roots) {
    this.tokens = tokens;
    this.roots = roots;
    this.index = 0;
    this.used = new Set();
  }

  peek(offset = 0) {
    return this.tokens[this.index + offset] || this.tokens[this.tokens.length - 1];
  }

  next() {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  isOp(value, offset = 0) {
    const token = this.peek(offset);
    return token.type === 'op' && token.value === value;
  }

  expectOp(value) {
    if (!this.isOp(value)) {
      if (this.peek().type === 'eof') throw new ExpressionError('表达式结尾不完整');
      throw new ExpressionError(`缺少「${value}」`);
    }
    return this.next();
  }

  parse() {
    const node = this.parseTernary();
    if (this.peek().type !== 'eof') {
      throw new ExpressionError(`多余的内容「${this.peek().value}」`);
    }
    return { ast: node, roots: [...this.used] };
  }

  parseTernary() {
    const test = this.parseBinary(1);
    if (this.isOp('?')) {
      this.next();
      const consequent = this.parseTernary();
      this.expectOp(':');
      const alternate = this.parseTernary();
      return { kind: 'ternary', test, consequent, alternate };
    }
    return test;
  }

  // 优先级：|| 1，&& 2，相等 3，比较 4，加减 5，乘除 6
  parseBinary(minPrecedence) {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      const precedence = binaryPrecedence(token);
      if (!precedence || precedence < minPrecedence) break;
      this.next();
      const right = this.parseBinary(precedence + 1);
      left = { kind: 'binary', op: token.value, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.isOp('!') || this.isOp('-')) {
      const op = this.next().value;
      return { kind: 'unary', op, operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        const token = this.next();
        if (token.type !== 'ident') {
          if (token.type === 'eof') throw new ExpressionError('表达式结尾不完整');
          throw new ExpressionError('属性访问后需要字段名');
        }
        if (RESERVED_PROPS.has(token.value)) {
          throw new ExpressionError(`不允许访问属性 ${token.value}`);
        }
        if (this.isOp('(')) throw new ExpressionError('不支持函数调用');
        node = { kind: 'member', object: node, property: token.value };
        continue;
      }
      if (this.isOp('[')) {
        this.next();
        const index = this.parseTernary();
        this.expectOp(']');
        node = { kind: 'index', object: node, index };
        continue;
      }
      if (this.isOp('(')) throw new ExpressionError('不支持函数调用');
      return node;
    }
  }

  parsePrimary() {
    const token = this.peek();
    if (token.type === 'eof') throw new ExpressionError('表达式结尾不完整');

    if (token.type === 'num') {
      this.next();
      return { kind: 'number', value: token.value };
    }
    if (token.type === 'str') {
      this.next();
      return { kind: 'string', value: token.value };
    }
    if (token.type === 'ident') {
      this.next();
      if (KEYWORDS.has(token.value)) return keywordNode(token.value);
      if (this.isOp('(')) throw new ExpressionError('不支持函数调用');
      if (!this.roots.has(token.value)) {
        throw new ExpressionError(
          `未知变量「${token.value}」；可用变量：${[...this.roots].join('、') || '（暂无）'}`
        );
      }
      this.used.add(token.value);
      return { kind: 'ref', root: token.value, segments: [] };
    }
    if (token.type === 'op' && token.value === '(') {
      this.next();
      const node = this.parseTernary();
      this.expectOp(')');
      return node;
    }
    if (token.type === 'op') {
      if (['+', '*', '/', '%', '<', '>', '.', '?', ':', '&&', '||', '==', '!=', '===', '!==', '>=', '<='].includes(token.value)) {
        throw new ExpressionError('表达式结尾不完整');
      }
      throw new ExpressionError(`不支持的字符「${token.value}」`);
    }
    throw new ExpressionError(`不支持的表达式「${token.value}」`);
  }
}

function keywordNode(word) {
  if (word === 'true' || word === 'false') return { kind: 'boolean', value: word === 'true' };
  if (word === 'null') return { kind: 'null' };
  return { kind: 'undefined' };
}

function binaryPrecedence(token) {
  if (token.type !== 'op') return 0;
  switch (token.value) {
    case '||': return 1;
    case '&&': return 2;
    case '===': case '!==': case '==': case '!=': return 3;
    case '<': case '>': case '<=': case '>=': return 4;
    case '+': case '-': return 5;
    case '*': case '/': case '%': return 6;
    default: return 0;
  }
}

/**
 * 把表达式源码解析成语言无关 AST。
 * @param {string} source 原始表达式（不含 {{ }}）
 * @param {Set<string>} roots 可用变量根
 * @returns {{ ast: object, roots: string[] }}
 */
export function parseExpression(source, roots) {
  const text = String(source == null ? '' : source).trim();
  if (!text) throw new ExpressionError('表达式为空');
  if (text.length > MAX_SOURCE) throw new ExpressionError(`表达式超过 ${MAX_SOURCE} 字符`);
  if (!(roots instanceof Set)) roots = new Set(Array.isArray(roots) ? roots : []);
  const parser = new Parser(tokenize(text), roots);
  return parser.parse();
}

/* ------------------------------------------------------------------ 输出（Node / JS） */

export function emitJsExpression(node) {
  if (!node || typeof node !== 'object') throw new ExpressionError('表达式 AST 不合法');
  switch (node.kind) {
    case 'number':
    case 'string':
      return node.value;
    case 'boolean':
      return node.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    case 'ref': {
      let code = 'scope.' + node.root;
      for (const segment of node.segments || []) {
        code += segment.kind === 'field'
          ? '.' + segment.name
          : '[' + emitJsExpression(segment.expr) + ']';
      }
      return code;
    }
    case 'member':
      return '(' + emitJsExpression(node.object) + ').' + node.property;
    case 'index':
      return '(' + emitJsExpression(node.object) + ')[' + emitJsExpression(node.index) + ']';
    case 'unary':
      return '(' + node.op + emitJsExpression(node.operand) + ')';
    case 'binary':
      return '(' + emitJsExpression(node.left) + ' ' + node.op + ' ' + emitJsExpression(node.right) + ')';
    case 'ternary':
      return '(' + emitJsExpression(node.test) + ' ? ' + emitJsExpression(node.consequent) + ' : ' + emitJsExpression(node.alternate) + ')';
    default:
      throw new ExpressionError(`未知表达式节点：${node.kind}`);
  }
}

/**
 * 编译表达式（兼容旧入口）。
 * @returns {{ code: string, roots: string[] }}
 */
export function compileExpression(source, roots) {
  const { ast, roots: used } = parseExpression(source, roots);
  return { code: emitJsExpression(ast), roots: used };
}

/* ------------------------------------------------------------------ 字段辅助 */

/**
 * 把字段值转成表达式源码。
 *   {{rows.total}}     → 表达式 rows.total
 *   20 / true          → 字面量
 *   其它纯文本          → 字符串字面量（避免把 "abc" 当变量）
 */
export function expressionSource(value) {
  const text = String(value == null ? '' : value).trim();
  const exact = /^\{\{([\s\S]+)\}\}$/.exec(text);
  if (exact) return { source: exact[1], mode: 'expression' };
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { source: text, mode: 'literal' };
  if (text === 'true' || text === 'false' || text === 'null') return { source: text, mode: 'literal' };
  return { source: JSON.stringify(String(value == null ? '' : value)), mode: 'literal' };
}

/** 找出字符串里所有 {{…}} 片段；返回 [{ raw, start, end, source }] */
export function placeholderSegments(text) {
  const out = [];
  const re = /\{\{([\s\S]+?)\}\}/g;
  let match;
  while ((match = re.exec(String(text))) !== null) {
    out.push({ raw: match[0], start: match.index, end: match.index + match[0].length, source: match[1] });
  }
  return out;
}

export function hasPlaceholder(value) {
  return typeof value === 'string' && /\{\{[\s\S]+?\}\}/.test(value);
}

export function compiledRoots(list) {
  return new Set(list);
}
