/* 站内检索 · 样例数据
 *
 * 两个用途：
 * 1. createSamplePages(count) 生成 50+ 页中英文混合数据，供 bench / verify 使用；
 * 2. createDemoPages() 生成 demo 页里内联的小索引，正文与 demo 页面上的段落对应。
 *
 * 全部是确定性拼装，没有随机数，因此每次生成结果一致，便于比较索引字节。
 */

const TOPICS = [
  {
    key: 'cache',
    zh: '缓存',
    en: 'cache',
    tags: ['缓存', '性能', 'HTTP'],
    headings: ['强缓存与 Cache-Control', '协商缓存 ETag 与 Last-Modified', '缓存键与版本号', '缓存穿透、击穿与雪崩'],
    sentences: [
      '强缓存由 Cache-Control 的 max-age 和 public 指令决定，命中时浏览器直接读取本地副本，不再向服务器发请求。',
      '协商缓存把 ETag 或 Last-Modified 带回去，服务器判断内容没变就返回 304，只省传输不省往返。',
      '缓存键要能区分语言、登录态和版本，常见做法是把版本号或内容哈希拼进 URL，而不是到处写 no-cache。',
      '缓存穿透是查了不存在的键，击穿是热点键过期瞬间大量回源，雪崩是同一时刻大批键一起失效。',
      '反向代理和浏览器是两层缓存，排查命中率时要先确认看的是哪一层的日志和响应头。'
    ]
  },
  {
    key: 'index',
    zh: '倒排索引',
    en: 'inverted index',
    tags: ['索引', '搜索', '数据结构'],
    headings: ['倒排索引的结构', '词典与倒排表', '位置信息与短语查询', '增量更新与合并'],
    sentences: [
      '倒排索引把词映射到文档编号列表，查询时按词取出候选文档，再合并打分，避免逐篇扫描全文。',
      '词典通常用有序数组或前缀树保存，倒排表保存文档编号、词频和可选的位置信息。',
      '只有文档编号时能做布尔查询，加上位置信息才能判断两个词是否相邻，从而支持短语搜索。',
      '增量更新要么把新文档写进小段再定期合并，要么直接改倒排表，前者写快读慢，后者相反。',
      '删除通常不做物理删除，而是加删除标记，等段合并时再真正清理，避免频繁搬动整个倒排表。'
    ]
  },
  {
    key: 'tokenizer',
    zh: '分词',
    en: 'tokenizer',
    tags: ['分词', '中文', '搜索'],
    headings: ['中文为什么需要分词', '字典分词与统计分词', '二字切分与单字回退', '停用词与标点处理'],
    sentences: [
      '英文单词天然有空格分隔，中文没有，必须先切分成词或字，才能建立可检索的索引。',
      '字典分词依赖词表，歧义时用最大匹配或最短路径；统计分词依赖语料训练，未登录词表现更好。',
      '轻量方案可以按二字切分并保留单字，不用维护词典，代价是会产生一些无意义的组合。',
      '停用词过滤要谨慎，单字停用词可以丢，双字组合最好保留，否则可用、上游这类词会被误杀。',
      '标点、表情和全角符号先做归一化，再参与切分，否则同一个词会因为符号不同变成两个词。'
    ]
  },
  {
    key: 'ranking',
    zh: '搜索排序',
    en: 'ranking',
    tags: ['搜索', '排序', 'BM25'],
    headings: ['词频与逆文档频率', 'BM25 的饱和与长度归一', '字段权重与标题命中', '排序稳定性和可解释性'],
    sentences: [
      '词频衡量一个词在文档里出现多少次，逆文档频率衡量这个词有多稀有，两者相乘就是最朴素的打分。',
      'BM25 在词频上加了饱和函数，词出现十次不会比出现五次重要一倍，同时按文档长度做惩罚。',
      '标题和章节标题命中通常比正文命中更重要，可以给字段乘不同权重，也可以单独分组展示。',
      '排序要稳定，同分时按路径或发布时间兜底，否则每次刷新顺序都可能变，用户会以为结果坏了。',
      '可解释性同样重要，结果里展示命中片段和命中字段，用户才知道为什么这条排在这里。'
    ]
  },
  {
    key: 'build',
    zh: '前端构建',
    en: 'bundling',
    tags: ['构建', 'Vite', '依赖'],
    headings: ['依赖图与模块解析', '打包与代码分割', '构建缓存与增量构建', '产物体积与压缩'],
    sentences: [
      '构建工具从入口开始解析 import，形成依赖图，再决定哪些模块打进同一个包。',
      '代码分割把路由或大组件拆成独立文件，首屏只加载需要的部分，剩余部分按需请求。',
      '增量构建依赖文件哈希和依赖图缓存，改一个文件只重算受影响的模块，冷启动和热更新是两种不同路径。',
      '产物体积要看压缩前、gzip 后和实际传输三个数字，只看其中一个很容易误判。',
      '第三方库往往占大头，先看构建分析报告，再决定是换库、按需引入还是拆包，不要一上来就开激进压缩。'
    ]
  },
  {
    key: 'deploy',
    zh: '部署',
    en: 'deployment',
    tags: ['部署', 'Nginx', '运维'],
    headings: ['反向代理与静态资源', '进程管理与重启', '证书与 HTTPS', '回滚与灰度'],
    sentences: [
      '静态站点用 Nginx 直接托管最省事，反向代理再把接口请求转给后端进程。',
      '进程管理要保证崩溃能拉起、发布能平滑重启，单机最少也要有健康检查和日志落盘。',
      'HTTPS 证书有有效期，过期当天所有请求都会失败，续期和到期提醒要写进发布流程。',
      '回滚不是把旧包再传一次，而是保留上一版产物和配置，出了问题能在几分钟内切回去。',
      '灰度发布先切少量流量，观察错误率和延迟，再逐步放量，别一次性把全部实例换掉。'
    ]
  },
  {
    key: 'database',
    zh: '数据库事务',
    en: 'transaction',
    tags: ['数据库', '事务', 'MVCC'],
    headings: ['事务的 ACID', '隔离级别与并发异常', 'MVCC 与版本链', '死锁与重试'],
    sentences: [
      '事务把多条写操作打包成一个整体，要么全部成功，要么全部回滚，中间状态不能被其他事务看到。',
      '隔离级别越高并发冲突越少，但锁等待越多；读已提交和可重复读是最常见的两档。',
      'MVCC 通过版本链和快照读避免读写互相阻塞，更新时再判断版本是否仍然可见。',
      '死锁通常来自两个事务以相反顺序锁同一批行，数据库会杀掉其中一个，应用层要能识别并重试。',
      '长事务会拖住清理线程，导致版本链越来越长，排查慢查询时要同时看事务持续时间和锁等待。'
    ]
  },
  {
    key: 'performance',
    zh: '性能剖析',
    en: 'profiler',
    tags: ['性能', 'profiler', '火焰图'],
    headings: ['先测量再优化', '火焰图怎么看', '内存与垃圾回收', '前端性能指标'],
    sentences: [
      '性能问题先测量再动手，没有基线的优化很容易把时间花在无关紧要的地方。',
      '火焰图横向宽度代表占用时间，纵向代表调用栈，最上面宽而平的那一段通常就是热点。',
      '内存问题看分配速率和回收频率，频繁回收会让延迟出现规律性抖动，而不是持续变慢。',
      '前端指标要区分实验室数据和真实用户数据，实验室稳定可复现，真实数据才有代表性。',
      '优化后要用同一份数据和同一套环境复测，否则很难判断收益是来自代码还是来自机器。'
    ]
  },
  {
    key: 'observability',
    zh: '可观测性',
    en: 'observability',
    tags: ['可观测性', '日志', 'tracing'],
    headings: ['日志、指标与链路', '结构化日志', '采样与成本', '告警设计'],
    sentences: [
      '日志回答发生了什么，指标回答整体趋势，链路追踪回答一次请求经过了哪些服务。',
      '日志要结构化，至少带时间、级别、请求标识和关键业务字段，纯文本日志在检索时非常吃力。',
      '全量采集链路数据成本很高，通常按错误、慢请求和固定比例采样，保证问题现场还能还原。',
      '告警要少而准，阈值告警容易在流量波动时误报，结合持续时间和错误率会更稳。',
      '可观测性不是装一个平台就结束了，字段规范、采样策略和排班响应都要一起定。'
    ]
  },
  {
    key: 'accessibility',
    zh: '无障碍',
    en: 'accessibility',
    tags: ['无障碍', '键盘', '对比度'],
    headings: ['键盘可达性', '语义与焦点管理', '颜色对比度', '屏幕阅读器实测'],
    sentences: [
      '所有可点击元素都要能通过键盘到达，Tab 顺序要和视觉顺序一致，不能靠 div 加 onclick 糊弄。',
      '弹窗打开后焦点要进入弹窗，关闭后回到触发按钮，否则键盘用户会迷失在页面里。',
      '正文和背景的对比度至少达到 4.5 比 1，大字号可以放宽，但暗色主题要单独检查。',
      '无障碍不是加几个 aria 属性就完事，真实用屏幕阅读器走一遍，才会发现读不出或读重复的问题。',
      '焦点样式不要直接 outline none，可以换成更清楚的内外两层焦点环，保证任何背景上都看得见。'
    ]
  },
  {
    key: 'security',
    zh: '安全',
    en: 'security',
    tags: ['安全', '令牌', 'JWT'],
    headings: ['认证与授权', 'JWT 与刷新令牌', '密码存储', '常见注入与防护'],
    sentences: [
      '认证回答你是谁，授权回答你能做什么，两者混在一起写，后面很难加权限点。',
      'JWT 适合无状态校验，但撤销困难；刷新令牌可以轮换并落库，用来弥补这一点。',
      '密码只能用带盐的慢哈希保存，bcrypt、scrypt 或 Argon2 都可以，绝不能自己发明加密方案。',
      'SQL 注入靠参数化查询防，XSS 靠输出转义和内容安全策略防，命令注入则要避免拼接用户输入。',
      '错误信息不要泄漏用户是否存在，登录失败统一提示，频率限制和失败计数要同时做。'
    ]
  },
  {
    key: 'network',
    zh: '网络请求',
    en: 'HTTP request',
    tags: ['网络', 'HTTP', '请求'],
    headings: ['请求生命周期', '连接复用与超时', '重试与幂等', '跨域与预检'],
    sentences: [
      '一次请求会经过 DNS 解析、建立连接、发送请求、等待响应和读取响应几个阶段，慢在哪一段要分开看。',
      '连接复用能省掉握手开销，但连接池太小会排队，太大又会压垮下游，需要结合并发量调。',
      '重试只对幂等请求安全，写请求重试前要有幂等键，否则一次超时可能变成两次下单。',
      '跨域预检由浏览器发起，服务端要正确响应 OPTIONS，并明确允许的方法和请求头。',
      '超时要分层设置，连接超时、读取超时和总超时含义不同，只设一个往往挡不住慢请求。'
    ]
  },
  {
    key: 'concurrency',
    zh: '并发',
    en: 'concurrency',
    tags: ['并发', '线程', '队列'],
    headings: ['并发与并行的区别', '共享状态与锁', '队列与背压', '超时与取消'],
    sentences: [
      '并发是同时处理多件事，并行是同时执行多件事，单核也能并发，只是靠切换。',
      '共享状态要么加锁，要么改成消息传递，锁的粒度越大越安全，也越容易排队。',
      '队列能削峰，但消费者跟不上时必须有背压，否则队列会一直涨，最后把内存吃光。',
      '任务要支持超时和取消，否则一个卡住的请求会占着线程或连接，拖垮整个池子。',
      '排查并发问题要看时间线和线程栈，日志里带上请求标识，才能把交错的事件拼回去。'
    ]
  },
  {
    key: 'storage',
    zh: '存储',
    en: 'storage',
    tags: ['存储', '文件系统', '备份'],
    headings: ['文件与对象存储', '原子写入', '容量与清理', '备份与恢复'],
    sentences: [
      '文件系统适合频繁改写的小文件，对象存储适合一次写入多次读取的大文件，选型先看访问模式。',
      '写入要尽量原子，先写临时文件再重命名，避免进程中途退出留下半个文件。',
      '容量要有配额和清理策略，日志、缓存和临时文件是最容易失控的三类数据。',
      '备份不是复制一份就完了，恢复演练才证明备份可用，恢复时间也要提前估算。',
      '目录权限要收紧，密钥和证书不能和普通静态资源放在同一个可下载目录里。'
    ]
  },
  {
    key: 'testing',
    zh: '测试',
    en: 'testing',
    tags: ['测试', '单元测试', '流水线'],
    headings: ['测试金字塔', '单元测试与集成测试', '测试数据管理', '流水线中的质量门禁'],
    sentences: [
      '单元测试跑得快、定位准，集成测试覆盖真实依赖，端到端测试最接近用户但最慢，比例要合理。',
      '单元测试不要连真实数据库和网络，依赖用假实现替换，否则测试会又慢又不稳定。',
      '测试数据要可重复生成，随机数据要固定种子，跨用例共享数据很容易互相污染。',
      '流水线里先跑快的检查，再跑慢的测试，失败要能直接看到是哪个用例和哪段日志。',
      '覆盖率是参考不是目标，关键路径和边界条件有测试，比把数字刷到很高更有意义。'
    ]
  },
  {
    key: 'release',
    zh: '版本发布',
    en: 'release',
    tags: ['版本', '发布', '回滚'],
    headings: ['语义化版本', '变更日志', '发布检查清单', '回滚与事故复盘'],
    sentences: [
      '语义化版本用主版本表示不兼容变更，次版本表示新增功能，修订号表示修复，团队要约定怎么判定。',
      '变更日志写给人看，说明改了什么、影响谁、怎么迁移，不要只贴提交记录。',
      '发布检查清单至少覆盖构建产物、配置、数据库迁移、证书和回滚包，逐项打勾再上线。',
      '回滚路径要在发布前演练，数据库迁移要尽量向前兼容，否则代码能回滚、数据回不去。',
      '事故复盘对事不对人，写清时间线、影响范围、直接原因和后续动作，别停在「加强注意」。'
    ]
  }
];

