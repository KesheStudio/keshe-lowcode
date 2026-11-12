/* 渲染核心 · Node 侧加载器
   浏览器里按 <script> 顺序加载，Node 侧则用这个桥接文件：
   - 工程 package.json 是 "type": "module"，而渲染模块为了双击 file:// 验收必须保持经典脚本；
   - 这里用 vm 以 CommonJS 包装执行同一批文件，不复制、不改写源码。
   用法：const LC = require('./src/render/node.cjs');
        const site = LC.loadModule('./samples/site.data.js'); */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const cache = new Map();

function resolveRequest(fromFile, request) {
  if (!request.startsWith('.') && !path.isAbsolute(request)) return null;
  let target = path.isAbsolute(request) ? request : path.resolve(path.dirname(fromFile), request);
  if (!fs.existsSync(target)) {
    if (fs.existsSync(target + '.js')) target += '.js';
    else if (fs.existsSync(target + '.cjs')) target += '.cjs';
  }
  return target;
}

function loadFile(filePath) {
  const full = path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
  if (cache.has(full)) return cache.get(full).exports;

  const module = { exports: {} };
  cache.set(full, module);

  const source = fs.readFileSync(full, 'utf8');
  const wrapper = '(function (module, exports, require, __filename, __dirname) {\n' +
    source + '\n})';
  const script = new vm.Script(wrapper, { filename: full });
  const fn = script.runInThisContext();

  const localRequire = function (request) {
    /* 渲染模块自身不依赖第三方包；Node 内建模块用于读取源文件拼接浏览器包。 */
    if (request.startsWith('node:')) return require(request);
    const target = resolveRequest(full, request);
    if (!target) throw new Error('渲染模块只允许相对路径依赖：' + request);
    return loadFile(target);
  };

  fn(module, module.exports, localRequire, full, path.dirname(full));
  return module.exports;
}

const api = loadFile('./index.js');
api.loadModule = loadFile;

module.exports = api;
