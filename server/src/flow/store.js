/* 后端积木 · 流程文档与用户区读写
 *
 * 存放位置与现有后端三区结构保持一致：
 *   data/sites/<siteId>/backend/node/_flow/flow.json     流程文档（站点源数据）
 *   data/sites/<siteId>/backend/node/src/custom/...      用户代码（代码节点也在这里）
 * 生成区只在编译产物里写（backend-build/node/src/generated），不会回写站点源码。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { USER_ZONES, isUserZonePath } from '../code/zones.js';
import { defaultFlow, sampleFlow, codeFileFor, codeTemplate, FLOW_LANGUAGE } from './nodes.js';

export function normalizeLanguage(value) {
  const key = String(value || FLOW_LANGUAGE).toLowerCase();
  return key === 'node' ? 'node' : '';
}

export function flowFilePath(siteDir, language) {
  return path.join(siteDir, 'backend', language, '_flow', 'flow.json');
}

export async function readFlow(siteDir, siteId, language = FLOW_LANGUAGE) {
  const file = flowFilePath(siteDir, language);
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { doc: defaultFlow(siteId, language), file, exists: false };
    throw err;
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    const error = new Error(`流程文件解析失败：${file}（${err.message}）`);
    error.statusCode = 422;
    error.code = 'LC_E_FLOW_JSON';
    throw error;
  }
  if (!doc || typeof doc !== 'object' || !doc.flow || typeof doc.flow !== 'object') {
    const error = new Error(`流程文件结构不合法：${file}`);
    error.statusCode = 422;
    error.code = 'LC_E_FLOW_SHAPE';
    throw error;
  }
  return { doc, file, exists: true };
}

function assertFlowShape(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throwObject('流程文档必须是对象');
  if (doc.language !== 'node') throwObject('当前只支持 Node 后端');
  if (!doc.flow || typeof doc.flow !== 'object') throwObject('缺少 flow');
  if (doc.flow.id !== 'main') throwObject('流程 id 必须是 main');
  if (!doc.flow.root || typeof doc.flow.root !== 'object') throwObject('缺少 flow.root');
  if (!Array.isArray(doc.flow.root.children)) throwObject('flow.root.children 必须是数组');
  if (JSON.stringify(doc).length > 2 * 1024 * 1024) throwObject('流程文档超过 2 MB');
}

function throwObject(message) {
  const error = new Error(message);
  error.statusCode = 422;
  error.code = 'LC_E_FLOW_SHAPE';
  throw error;
}

export async function saveFlow(siteDir, siteId, language, doc) {
  assertFlowShape(doc);
  const file = flowFilePath(siteDir, language);
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const payload = {
    ...doc,
    siteId,
    language,
    updatedAt: new Date().toISOString()
  };
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
  return { doc: payload, file };
}

/** 站点后端用户区文件清单（与代码编辑器、导出使用同一份白名单）。 */
export async function listUserFiles(siteDir, language) {
  const zone = USER_ZONES[language];
  if (!zone) return [];
  const root = path.join(siteDir, 'backend', language);
  const out = [];
  const walk = async (dir, prefix) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile() && isUserZonePath(zone, rel)) {
        out.push({ rel, abs: path.join(root, rel) });
      }
    }
  };
  await walk(root, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** 读取站点集合定义（含可能存在的 rows，用于预览时灌入隔离库）。 */
export async function readCollections(siteDir) {
  const dir = path.join(siteDir, 'data', 'collections');
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf8'));
      const id = String(raw.id || entry.name.replace(/\.json$/i, '')).toLowerCase();
      out.push({ id, fileName: entry.name, json: raw, rows: Array.isArray(raw.rows) ? raw.rows : [] });
    } catch {
      // 单个集合损坏不阻塞流程编译；后端启动时会自行告警。
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function ensureCodeFile(siteDir, language, flowId, nodeId, label, codeLanguage = 'node') {
  const rel = codeFileFor(flowId, nodeId, codeLanguage);
  const abs = path.join(siteDir, 'backend', language, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fs.writeFile(abs, codeTemplate(flowId, nodeId, label), { encoding: 'utf8', flag: 'wx' });
    return { rel, created: true };
  } catch (err) {
    if (err.code === 'EEXIST') return { rel, created: false };
    throw err;
  }
}

export { defaultFlow, sampleFlow };