const VARIANTS = [
  {
    key: 'intro',
    zh: '入门',
    lead: '先把整体轮廓讲清楚，知道每个概念负责什么，再去看细节。',
    notes: [
      '入门阶段最容易犯的错是一上来就记命令和参数，结果换个场景就不知道该怎么选。',
      '建议先画一张自己的流程图：输入是什么、经过哪几步、输出落到哪里，再对照文档补空缺。'
    ],
    closing: '这一篇的目标不是让你背结论，而是遇到问题时知道该先看哪一层。'
  },
  {
    key: 'advanced',
    zh: '进阶',
    lead: '默认你已经用过一轮，重点讲边界条件、性能代价和容易忽略的坑。',
    notes: [
      '很多方案在演示数据上都很漂亮，真正的问题是数据量上来、并发变高或者依赖不稳定时才出现。',
      '判断一个方案是否成熟，看它失败时怎么退化，而不是看它在顺利路径上跑得多快。'
    ],
    closing: '进阶的分水岭不是会用更多配置，而是能说清楚每个配置换来了什么、又付出了什么。'
  },
  {
    key: 'practice',
    zh: '实践',
    lead: '把概念落到一个能跑起来的小项目里，先做对，再做好。',
    notes: [
      '实践时先把可观测性加上，日志、指标和错误信息齐了，后面排查才不用猜。',
      '每加一个功能都留一条可验证的检查方法，别等上线后才发现根本不知道有没有生效。'
    ],
    closing: '能复现、能验证、能回滚，这三件事比代码写得多漂亮更重要。'
  },
  {
    key: 'troubleshooting',
    zh: '排错',
    lead: '从真实故障出发，按现象、原因、第一步查什么三段来定位。',
    notes: [
      '排错最忌同时改三个地方，先固定变量，一次只动一个，否则好了也不知道是哪一步起的作用。',
      '日志和监控要能对得上时间，跨机器时先校准时钟，再看请求标识把链路串起来。'
    ],
    closing: '故障处理完别急着关单，把判断依据和误判路径写下来，下次能少走一半弯路。'
  }
];

