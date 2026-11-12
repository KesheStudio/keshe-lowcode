import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomic.js';

/**
 * 站点级单调递增版本号。
 * 磁盘位置：<site>/.lowcode/rev.json，内容 { rev, updatedAt }。
 * 读取始终走磁盘（不缓存），保证多进程看到同一数值。
 */
export class RevStore {
  constructor(siteDir) {
    this.file = path.join(siteDir, '.lowcode', 'rev.json');
  }

  async read() {
    try {
      const text = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(text);
      const rev = Number(parsed && parsed.rev);
      return Number.isFinite(rev) && rev >= 0 ? rev : 0;
    } catch (error) {
      if (error && error.code === 'ENOENT') return 0;
      // 坏文件不阻断读写，按 0 处理，下一次提交会重写
      return 0;
    }
  }

  async bump() {
    const current = await this.read();
    const next = current + 1;
    await writeFileAtomic(
      this.file,
      JSON.stringify({ rev: next, updatedAt: new Date().toISOString() }, null, 2)
    );
    return next;
  }
}
