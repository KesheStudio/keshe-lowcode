import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EB = require('../shared/export-bundle.js');
const ET = require('../shared/export-templates.js');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const createdAt = '2026-11-08T05:30:00.000Z';
const artifactId = 'site-20261108-0530';

function readTemplateSources(templateRoot, kind) {
  const out = {};
  const absoluteRoot = path.join(root, templateRoot);
  if (!fs.existsSync(absoluteRoot)) return out;

  function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const nextRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (!ET.includedIn(kind, nextRel) && !/^(?:web|src|data|src-tauri|scripts|config|docs|migrations)$/.test(nextRel)) continue;
        walk(path.join(dir, entry.name), nextRel);
      } else if (ET.includedIn(kind, nextRel)) {
        out[templateRoot + '/' + nextRel] = fs.readFileSync(path.join(dir, entry.name));
      }
    }
  }
  walk(absoluteRoot, '');
  return out;
}

function siteFiles() {
  return { 'web/index.html': '<!doctype html><html><body>示例</body></html>' };
}

function assembleInput(files, extra) {
  return Object.assign({
    target: 'web-static',
    artifactId,
    createdAt,
    project: { id: 'site-1', name: '示例站点', config: {} },
    files,
    backend: { language: 'none' }
  }, extra || {});
}

test('planTemplates：按目标与后端语言给出映射规则与必需文件', () => {
  const web = ET.planTemplates({ target: 'web-static', backend: { language: 'rust' } });
  assert.equal(web.rules.length, 3);
  assert.equal(web.rules[0].root, 'templates/backend/rust');
  assert.equal(web.rules.some((rule) => rule.kind === 'deploy-scripts'), true);
  assert.equal(web.rules.some((rule) => rule.kind === 'deploy-docs'), true);
  assert.equal(web.required.includes('server/src/main.rs'), true);
  assert.equal(web.required.includes('deploy/scripts/install.sh'), true);
  assert.equal(web.configCandidates[0], 'templates/backend/rust/config.generated.yaml');

  const desktop = ET.planTemplates({ target: 'tauri-desktop', backend: { language: 'none' } });
  assert.equal(desktop.rules.some((rule) => rule.kind === 'tauri'), true);
  assert.equal(desktop.required.includes('desktop/src-tauri/tauri.conf.json'), true);
  assert.equal(desktop.required.includes('web/desktop-config.js'), true);
});

test('装配真实 Node 后端模板：排除 node_modules 与运行库，标注用户/平台文件', async () => {
  const sources = readTemplateSources('templates/backend/node', 'backend-node');
  Object.assign(sources, readTemplateSources('templates/deploy/scripts', 'deploy-scripts'));
  sources['templates/deploy/README.md'] = fs.readFileSync(path.join(root, 'templates/deploy/README.md'));
  sources['templates/backend/config.example.yaml'] = fs.readFileSync(path.join(root, 'templates/backend/config.example.yaml'));
  const plan = ET.planTemplates({ target: 'web-static', backend: { language: 'node' } });
  const result = ET.applyTemplates({ plan, sources, files: siteFiles() });

  assert.equal(result.files['server/package.json'] != null, true);
  assert.equal(result.files['server/package-lock.json'] != null, true);
  assert.equal(result.files['server/src/main.js'] != null, true);
  assert.equal(result.files['server/node_modules/fastify/package.json'], undefined);
  assert.equal(result.files['server/data/app.db'], undefined);
  assert.equal(result.files['server/.env.example'] != null, true);
  assert.equal(result.files['deploy/backend/config.generated.yaml'] != null, true);
  assert.equal(result.files['deploy/backend/config.yaml'] != null, true);

  assert.equal(result.ownership.user.includes('server/src/custom/handlers/items.js'), true);
  assert.equal(result.ownership.platform.includes('server/src/generated/routes/health.js'), true);
  assert.equal(result.ownership.user.includes('server/migrations/custom/README.md'), true);
  assert.equal(result.ownership.user.includes('deploy/backend/config.yaml'), true);
  assert.equal(result.ownership.platform.includes('deploy/backend/config.generated.yaml'), true);
  assert.equal(result.ownership.merged.length, 0);

  const manifest = await EB.assemble(assembleInput(result.files, {
    backend: { language: 'node', maturity: 'full', database: 'sqlite' },
    templateRequired: result.required,
    ownership: result.ownership,
    warnings: result.warnings
  }));

  assert.equal(manifest.ok, true, JSON.stringify(manifest.failures));
  assert.equal(manifest.manifest.checks.find((item) => item.id === 'template-integrity').status, 'pass');
  assert.equal(manifest.manifest.checks.find((item) => item.id === 'lockfile-present').status, 'pass');
  assert.equal(manifest.manifest.checks.find((item) => item.id === 'backend-config-valid').status, 'pass');
  assert.equal(manifest.manifest.size.byCategory.server > 0, true);
  assert.equal(manifest.manifest.ownership.user.includes('server/src/custom/handlers/items.js'), true);
});