function buildBody(topic, variant) {
  const paragraphs = [];
  paragraphs.push(topic.zh + '（' + topic.en + '）' + variant.zh + '篇：' + variant.lead);
  paragraphs.push(topic.sentences.join(' '));
  paragraphs.push(variant.notes.join(' '));
  paragraphs.push(variant.closing);
  return paragraphs.join('\n\n');
}

export function createSamplePages(count) {
  const total = Math.max(1, Number(count) || 64);
  const pages = [];
  let index = 0;
  while (pages.length < total) {
    const topic = TOPICS[index % TOPICS.length];
    const variant = VARIANTS[Math.floor(index / TOPICS.length) % VARIANTS.length];
    const suffix = variant.key + '-' + String(index + 1).padStart(2, '0');
    pages.push({
      path: 'articles/guide/' + topic.key + '-' + suffix + '.html',
      title: topic.zh + variant.zh + '：' + topic.en + ' 的关键取舍',
      summary: topic.zh + variant.zh + '：' + topic.sentences[0],
      tags: topic.tags.concat([variant.zh]),
      headings: topic.headings.map(function (heading, position) {
        return {
          id: 'section-' + (position + 1),
          text: position === 0 ? heading + '（' + variant.zh + '）' : heading
        };
      }),
      body: buildBody(topic, variant)
    });
    index += 1;
  }
  return pages;
}

