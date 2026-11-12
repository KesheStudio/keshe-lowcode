#!/usr/bin/env node
// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 生成区清单工具：让平台重新生成前能发现“用户改过生成区文件”，避免静默覆盖。
// 用法：
//   node scripts/generated-manifest.mjs create   写入 GENERATED-MANIFEST.json
//   node scripts/generated-manifest.mjs verify   检查是否有改动，输出 JSON
// verify 退出码：0 一致；3 有漂移（modified / missing / extra）；4 清单缺失或损坏。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const LANGUAGE = 'rust'
const TEMPLATE_VERSION = '0.1.0'
const MANIFEST_NAME = 'GENERATED-MANIFEST.json'

const PROFILES = {
  node: {
    generatedPaths: ['src/generated', 'src/main.js', 'migrations/generated', 'scripts', 'package.json', 'README.md', '.env.example', '.gitignore']
  },
  rust: {
    generatedPaths: ['src/generated', 'src/main.rs', 'migrations/generated', 'scripts', 'Cargo.toml', 'README.md', '.env.example', '.gitignore']
  },
  go: {
    generatedPaths: ['internal/generated', 'main.go', 'migrations/generated', 'scripts', 'go.mod', 'README.md', '.env.example', '.gitignore']
  }
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MANIFEST = path.join(ROOT, MANIFEST_NAME)
const SKIP_NAMES = new Set(['node_modules', 'target', 'out', 'bin', 'dist', MANIFEST_NAME])

const command = process.argv[2] || 'verify'
if (command === 'create') {
  create()
} else if (command === 'verify') {
  verify()
} else {
  console.error('用法：node scripts/generated-manifest.mjs <create|verify>')
  process.exit(2)
}

function create() {
  const files = collectGeneratedFiles()
  const manifest = {
    generator: 'lowcode-backend-template',
    templateVersion: TEMPLATE_VERSION,
    language: LANGUAGE,
    createdAt: new Date().toISOString(),
    files: {}
  }
  for (const rel of files) manifest.files[rel] = hash(path.join(ROOT, rel))
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`已写入 ${MANIFEST_NAME}，共 ${files.length} 个文件`)
}

function verify() {
  if (!fs.existsSync(MANIFEST)) {
    console.log(JSON.stringify({ ok: false, reason: 'missing-manifest', language: LANGUAGE }))
    process.exit(4)
  }
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  } catch (err) {
    console.log(JSON.stringify({ ok: false, reason: 'invalid-manifest', detail: err.message, language: LANGUAGE }))
    process.exit(4)
  }

  const expected = manifest.files || {}
  const current = new Set(collectGeneratedFiles())
  const modified = []
  const missing = []
  for (const [rel, digest] of Object.entries(expected)) {
    if (!current.has(rel)) {
      missing.push(rel)
    } else if (hash(path.join(ROOT, rel)) !== digest) {
      modified.push(rel)
    }
  }
  const extra = [...current].filter((rel) => !(rel in expected))

  const ok = modified.length === 0 && missing.length === 0 && extra.length === 0
  console.log(
    JSON.stringify({
      ok,
      language: LANGUAGE,
      modified,
      missing,
      extra,
      hint: ok ? '' : '生成区有改动。平台重新生成前必须让用户选择：覆盖 / 把改动迁移到 src/custom 并保留 / 取消。不要静默覆盖。'
    })
  )
  process.exit(ok ? 0 : 3)
}

function collectGeneratedFiles() {
  const out = []
  for (const rel of PROFILES[LANGUAGE].generatedPaths) {
    const target = path.join(ROOT, rel)
    if (!fs.existsSync(target)) continue
    if (fs.statSync(target).isFile()) {
      out.push(rel)
      continue
    }
    for (const file of walk(target)) out.push(file)
  }
  return out.sort()
}

function walk(target) {
  const out = []
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue
    // data/、logs/ 只在工程根目录视为运行产物；生成区源码目录必须纳入清单。
    if ((entry.name === 'data' || entry.name === 'logs') && target === ROOT) continue
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(path.relative(ROOT, full).replace(/\\/g, '/'))
  }
  return out
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
