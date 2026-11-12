#!/usr/bin/env node
/* 后端积木 · 纵向切片自检
 *
 * 节点树：入口 GET /api/items → 中间件（CORS、日志）→ 读取集合 items → 返回 JSON
 * 完整跑一遍：校验 → 生成区代码 → 迁移隔离库 → 灌数据 → 启动服务（127.0.0.1 随机端口）
 * → 真实 HTTP 请求 → 断言 200 与数据 → 停止并删除临时目录。
 *
 * 数据库只用临时目录里的 SQLite 文件（随机名），不读站点配置，也不连接本机的
 * 3306 / 6379 / 5432。跑完即毁。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleFlow } from '../server/src/flow/nodes.js';
import { startPreview, stopPreview, requestPreview } from '../server/src/flow/preview.js';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteId = 'lc-tmp-flow-slice';
const target = ['node', 'rust', 'go'].includes(process.argv[2]) ? process.argv[2] : 'node';
const GENERATED = {
  node: [
    'src/generated/flows/runtime.js',
    'src/generated/flows/main.js',
    'src/generated/routes/flows.js',
    'src/generated/routes/index.js',
    'src/generated/flows/manifest.json'
  ],
  rust: [
    'src/generated/flows/runtime.rs',
    'src/generated/flows/mod.rs',
    'src/generated/flows/main.rs',
    'src/generated/flows/main.ir.json',
    'src/generated/flows/manifest.json'
  ],
  go: [
    'internal/generated/flows/runtime.go',
    'internal/generated/flows/main.go',
    'internal/generated/flows/register.go',
    'internal/generated/flows/main.ir.json',
    'internal/generated/flows/manifest.json'
  ]
};

function log(step, detail = '') {
  console.log(`\n[${step}]${detail ? ' ' + detail : ''}`);
}

function assert(condition, message) {
  if (!condition) throw new Error('断言失败：' + message);
}

const items = [
  { id: 'row-1', name: '积木一号', price: 12, tag: 'demo' },
  { id: 'row-2', name: '积木二号', price: 34, tag: 'demo' },
  { id: 'row-3', name: '积木三号', price: 56, tag: 'demo' }
];

/** 覆盖流程：文件读写、变换、循环、分支、写入集合、限流、JSON 响应。 */
function coverageFlow(site) {
  return {
    site,
    schemaVersion: 1,
    language: 'node',
    flow: {
      id: 'main',
      name: '覆盖验证',
      treeVersion: 0,
      root: {
        id: 'root',
        type: 'flow.root',
        children: [
          { id: 'entry', type: 'entry.request', params: { method: 'POST', path: '/api/coverage', params: [] } },
          { id: 'cors', type: 'middleware.cors', params: { origins: '*', credentials: false, maxAgeSeconds: 600 } },
          { id: 'rate', type: 'middleware.rateLimit', params: { rps: 1000, burst: 5000, keyBy: 'ip' } },
          { id: 'log', type: 'middleware.log', params: { level: 'info', skipHealth: true } },
          {
            id: 'write_note', type: 'file.write',
            params: { path: 'out/note.txt', content: 'seed-note', append: false }
          },
          {
            id: 'read_note', type: 'file.read',
            params: { path: 'out/note.txt', encoding: 'utf8', output: 'note' }
          },
          {
            id: 'read_rows', type: 'db.readCollection',
            params: { collection: 'items', page: '', pageSize: '20', q: '', sort: '', fields: '', output: 'rows' }
          },
          {
            id: 'pick', type: 'data.transform',
            params: { mode: 'pick', input: '{{rows.items}}', fields: 'id,name', template: '', output: 'picked' }
          },
          {
            id: 'collect_names', type: 'flow.loop',
            params: {
              source: '{{picked}}',
              itemVar: 'item',
              maxIterations: 100,
              collect: '{{item.name}}',
              output: 'names'
            },
            children: []
          },
          {
            id: 'insert', type: 'db.insertCollection',
            params: { collection: 'items', body: '{{request.body}}', output: 'created' }
          },
          {
            id: 'branch', type: 'flow.branch',
            params: { condition: '{{rows.total > 0}}' },
            children: [
              {
                id: 'write_result', type: 'file.write',
                params: { path: 'out/coverage.txt', content: '{{note}}', append: false }
              }
            ],
            elseChildren: []
          },
          {
            id: 'shape', type: 'data.transform',
            params: {
              mode: 'template',
              input: '{{rows.items}}',
              fields: '',
              template: '{"note":"{{note}}","total":"{{rows.total}}"}',
              output: 'payload'
            }
          },
          {
            id: 'respond', type: 'response.json',
            params: {
              status: 200,
              body: '{"note":"{{note}}","total":"{{rows.total}}","names":"{{names}}","createdId":"{{created.id}}","shaped":"{{payload}}"}',
              headers: '{}'
            }
          }
        ]
      }
    },
    settings: { configCenter: { definitions: [], values: {} } }
  };
}

