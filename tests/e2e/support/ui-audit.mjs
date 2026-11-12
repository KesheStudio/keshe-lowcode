/* 逐页 UI 点检公共逻辑。
 *
 * 每个页面在 1280 / 390 两个宽度下执行同一组检查：
 *   1. 文档无横向滚动
 *   2. 可见控件不出界、不互相遮挡、不被固定层压住
 *   3. 输入框按字段语义有宽度差异，短字段不占满整行
 *   4. 滚动条为自绘样式（自定义轨道 / 滑块，无系统箭头）
 *   5. 弹窗的四条关闭路径与关闭后的残留（仅对存在自定义弹窗的页面）
 *   6. 回工作台 / 回首页入口可点击
 *   7. 空态有提示而不是空白
 *
 * 失败信息统一带 [产品缺陷] 或 [测试脚本] 前缀，便于区分是页面问题还是用例自身问题。
 */

const DIALOG_ROOTS = [
  '.lc-dialog-backdrop',
  '[data-new-page-dialog]',
  '[data-theme-dialog]',
  '[data-code-dialog]',
  '[data-new-dialog]',
  '[data-modal]'
];

const SHORT_FIELD_RE = /(ID|id|编号|版本|端口|超时|数量|行数|长度|宽度|高度|哈希|密钥|密码|方法|类别|图标|语言|环境|键名|次数|上限|下限|阈值)/;

const TEXT_INPUT_TYPES = ['text', 'search', 'number', 'url', 'email', 'tel', 'password'];

function oneLine(value, max) {
  const limit = max || 220;
  const text = String(value == null ? '' : value)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  /* 超长时保留头尾：Playwright 的关键原因（not visible / not stable / outside viewport）在尾部。 */
  if (text.length <= limit) return text;
  const head = 120;
  return text.slice(0, head) + ' … ' + text.slice(-(limit - head - 3));
}

export function viewportLabel(viewport) {
  return viewport.width >= 1000 ? '1280' : '390';
}

export function testTitle(pageDef, viewport) {
  return '[' + pageDef.label + '] ' + viewportLabel(viewport) + ' 宽度 UI 点检';
}

/* ---------- 页面内探针 ---------- */

/* 在页面上下文里判断元素是否真的可见。 */
async function waitVisible(page, selector, timeout) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  await page.waitForFunction((sels) => {
    const visible = (el) => {
      if (!el || !el.isConnected || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    return sels.some((sel) => [...document.querySelectorAll(sel)].some((el) => visible(el)));
  }, selectors, { timeout: timeout || 15_000 });
}

/* 用真实渲染结果做几何检查，不依赖类名约定。 */
async function readLayout(page, scope) {
  return page.evaluate((args) => {
    const visible = (el) => {
      if (!el || !el.isConnected || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const labelOf = (el) => {
      const own = el.getAttribute('aria-label');
      if (own) return own;
      const label = el.closest('label');
      if (label) {
        const text = label.querySelector('.lc-label') || label;
        const value = String(text.textContent || '').replace(/\s+/g, ' ').trim();
        if (value) return value;
      }
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return placeholder;
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      return text || (el.tagName || '').toLowerCase();
    };
    const scrollableX = (el) => {
      let parent = el.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const style = getComputedStyle(parent);
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') &&
            parent.clientWidth + 1 < parent.scrollWidth) return true;
        parent = parent.parentElement;
      }
      return false;
    };
    /* 把元素矩形裁到各层滚动/裁剪容器的可视区：
       落在滚动容器可视区之外的控件只是「滚走了」，不算被遮挡或出界。 */
    const clipRect = (el) => {
      let rect = el.getBoundingClientRect();
      let parent = el.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const style = getComputedStyle(parent);
        const clips = [style.overflowX, style.overflowY]
          .some((value) => value === 'hidden' || value === 'auto' || value === 'scroll' || value === 'clip');
        if (clips) {
          const box = parent.getBoundingClientRect();
          const left = Math.max(rect.left, box.left);
          const right = Math.min(rect.right, box.right);
          const top = Math.max(rect.top, box.top);
          const bottom = Math.min(rect.bottom, box.bottom);
          if (right - left < 2 || bottom - top < 2) return null;
          rect = { left, right, top, bottom, width: right - left, height: bottom - top };
        }
        parent = parent.parentElement;
      }
      return rect;
    };
    const root = args.scope ? document.querySelector(args.scope) : document.documentElement;
    if (!root) {
      return { missing: true, scrollWidth: 0, clientWidth: document.documentElement.clientWidth, bounds: [], covered: [], count: 0 };
    }
    const clientWidth = document.documentElement.clientWidth;
    /* 文档级横向滚动只在整页检查时算；弹窗内检查只看弹窗自身，避免同一条重复报多次。 */
    const scrollWidth = args.scope ? 0 : document.documentElement.scrollWidth;
    const nodes = [...root.querySelectorAll(
      'a[href],button,input,select,textarea,[role="button"],[role="tab"],[tabindex]:not([tabindex="-1"])'
    )].filter(visible);
    const bounds = [];
    const covered = [];
    nodes.forEach((el) => {
      if (scrollableX(el)) return;
      const rect = clipRect(el);
      if (!rect) return;
      if (rect.left < -2 || rect.right > clientWidth + 2 || rect.width > clientWidth + 2) {
        bounds.push({
          label: labelOf(el),
          tag: (el.tagName || '').toLowerCase(),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        });
      }
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + Math.min(12, rect.width / 3), rect.top + Math.min(12, rect.height / 3)],
        [rect.right - Math.min(12, rect.width / 3), rect.bottom - Math.min(12, rect.height / 3)]
      ];
      const hits = [];
      for (const point of points) {
        if (point[0] < 0 || point[0] > clientWidth || point[1] < 0 || point[1] > window.innerHeight) continue;
        const hit = document.elementFromPoint(point[0], point[1]);
        if (!hit) continue;
        if (hit === el || el.contains(hit) || hit.contains(el)) continue;
        if (hit.closest && hit.closest('label') === el.closest('label') && el.closest('label')) continue;
        const hitRect = hit.getBoundingClientRect();
        /* 记录遮挡者的位置与是否在同一次检查范围内：
           范围外的元素压住弹窗，通常是固定顶栏/页面主体的层叠问题（产品缺陷）；
           范围内元素互压则要看是否只是自绘控件的内部结构（可能是用例误判）。 */
        hits.push({
          el: (hit.tagName || '').toLowerCase() + '.' + String(hit.className || '').split(' ').slice(0, 2).join('.'),
          left: Math.round(hitRect.left),
          top: Math.round(hitRect.top),
          inScope: root === document.documentElement || root.contains(hit)
        });
      }
      if (hits.length) {
        covered.push({ label: labelOf(el), tag: (el.tagName || '').toLowerCase(), by: hits.slice(0, 2) });
      }
    });
    /* 固定层残留：弹窗关闭后不应再有全屏遮罩可见。 */
    const masks = [...document.querySelectorAll(
      '.lc-modal-mask,.lc-dialog-backdrop,.lc-home-dialog,[data-new-page-dialog],[data-theme-dialog],[data-code-dialog],[data-modal]'
    )].filter(visible).map((el) => (el.className || el.getAttribute('data-modal') || '').toString().split(' ')[0]);
    return {
      missing: false,
      scrollWidth,
      clientWidth,
      bounds: bounds.slice(0, 10),
      covered: covered.slice(0, 10),
      count: nodes.length,
      masks
    };
  }, { scope: scope || null });
}

