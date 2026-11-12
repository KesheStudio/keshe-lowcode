import fs from 'node:fs/promises';
import path from 'node:path';
import { recoverTransactions, cleanStaleTemps } from './txn.js';

/**
 * 站点启动恢复：
 * 1) 回滚未完成事务；2) 清理过期临时文件；3) 校验 site.json / project.json 可解析。
 * 不加载全量页面，避免站点变大后拖慢启动。
 */
export async function recoverSite(siteDir, options = {}) {
  const tmpMaxAgeMs = options.tmpMaxAgeMs || 3600000;
  const report = { siteId: path.basename(siteDir), transactions: [], tempsRemoved: 0, warnings: [], ok: true };

  try {
    report.transactions = await recoverTransactions(siteDir);
  } catch (error) {
    report.ok = false;
    report.warnings.push({ code: 'LC_E_TXN_RECOVER', message: error.message });
  }

  try {
    report.tempsRemoved = await cleanStaleTemps(siteDir, tmpMaxAgeMs);
  } catch (error) {
    report.warnings.push({ message: error.message });
  }

  for (const file of ['site.json', 'project.json']) {
    const abs = path.join(siteDir, file);
    try {
      JSON.parse(await fs.readFile(abs, 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        report.warnings.push({ code: 'LC_E_FILE_CORRUPT', file, message: '文件缺失' });
      } else {
        report.warnings.push({ code: 'LC_E_FILE_CORRUPT', file, message: 'JSON 解析失败' });
      }
      report.ok = false;
    }
  }
  return report;
}

/** 恢复全部站点（sites 根下的直接子目录）。 */
export async function recoverAllSites(sitesRoot, options = {}) {
  let entries = [];
  try {
    entries = await fs.readdir(sitesRoot, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const reports = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    reports.push(await recoverSite(path.join(sitesRoot, entry.name), options));
  }
  return reports;
}
