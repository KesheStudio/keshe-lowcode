/* 渲染核心 · 内置组件样例
   新插入的内置组件默认带上这一组样例数据，保证「插入即见效果」。
   这里只放能直接渲染的最小真实内容，用户之后可在检查器里改。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LC = root.LC || {};
    root.LC.Render = root.LC.Render || {};
    root.LC.Render.ComponentSamples = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%232f6f5e'/%3E%3Cstop offset='1' stop-color='%23c9a227'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='360' fill='url(%23g)'/%3E%3Ctext x='320' y='192' font-family='sans-serif' font-size='44' fill='white' text-anchor='middle'%3E示例图片%3C/text%3E%3C/svg%3E";

  return {
    'ui-table': {
      caption: '本月订单（示例）',
      columns: [
        { key: 'id', title: '订单号' },
        { key: 'customer', title: '客户' },
        { key: 'amount', title: '金额', align: 'right', format: 'number' },
        { key: 'status', title: '状态' }
      ],
      rows: [
        { id: 'A-1001', customer: '青禾设计', amount: 1280, status: '已付款' },
        { id: 'A-1002', customer: '山间书店', amount: 640, status: '待发货' },
        { id: 'A-1003', customer: '拾光咖啡', amount: 320, status: '已完成' }
      ],
      pageSize: 5
    },
    'ui-image': { src: IMAGE, alt: '示例图片', ratio: '16:9', caption: '插入后可替换为你的图片地址' },
    'ui-form': {
      fields: [
        { name: 'name', label: '姓名', type: 'text', placeholder: '请输入姓名', required: true },
        { name: 'email', label: '邮箱', type: 'email', placeholder: 'you@example.com', required: true },
        { name: 'topic', label: '咨询主题', type: 'select', options: [{ value: 'product', label: '产品' }, { value: 'support', label: '技术支持' }] },
        { name: 'message', label: '留言', type: 'textarea', placeholder: '简单说明你的需求', rows: 3 }
      ],
      submitLabel: '提交咨询'
    },
    'ui-modal': { title: '确认操作', triggerLabel: '打开示例对话框', body: '这是一个可以直接使用的对话框示例。', open: true },
    'ui-drawer': { title: '更多信息', triggerLabel: '打开示例抽屉', body: '抽屉适合放筛选、详情或次级操作。', open: true, placement: 'right' },
    'ui-tabs': {
      items: [
        { id: 'overview', label: '概览', content: '这里是概览内容。' },
        { id: 'details', label: '详情', content: '这里是详情内容。' },
        { id: 'faq', label: '常见问题', content: '这里是常见问题内容。' }
      ]
    },
    'ui-carousel': {
      items: [
        { title: '第一屏', content: '用轮播展示重点内容。' },
        { title: '第二屏', content: '支持自动播放与手动切换。' },
        { title: '第三屏', content: '移动端同样可用。' }
      ]
    },
    'ui-timeline': {
      items: [
        { title: '提交需求', time: '09:00', status: 'done', content: '已收到需求。' },
        { title: '方案确认', time: '11:30', status: 'active', content: '正在确认方案。' },
        { title: '开始实施', time: '14:00', status: 'pending', content: '等待开始。' }
      ]
    },
    'ui-code': { code: 'function greet(name) {\n  return "你好，" + name + "！";\n}\n\nconsole.log(greet("世界"));', language: 'javascript', filename: 'greet.js' },
    'ui-state': { kind: 'empty', title: '这里还没有内容', text: '可以通过上面的按钮添加第一条记录。', retry: false },
    'ui-textfield': { label: '邮箱', name: 'email', placeholder: 'you@example.com', type: 'email', help: '用于接收通知，不会公开。' },
    'ui-otp': { label: '验证码', name: 'code', value: '' },
    'ui-upload': { endpoint: '', title: '上传附件', hint: '支持拖拽或点击选择，单文件不超过 10 MB。', files: [] },
    'ui-date': { label: '日期', name: 'date', mode: 'single' },
    'ui-slider': { label: '预算范围', min: 0, max: 100, value: 40, unit: '%', showInput: true },
    'ui-autocomplete': { label: '搜索城市', name: 'city', placeholder: '输入城市名', options: [{ label: '北京', value: 'beijing' }, { label: '上海', value: 'shanghai' }, { label: '广州', value: 'guangzhou' }] },
    'ui-select': { label: '选择套餐', name: 'plan', options: [{ value: 'basic', label: '基础版' }, { value: 'pro', label: '专业版' }, { value: 'team', label: '团队版' }], placeholder: '请选择套餐' },
    'ui-multiselect': { label: '感兴趣的服务', name: 'services', options: [{ value: 'web', label: '网站建设' }, { value: 'app', label: '应用开发' }, { value: 'ops', label: '运维支持' }], value: ['web'] },
    'ui-radio-group': { label: '联系方式', name: 'contact', options: [{ value: 'phone', label: '电话' }, { value: 'email', label: '邮件' }], value: 'email' },
    'ui-checkbox-group': { label: '订阅内容', name: 'topics', options: [{ value: 'news', label: '产品动态' }, { value: 'tips', label: '使用技巧' }, { value: 'events', label: '活动通知' }], value: ['news'] },
    'ui-switch': { label: '接收邮件通知', name: 'notify', value: true },
    'ui-number': { label: '数量', name: 'quantity', value: 2, min: 1, max: 10 },
    'ui-textarea': { label: '备注', name: 'note', placeholder: '补充说明（选填）', rows: 4 },
    'ui-tags': { label: '标签', name: 'tags', value: ['设计', '前端'] },
    'ui-cascader': { label: '所在地区', name: 'region', options: [{ value: 'east', label: '华东' }, { value: 'north', label: '华北' }, { value: 'south', label: '华南' }], value: ['east'] },
    'ui-rating': { label: '满意度', name: 'rating', value: 4, max: 5 },
    'ui-chart-line': { title: '访问趋势（示例）', data: [{ label: '周一', value: 120 }, { label: '周二', value: 180 }, { label: '周三', value: 150 }, { label: '周四', value: 220 }, { label: '周五', value: 260 }], area: true, showDots: true },
    'ui-chart-bar': { title: '渠道对比（示例）', data: [{ label: '自然搜索', value: 320 }, { label: '直接访问', value: 210 }, { label: '社交媒体', value: 150 }] },
    'ui-chart-pie': { title: '流量来源（示例）', data: [{ label: '搜索', value: 42 }, { label: '直接访问', value: 28 }, { label: '社交', value: 18 }, { label: '其他', value: 12 }] },
    'ui-chart-donut': { title: '预算分配（示例）', data: [{ label: '研发', value: 46 }, { label: '市场', value: 32 }, { label: '运营', value: 22 }], centerValue: '100%', centerLabel: '已分配' },
    'ui-sparkline': { data: [{ label: '1', value: 12 }, { label: '2', value: 18 }, { label: '3', value: 15 }, { label: '4', value: 24 }, { label: '5', value: 22 }], width: 120, height: 32 },
    'ui-kpi': { label: '本月新增用户', value: 1280, comparison: 12.5, comparisonLabel: '较上月', suffix: '人' },
    'ui-progress': { title: '项目进度', value: 68, max: 100, caption: '示例进度，可在检查器里调整。' },
    'ui-progress-ring': { title: '目标完成度', value: 76, max: 100, centerLabel: '完成度' },
    'ui-site-nav': {
      brand: '青禾工作室',
      brandHref: 'index.html',
      items: [{ label: '首页', href: 'index.html' }, { label: '服务', href: 'index.html#services' }, { label: '关于', href: 'index.html#about' }],
      cta: { label: '联系我们', href: 'index.html#contact' }
    },
    'ui-site-footer': {
      brand: '青禾工作室',
      description: '设计、开发与上线，一个人也能把站点做完整。',
      columns: [
        { title: '产品', links: [{ label: '服务', href: 'index.html#services' }, { label: '案例', href: 'index.html#cases' }] },
        { title: '支持', links: [{ label: '常见问题', href: 'index.html#faq' }, { label: '联系我们', href: 'index.html#contact' }] }
      ],
      copyright: '© 2026 青禾工作室',
      legal: [{ label: '隐私', href: 'index.html' }, { label: '条款', href: 'index.html' }]
    },
    'ui-sidebar': { title: '本页目录', description: '快速跳到页面中的小节。', items: [{ label: '概览', href: '#overview' }, { label: '功能', href: '#features' }, { label: '价格', href: '#pricing' }], footnote: '内容会随页面更新。' },
    'ui-breadcrumb': { items: [{ label: '首页', href: 'index.html' }, { label: '文档', href: 'index.html' }, { label: '示例页面', href: '' }], auto: false },
    'ui-page-header': { eyebrow: '示例页面', title: '把想法整理成可上线的站点', subtitle: '这是一段可以直接替换的页面说明。', meta: [{ label: '更新于 2026-11-08' }, { label: '阅读 3 分钟' }], actions: [{ label: '开始使用', href: '#start', variant: 'primary' }, { label: '查看文档', href: '#docs', variant: 'ghost' }] }
  };
}));
