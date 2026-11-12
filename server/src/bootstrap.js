import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { recoverAllSites } from '../../src/storage/recovery.js';
import { sitesRoot } from '../../src/storage/index.js';

/**
 * 启动时准备运行环境：建目录 → 探可写 → 恢复站点事务。
 * 磁盘不可写不阻止启动，而是进入只读模式（编辑可浏览、保存禁用）。
 */
export async function prepareRuntime(paths, config) {
  const dirs = {
    data: paths.dataDir,
    sites: sitesRoot(paths.dataDir),
    exports: paths.exportsDir,
    logs: paths.logsDir
  };

  let readOnly = false;
  let readOnlyReason = '';
  try {
    for (const dir of Object.values(dirs)) {
      await fsp.mkdir(dir, { recursive: true });
    }
    await probeWritable(dirs.data);
  } catch (error) {
    readOnly = true;
    readOnlyReason = friendlyDiskError(error, dirs.data);
  }

  let siteReports = [];
  if (!readOnly) {
    try {
      siteReports = await recoverAllSites(dirs.sites, { tmpMaxAgeMs: config.storage.tmpMaxAgeMs });
    } catch (error) {
      readOnly = true;
      readOnlyReason = `站点目录恢复失败：${error.message}`;
    }
  }

  return {
    readOnly,
    readOnlyReason,
    dirs,
    siteReports,
    sitesRoot: dirs.sites
  };
}

async function probeWritable(dir) {
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  await fsp.writeFile(probe, 'ok', 'utf8');
  await fsp.unlink(probe);
}

function friendlyDiskError(error, dir) {
  if (error && (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS')) {
    return `数据目录不可写：${dir}（权限不足或被只读挂载）`;
  }
  if (error && error.code === 'ENOSPC') {
    return `磁盘空间不足：${dir}`;
  }
  return `无法准备数据目录：${dir}（${error && error.message ? error.message : '未知错误'}）`;
}

/** 启动失败写盘，供 diagnostics.html 读取；不包含密钥或堆栈全文。 */
export function writeBootError(paths, payload) {
  try {
    fs.mkdirSync(paths.logsDir, { recursive: true });
    const file = path.join(paths.logsDir, 'boot-error.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), stage: 'boot', ...payload }, null, 2),
      'utf8'
    );
    return file;
  } catch {
    return null;
  }
}

export function clearBootError(paths) {
  try {
    fs.unlinkSync(path.join(paths.logsDir, 'boot-error.json'));
  } catch {
    /* 不存在即正常 */
  }
}

export function readBootError(paths) {
  try {
    const file = path.join(paths.logsDir, 'boot-error.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 打开浏览器；失败只提示 URL，不阻断服务。 */
export function openBrowser(url) {
  const command =
    process.platform === 'win32'
      ? { file: 'cmd', args: ['/c', 'start', '', url] }
      : process.platform === 'darwin'
        ? { file: 'open', args: [url] }
        : { file: 'xdg-open', args: [url] };
  try {
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
