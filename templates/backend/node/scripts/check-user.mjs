#!/usr/bin/env node
// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 导出前的用户区检查：语法/编译检查 + 疑似硬编码秘密告警。
// 用法：node scripts/check-user.mjs [--strict-secrets]
// 退出码：0 通过（可能带告警）；1 语法/编译失败（必须拦住导出）；2 本机缺少对应工具链。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const LANGUAGE = 'node'

const PROFILES = {
  node: {
    label: 'Node',
    customPaths: ['src/custom', 'migrations/custom', 'config.yaml', '.env', '.env.local'],
    syntaxFiles: ['src/custom']
  },
  rust: {
    label: 'Rust',
    customPaths: ['src/custom', 'migrations/custom', 'config.yaml', '.env', '.env.local'],
    syntaxFiles: []
  },
  go: {
    label: 'Go',
    customPaths: ['internal/custom', 'migrations/custom', 'config.yaml', '.env', '.env.local'],
    syntaxFiles: []
  }
}

const SECRET_RULES = [
  { name: '私钥块', regex: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED |DSA )?PRIVATE KEY-----/ },
  { name: '疑似密码', regex: /(?:password|passwd|pwd)\s*[:=]\s*["'`]?([^\s"'`,;#]{4,})/i, group: 1 },
  { name: '疑似 secret', regex: /(?:client_secret|secret|secret_key)\s*[:=]\s*["'`]?([^\s"'`,;#]{6,})/i, group: 1 },
  { name: '疑似 token / api key', regex: /(?:api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["'`]?([^\s"'`,;#]{8,})/i, group: 1 },
  { name: '带账号密码的连接串', regex: /(?:mongodb|postgres(?:ql)?|mysql|redis|amqp|mssql):\/\/[^\s/:@]+:[^\s/@]+@/i },
  { name: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: '疑似 OpenAI 风格密钥', regex: /\bsk-[A-Za-z0-9]{20,}\b/ }
]

const PLACEHOLDER = /(?:changeme|change-me|placeholder|your[-_]?password|example|dummy|^x{4,}$|^\*{3,}$|<[^>]+>|\$\{[^}]+\})/i
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yaml', '.yml', '.env',
  '.rs', '.go', '.sql', '.md', '.txt', '.toml', '.properties', '.conf', '.sh', '.cmd', '.ps1', ''
])

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const profile = PROFILES[LANGUAGE]
const strictSecrets = process.argv.includes('--strict-secrets')

let failed = false
let blocked = false
let warnings = 0

log(`语言：${profile.label}`)
log('秘密扫描：')
const scanned = scanSecrets()
log(`  扫描文件 ${scanned.files} 个，告警 ${scanned.warnings} 处`)
if (scanned.warnings > 0) {
  warnings += scanned.warnings
  if (strictSecrets) failed = true
}

log('语法/编译检查：')
checkSyntax()

if (blocked) {
  log('结果：BLOCKED（本机缺少对应工具链，未完成检查，导出应被拦住）')
  process.exit(2)
}
if (failed) {
  log('结果：FAIL（导出必须被拦住）')
  process.exit(1)
}
log(warnings > 0 ? `结果：PASS（有 ${warnings} 条告警，请人工确认）` : '结果：PASS')
process.exit(0)

// ---------------------------------------------------------------- 秘密扫描

function scanSecrets() {
  let files = 0
  let found = 0
  for (const rel of profile.customPaths) {
    const target = path.join(ROOT, rel)
    if (!fs.existsSync(target)) continue
    for (const file of walk(target)) {
      const ext = path.extname(file).toLowerCase()
      if (!TEXT_EXTENSIONS.has(ext)) continue
      if (fs.statSync(file).size > 512 * 1024) continue
      files++
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        for (const rule of SECRET_RULES) {
          const match = line.match(rule.regex)
          if (!match) continue
          if (rule.group && PLACEHOLDER.test(match[rule.group] || '')) continue
          found++
          // 只报类别与位置，绝不打印命中的内容
          warn(`  ${relative(file)}:${index + 1} 疑似硬编码：${rule.name}（内容已隐藏）`)
        }
      })
    }
  }
  return { files, warnings: found }
}

// ---------------------------------------------------------------- 语法检查

function checkSyntax() {
  if (LANGUAGE === 'node') {
    const files = profile.syntaxFiles.flatMap((rel) => {
      const target = path.join(ROOT, rel)
      if (!fs.existsSync(target)) return []
      return walk(target).filter((file) => ['.js', '.mjs', '.cjs'].includes(path.extname(file)))
    })
    if (files.length === 0) {
      log('  用户区没有 JS 文件，跳过')
      return
    }
    for (const file of files) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
      if (result.error?.code === 'ENOENT') return missingTool('node')
      if (result.status !== 0) {
        failed = true
        log(`  FAIL ${relative(file)} 语法错误`)
        log(indent(result.stderr || result.stdout))
      }
    }
    if (!failed) log(`  PASS ${files.length} 个文件语法通过`)
    return
  }

  if (LANGUAGE === 'rust') {
    const result = runTool('cargo', ['check', '--quiet'])
    if (!result) return
    if (result.status !== 0) {
      failed = true
      log('  FAIL cargo check 未通过')
      log(indent(result.stderr || result.stdout))
    } else {
      log('  PASS cargo check 通过')
    }
    return
  }

  if (LANGUAGE === 'go') {
    const result = runTool('go', ['vet', './...'])
    if (!result) return
    if (result.status !== 0) {
      failed = true
      log('  FAIL go vet 未通过')
      log(indent(result.stderr || result.stdout))
    } else {
      log('  PASS go vet 通过')
    }
    return
  }
}

function runTool(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 600000 })
  if (result.error?.code === 'ENOENT') {
    missingTool(command)
    return null
  }
  return result
}

function missingTool(name) {
  blocked = true
  log(`  BLOCKED 本机找不到 ${name}，无法完成编译检查；导出应被拦住，或先安装对应工具链`)
  return null
}

// ---------------------------------------------------------------- 工具函数

function walk(target) {
  if (!fs.existsSync(target)) return []
  if (fs.statSync(target).isFile()) return [target]
  const out = []
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (['node_modules', 'target', 'out', 'bin', 'dist', 'data', 'logs'].includes(entry.name)) continue
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function relative(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

function log(message) {
  console.log(message)
}

function warn(message) {
  console.log(`WARN${message}`)
}

function indent(text) {
  return String(text || '').trim().split(/\r?\n/).slice(0, 12).map((line) => `    ${line}`).join('\n')
}