test('装配真实 Rust 模板的配置底稿，并保留独立 config.yaml 覆盖位', () => {
  const sources = readTemplateSources('templates/backend/rust', 'backend-rust');
  sources['templates/backend/config.example.yaml'] = fs.readFileSync(path.join(root, 'templates/backend/config.example.yaml'));
  const plan = ET.planTemplates({ target: 'web-static', backend: { language: 'rust' } });
  const result = ET.applyTemplates({ plan, sources, files: siteFiles() });

  assert.equal(result.files['server/Cargo.toml'] != null, true);
  assert.equal(result.files['server/config.generated.yaml'], undefined);
  assert.equal(result.files['server/config.yaml'], undefined);
  assert.equal(result.files['deploy/backend/config.generated.yaml'] != null, true);
  assert.equal(result.files['deploy/backend/config.yaml'] != null, true);
  assert.equal(result.files['server/src/custom/routes.rs'] != null, true);
  assert.equal(result.ownership.user.includes('server/src/custom/routes.rs'), true);
});

test('装配 Tauri 模板：desktop/ 工程 + web/desktop-config.js，跳过占位页与 gen 缓存', async () => {
  const tauriSources = readTemplateSources('templates/tauri', 'tauri');
  const signingSources = readTemplateSources('templates/signing', 'signing');
  const sources = Object.assign({}, tauriSources, signingSources);
  const plan = ET.planTemplates({ target: 'tauri-desktop', backend: { language: 'none' } });
  const result = ET.applyTemplates({ plan, sources, files: siteFiles() });

  assert.equal(result.files['desktop/src-tauri/tauri.conf.json'] != null, true);
  assert.equal(result.files['desktop/src-tauri/Cargo.toml'] != null, true);
  assert.equal(result.files['desktop/package.json'] != null, true);
  assert.equal(result.files['desktop/web/index.html'], undefined);
  assert.equal(result.files['web/desktop-config.js'] != null, true);
  assert.equal(result.files['desktop/src-tauri/gen/schemas/desktop-schema.json'], undefined);
  assert.equal(result.files['deploy/signing/README.md'] != null, true);

  const manifest = await EB.assemble(assembleInput(result.files, {
    target: 'tauri-desktop',
    templateRequired: result.required,
    ownership: result.ownership,
    warnings: result.warnings
  }));
  assert.equal(manifest.ok, true, JSON.stringify(manifest.failures));
  assert.equal(manifest.manifest.entry, 'web/index.html');
  assert.equal(manifest.manifest.checks.find((item) => item.id === 'template-integrity').status, 'pass');
});

test('模板缺文件时 template-integrity 失败，而不是静默产出半个工程', async () => {
  const plan = ET.planTemplates({ target: 'web-static', backend: { language: 'go' } });
  const result = ET.applyTemplates({ plan, sources: {}, files: siteFiles() });
  assert.equal(result.warnings.some((item) => item.code === 'LC_W_TEMPLATE_MISSING'), true);

  const manifest = await EB.assemble(assembleInput(result.files, {
    backend: { language: 'go', maturity: 'usable', database: 'sqlite' },
    templateRequired: result.required,
    warnings: result.warnings
  }));
  assert.equal(manifest.ok, false);
  assert.equal(manifest.checks.find((item) => item.id === 'template-integrity').status, 'fail');
  assert.equal(manifest.checks.find((item) => item.id === 'backend-config-valid').status, 'fail');
});

test('模板不覆盖调用方已有的用户文件；敏感文件名被排除', () => {
  const sources = {
    'templates/backend/node/package.json': '{"name":"template"}',
    'templates/backend/node/.env': 'PASSWORD=secret',
    'templates/backend/node/data/app.db': 'db',
    'templates/signing/windows/keys/test.pfx': 'binary',
    'templates/signing/README.md': '# signing'
  };
  const plan = ET.planTemplates({ target: 'web-static', backend: { language: 'node' } });
  const files = { 'server/package.json': '{"name":"user"}' };
  const result = ET.applyTemplates({ plan, sources, files });

  assert.equal(result.files['server/package.json'], '{"name":"user"}');
  assert.equal(result.files['server/.env'], undefined);
  assert.equal(result.files['server/data/app.db'], undefined);
  assert.equal(result.files['deploy/signing/windows/keys/test.pfx'], undefined);
  assert.equal(result.warnings.some((item) => item.code === 'LC_W_TEMPLATE_COLLISION'), true);
});

test('浏览器分支：加载三个共享模块后模板计划可用', () => {
  const names = ['export-bundle.js', 'export-assets.js', 'export-templates.js'];
  const sandbox = { TextEncoder, TextDecoder, crypto: globalThis.crypto, console };
  vm.createContext(sandbox);
  for (const name of names) {
    const source = fs.readFileSync(new URL('../shared/' + name, import.meta.url), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'shared/' + name });
  }

  const browserET = sandbox.LC.ExportTemplates;
  assert.equal(typeof browserET.planTemplates, 'function');
  const plan = browserET.planTemplates({ target: 'tauri-desktop', backend: { language: 'none' } });
  assert.equal(plan.rules.some((rule) => rule.kind === 'tauri'), true);
});
