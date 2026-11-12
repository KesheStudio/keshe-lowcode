import { test, expect } from '../support/fixtures.mjs';
import { PLATFORM_ROOT } from '../support/config.mjs';
import { startStaticServer } from '../support/static-server.mjs';

/* 表单组件是渲染核心的交互能力，官方浏览器验收页就是 src/render/demo.html：
   它按页面加载真实组件脚本并调用 enhanceComponents，和导出包里的组件实现同源。 */
test('表单组件：浮动标签、验证码粘贴、日期范围、滑块、自动补全都可交互', async ({ page, context, artifacts }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const server = await startStaticServer(PLATFORM_ROOT);
  try {
    await page.goto(server.base + '/src/render/demo.html');

    /* ---------- 文本框：浮动标签 + 字数 + 清除 + 错误态 ---------- */
    await page.selectOption('#page-select', 'page-textfield');
    const floating = page.locator('[data-lc-block="tf-floating"]');
    await expect(floating).toBeVisible();
    const input = floating.locator('[data-lc-textfield-input]');
    const floatLabel = floating.locator('.lc-ui-textfield-float');
    const count = floating.locator('.lc-ui-textfield-count');

    const fontBefore = await floatLabel.evaluate((el) => getComputedStyle(el).fontSize);
    await input.focus();
    await expect.poll(
      async () => floatLabel.evaluate((el) => getComputedStyle(el).fontSize),
      { message: '聚焦后浮动标签应上浮（字号变小）' }
    ).not.toBe(fontBefore);

    await expect(count, '初始字数应为 0 / 40').toHaveText('0 / 40');
    await input.fill('e2e@example.com');
    await expect(count, '输入后字数应同步').toHaveText('15 / 40');

    const affix = page.locator('[data-lc-block="tf-affix"]');
    const clear = affix.locator('[data-lc-textfield-clear]');
    await expect(clear, '有内容时清除按钮应出现').toBeVisible();
    await clear.click();
    await expect(affix.locator('[data-lc-textfield-input]'), '点清除后输入框应为空').toHaveValue('');
    await expect(affix.locator('.lc-ui-textfield-count')).toHaveText('0 / 10');

    await expect(
      page.locator('[data-lc-block="tf-error"] .lc-ui-textfield-error'),
      '错误态应显示错误文案'
    ).toHaveText('格式不正确：需要包含 @ 的邮箱地址。');

    /* ---------- 验证码：整段粘贴自动分格 ---------- */
    await page.selectOption('#page-select', 'page-otp');
    const otp = page.locator('[data-lc-block="otp-numeric"]');
    await expect(otp.locator('[data-lc-otp-cell]'), '验证码应有 6 个输入格').toHaveCount(6);
    await otp.locator('[data-lc-otp-cell="0"]').evaluate((cell) => {
      var event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: function () { return '246810'; } }
      });
      cell.dispatchEvent(event);
    });
    for (let i = 0; i < 6; i += 1) {
      await expect(otp.locator('[data-lc-otp-cell="' + i + '"]'), '第 ' + (i + 1) + ' 格应被粘贴填上')
        .toHaveValue('246810'[i]);
    }
    await expect(otp.locator('[data-lc-otp-copy]'), '验证码应提供整体复制按钮').toBeVisible();

    /* ---------- 日期范围：打开日历后点快捷项 ---------- */
    await page.selectOption('#page-select', 'page-date');
    const range = page.locator('[data-lc-block="date-range"]');
    await expect(range.locator('.lc-ui-date')).toHaveAttribute('data-mode', 'range');
    await range.locator('[data-lc-date-toggle]').click();
    await range.locator('[data-lc-date-shortcut="last7"]').click();
    const dateInputs = range.locator('[data-lc-date-input]');
    await expect(dateInputs, '日期范围应有两个输入框').toHaveCount(2);
    await expect.poll(async () => dateInputs.nth(0).inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect.poll(async () => dateInputs.nth(1).inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const start = await dateInputs.nth(0).inputValue();
    const end = await dateInputs.nth(1).inputValue();
    expect(start <= end, '结束日期应不早于开始日期').toBeTruthy();

    /* ---------- 滑块：数字输入与键盘微调 ---------- */
    await page.selectOption('#page-select', 'page-slider');
    const slider = page.locator('[data-lc-block="slider-single"]');
    const readout = slider.locator('[data-lc-slider-value]');
    const numberInput = slider.locator('[data-lc-slider-number="0"]');
    const sliderRange = slider.locator('[data-lc-slider-range]');
    await expect(readout, '初始读数应为 30%').toHaveText('30%');
    await numberInput.fill('60');
    await expect.poll(async () => sliderRange.inputValue()).toBe('60');
    await expect(readout, '数字输入后读数应同步').toHaveText('60%');
    await sliderRange.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => sliderRange.inputValue(), { message: '键盘方向键应微调滑块' }).toBe('65');
    await expect(readout).toContainText('65');

    /* ---------- 自动补全：输入过滤 + 选中 ---------- */
    await page.selectOption('#page-select', 'page-autocomplete');
    const ac = page.locator('[data-lc-block="ac-local"]');
    const acInput = ac.locator('[data-lc-ac-input]');
    const acList = ac.locator('[data-lc-ac-list]');
    await acInput.click();
    await expect(acList, '聚焦后应展开候选列表').toBeVisible();
    await expect(ac.locator('[data-lc-ac-value]'), '本地应有 5 个候选').toHaveCount(5);
    await acInput.fill('上');
    await expect(ac.locator('[data-lc-ac-value]'), '输入后应只剩一个匹配项').toHaveCount(1);
    await acInput.press('ArrowDown');
    await acInput.press('Enter');
    const shanghaiChip = ac.locator('.lc-ui-ac-chip', { hasText: '上海' });
    await expect(shanghaiChip, '键盘选中后应出现上海标签').toBeVisible();
    await expect(acInput, '多选后输入框应清空').toHaveValue('');
    await expect(ac.locator('[data-lc-ac-remove="sh"]'), '标签上应提供移除按钮').toBeVisible();

    expect(artifacts.unexpectedConsoleErrors(), '表单验收页不应出现控制台错误').toEqual([]);
  } finally {
    await server.close();
  }
});