/* demo 页专用：正文短，章节 id 与 assets/search-demo.html 里的锚点一致。 */
const DEMO_PAGES = [
  {
    key: 'cache',
    title: '缓存策略：强缓存与协商缓存',
    path: '#demo-cache',
    tags: ['缓存', 'HTTP', '性能'],
    headings: [
      { id: 'demo-cache-title', text: '强缓存与 Cache-Control' },
      { id: 'demo-cache-etag', text: '协商缓存 ETag' }
    ],
    body: '浏览器缓存分强缓存和协商缓存。强缓存由 Cache-Control 的 max-age 控制，命中后连请求都不发。协商缓存把 ETag 或 Last-Modified 发给服务器，由服务器判断是否返回 304。静态资源适合长 max-age 加文件名哈希，HTML 用 no-cache 保持可更新。'
  },
  {
    key: 'index',
    title: '倒排索引：从词到文档',
    path: '#demo-index',
    tags: ['索引', '搜索', '数据结构'],
    headings: [
      { id: 'demo-index-title', text: '倒排索引的结构' },
      { id: 'demo-index-postings', text: '倒排表与增量合并' }
    ],
    body: '倒排索引把词映射到文档编号列表，查询时按词取出候选文档再打分，不需要逐篇扫描全文。词典保存词和倒排表位置，倒排表保存文档编号、词频和可选的位置信息。增量更新通常先写小段再合并，删除用标记位延迟清理。'
  },
  {
    key: 'tokenizer',
    title: '中文分词：二字切分与单字回退',
    path: '#demo-tokenizer',
    tags: ['分词', '中文', '搜索'],
    headings: [
      { id: 'demo-tokenizer-title', text: '二字切分与单字回退' },
      { id: 'demo-stopwords', text: '停用词与标点处理' }
    ],
    body: '中文没有空格，索引前必须先切分。轻量方案按连续汉字切成二字组合，同时保留单字，不用维护词典，代价是会出现一些无意义组合。停用词只过滤单字和英文整词，双字组合保留，避免误杀可用、上游这类技术词。标点先归一化再切分。'
  },
  {
    key: 'ranking',
    title: '搜索排序：词频、idf 与字段权重',
    path: '#demo-ranking',
    tags: ['搜索', '排序', 'BM25'],
    headings: [
      { id: 'demo-ranking-title', text: 'BM25 与 idf' }
    ],
    body: '排序要把稀有词看得更重，idf 就是干这个的。词频不能无限加分，BM25 用饱和函数压住长文档的优势。标题命中比正文命中更重要，可以用字段权重，也可以按标题、章节、正文分组展示。同分时按路径兜底，保证顺序稳定。'
  },
  {
    key: 'build',
    title: '前端构建：依赖图与打包',
    path: '#demo-build',
    tags: ['构建', 'Vite', '依赖'],
    headings: [
      { id: 'demo-build-title', text: 'Vite 与依赖图' },
      { id: 'demo-bundling', text: 'Bundling 与产物体积' }
    ],
    body: '构建工具从入口解析 import，形成依赖图，再决定哪些模块进同一个包。代码分割让首屏只加载需要的部分，其余按需请求。产物体积要看压缩前、gzip 后和实际传输三个数字。第三方库通常占大头，先看分析报告再决定拆包。'
  },
  {
    key: 'deploy',
    title: '部署：Nginx 与 HTTPS',
    path: '#demo-deploy',
    tags: ['部署', 'Nginx', '运维'],
    headings: [
      { id: 'demo-deploy-title', text: 'Nginx 反向代理' },
      { id: 'demo-https', text: '证书与 HTTPS' }
    ],
    body: '静态站点用 Nginx 直接托管最省事，反向代理把接口请求转给后端进程。HTTPS 证书有有效期，过期当天所有请求都会失败，续期和到期提醒要写进发布流程。回滚要保留上一版产物和配置，出问题能在几分钟内切回去。'
  },
  {
    key: 'database',
    title: '数据库事务：MVCC 与隔离级别',
    path: '#demo-db',
    tags: ['数据库', '事务', 'MVCC'],
    headings: [
      { id: 'demo-db-title', text: '事务与 MVCC' },
      { id: 'demo-isolation', text: '隔离级别与死锁重试' }
    ],
    body: '事务把多条写操作打包成一个整体，要么全部成功，要么全部回滚。MVCC 用版本链和快照读避免读写互相阻塞。死锁通常来自两个事务以相反顺序锁同一批行，应用层要能识别并重试。长事务会拖住清理线程，排查时同时看事务持续时间和锁等待。'
  },
  {
    key: 'performance',
    title: '性能剖析：火焰图与 profiler',
    path: '#demo-performance',
    tags: ['性能', 'profiler', '火焰图'],
    headings: [
      { id: 'demo-performance-title', text: '火焰图与 profiler' }
    ],
    body: '性能问题先测量再动手，没有基线的优化很容易花在无关紧要的地方。火焰图横向宽度代表占用时间，纵向代表调用栈，最上面宽而平的那段通常是热点。优化后用同一份数据和同一套环境复测，才能判断收益来自代码还是机器。'
  },
  {
    key: 'observability',
    title: '可观测性：日志、指标与 tracing',
    path: '#demo-observability',
    tags: ['可观测性', '日志', 'tracing'],
    headings: [
      { id: 'demo-observability-title', text: '日志、指标与链路追踪' }
    ],
    body: '日志回答发生了什么，指标回答整体趋势，链路追踪回答一次请求经过了哪些服务。日志要结构化，至少带时间、级别、请求标识和关键业务字段。全量采集链路成本很高，通常按错误、慢请求和固定比例采样，保证问题现场还能还原。'
  },
  {
    key: 'accessibility',
    title: '无障碍：键盘操作与对比度',
    path: '#demo-a11y',
    tags: ['无障碍', '键盘', '对比度'],
    headings: [
      { id: 'demo-a11y-title', text: '键盘操作与焦点管理' },
      { id: 'demo-contrast', text: '颜色对比度' }
    ],
    body: '所有可点击元素都要能通过键盘到达，Tab 顺序和视觉顺序一致。弹窗打开后焦点进入弹窗，关闭后回到触发按钮。正文和背景对比度至少 4.5 比 1，暗色主题要单独检查。不要直接 outline none，换成内外两层焦点环。'
  },
  {
    key: 'security',
    title: '安全：JWT 与刷新令牌',
    path: '#demo-security',
    tags: ['安全', '令牌', 'JWT'],
    headings: [
      { id: 'demo-security-title', text: 'JWT 与刷新令牌' }
    ],
    body: '认证回答你是谁，授权回答你能做什么。JWT 适合无状态校验，但撤销困难；刷新令牌可以轮换并落库，用来弥补这一点。密码只能用带盐的慢哈希保存，bcrypt、scrypt 或 Argon2 都可以。登录失败统一提示，并做频率限制和失败计数。'
  },
  {
    key: 'release',
    title: '版本发布：语义化版本与回滚',
    path: '#demo-release',
    tags: ['版本', '发布', '回滚'],
    headings: [
      { id: 'demo-release-title', text: '语义化版本与发布清单' }
    ],
    body: '语义化版本用主版本表示不兼容变更，次版本表示新增功能，修订号表示修复。变更日志写给人看，说明改了什么、影响谁、怎么迁移。发布清单至少覆盖构建产物、配置、数据库迁移、证书和回滚包。数据库迁移尽量向前兼容。'
  }
];

export function createDemoPages() {
  return DEMO_PAGES.map(function (page) {
    return {
      path: page.path,
      title: page.title,
      summary: page.body.slice(0, 70) + '…',
      tags: page.tags,
      headings: page.headings,
      body: page.body
    };
  });
}

export function createSampleSet() {
  return {
    topics: TOPICS.length,
    variants: VARIANTS.length,
    total: TOPICS.length * VARIANTS.length
  };
}
