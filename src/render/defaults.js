/* 渲染核心 · 组件默认内容
   供建站编辑器插入内置组件 / 基础区块时读取。纯数据，不依赖渲染运行时。
   Node：require('./defaults.js')；浏览器：挂到 LC.Render。

   约定：
   - 键名是组件 type（ui-*）或区块 type（heading / paragraph / ...）。
   - 值是可直接合并进 block 的 props，不带 id，也不含“按需改写”“示例文本”等占位文案。
   - 图表、表格、KPI 等默认样例给出足够的数据点，插入后即可看出图形轮廓。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    var api = factory();
    Object.keys(api).forEach(function (key) { root.LC.Render[key] = api[key]; });
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 图片默认值用内联 SVG：不依赖网络、导出后仍然可见。 */
  var IMAGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img">' +
    '<rect width="640" height="360" fill="#f6f3ea"/>' +
    '<g font-family="PingFang SC, Microsoft YaHei, sans-serif" text-anchor="middle">' +
    '<rect x="52" y="34" width="536" height="72" rx="10" fill="#e3efe8" stroke="#9fc4b4" stroke-width="1"/>' +
    '<text x="320" y="66" font-size="20" fill="#2f6b55">采集层</text>' +
    '<text x="320" y="88" font-size="13" fill="#557065">App 埋点 · 订单库 · 客服工单</text>' +
    '<path d="M320 108 L320 138" stroke="#9aab9f" stroke-width="2"/>' +
    '<path d="M312 130 L320 142 L328 130" fill="none" stroke="#9aab9f" stroke-width="2"/>' +
    '<rect x="52" y="144" width="536" height="72" rx="10" fill="#f0ece0" stroke="#cfc2a6" stroke-width="1"/>' +
    '<text x="320" y="176" font-size="20" fill="#7a5c22">清洗与建模层</text>' +
    '<text x="320" y="198" font-size="13" fill="#7c6c4e">去重 · 口径统一 · 维度关联</text>' +
    '<path d="M320 218 L320 248" stroke="#9aab9f" stroke-width="2"/>' +
    '<path d="M312 240 L320 252 L328 240" fill="none" stroke="#9aab9f" stroke-width="2"/>' +
    '<rect x="52" y="254" width="536" height="72" rx="10" fill="#e2edf1" stroke="#a3c2cc" stroke-width="1"/>' +
    '<text x="320" y="286" font-size="20" fill="#2f5a68">指标服务层</text>' +
    '<text x="320" y="308" font-size="13" fill="#4d6d78">GMV · 留存率 · 首次响应时长</text>' +
    '</g></svg>';
  var IMAGE_SRC = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(IMAGE_SVG);

  var componentDefaults = {
    'ui-table': {
      caption: '2026 年第三季度订单台账',
      columns: [
        { key: 'order', title: '订单号', width: 128, sortable: true },
        { key: 'customer', title: '客户', width: 160 },
        { key: 'channel', title: '渠道', width: 100 },
        { key: 'amount', title: '金额（元）', align: 'right', format: 'number', width: 110 },
        { key: 'status', title: '状态', width: 90 },
        { key: 'date', title: '下单日期', format: 'date', width: 120 }
      ],
      rows: [
        { id: 'LC-2609021', order: 'LC-2609021', customer: '杭州云栖茶业', channel: '小程序', amount: 1860, status: '已发货', date: '2026-09-02' },
        { id: 'LC-2609034', order: 'LC-2609034', customer: '北辰医疗器械', channel: '企业微信', amount: 12400, status: '待发货', date: '2026-09-04' },
        { id: 'LC-2609118', order: 'LC-2609118', customer: '南山精密制造', channel: '官网', amount: 6850, status: '已完成', date: '2026-09-11' },
        { id: 'LC-2609215', order: 'LC-2609215', customer: '远航教育科技', channel: '电话回访', amount: 3290, status: '已完成', date: '2026-09-21' },
        { id: 'LC-2609306', order: 'LC-2609306', customer: '青禾生鲜', channel: '小程序', amount: 2450, status: '已退款', date: '2026-09-30' },
        { id: 'LC-2610042', order: 'LC-2610042', customer: '朗途数据服务', channel: '合作伙伴', amount: 21800, status: '已完成', date: '2026-10-04' }
      ],
      rowKey: 'id',
      pageSize: 8,
      dense: false
    },
    'ui-image': {
      src: IMAGE_SRC,
      alt: 'Lantern 数据平台三层架构示意',
      ratio: '16:9',
      fit: 'cover',
      caption: '数据从采集层经过清洗建模，最终进入指标服务层。',
      lazy: true
    },
    'ui-form': {
      fields: [
        { name: 'name', label: '你的姓名', type: 'text', placeholder: '例如：林雨', required: true, maxLength: 40 },
        { name: 'email', label: '工作邮箱', type: 'email', placeholder: 'name@company.com', required: true, maxLength: 120, help: '演示预约链接会发到这个邮箱。' },
        { name: 'seats', label: '团队席位数', type: 'number', value: '12', min: 3, max: 200, help: '3 人起购，可随时增减。' },
        { name: 'note', label: '希望解决的问题', type: 'textarea', rows: 3, placeholder: '例如：希望把订单数据接入现有 BI 看板，并在每晚 8 点前完成同步。' }
      ],
      submitLabel: '预约演示',
      resetLabel: '清空',
      successText: '已收到预约，顾问会在一个工作日内联系你。',
      errorText: '提交失败，请稍后重试或直接致电 0571-8800 1234。'
    },
    'ui-modal': {
      title: '确认发布本期站点？',
      triggerLabel: '发布站点',
      body: '发布后，页面会立即对全部访客可见。你可以在「版本记录」里回滚到上一个版本。',
      footer: '发布前会自动检查失效链接与缺失图片。',
      size: 'md',
      closeOnMask: true,
      closeOnEsc: true
    },
    'ui-drawer': {
      title: '订单详情',
      triggerLabel: '查看订单 #LC-20261108-0427',
      body: '订单 #LC-20261108-0427 由杭州云栖茶业于 11 月 8 日 09:42 提交，含 3 件商品，合计 ¥1,860.00。当前状态：已发货。',
      footer: '物流单号 SF1234567890，预计 11 月 10 日送达。',
      size: 'md',
      placement: 'right'
    },
    'ui-tabs': {
      label: '产品能力',
      active: 'tab-data',
      items: [
        { id: 'tab-data', label: '数据接入', content: '通过 REST 接口或 SDK 上报事件，平均延迟 40 秒；支持批量回放最近 7 天的数据。' },
        { id: 'tab-chart', label: '可视化', content: '内置折线、柱状、饼图与圆环四种图表，移动端自动切换为可读的数据表。' },
        { id: 'tab-auth', label: '权限管理', content: '按角色控制到字段级，所有导出操作写入审计日志，默认保留 180 天。' }
      ]
    },
    'ui-carousel': {
      label: '产品亮点',
      items: [
        { title: '分钟级同步', content: '业务库变更平均 40 秒进入指标层，大促期间延迟不超过 2 分钟。' },
        { title: '字段级权限', content: '同一个看板，不同角色看到的指标口径和字段范围可以不同。' },
        { title: '可回滚发布', content: '每次发布都有版本快照，出问题时一键回到上一个稳定版本。' }
      ],
      autoplay: true,
      interval: 5000,
      loop: true,
      indicators: true,
      controls: true,
      pauseOnHover: true
    },
    'ui-timeline': {
      orientation: 'vertical',
      items: [
        { title: '需求评审通过', time: '2026-09-02', status: 'done', content: '确认本期范围：数据接入、指标看板、字段级权限三项。' },
        { title: '设计稿交付', time: '2026-09-09', status: 'done', content: '完成 12 个页面的高保真稿，移动端断点补到 375px。' },
        { title: '开发联调', time: '2026-09-18', status: 'active', content: '接口联调完成 8 / 10，剩余导出与审计日志两个模块。' },
        { title: '灰度发布', time: '2026-10-08', status: 'pending', content: '先放量 10% 客户，观察 48 小时错误率与响应时长。' }
      ]
    },
    'ui-code': {
      code: 'function formatCny(cents) {\n  const yuan = cents / 100;\n  return new Intl.NumberFormat(\'zh-CN\', {\n    style: \'currency\',\n    currency: \'CNY\'\n  }).format(yuan);\n}\n\nformatCny(129900);\n// ¥1,299.00',
      language: 'javascript',
      filename: 'src/format-cny.js',
      lineNumbers: true,
      copyable: true,
      highlight: true,
      maxHeight: '360px'
    },
    'ui-state': {
      kind: 'empty',
      title: '这个月还没有订单',
      text: '调整筛选条件，或等到下一批订单同步后再查看。',
      retry: true,
      retryLabel: '重新加载',
      compact: false
    },
    'ui-textfield': {
      label: '工作邮箱',
      name: 'email',
      value: 'lin.yu@lantern.dev',
      placeholder: 'name@company.com',
      type: 'email',
      required: true,
      help: '用于接收账单、发票与产品通知。',
      maxLength: 80,
      showCount: true,
      clearable: true
    },
    'ui-otp': {
      label: '短信验证码',
      length: 6,
      mode: 'numeric',
      value: '482913',
      name: 'otp',
      help: '已发送至 138****6721，5 分钟内有效。',
      copyable: true
    },
    'ui-upload': {
      mode: 'preview',
      title: '上传交付素材',
      hint: '支持 PNG / JPG / PDF，单张不超过 5 MB，一次最多 5 个文件。',
      accept: 'image/png,image/jpeg,application/pdf',
      multiple: true,
      maxFiles: 5,
      maxSize: 5242880,
      files: [
        { name: '首页改版.png', size: 1843200, status: 'success', progress: 100 },
        { name: '结算页移动端.jpg', size: 2411724, status: 'success', progress: 100 },
        { name: '数据导出说明.pdf', size: 864256, status: 'uploading', progress: 65 }
      ]
    },
    'ui-date': {
      label: '期望交付日期',
      mode: 'single',
      value: '2026-11-20',
      min: '2026-11-01',
      max: '2027-03-31',
      shortcuts: ['today', 'month', 'last7'],
      help: '工作日 18:00 前提交，次日开始排期。'
    },
    'ui-slider': {
      label: '季度投放预算',
      min: 10,
      max: 120,
      step: 5,
      value: [40, 90],
      range: true,
      unit: '万元',
      marks: [
        { value: 10, label: '10 万' },
        { value: 60, label: '60 万' },
        { value: 120, label: '120 万' }
      ],
      showInput: true,
      help: '预算区间会影响可投放的城市数量。'
    },
    'ui-autocomplete': {
      label: '客户名称',
      name: 'customer',
      placeholder: '输入公司名或客户编号',
      mode: 'local',
      options: [
        { label: '远航教育科技', value: 'yuanhang' },
        { label: '杭州云栖茶业', value: 'yunqi' },
        { label: '北辰医疗器械', value: 'beichen' },
        { label: '南山精密制造', value: 'nanshan' }
      ],
      value: 'yuanhang',
      multiple: false,
      help: '支持按公司名或客户编号搜索。'
    },
    'ui-select': {
      label: '订阅方案',
      name: 'plan',
      options: [
        { label: '基础版 · ¥99 / 月', value: 'basic' },
        { label: '专业版 · ¥299 / 月', value: 'pro' },
        { label: '旗舰版 · ¥899 / 月', value: 'max' },
        { label: '私有部署 · 按需报价', value: 'private' }
      ],
      value: 'pro',
      placeholder: '选择方案',
      help: '升级按剩余天数折算差价。'
    },
    'ui-multiselect': {
      label: '通知方式',
      name: 'notify',
      options: [
        { label: '邮件', value: 'email' },
        { label: '短信', value: 'sms' },
        { label: '企业微信', value: 'wechat' },
        { label: '站内信', value: 'inapp' }
      ],
      value: ['email', 'wechat'],
      help: '至少选择一种，否则告警不会送达。'
    },
    'ui-radio-group': {
      label: '结算周期',
      name: 'billing',
      options: [
        { label: '月付', value: 'monthly' },
        { label: '年付 · 省 2 个月', value: 'yearly' },
        { label: '一次性买断', value: 'lifetime' }
      ],
      value: 'yearly'
    },
    'ui-checkbox-group': {
      label: '订阅内容',
      name: 'subscriptions',
      options: [
        { label: '产品更新', value: 'product' },
        { label: '行业报告', value: 'report' },
        { label: '活动邀请', value: 'event' },
        { label: '新功能内测', value: 'beta' }
      ],
      value: ['product', 'report']
    },
    'ui-switch': {
      label: '自动续费',
      name: 'renew',
      value: true,
      onLabel: '已开启',
      offLabel: '已关闭',
      help: '关闭后，当前周期结束将不再扣款。'
    },
    'ui-number': {
      label: '团队席位数',
      name: 'seats',
      value: 12,
      min: 3,
      max: 200,
      step: 1,
      unit: ' 个',
      help: '3 人起购，可随时调整。'
    },
    'ui-textarea': {
      label: '需求描述',
      name: 'note',
      value: '希望把订单数据接入现有 BI 看板，并在每晚 8 点前完成当日数据同步。',
      rows: 4,
      maxLength: 200,
      placeholder: '写下你现在的流程，以及希望改成什么样。'
    },
    'ui-tags': {
      label: '项目标签',
      name: 'tags',
      value: ['移动端', '支付', '企业服务', '数据分析'],
      placeholder: '输入后按回车添加',
      maxTags: 8,
      help: '最多 8 个标签，用于项目检索。'
    },
    'ui-cascader': {
      label: '所属行业',
      name: 'industry',
      options: [
        { value: 'manufacturing', label: '制造业', children: [
          { value: 'electronics', label: '电子制造' },
          { value: 'auto-parts', label: '汽车零部件' }
        ] },
        { value: 'retail', label: '零售与消费', children: [
          { value: 'ecommerce', label: '电商' },
          { value: 'offline', label: '连锁门店' }
        ] },
        { value: 'health', label: '医疗健康', children: [
          { value: 'hospital', label: '医院' },
          { value: 'pharma', label: '医药研发' }
        ] }
      ],
      value: ['manufacturing', 'electronics'],
      placeholder: '选择行业'
    },
    'ui-rating': {
      label: '服务满意度',
      name: 'rating',
      value: 4,
      max: 5,
      help: '评分会同步给客户成功团队。'
    },
    'ui-chart-line': {
      title: '月度活跃用户',
      subtitle: '2026 年 1–6 月，单位：人',
      labels: ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月'],
      series: [
        { name: '新增用户', values: [1280, 1560, 1430, 1890, 2140, 2360] },
        { name: '活跃用户', values: [8200, 8600, 9100, 9800, 10400, 11200] }
      ],
      height: 260,
      legend: true,
      showTable: true,
      smooth: true,
      showDots: true
    },
    'ui-chart-bar': {
      title: '各渠道订单量',
      subtitle: '2026 年 10 月',
      labels: ['小程序', '官网', '门店', '企业微信', '电话回访', '合作伙伴'],
      series: [
        { name: '订单量', values: [1860, 1240, 960, 720, 410, 380] }
      ],
      height: 260,
      legend: true,
      showTable: true
    },
    'ui-chart-pie': {
      title: '订单来源构成',
      subtitle: '按渠道统计',
      data: [
        { label: '小程序', value: 38 },
        { label: '官网', value: 24 },
        { label: '门店', value: 17 },
        { label: '企业微信', value: 11 },
        { label: '电话回访', value: 6 },
        { label: '其他', value: 4 }
      ],
      height: 260,
      legend: true,
      showTable: true
    },
    'ui-chart-donut': {
      title: '订阅收入构成',
      subtitle: '2026 年 10 月',
      data: [
        { label: '专业版', value: 43 },
        { label: '旗舰版', value: 26 },
        { label: '基础版', value: 16 },
        { label: '私有部署', value: 9 },
        { label: '增值服务', value: 4 },
        { label: '其他', value: 2 }
      ],
      centerValue: '¥286 万',
      centerLabel: '本月合计',
      thickness: 36,
      height: 260,
      legend: true,
      showTable: true
    },
    'ui-sparkline': {
      title: '近 12 周留存率',
      subtitle: '单位：%',
      labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'],
      data: [
        { label: 'W1', value: 38 }, { label: 'W2', value: 41 },
        { label: 'W3', value: 39 }, { label: 'W4', value: 44 },
        { label: 'W5', value: 46 }, { label: 'W6', value: 43 },
        { label: 'W7', value: 47 }, { label: 'W8', value: 49 },
        { label: 'W9', value: 48 }, { label: 'W10', value: 51 },
        { label: 'W11', value: 53 }, { label: 'W12', value: 52 }
      ],
      sparkType: 'line',
      width: 160,
      height: 40
    },
    'ui-kpi': {
      title: '月度经常性收入',
      value: 1284600,
      unit: ' 元',
      decimals: 0,
      comparison: 12.4,
      comparisonLabel: '较上月',
      note: '口径：已支付且未退款的订阅，含税。'
    },
    'ui-progress': {
      title: '第三季度交付进度',
      value: 72,
      max: 100,
      format: 'percent',
      size: 'md',
      caption: '已完成 36 / 50 个交付项，剩余 2 周。'
    },
    'ui-progress-ring': {
      title: '客户满意度',
      value: 92,
      max: 100,
      size: 128,
      thickness: 12,
      centerLabel: '好评率',
      caption: '来自 412 份回访问卷。'
    },
    'ui-site-nav': {
      brand: 'Lantern 数据平台',
      brandHref: 'index.html',
      items: [
        { label: '产品', href: 'product.html', children: [
          { label: '数据接入', href: 'product-ingest.html' },
          { label: '指标看板', href: 'product-dashboard.html' }
        ] },
        { label: '解决方案', href: 'solutions.html' },
        { label: '价格', href: 'pricing.html' },
        { label: '文档', href: 'docs.html', badge: '新' }
      ],
      cta: { label: '免费试用', href: 'signup.html' },
      sticky: true
    },
    'ui-site-footer': {
      brand: 'Lantern 数据平台',
      description: '把分散在业务库、埋点与工单里的数据，收拢成一套可复用的指标。',
      columns: [
        { title: '产品', links: [
          { label: '数据接入', href: 'product-ingest.html' },
          { label: '指标看板', href: 'product-dashboard.html' },
          { label: '权限管理', href: 'product-auth.html' }
        ] },
        { title: '资源', links: [
          { label: '快速开始', href: 'docs-quickstart.html' },
          { label: 'API 参考', href: 'docs-api.html' },
          { label: '状态页', href: 'status.html' }
        ] },
        { title: '公司', links: [
          { label: '关于我们', href: 'about.html' },
          { label: '加入我们', href: 'careers.html' },
          { label: '联系我们', href: 'contact.html' }
        ] }
      ],
      copyright: '© 2026 杭州朗途科技有限公司',
      note: '浙ICP备2026012345号',
      legal: [
        { label: '隐私政策', href: 'privacy.html' },
        { label: '服务条款', href: 'terms.html' },
        { label: '安全说明', href: 'security.html' }
      ]
    },
    'ui-sidebar': {
      title: '本页目录',
      description: '数据接入指南',
      items: [
        { label: '接入前准备', href: '#section-1' },
        { label: '上报第一条事件', href: '#section-2' },
        { label: '校验与去重', href: '#section-3' },
        { label: '常见问题', href: '#section-4' }
      ],
      sticky: true,
      footnote: '最后更新：2026-11-06'
    },
    'ui-breadcrumb': {
      items: [
        { label: '文档', href: 'docs.html' },
        { label: '指南', href: 'docs-guide.html' },
        { label: '数据接入' }
      ],
      auto: false,
      homeLabel: '首页',
      homeHref: 'index.html'
    },
    'ui-page-header': {
      eyebrow: '指南 · 数据接入',
      title: '把业务数据接入 Lantern',
      subtitle: '从上报第一条事件到看板出数，大约需要 30 分钟。',
      meta: [
        { label: '阅读时长', value: '8 分钟' },
        { label: '更新于', value: '2026-11-06' },
        { label: '适用版本', value: 'v2.3 及以上' }
      ],
      actions: [
        { label: '下载 SDK', href: 'downloads.html', variant: 'primary' },
        { label: '查看 API', href: 'docs-api.html' }
      ],
      align: 'left'
    }
  };

  var blockDefaults = {
    heading: { text: '接入流程概览', level: 2 },
    paragraph: {
      md: '把业务库、埋点和客服工单里的数据接进 Lantern，分三步：**上报**、**校验**、**建模**。每一步都有对应的日志，失败时会给出可定位的错误码。'
    },
    markdown: {
      md: '## 为什么先做指标口径\n\n' +
        '同一个「活跃用户」，运营按 30 天内登录一次计算，产品按 7 天内完成核心动作计算，两边看板自然对不上。\n\n' +
        '先把口径写进指标字典，再接入数据：\n\n' +
        '- **GMV**：已支付且未退款的订单金额\n' +
        '- **留存率**：次周仍完成核心动作的用户占比\n' +
        '- **首次响应时长**：工单创建到客服首次回复的分钟数\n\n' +
        '| 指标 | 数据来源 | 更新频率 |\n' +
        '| --- | --- | --- |\n' +
        '| GMV | 订单库 | 5 分钟 |\n' +
        '| 留存率 | 埋点事件 | 每日 |\n' +
        '| 首次响应时长 | 客服工单 | 10 分钟 |'
    },
    html: {
      html: '<section class="callout">' +
        '<h3>为什么用 event_id 去重</h3>' +
        '<p>同一笔支付可能被回调通知两次。按 <code>event_id</code> 幂等写入后，重复率从 1.8% 降到 0.02%，对账时不再出现双倍金额。</p>' +
        '</section>'
    },
    note: {
      title: '上线前检查',
      variant: 'warn',
      md: '导出前确认三件事：外链都带 `rel="noopener"`，表格数据源返回 200，单张图片不超过 1 MB。'
    },
    cards: {
      columns: 3,
      cards: [
        { title: '统一指标口径', body: '把 GMV、留存、响应时长收拢到一套定义，避免各部门各算各的。', href: '' },
        { title: '分钟级同步', body: '订单库变更平均 40 秒进入指标层，大促期间延迟不超过 2 分钟。', href: '' },
        { title: '权限到字段', body: '支持按角色控制到字段级，审计日志默认保留 180 天。', href: '' }
      ]
    },
    image: {
      src: IMAGE_SRC,
      alt: 'Lantern 数据平台三层架构示意',
      caption: '数据从采集层经过清洗建模，最终进入指标服务层。'
    },
    divider: {},
    button: {
      label: '查看完整接入文档',
      href: 'docs-data-onboarding.html',
      variant: 'primary',
      align: 'left'
    },
    code: {
      lang: 'bash',
      code: 'curl -X POST https://api.lantern.dev/v1/events \\\n' +
        '  -H "Authorization: Bearer $LANTERN_TOKEN" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        '  -d \'{"event":"order_paid","userId":"u_1042","amount":1299}\''
    },
    articleList: { limit: 5 },
    container: {
      variant: 'columns',
      title: '自建采集与托管采集',
      columns: 2,
      blocks: [
        { id: 'default-col-a-head', type: 'heading', text: '自建采集', level: 3 },
        { id: 'default-col-a-body', type: 'paragraph', md: '适合已有数据团队的公司：自己维护上报服务，按需做脱敏和补采，成本更可控。' },
        { id: 'default-col-b-head', type: 'heading', text: '托管采集', level: 3 },
        { id: 'default-col-b-body', type: 'paragraph', md: '适合缺人手的团队：SDK 与同步任务由平台维护，你只需要确认字段映射和刷新频率。' }
      ]
    },
    mermaid: {
      md: '```mermaid\nflowchart LR\n  A[业务库] --> B[采集服务]\n  B --> C{校验}\n  C -->|通过| D[指标层]\n  C -->|失败| E[告警与重试]\n```'
    },
    articleBody: {
      md: '## 接入前准备\n\n' +
        '在控制台创建应用后，你会拿到一对密钥：`client_id` 与 `client_secret`。密钥只在创建时展示一次，请放进服务端的环境变量。\n\n' +
        '## 上报第一条事件\n\n' +
        '用 cURL 发一条测试事件，确认网络、鉴权和字段映射都正确：\n\n' +
        '```bash\ncurl -X POST https://api.lantern.dev/v1/events \\\n  -H "Authorization: Bearer $LANTERN_TOKEN" \\\n  -d \'{"event":"order_paid","userId":"u_1042","amount":1299}\'\n```\n\n' +
        '## 校验与去重\n\n' +
        '同一笔支付可能收到多次回调。带上稳定的 `event_id`，平台会按幂等键去重，重复写入不会影响指标。\n\n' +
        '## 常见问题\n\n' +
        '- **事件延迟超过 5 分钟**：检查上报服务的队列积压与重试策略。\n' +
        '- **金额单位不一致**：平台统一按「分」存储，展示时再换算成元。\n' +
        '- **字段缺失**：在字段映射页补齐后，历史数据会在次日重新计算。'
    }
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function getComponentDefaults(type) {
    var key = String(type == null ? '' : type);
    if (Object.prototype.hasOwnProperty.call(componentDefaults, key)) return clone(componentDefaults[key]);
    if (Object.prototype.hasOwnProperty.call(blockDefaults, key)) return clone(blockDefaults[key]);
    return null;
  }

  function getBlockDefaults(type) {
    var key = String(type == null ? '' : type);
    return Object.prototype.hasOwnProperty.call(blockDefaults, key) ? clone(blockDefaults[key]) : null;
  }

  return {
    componentDefaults: componentDefaults,
    blockDefaults: blockDefaults,
    getComponentDefaults: getComponentDefaults,
    getBlockDefaults: getBlockDefaults
  };
}));
