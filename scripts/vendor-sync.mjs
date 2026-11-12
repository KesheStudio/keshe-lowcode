import fs from 'node:fs/promises';
import path from 'node:path';
import { PLATFORM_ROOT, MARK } from './_shared.mjs';

/**
 * 把 npm 依赖中浏览器可直接加载的文件复制到 vendor/。
 * 禁止 CDN：产物与编辑器只引用 vendor/ 下的本地副本。
 */
/* mermaid 只在这里放一份本地副本；有图表块的产物一律打包，不再回退 CDN（本轮）。 */
const COPIES = [
  { from: 'jszip/dist/jszip.min.js', to: 'jszip.min.js' },
  { from: 'mermaid/dist/mermaid.min.js', to: 'mermaid.min.js', package: 'mermaid', license: 'MIT', header: true }
];

async function packageVersion(name) {
  const text = await fs.readFile(path.join(PLATFORM_ROOT, 'node_modules', name, 'package.json'), 'utf8');
  return JSON.parse(text).version;
}

async function main() {
  let copied = 0;
  for (const item of COPIES) {
    const source = path.join(PLATFORM_ROOT, 'node_modules', ...item.from.split('/'));
    const target = path.join(PLATFORM_ROOT, 'vendor', item.to);
    try {
      if (item.header) {
        const body = await fs.readFile(source, 'utf8');
        const version = await packageVersion(item.package);
        const header = `/* vendored: ${item.package}@${version} · ${item.license} · 来源 node_modules */\n`;
        await fs.writeFile(target, header + body);
      } else {
        await fs.copyFile(source, target);
      }
      console.log(`${MARK.ok} ${item.to}`);
      copied += 1;
    } catch (error) {
      console.error(`${MARK.fail} ${item.from}：${error.code === 'ENOENT' ? '依赖未安装' : error.message}`);
      console.error('  → 先运行 npm install');
      process.exit(1);
    }
  }
  console.log(`${MARK.info} 已同步 ${copied} 个 vendor 文件`);
}

main().catch((error) => {
  console.error(`${MARK.fail} ${error.message}`);
  process.exit(1);
});
