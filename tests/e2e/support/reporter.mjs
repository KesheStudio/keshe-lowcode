/* 发布前自检摘要：跑完在终端给一段人话结论，一眼看出能不能发布。
   只做汇总展示，不改变用例结果，也不依赖任何外部服务。 */

function stripAnsi(value) {
  return String(value == null ? '' : value).replace(/\u001b\[[0-9;]*m/g, '');
}

function firstLine(value) {
  return stripAnsi(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0] || '未知原因';
}

function reasonOf(result) {
  const errors = (result && result.errors) || [];
  const first = errors[0];
  if (first && first.message) return firstLine(first.message);
  if (result && result.error && result.error.message) return firstLine(result.error.message);
  if (result && result.status === 'timedOut') return '用例超时';
  if (result && result.status === 'interrupted') return '用例被中断';
  return '未知原因';
}

function isFailed(status) {
  return status !== 'passed' && status !== 'skipped';
}

/* 用例标题以 [页面名] 开头；汇总时按页面归组，方便一处一处看失败。 */
function pageOf(title) {
  const match = String(title || '').match(/^\[([^\]]+)\]/);
  return match ? match[1] : '未归组';
}

function titleWithoutPage(title) {
  return String(title || '').replace(/^\[[^\]]+\]\s*/, '');
}

/* 报告路径：并行跑多轮时每轮用 LC_E2E_REPORT_DIR 各写各的，这里跟着显示对应目录。 */
function reportPath() {
  const dir = String(process.env.LC_E2E_REPORT_DIR || '').trim();
  return (dir ? dir.replace(/\\/g, '/') : 'tests/e2e/.report') + '/index.html';
}

export default class ReleaseCheckReporter {
  constructor() {
    this.failures = [];
    this.passed = 0;
    this.skipped = 0;
    this.total = 0;
    this.startedAt = Date.now();
  }

  onBegin(config, suite) {
    this.total = suite.allTests().length;
    this.startedAt = Date.now();
  }

  onTestEnd(test, result) {
    if (result.status === 'passed') {
      this.passed += 1;
      return;
    }
    if (result.status === 'skipped') {
      this.skipped += 1;
      return;
    }
    if (isFailed(result.status)) {
      this.failures.push({
        title: test.title,
        page: pageOf(test.title),
        file: test.location && test.location.file ? test.location.file : '',
        reason: reasonOf(result)
      });
    }
  }

  onEnd(result) {
    const seconds = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const failed = this.failures.length;
    const lines = [];

    lines.push('');
    lines.push('──────── 发布前自检 ────────');
    if (this.total === 0) {
      lines.push('没有匹配到任何用例，本次未执行检查。');
      lines.push('提示：检查 --grep 的筛选条件，或用 npm run e2e 跑全量。');
      lines.push('结论：未执行，不能据此判断可以发布');
      console.log(lines.join('\n'));
      return;
    }

    lines.push('用例总数：' + this.total + '    通过：' + this.passed + '    失败：' + failed +
      (this.skipped ? '    跳过：' + this.skipped : ''));
    lines.push('耗时：' + seconds + ' 秒');

    if (failed) {
      lines.push('结论：不能发布');
      lines.push('失败用例（按页面归组）：');
      const groups = new Map();
      this.failures.forEach((item) => {
        const page = item.page || '未归组';
        if (!groups.has(page)) groups.set(page, []);
        groups.get(page).push(item);
      });
      let index = 0;
      groups.forEach((items, page) => {
        lines.push('  ' + page + '（' + items.length + ' 条）');
        items.forEach((item) => {
          index += 1;
          lines.push('    ' + index + '. ' + titleWithoutPage(item.title));
          if (item.file) {
            lines.push('       位置：' + item.file.replace(/\\/g, '/').split('/tests/e2e/').pop());
          }
          lines.push('       原因：' + item.reason);
        });
      });
      lines.push('失败截图与上下文已附在报告里：' + reportPath());
    } else {
      lines.push('结论：可以发布（全部用例通过）');
      lines.push('报告：' + reportPath());
    }
    lines.push('──────────────────────────');
    console.log(lines.join('\n'));
  }

  onError(error) {
    console.log('[发布前自检] 运行期错误：' + firstLine(error && error.message ? error.message : error));
  }
}
