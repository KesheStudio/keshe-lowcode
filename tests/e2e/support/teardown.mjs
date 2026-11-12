import { cleanupStaleRoots, removeRoot } from './temp-root.mjs';

/**
 * 兜底清理：只删本轮运行自己的隔离平台根（E2E_RUN_ROOT，由 runId 决定），
 * 再顺带清理已退出轮次留下的残留目录。
 * 不读也不写任何全局状态文件——并行跑两轮时不会误删另一轮的目录。
 */
export default async function globalTeardown() {
  try {
    const root = String(process.env.LC_E2E_RUN_ROOT || '').trim();
    if (root) await removeRoot(root);
    await cleanupStaleRoots(root);
  } catch (error) {
    console.log('[E2E] 兜底清理失败（不影响用例结果）：' + (error && error.message ? error.message : error));
  }
}