async function readInputs(page, scope, mobile) {
  return page.evaluate((args) => {
    const visible = (el) => {
      if (!el || !el.isConnected || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const root = args.scope ? document.querySelector(args.scope) : document.documentElement;
    if (!root) return { missing: true, items: [] };
    const inputs = [...root.querySelectorAll('input')].filter((el) => {
      if (!visible(el)) return false;
      if (el.disabled || el.readOnly) return false;
      const type = String(el.getAttribute('type') || 'text').toLowerCase();
      return args.types.indexOf(type) >= 0;
    });
    const items = inputs.map((el) => {
      const field = el.closest('.lc-field') || el.parentElement;
      const row = field && field.parentElement ? field.parentElement : field;
      const rect = el.getBoundingClientRect();
      const fieldRect = field ? field.getBoundingClientRect() : rect;
      const rowRect = row ? row.getBoundingClientRect() : fieldRect;
      const label = el.getAttribute('aria-label') ||
        (el.closest('label') && el.closest('label').querySelector('.lc-label')
          ? el.closest('label').querySelector('.lc-label').textContent
          : '') ||
        el.getAttribute('placeholder') || el.name || el.id || '';
      const classes = (field ? field.className : '') + ' ' + (el.className || '');
      return {
        label: String(label || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 80),
        type: String(el.getAttribute('type') || 'text').toLowerCase(),
        width: Math.round(rect.width),
        fieldWidth: Math.round(fieldRect.width),
        rowWidth: Math.round(rowRect.width),
        ratio: rowRect.width ? fieldRect.width / rowRect.width : 1,
        mobile: Boolean(args.mobile),
        classes: String(classes)
      };
    });
    return { missing: false, items };
  }, { scope: scope || null, types: TEXT_INPUT_TYPES, mobile: Boolean(mobile) });
}

async function readScrollbar(page) {
  return page.evaluate(() => {
    const collect = (rules, out) => {
      for (const rule of rules) {
        if (rule.selectorText) out.push({ selector: rule.selectorText, css: rule.style.cssText || '' });
        else if (rule.cssRules && rule.cssRules.length) collect(rule.cssRules, out);
      }
    };
    const all = [];
    for (const sheet of document.styleSheets) {
      try {
        collect(sheet.cssRules, all);
      } catch (error) {
        // 跨域样式表读不到规则，跳过；本地资源不应出现
      }
    }
    const webkit = all.filter((item) => /::-webkit-scrollbar($|[\s,:])/.test(item.selector));
    const thumb = all.filter((item) => /::-webkit-scrollbar-thumb/.test(item.selector));
    const arrows = all.filter((item) => /::-webkit-scrollbar-button/.test(item.selector) && /display:\s*block/.test(item.css));
    const thin = getComputedStyle(document.documentElement).scrollbarWidth === 'thin' ||
      getComputedStyle(document.body).scrollbarWidth === 'thin';
    return {
      webkit: webkit.length,
      thumb: thumb.length,
      arrowShown: arrows.length,
      thin,
      widthRule: webkit.some((item) => /width:\s*(8|10|12|14)px/.test(item.css))
    };
  });
}

async function readDialogState(page, spec) {
  return page.evaluate((args) => {
    const visible = (el) => {
      if (!el || !el.isConnected || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const root = [...document.querySelectorAll(args.root)].filter(visible)[0] || null;
    const find = (selector, text) => {
      if (!selector) return null;
      return [...document.querySelectorAll(selector)].filter(visible).find((el) =>
        !text || String(el.textContent || '').replace(/\s+/g, ' ').indexOf(text) >= 0) || null;
    };
    const close = find(args.close, args.closeText);
    const cancel = find(args.cancel, args.cancelText);
    const leftovers = [...document.querySelectorAll(args.all)].filter(visible)
      .map((el) => String(el.className || '').split(' ')[0] || el.tagName.toLowerCase());
    const locked = document.body.classList.contains('lc-modal-open') ||
      document.body.style.overflow === 'hidden' ||
      document.documentElement.style.overflow === 'hidden';
    return { open: Boolean(root), close: Boolean(close), cancel: Boolean(cancel), leftovers, locked };
  }, {
    root: spec.root,
    close: spec.close || null,
    closeText: spec.closeText || '',
    cancel: spec.cancel || null,
    cancelText: spec.cancelText || '',
    all: DIALOG_ROOTS
  });
}

function variantLocator(page, spec, key) {
  const selector = spec[key];
  if (!selector) return null;
  let locator = page.locator(selector);
  if (spec[key + 'Text']) locator = locator.filter({ hasText: spec[key + 'Text'] });
  return locator.first();
}

/* ---------- 断言与错误分类 ---------- */

function pushFailure(failures, kind, label, error) {
  const prefix = kind === 'test' ? '[测试脚本]' : '[产品缺陷]';
  const message = error && error.message ? error.message : String(error);
  failures.push(prefix + ' ' + label + '：' + oneLine(message, 320));
}

function summarize(items, render) {
  return items.slice(0, 3).map(render).join('、');
}

async function assertLayout(page, scope, failures, label) {
  const data = await readLayout(page, scope);
  if (data.missing) {
    throw new Error('检查范围不存在');
  }
  if (data.scrollWidth && data.scrollWidth > data.clientWidth + 2) {
    throw new Error('文档出现横向滚动：scrollWidth=' + data.scrollWidth + '，clientWidth=' + data.clientWidth);
  }
  if (data.bounds.length) {
    throw new Error('有 ' + data.bounds.length + ' 个可见控件横向出界：' +
      summarize(data.bounds, (item) => item.label + '（' + item.left + '~' + item.right + 'px）'));
  }
  if (data.covered.length) {
    const describe = (hit) => hit.el + '（' + (hit.inScope ? '同范围' : '范围外') +
      ' ' + hit.left + ',' + hit.top + '）';
    throw new Error('有 ' + data.covered.length + ' 个可见控件被遮挡：' +
      summarize(data.covered, (item) => item.label + '被 ' + item.by.map(describe).join('/') + ' 压住'));
  }
  return data;
}

async function assertInputs(page, scope, failures, label) {
  const data = await readInputs(page, scope, page.viewportSize().width <= 640);
  if (data.missing) throw new Error('检查范围不存在');
  if (!data.items.length) return { skipped: true, items: [] };
  /* 390 下表单是单列，短字段跟着占满一行是正常响应式行为，宽度语义只在宽屏判定。 */
  const shortItems = data.items.filter((item) => !item.mobile &&
    (SHORT_FIELD_RE.test(item.label) || item.type === 'number' || /is-short/.test(item.classes)));
  const problems = [];
  shortItems.forEach((item) => {
    const desktop = page.viewportSize().width >= 1000;
    const limit = desktop ? 320 : 220;
    if (item.ratio >= 0.92 && item.width >= limit && !/is-short/.test(item.classes)) {
      problems.push(item.label + '（宽 ' + item.width + 'px，占整行 ' + Math.round(item.ratio * 100) + '%）');
    }
  });
  if (shortItems.length && data.items.length >= 2) {
    const widths = new Set(data.items.map((item) => Math.round(item.width / 8)));
    if (widths.size < 2) {
      problems.push('短字段与其它输入框宽度完全一致（均约 ' + data.items[0].width + 'px）');
    }
  }
  if (problems.length) {
    throw new Error(summarize(problems, (item) => item));
  }
  return { skipped: false, items: data.items, shortItems };
}

async function assertScrollbar(page) {
  const data = await readScrollbar(page);
  if (!data.webkit || !data.thumb || !data.widthRule) {
    throw new Error('滚动条未自绘：::-webkit-scrollbar 规则 ' + data.webkit +
      ' 条，滑块 ' + data.thumb + ' 条，固定宽度规则 ' + (data.widthRule ? '有' : '无'));
  }
  if (data.arrowShown) throw new Error('滚动条按钮被显示，存在系统箭头');
  return data;
}

/* 控件不可见时立刻失败，而不是让 Playwright 一直等到用例超时：
   这类失败会带上「不可达」说明，方便判断是布局缺陷还是用例问题。 */
async function clickControl(page, selector, what) {
  const el = typeof selector === 'string' ? page.locator(selector).first() : selector;
  if (!(await el.isVisible().catch(() => false))) {
    throw new Error((what || selector) + ' 在当前宽度下不可见 / 不可达');
  }
  await el.click({ timeout: 8_000 });
}

/* 窄屏侧栏抽屉（≤640 为覆盖层）：展开后它会盖住主区域，弹窗入口被挡住前要先收起。 */
async function setSidebarDrawer(page, open) {
  if (page.viewportSize().width > 640) return;
  const toggle = page.locator('[data-toggle-sidebar]').first();
  if (!(await toggle.isVisible().catch(() => false))) return;
  const isOpen = await page.evaluate(() => document.body.getAttribute('data-lc-sidebar') === 'open');
  if (isOpen === open) return;
  await toggle.click().catch(() => {});
  await page.waitForTimeout(150);
}

/* 窄屏抽屉（≤900 的侧栏 / 属性面板）：需要时展开，没有开关就返回 false。 */
async function expandDrawer(page, which) {
  const attr = which === 'inspector' ? 'data-lc-inspector' : 'data-lc-sidebar';
  const toggle = page.locator('[data-toggle-' + which + ']').first();
  if (!(await toggle.isVisible().catch(() => false))) return false;
  const opened = await page.evaluate((key) => document.body.getAttribute(key) === 'open', attr);
  if (!opened) {
    await toggle.click({ timeout: 5_000 });
    await page.waitForTimeout(150);
  }
  return true;
}

/* 窄屏抽屉收起：宽屏下抽屉是常驻列，没有开关时直接跳过。 */
async function collapseDrawer(page, which) {
  const attr = which === 'inspector' ? 'data-lc-inspector' : 'data-lc-sidebar';
  const toggle = page.locator('[data-toggle-' + which + ']').first();
  if (!(await toggle.isVisible().catch(() => false))) return false;
  const opened = await page.evaluate((key) => document.body.getAttribute(key) === 'open', attr);
  if (opened) {
    await toggle.click().catch(() => {});
    await page.waitForTimeout(150);
  }
  return true;
}

async function openDialog(page, spec) {
  await spec.open(page);
  await page.waitForFunction((args) => {
    const visible = (el) => {
      if (!el || !el.isConnected || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    return [...document.querySelectorAll(args.root)].some((el) => visible(el));
  }, { root: spec.root }, { timeout: 15_000 });
}

/* 遮罩点击落点：左下角。固定在顶部的顶栏（z-index 高于部分弹窗）会拦截上方落点，
   点左上角可能误触顶栏的「回首页」链接，把页面导航走。 */
function backdropPointOf(page) {
  const size = page.viewportSize();
  return { x: 10, y: (size ? size.height : 844) - 16 };
}

/* 兜底关闭：一律走真实鼠标坐标点遮罩，避免 locator.click 等命中目标而长时间挂住。 */
async function forceClose(page, spec) {
  const state = await readDialogState(page, spec);
  if (!state.open) return;
  const close = variantLocator(page, spec, 'close');
  if (close && await close.isVisible().catch(() => false)) {
    await close.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(150);
    if (!(await readDialogState(page, spec)).open) return;
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
  if (!(await readDialogState(page, spec)).open) return;
  const point = backdropPointOf(page);
  await page.mouse.click(point.x, point.y).catch(() => {});
  await page.waitForTimeout(150);
}

async function auditDialogPaths(page, spec, failures, testInfo) {
  const name = spec.label || '弹窗';
  const paths = [
    { key: 'close', label: '关闭按钮', action: async () => {
      const state = await readDialogState(page, spec);
      if (!state.close) throw new Error('弹窗缺少关闭按钮');
      await variantLocator(page, spec, 'close').click({ timeout: 8_000 });
    } },
    { key: 'cancel', label: '取消按钮', action: async () => {
      const state = await readDialogState(page, spec);
      if (!state.cancel) {
        if (spec.cancelOptional) return 'skip';
        throw new Error('弹窗缺少取消按钮');
      }
      await variantLocator(page, spec, 'cancel').click({ timeout: 8_000 });
    } },
    { key: 'escape', label: 'ESC', action: async () => {
      await page.keyboard.press('Escape');
    } },
    { key: 'backdrop', label: '点击遮罩', action: async () => {
      const point = backdropPointOf(page);
      await page.mouse.click(point.x, point.y);
    } }
  ];

  let layoutChecked = false;
  const skipped = [];
  for (const item of paths) {
    try {
      await openDialog(page, spec);
    } catch (error) {
      /* 打不开就记一条并退出：后续三条路径同样打不开，重复报没有信息量。 */
      pushFailure(failures, 'product', '弹窗「' + name + '」无法打开', error);
      await forceClose(page, spec);
      return;
    }
    /* 弹窗内布局只查一次：四条路径都查会得到四条一模一样的结论。 */
    if (!layoutChecked) {
      layoutChecked = true;
      try {
        await assertLayout(page, spec.root, failures, '弹窗内布局');
      } catch (error) {
        pushFailure(failures, 'product', '弹窗「' + name + '」内布局', error);
      }
    }
    try {
      const result = await item.action();
      if (result === 'skip') {
        skipped.push(item.label);
        await forceClose(page, spec);
        continue;
      }
      await page.waitForTimeout(220);
      const state = await readDialogState(page, spec);
      if (state.open) throw new Error('通过' + item.label + '后弹窗仍然可见');
      const leftovers = state.leftovers.filter((name) => /mask|backdrop|dialog|modal|home/i.test(name));
      if (leftovers.length) throw new Error('关闭后残留遮罩/弹窗层：' + leftovers.join('、'));
      if (state.locked) throw new Error('关闭后仍锁住页面滚动（body 仍为 overflow:hidden 或 lc-modal-open）');
    } catch (error) {
      pushFailure(failures, 'product', '弹窗「' + name + '」关闭路径：' + item.label, error);
      await forceClose(page, spec);
    }
  }
  await forceClose(page, spec);
  if (testInfo) {
    testInfo.annotations.push({
      type: 'dialog-paths',
      description: (spec.label || '弹窗') + '：已检查' +
        (skipped.length ? '关闭/ESC/遮罩三条路径（当前实现没有' + skipped.join('、') + '）' : '关闭/取消/ESC/遮罩四条路径')
    });
  }
}

/* ---------- 空态 ---------- */

async function assertText(page, selector, keyword, timeout) {
  await page.waitForFunction((args) => {
    const all = [...document.querySelectorAll(args.selector)];
    return all.some((el) => {
      if (el.hidden) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 1 || rect.height < 1) return false;
      return String(el.textContent || '').replace(/\s+/g, ' ').trim().indexOf(args.keyword) >= 0;
    });
  }, { selector, keyword }, { timeout: timeout || 12_000 });
}

/* 空态或已有内容二选一：页面已经自动选中内容时不再要求空态可见，
   但空态元素本身仍必须有可读文案，不能是空白占位。 */
async function assertEmptyOrContent(page, { empty, keyword, content }) {
  /* 页面在选中/加载后会在「空态」和「已选内容」之间切换，先等其中一侧出现，
     避免渲染未完成时两边都看不见而误判成空态缺失。 */
  await page.waitForFunction(({ emptySel, contentSel }) => {
    const visible = (el) => Boolean(el) && (() => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })();
    const emptyHit = emptySel ? [...document.querySelectorAll(emptySel)].some(visible) : false;
    const contentHit = contentSel ? [...document.querySelectorAll(contentSel)].some(visible) : false;
    return emptyHit || contentHit;
  }, { emptySel: empty || null, contentSel: content || null }, { timeout: 10_000 }).catch(() => {});

  const emptyEl = page.locator(empty).first();
  if (await emptyEl.isVisible().catch(() => false)) {
    const text = String(await emptyEl.textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('空态区域可见，但没有任何提示文案');
    if (keyword && text.indexOf(keyword) < 0) throw new Error('空态提示文案不符：' + oneLine(text, 80));
    return { empty: true, text };
  }
  if (content) {
    const contentEl = page.locator(content).first();
    if (await contentEl.isVisible().catch(() => false)) return { empty: false };
  }
  throw new Error('既没有空态提示，也没有已选内容');
}

/* ---------- 页面清单 ---------- */

/* 中间件：窄屏侧栏是抽屉且没有开关，主内容区另有「新增」，按实际可见的入口点。 */
async function openCustomMiddlewareDialog(page) {
  if (await page.locator('.lc-dialog-backdrop').first().isVisible().catch(() => false)) return;
  const side = page.locator('[data-add-custom]').first();
  if (await side.isVisible().catch(() => false)) await side.click({ timeout: 8_000 });
  else await clickControl(page, '[data-add-custom-2]', '新增自定义中间件按钮');
  await waitVisible(page, '.lc-dialog-backdrop');
}

/* 配置中心：添加配置项按钮由分组渲染出来，先等它出现再点。 */
async function openConfigItemDialog(page) {
  if (await page.locator('.lc-dialog-backdrop').first().isVisible().catch(() => false)) return;
  const add = page.locator('[data-add-group]').first();
  await add.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await clickControl(page, add, '分组「添加配置项」按钮');
  await waitVisible(page, '.lc-dialog-backdrop');
}

const pages = [
  {
    key: 'home',
    label: '首页',
    url: () => '/home.html',
    ready: '[data-project-list]',
    back: null,
    backNote: '首页本身就是工作台入口，跳过回工作台检查',
    empty: async (page) => {
      await page.route('**/api/sites', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [] }) });
        } else {
          await route.continue();
        }
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await assertText(page, '[data-project-list]', '还没有项目', 15_000);
    },
    prepare: async (page) => {
      await clickControl(page, '[data-new-project]', '新建项目按钮');
      await waitVisible(page, '[data-new-dialog]');
    },
    inputScope: '[data-new-dialog]',
    dialog: {
      label: '新建项目弹窗',
      root: '[data-new-dialog]',
      close: '[data-new-dialog] [data-close-dialog]',
      closeText: '关闭',
      cancel: '[data-new-dialog] [data-close-dialog]',
      cancelText: '取消',
      backdropPoint: null,
      open: async (page) => {
        if (!(await page.locator('[data-new-dialog]').isVisible().catch(() => false))) {
          await clickControl(page, '[data-new-project]', '新建项目按钮');
        }
      }
    }
  },
  {
    key: 'builder',
    label: 'builder',
    url: (siteId) => '/builder.html?site=' + encodeURIComponent(siteId),
    ready: '[data-canvas-wrap]',
    back: 'a[href="home.html"]',
    /* 390 下左侧资源栏是抽屉，页面列表与新建页面入口要先点「资源」展开。 */
    drawer: true,
    empty: async (page) => {
      await assertText(page, '[data-page-list]', '还没有页面', 12_000);
      await assertText(page, '[data-canvas-placeholder]', '选择左侧页面', 12_000);
    },
    prepare: async (page) => {
      await clickControl(page, '[data-new-page]', '新建页面按钮');
      await waitVisible(page, '[data-new-page-dialog]');
    },
    inputScope: '[data-new-page-dialog]',
    dialogs: [
      {
        label: '新建页面弹窗',
        root: '[data-new-page-dialog]',
        close: '[data-new-page-close]',
        cancel: '[data-new-page-cancel]',
        backdropPoint: null,
        open: async (page) => {
          if (!(await page.locator('[data-new-page-dialog]').isVisible().catch(() => false))) {
            await clickControl(page, '[data-new-page]', '新建页面按钮');
          }
        }
      },
      {
        label: '站点主题弹窗',
        root: '[data-theme-dialog]',
        close: '[data-theme-close]',
        cancel: '[data-theme-cancel]',
        /* 现实现里主题弹窗只有「关闭」，没有独立「取消」按钮：有就按四条断言，
           没有则跳过「取消」路径并记录，避免把关闭按钮当成取消重复点一次。 */
        cancelOptional: true,
        backdropPoint: null,
        /* 1280 / 390 下顶栏「主题」都在「更多」菜单里，入口要按实际布局走。 */
        open: async (page) => {
          if (await page.locator('[data-theme-dialog]').isVisible().catch(() => false)) return;
          /* 390 下资源抽屉还开着会压住顶栏「更多」菜单，先收起。 */
          await setSidebarDrawer(page, false);
          if (await page.locator('[data-theme-entry]').isVisible().catch(() => false)) {
            await page.locator('[data-theme-entry]').click({ timeout: 8_000 });
            return;
          }
          await clickControl(page, '[data-more-toggle]', '顶栏「更多」菜单');
          await waitVisible(page, '[data-more-menu]:not([hidden])');
          await clickControl(page, '[data-mirror="[data-theme-entry]"]', '「更多」菜单里的主题入口');
        }
      }
    ]
  },
  {
    key: 'page-import',
    label: '页面导入',
    url: (siteId) => '/page-import.html?site=' + encodeURIComponent(siteId),
    ready: '[data-page-list]',
    back: 'a[href="home.html"]',
    empty: async (page) => {
      await assertText(page, '[data-page-list]', '还没有页面', 12_000);
      await assertText(page, '[data-import-summary]', '还没有导入记录', 8_000);
    },
    prepare: null,
    inputScope: null,
    dialog: null
  },
  {
    key: 'builds',
    label: '构建记录',
    /* 原独立「页面列表」页（/index.html）已随工作台改版下线：项目列表在 home.html，
       站点页面列表在 Builder 左侧栏。当前独立列表页是构建记录页。 */
    url: (siteId) => '/builds.html?site=' + encodeURIComponent(siteId),
    ready: ['[data-body]', '[data-gate]'],
    back: 'a[href="home.html"]',
    empty: async (page) => {
      await assertText(page, '[data-empty]', '还没有构建记录', 8_000);
    },
    prepare: null,
    inputScope: null,
    dialog: null
  },
  {
    key: 'components',
    label: '组件库',
    url: (siteId) => '/components.html?site=' + encodeURIComponent(siteId),
    ready: '[data-component-list]',
    back: 'a[href="home.html"]',
    empty: async (page) => {
      await assertEmptyOrContent(page, { empty: '[data-empty]', keyword: '还没有选中', content: '[data-editor]' });
    },
    prepare: async (page) => {
      await clickControl(page, '[data-new-component]', '新建组件按钮');
      await waitVisible(page, '[data-editor]');
    },
    inputScope: '[data-editor]',
    dialog: null
  },
  {
    key: 'templates',
    label: '模板库',
    url: (siteId) => '/templates.html?site=' + encodeURIComponent(siteId),
    ready: '[data-template-list]',
    back: 'a[href="home.html"]',
    empty: async (page) => {
      await assertEmptyOrContent(page, { empty: '[data-empty]', keyword: '还没有选中', content: '[data-editor]' });
    },
    prepare: async (page) => {
      await clickControl(page, '[data-create-page]', '页面存为模板按钮');
      await waitVisible(page, '[data-create-panel]');
    },
    inputScope: '[data-create-panel]',
    dialog: null
  },
  {
    key: 'data',
    label: '数据源',
    url: (siteId) => '/data.html?site=' + encodeURIComponent(siteId),
    ready: '[data-collection-list]',
    back: 'a[href="home.html"]',
    empty: async (page) => {
      await assertEmptyOrContent(page, { empty: '[data-empty]', keyword: '还没有', content: '[data-editor]' });
    },
    prepare: async (page) => {
      await clickControl(page, '[data-new-source]', '新建接口按钮');
      await waitVisible(page, '[data-source-editor]');
    },
    inputScope: '[data-source-editor]',
    dialog: null
  },
  {
    key: 'data-upload',
    label: '数据源 · 上传目标',
    url: (siteId) => '/data.html?site=' + encodeURIComponent(siteId),
    ready: '[data-collection-list]',
    back: 'a[href="home.html"]',
    empty: null,
    emptyNote: '上传目标是「站点设置」下的表单子视图，没有空态场景',
    prepare: async (page) => {
      await clickControl(page, '[data-open-upload]', '站点设置里的「上传目标」入口');
      await waitVisible(page, '[data-upload-view]:not([hidden])', 10_000);
    },
    inputScope: '[data-upload-view]',
    dialog: null,
    extras: [{
      label: '上传目标视图布局',
      run: async (page, { failures }) => {
        /* 切到子视图后整页可见内容变了，这里重新做一次整页几何检查（含文档横向滚动）。 */
        await assertLayout(page, null, failures, '上传目标视图布局');
      }
    }]
  },
  {
    key: 'middleware',
    label: '中间件',
    backendSite: true,
    url: (siteId) => '/middleware.html?site=' + encodeURIComponent(siteId),
    ready: ['[data-content]', '[data-gate]'],
    back: 'a[href="home.html"]',
    empty: async (page) => {
      await assertText(page, '[data-custom-list]', '还没有自定义中间件', 10_000);
    },
    prepare: async (page) => {
      await openCustomMiddlewareDialog(page);
    },
    inputScope: '.lc-dialog-backdrop',
    dialog: {
      label: '新增自定义中间件弹窗',
      root: '.lc-dialog-backdrop',
      close: '[data-dialog-close]',
      cancel: '.lc-dialog-foot button',
      cancelText: '取消',
      backdropPoint: null,
      open: async (page) => {
        await openCustomMiddlewareDialog(page);
      }
    }
  },
  {
    key: 'config',
    label: '配置中心',
    backendSite: true,
    url: (siteId) => '/config-center.html?site=' + encodeURIComponent(siteId),
    ready: ['[data-content]', '[data-gate]'],
    back: 'a[href="home.html"]',
    empty: async (page) => {
      const hasEmpty = await page.locator('.lc-config-empty').first().isVisible().catch(() => false);
      if (!hasEmpty) {
        const items = await page.locator('[data-groups] .lc-config-row, [data-groups] input, [data-groups] select').count();
        if (items > 0) return; // 已有配置项，不属于空态
        throw new Error('分组内没有任何配置项，也没有空态提示');
      }
      const text = await page.locator('.lc-config-empty').first().textContent();
      if (!String(text || '').trim()) throw new Error('空态提示是空白文本');
    },
    prepare: async (page) => {
      await openConfigItemDialog(page);
    },
    inputScope: '.lc-dialog-backdrop',
    dialog: {
      label: '添加配置项弹窗',
      root: '.lc-dialog-backdrop',
      close: '[data-dialog-close]',
      cancel: '.lc-dialog-foot button',
      cancelText: '取消',
      backdropPoint: null,
      open: async (page) => {
        await openConfigItemDialog(page);
      }
    }
  },
  {
    key: 'backend',
    label: '后端积木',
    backendSite: true,
    url: (siteId) => '/backend-flow.html?site=' + encodeURIComponent(siteId),
    ready: ['[data-tree]', '[data-tree-empty]'],
    back: 'a[href="home.html"]',
    empty: async (page) => {
      await assertEmptyOrContent(page, {
        empty: '[data-tree-empty]',
        keyword: '还没有节点',
        content: '[data-tree] [role="treeitem"]'
      });
    },
    prepare: async (page) => {
      await clickControl(page, '[data-load-sample]', '载入示例按钮');
      await page.waitForFunction(() => {
        const tree = document.querySelector('[data-tree]');
        return tree && tree.querySelectorAll('[role="treeitem"]').length > 0;
      }, null, { timeout: 12_000 });
    },
    inputScope: null,
    extras: [{
      label: '资源/属性抽屉',
      run: async (page, { failures }) => {
        /* 390 下资源与属性都是覆盖式抽屉，需要顶栏开关展开；1280 下是常驻列，直接检查即可。 */
        await expandDrawer(page, 'sidebar');
        await waitVisible(page, '.lc-sidebar', 10_000);
        await assertText(page, '.lc-sidebar', '节点库', 8_000);
        await assertLayout(page, '.lc-sidebar', failures, '资源抽屉');
        await collapseDrawer(page, 'sidebar');

        await expandDrawer(page, 'inspector');
        await waitVisible(page, '.lc-inspector', 10_000);
        await assertText(page, '.lc-inspector', '属性', 8_000);
        await assertLayout(page, '.lc-inspector', failures, '属性抽屉');
        await collapseDrawer(page, 'inspector');
      }
    }],
    dialog: {
      label: '用户代码弹窗',
      root: '[data-code-dialog]',
      close: '[data-code-close]',
      cancel: '[data-code-cancel]',
      backdropPoint: null,
      open: async (page) => {
        if (await page.locator('[data-code-dialog]').isVisible().catch(() => false)) return;
        /* 390 下节点库在左侧抽屉、节点属性在右侧抽屉，都收起时点不到。 */
        const node = page.locator('[data-type="code.node"]').first();
        if (!(await node.isVisible().catch(() => false))) await expandDrawer(page, 'sidebar');
        await clickControl(page, node, '节点库里的「代码节点」');
        await page.waitForTimeout(250);
        let edit = page.getByRole('button', { name: '编辑用户代码' }).first();
        if (!(await edit.isVisible().catch(() => false))) await expandDrawer(page, 'inspector');
        if (!(await edit.isVisible().catch(() => false))) throw new Error('新增代码节点后找不到「编辑用户代码」入口');
        await edit.click({ timeout: 8_000 });
      }
    }
  },
  {
    key: 'export',
    label: '导出向导',
    url: (siteId) => '/export.html?site=' + encodeURIComponent(siteId),
    ready: ['[data-step="1"]', '[data-site-title]'],
    back: 'a[href="home.html"]',
    empty: async (page) => {
      /* 内容范围与页面列表在第 2 步面板里，默认停在第 1 步；先切到第 2 步。 */
      const goto = page.locator('[data-goto="2"]').first();
      if (await goto.isVisible().catch(() => false)) await goto.click({ timeout: 8_000 });
      await waitVisible(page, '[data-step="2"]', 8_000);
      /* 单选框是自绘样式（原生 input 被隐藏），点可见的 label。 */
      await clickControl(page, page.locator('label.lc-radio').filter({ hasText: '选定页面' }).first(), '「选定页面」范围选项');
      await assertText(page, '[data-page-list]', '还没有页面', 8_000);
    },
    prepare: async (page) => {
      const goto = page.locator('[data-goto="2"]').first();
      if (await goto.isVisible().catch(() => false)) await goto.click({ timeout: 8_000 });
      else await clickControl(page, page.locator('[data-next]').first(), '进入下一步按钮');
      await page.waitForTimeout(250);
    },
    inputScope: null,
    dialog: null
  },
  {
    key: 'theme',
    label: '主题编辑器',
    /* 主题编辑器是独立页面（/theme/editor.html），不是 Builder 顶栏的主题弹窗。 */
    url: (siteId) => '/theme/editor.html?site=' + encodeURIComponent(siteId),
    ready: ['#teBackHome', '[data-save]'],
    back: '#teBackHome',
    empty: null,
    emptyNote: '主题编辑器始终有内置主题与令牌分组可选，不存在空白空态',
    prepare: null,
    inputScope: null,
    dialog: null
  }
];

export { pages as uiPages };

/* ---------- 单次页面审计 ---------- */

export async function runUiAudit({ page, siteId, pageDef, viewport, testInfo }) {
  const failures = [];
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  let response = null;
  try {
    response = await page.goto(pageDef.url(siteId), { waitUntil: 'domcontentloaded' });
  } catch (error) {
    throw new Error('[测试脚本] 页面打开失败：' + oneLine(error.message));
  }
  if (!response || !response.ok()) {
    throw new Error('[测试脚本] 页面返回异常状态：HTTP ' + (response ? response.status() : '无响应'));
  }
  try {
    await waitVisible(page, pageDef.ready, 20_000);
  } catch (error) {
    throw new Error('[测试脚本] 页面初始化超时，找不到就绪标记 ' + pageDef.ready);
  }
  await page.waitForTimeout(500);

  /* 窄屏抽屉：≤640 时侧栏是覆盖层，未展开时里面的控件不可见。只在需要时展开，
     检查完立刻收起，避免抽屉遮罩影响页面整体布局检查。 */
  const setDrawer = async (open) => {
    if (!pageDef.drawer) return;
    await setSidebarDrawer(page, open);
  };
  await setDrawer(true);

  /* 1. 空态：先看空内容，再打开表单。 */
  if (pageDef.empty) {
    try {
      await pageDef.empty(page);
    } catch (error) {
      pushFailure(failures, 'product', '空态缺少提示', error);
    }
  } else {
    testInfo.annotations.push({ type: 'empty-state', description: pageDef.emptyNote || '该页没有空态场景' });
  }
  await setDrawer(false);

  /* 2. 页面整体布局：先不打开任何弹窗，避免遮罩干扰命中测试。 */
  try {
    await assertLayout(page, null, failures, '页面整体布局');
  } catch (error) {
    pushFailure(failures, 'product', '无横向滚动 / 控件不出界 / 不被遮挡', error);
  }

  /* 3. 自绘滚动条。 */
  try {
    await assertScrollbar(page);
  } catch (error) {
    pushFailure(failures, 'product', '滚动条样式', error);
  }

  /* 4. 打开表单 / 编辑区，检查输入框语义宽度。 */
  if (pageDef.prepare) {
    try {
      await setDrawer(true);
      await pageDef.prepare(page);
      await page.waitForTimeout(200);
    } catch (error) {
      pushFailure(failures, 'product', '打开表单/编辑区', error);
    }
  }
  try {
    const result = await assertInputs(page, pageDef.inputScope, failures, '输入框宽度');
    if (result.skipped) {
      testInfo.annotations.push({ type: 'inputs', description: '当前状态下没有可编辑文本框，跳过宽度语义检查' });
    }
  } catch (error) {
    pushFailure(failures, 'product', '输入框宽度语义', error);
  }

  /* 5. 页面附加场景（新增抽屉 / 子视图等），独立报错，避免拖垮后面的弹窗检查。 */
  for (const extra of pageDef.extras || []) {
    try {
      await extra.run(page, { failures, viewport, testInfo });
    } catch (error) {
      pushFailure(failures, 'product', extra.label, error);
    }
  }

  /* 6. 弹窗四条关闭路径：一个页面可能有多个自定义弹窗，逐个穷举。 */
  const dialogSpecs = pageDef.dialogs || (pageDef.dialog ? [pageDef.dialog] : []);
  if (dialogSpecs.length) {
    for (const spec of dialogSpecs) {
      await auditDialogPaths(page, spec, failures, testInfo);
    }
  } else {
    testInfo.annotations.push({ type: 'dialog-paths', description: '该页没有自定义弹窗，四条关闭路径不适用' });
  }

  /* 失败截图要在离开当前页之前抓：之后的返回首页会把页面换成工作台。 */
  try {
    const shot = await page.screenshot({ fullPage: false });
    await testInfo.attach('页面当前状态', { body: shot, contentType: 'image/png' });
  } catch (error) {
    pushFailure(failures, 'script', '抓取页面截图', error);
  }

  /* 6. 回工作台 / 回首页入口：放在最后，点击后会离开当前页。 */
  if (pageDef.back) {
    try {
      const link = page.locator(pageDef.back).first();
      if (!(await link.isVisible().catch(() => false))) throw new Error('页面上没有可见的返回工作台/首页入口');
      /* 离开页面时产品可能弹原生确认框；显式接受，避免点击被未处理的对话框挂住直到超时。 */
      const acceptDialog = (dialog) => { dialog.accept().catch(() => {}); };
      page.on('dialog', acceptDialog);
      try {
        await Promise.all([
          page.waitForURL(/home\.html/, { timeout: 15_000 }),
          link.click({ timeout: 8_000 })
        ]);
      } finally {
        page.off('dialog', acceptDialog);
      }
      if (!/home\.html/.test(page.url())) throw new Error('点击后没有回到工作台，当前地址 ' + page.url());
    } catch (error) {
      pushFailure(failures, 'product', '回工作台入口', error);
    }
  } else if (pageDef.backNote) {
    testInfo.annotations.push({ type: 'back-entry', description: pageDef.backNote });
  }

  if (failures.length) throw new Error(failures.join('；'));
}
