import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Mermaid = require('../shared/mermaid.js');

const fence = ['说明', '```mermaid', 'graph TD; A-->B;', '```', '收尾'].join('\n');

test('识别 mermaid / mmd 围栏，不误判普通文本', () => {
  assert.equal(Mermaid.hasMermaid(fence), true);
  assert.equal(Mermaid.hasMermaid('```mmd\ngraph LR\n```'), true);
  assert.equal(Mermaid.hasMermaid('```js\nconsole.log(1)\n```'), false);
  assert.equal(Mermaid.hasMermaid('普通正文提到 mermaid 但没有围栏'), false);
  assert.equal(Mermaid.isFenceLang('MERMAID'), true);
  assert.equal(Mermaid.isFenceLang('mmd'), true);
  assert.equal(Mermaid.isFenceLang('markdown'), false);
});

test('站点 JSON 任意层级命中围栏', () => {
  assert.equal(Mermaid.hasMermaidInSite({ pages: [{ blocks: [{ markdown: fence }] }] }), true);
  assert.equal(Mermaid.hasMermaidInSite({ pages: [{ blocks: [{ markdown: '普通内容' }] }] }), false);
});

test('代码块输出带标记且转义 HTML', () => {
  const html = Mermaid.renderCode('graph TD;\nA["<b>x</b>"] --> B;');
  assert.match(html, /^<div class="lc-mermaid" data-lc-mermaid="true" data-lc-mermaid-status="pending">/);
  assert.match(html, /data-lc-mermaid-source/);
  assert.match(html, /data-lc-mermaid-canvas/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.equal(html.includes('<b>'), false);
  assert.equal(Mermaid.hasMermaidMarkup(html), true);
  assert.equal(Mermaid.hasMermaidMarkup('<pre><code>普通</code></pre>'), false);
});

test('注入给渲染层的 codeRenderers 覆盖 mermaid 与 mmd', () => {
  const renderers = Mermaid.codeRenderers();
  assert.deepEqual(Object.keys(renderers).sort(), ['mermaid', 'mmd']);
  assert.equal(renderers.mermaid('graph TD'), renderers.mmd('graph TD'));
  assert.equal(Mermaid.bootstrap().includes('lib.render'), true);
  assert.equal(Mermaid.bootstrap().includes('data-lc-mermaid-source'), true);
  assert.equal(Mermaid.bootstrap().includes('data-lc-mode'), true);
});