async function main() {
  const siteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-tmp-flow-'));
  log('临时站点', siteDir);
  let preview = null;
  try {
    await fs.mkdir(path.join(siteDir, 'data', 'collections'), { recursive: true });
    await fs.writeFile(
      path.join(siteDir, 'data', 'collections', 'items.json'),
      JSON.stringify({
        id: 'items',
        name: '物品',
        fields: [
          { id: 'name', name: '名称', type: 'text' },
          { id: 'price', name: '价格', type: 'number' },
          { id: 'tag', name: '标签', type: 'text' }
        ],
        rows: items
      }, null, 2) + '\n',
      'utf8'
    );

    const flowDoc = sampleFlow(siteId);
    preview = await startPreview({ paths: { platformRoot }, siteId, siteDir, flowDoc, target });
    log('预览已启动', `${target} ${preview.url} 端口=${preview.port} 灌入 ${preview.seeded} 行 treeVersion=${preview.treeVersion}`);

    const generated = GENERATED[target];
    for (const rel of generated) {
      const stat = await fs.stat(path.join(preview.buildDir, rel)).catch(() => null);
      assert(stat && stat.isFile(), `生成文件缺失：${rel}`);
    }
    log('生成区文件齐全', generated.join(', '));

    const manifest = JSON.parse(await fs.readFile(path.join(preview.buildDir, 'GENERATED-MANIFEST.json'), 'utf8'));
    assert(manifest.flows && manifest.flows.treeVersion === preview.treeVersion, '清单未记录节点树版本');
    assert(manifest.flows.treeHash === preview.treeHash, '清单节点树哈希不一致');
    log('清单元数据', `treeVersion=${manifest.flows.treeVersion} treeHash=${manifest.flows.treeHash} entry=${manifest.flows.entry.method} ${manifest.flows.entry.path}`);

    const response = await requestPreview(siteId, { method: 'GET', path: '/api/items', target });
    log('真实请求', `GET /api/items → ${response.status}（${response.ms}ms）`);
    console.log(response.body.slice(0, 600));

    assert(response.status === 200, `期望 200，实际 ${response.status}`);
    const body = JSON.parse(response.body);
    assert(Array.isArray(body.items), '响应缺少 items 数组');
    assert(body.items.length === items.length, `期望 ${items.length} 行，实际 ${body.items.length}`);
    assert(body.total === items.length, `期望 total=${items.length}，实际 ${body.total}`);
    assert(body.items.some((item) => item.name === items[0].name), '第一行数据不正确');

    const paged = await requestPreview(siteId, { method: 'GET', path: '/api/items?pageSize=2', target });
    const pagedBody = JSON.parse(paged.body);
    assert(paged.status === 200 && pagedBody.items.length === 2 && pagedBody.total === 3, '分页参数没有生效');
    log('分页校验通过', `GET /api/items?pageSize=2 → ${pagedBody.items.length} 行 / total ${pagedBody.total}`);

    // 第二轮：文件读写、数据变换、条件分支、循环、写入集合、限流与 JSON 响应。
    await stopPreview(siteId, target);
    preview = await startPreview({ paths: { platformRoot }, siteId, siteDir, flowDoc: coverageFlow(siteId), target });
    log('覆盖流程已启动', `${target} ${preview.url}`);

    const registered = await requestPreview(siteId, {
      method: 'POST',
      path: '/api/auth/register',
      headers: { 'content-type': 'application/json' },
      body: { username: 'lcverify', password: 'Lc-verify-123456', displayName: '覆盖验证' },
      target
    });
    assert(registered.status === 201, `注册测试账号失败：${registered.status} ${registered.body}`);
    const registeredBody = JSON.parse(registered.body);
    const tokens = registeredBody.data || registeredBody;
    assert(tokens.accessToken, '注册没有返回 accessToken');

    const coverage = await requestPreview(siteId, {
      method: 'POST',
      path: '/api/coverage',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.accessToken}` },
      body: { name: '覆盖验证' },
      target
    });
    log('覆盖请求', `POST /api/coverage → ${coverage.status}（${coverage.ms}ms）`);
    console.log(coverage.body.slice(0, 600));
    assert(coverage.status === 200, `覆盖流程期望 200，实际 ${coverage.status}`);
    const covered = JSON.parse(coverage.body);
    assert(covered.note === 'seed-note', '文件写入后读取不一致');
    assert(covered.total === items.length, '集合读取结果不正确');
    assert(Array.isArray(covered.names) && covered.names.length === items.length, '循环收集结果不正确');
    assert(covered.names.includes(items[0].name), '循环表达式没有读到当前项');
    assert(covered.createdId, '写入集合没有返回新行');
    const writtenFile = path.join(preview.buildDir, 'data', 'files', 'out', 'coverage.txt');
    const written = await fs.readFile(writtenFile, 'utf8').catch(() => '');
    assert(written === 'seed-note', `分支里的文件写入不正确：${written}`);
    log('覆盖通过', 'file.write/file.read · db.read/db.insert · data.pick/data.template · branch · loop · rateLimit · response.json');

    log('通过', `生成目录：${preview.buildDir}`);
    console.log(JSON.stringify({
      ok: true,
      target,
      siteId,
      url: preview.url,
      treeVersion: manifest.flows.treeVersion,
      treeHash: manifest.flows.treeHash,
      generatedFiles: generated,
      rows: body.items.length,
      coverage: {
        note: covered.note,
        total: covered.total,
        names: covered.names,
        createdId: covered.createdId
      }
    }, null, 2));
  } finally {
    if (preview) await stopPreview(siteId, target).catch(() => {});
    await fs.rm(siteDir, { recursive: true, force: true }).catch(() => {});
    log('已清理', siteDir);
  }
}

main().catch((err) => {
  console.error('\n[失败] ' + err.message);
  if (err.issues) console.error(JSON.stringify(err.issues, null, 2));
  process.exitCode = 1;
});
