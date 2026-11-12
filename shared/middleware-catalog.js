/* 中间件与配置中心的共享目录。
 *
 * 这份文件同时被浏览器（<script> 全局 LCMiddlewareCatalog）和服务端（require）使用，
 * 字段名、默认值、环境变量名必须与 templates/backend/<lang>/src/generated/config-center.js 对齐。
 * 不要在这里引入任何 Node 或浏览器专有 API。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LCMiddlewareCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ENV_PREFIX = 'LC_CFG_';

  function snake(text) {
    return String(text == null ? '' : text)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
  }

  /** 内置组字段的环境变量名：LC_CFG_<GROUP>_<FIELD>。 */
  function envNameForBuiltin(group, field) {
    return ENV_PREFIX + snake(group) + '_' + snake(field);
  }

  /** 自定义配置项的环境变量名：LC_CFG_<KEY>。 */
  function envNameForKey(key) {
    return ENV_PREFIX + String(key == null ? '' : key).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  }

  /** 自定义中间件字段导出的配置键：MW_<MID>_<FIELD>。 */
  function customKey(id, field) {
    var mid = snake(id);
    var key = snake(field);
    return 'MW_' + mid + '_' + key;
  }

  function field(key, label, type, defaultValue, options) {
    var item = {
      key: key,
      label: label,
      type: type || 'string',
      default: defaultValue,
      width: 'short',
      secret: false
    };
    if (options) {
      Object.keys(options).forEach(function (name) { item[name] = options[name]; });
    }
    return item;
  }

  var BUILTIN_GROUPS = [
    {
      id: 'sqlite',
      group: 'sqlite',
      label: 'SQLite',
      kind: 'database',
      description: '单文件数据库，适合本机与小型部署；不需要额外服务。',
      fields: [
        field('file', '数据库文件', 'string', 'data/app.db', {
          width: 'medium',
          required: true,
          placeholder: 'data/app.db',
          hint: '相对路径由后端工作目录解析。'
        })
      ]
    },
    {
      id: 'postgres',
      group: 'postgres',
      label: 'PostgreSQL',
      kind: 'database',
      description: '通过 pg 驱动连接；默认端口使用 15432，避免误连本机既有 5432。',
      fields: [
        field('host', '主机', 'string', '127.0.0.1', { required: true }),
        field('port', '端口', 'number', 15432, { min: 1, max: 65535, hint: '默认隔离端口 15432。' }),
        field('database', '库名', 'string', 'app', { width: 'medium', required: true }),
        field('user', '账号', 'string', 'lc'),
        field('password', '口令', 'string', '', {
          width: 'medium',
          secret: true,
          env: envNameForBuiltin('postgres', 'password')
        }),
        field('sslMode', 'SSL 模式', 'enum', 'disable', { enum: ['disable', 'require'] }),
        field('maxOpenConns', '最大连接', 'number', 10, { min: 1, max: 100 }),
        field('connectTimeoutSeconds', '连接超时', 'number', 5, { min: 1, max: 60, hint: '单位：秒。' })
      ]
    },
    {
      id: 'mysql',
      group: 'mysql',
      label: 'MySQL',
      kind: 'database',
      description: '通过 mysql2 驱动连接；默认端口使用 13306，避免误连本机既有 3306。',
      fields: [
        field('host', '主机', 'string', '127.0.0.1', { required: true }),
        field('port', '端口', 'number', 13306, { min: 1, max: 65535, hint: '默认隔离端口 13306。' }),
        field('database', '库名', 'string', 'app', { width: 'medium', required: true }),
        field('user', '账号', 'string', 'lc'),
        field('password', '口令', 'string', '', {
          width: 'medium',
          secret: true,
          env: envNameForBuiltin('mysql', 'password')
        }),
        field('maxOpenConns', '最大连接', 'number', 10, { min: 1, max: 100 }),
        field('connectTimeoutSeconds', '连接超时', 'number', 5, { min: 1, max: 60, hint: '单位：秒。' })
      ]
    },
    {
      id: 'mariadb',
      group: 'mysql',
      label: 'MariaDB',
      kind: 'database',
      description: '协议与 MySQL 兼容，导出时复用 mysql 组，环境变量同样是 LC_CFG_MYSQL_*。',
      fields: [
        field('host', '主机', 'string', '127.0.0.1', { required: true }),
        field('port', '端口', 'number', 13306, { min: 1, max: 65535, hint: '默认隔离端口 13306。' }),
        field('database', '库名', 'string', 'app', { width: 'medium', required: true }),
        field('user', '账号', 'string', 'lc'),
        field('password', '口令', 'string', '', {
          width: 'medium',
          secret: true,
          env: envNameForBuiltin('mysql', 'password')
        }),
        field('maxOpenConns', '最大连接', 'number', 10, { min: 1, max: 100 }),
        field('connectTimeoutSeconds', '连接超时', 'number', 5, { min: 1, max: 60, hint: '单位：秒。' })
      ]
    },
    {
      id: 'redis',
      group: 'redis',
      label: 'Redis',
      kind: 'cache',
      description: '缓存与轻量消息队列共用；默认使用 16379，避免误连本机既有 6379。',
      fields: [
        field('url', '连接地址', 'string', 'redis://127.0.0.1:16379/0', {
          width: 'long',
          required: true,
          placeholder: 'redis://127.0.0.1:16379/0',
          hint: '默认隔离端口 16379。'
        }),
        field('ttlSeconds', '默认 TTL', 'number', 30, { min: 1, max: 86400, hint: '单位：秒。' }),
        field('keyPrefix', '键前缀', 'string', 'lc:'),
        field('password', '口令', 'string', '', {
          width: 'medium',
          secret: true,
          env: envNameForBuiltin('redis', 'password')
        })
      ]
    },
    {
      id: 'objectStorage',
      group: 'objectStorage',
      label: '对象存储',
      kind: 'inject',
      description: 'S3 / OSS / COS 等对象存储连接信息，平台只注入配置，连接由用户代码负责。',
      fields: [
        field('driver', '驱动', 'string', 's3', { placeholder: 's3' }),
        field('endpoint', 'Endpoint', 'string', '', { width: 'long', placeholder: 'https://s3.example.com' }),
        field('bucket', 'Bucket', 'string', '', { width: 'medium' }),
        field('region', 'Region', 'string', '', { placeholder: 'us-east-1' }),
        field('accessKey', 'Access Key', 'string', '', {
          width: 'medium',
          secret: true,
          env: envNameForBuiltin('objectStorage', 'accessKey')
        }),
        field('secretKey', 'Secret Key', 'string', '', {
          width: 'medium',
          secret: true,
          env: envNameForBuiltin('objectStorage', 'secretKey')
        })
      ]
    },
    {
      id: 'messageQueue',
      group: 'messageQueue',
      label: '消息队列',
      kind: 'inject',
      description: 'Redis / Kafka / RabbitMQ 等队列连接信息，平台只注入配置。',
      fields: [
        field('driver', '驱动', 'string', 'redis', { placeholder: 'redis / kafka / rabbitmq' }),
        field('url', '连接地址', 'string', '', { width: 'long', placeholder: 'redis://127.0.0.1:16379/0' }),
        field('queue', '队列 / Topic', 'string', 'lc')
      ]
    },
    {
      id: 'search',
      group: 'search',
      label: '搜索',
      kind: 'inject',
      description: 'OpenSearch / Elasticsearch 等搜索服务连接信息。',
      fields: [
        field('driver', '驱动', 'string', 'opensearch', { placeholder: 'opensearch' }),
        field('url', '连接地址', 'string', '', { width: 'long', placeholder: 'http://127.0.0.1:9200' }),
        field('index', '索引', 'string', 'lc')
      ]
    },
    {
      id: 'reverseProxy',
      group: 'reverseProxy',
      label: '反向代理',
      kind: 'inject',
      description: '上游地址与请求体限制，适合把第三方服务藏在后端后面。',
      fields: [
        field('upstream', '上游地址', 'string', 'http://127.0.0.1:8080', {
          width: 'long',
          required: true,
          placeholder: 'http://127.0.0.1:8080'
        }),
        field('clientMaxBodySize', '请求体上限', 'string', '1m', { placeholder: '1m' })
      ]
    }
  ];

  var CONFIG_GROUPS = [
    { id: 'site', label: '站点', description: '站点名称、语言、版权等展示相关配置。', prefix: 'SITE_' },
    { id: 'backend', label: '后端', description: '运行模式、接口前缀、分页上限等后端行为。', prefix: 'APP_' },
    { id: 'deploy', label: '部署', description: '公开地址、部署渠道、健康检查路径。', prefix: 'DEPLOY_' },
    { id: 'middleware', label: '中间件', description: '自定义中间件字段与用户补充的连接参数。', prefix: 'MIDDLEWARE_' }
  ];

  var RECOMMENDED_DEFINITIONS = {
    site: [
      { key: 'SITE_NAME', type: 'string', default: '', description: '站点名称，供后端模板读取。' },
      { key: 'SITE_LOCALE', type: 'enum', default: 'zh-CN', enum: ['zh-CN', 'en-US'], description: '站点语言。' },
      { key: 'SITE_COPYRIGHT', type: 'string', default: '', description: '页脚版权文本。' }
    ],
    backend: [
      { key: 'APP_MODE', type: 'enum', default: 'standard', enum: ['standard', 'strict'], description: '严格模式下会拒绝未知配置。' },
      { key: 'FEATURE_NEW_UI', type: 'bool', default: false, description: '新界面开关。' },
      { key: 'API_BASE_URL', type: 'string', default: '/api', description: '前端请求后端的基址。' },
      { key: 'DATA_MAX_PAGE_SIZE', type: 'number', default: 100, description: '数据接口单页上限。' }
    ],
    deploy: [
      { key: 'PUBLIC_BASE_URL', type: 'string', default: '', description: '对外公开地址。' },
      { key: 'DEPLOY_CHANNEL', type: 'enum', default: 'systemd', enum: ['systemd', 'docker', 'static'], description: '部署方式。' },
      { key: 'HEALTH_PATH', type: 'string', default: '/api/health', description: '健康检查路径。' }
    ],
    middleware: [
      { key: 'MIDDLEWARE_HEALTH_INTERVAL_SECONDS', type: 'number', default: 30, description: '中间件健康检查间隔。' }
    ]
  };

  var builtinEnvNames = {};
  BUILTIN_GROUPS.forEach(function (group) {
    group.fields.forEach(function (item) {
      if (item.env) builtinEnvNames[item.env] = true;
      builtinEnvNames[envNameForBuiltin(group.group, item.key)] = true;
    });
  });

  function builtinGroup(id) {
    for (var i = 0; i < BUILTIN_GROUPS.length; i += 1) {
      if (BUILTIN_GROUPS[i].id === id) return BUILTIN_GROUPS[i];
    }
    return null;
  }

  function configGroup(id) {
    for (var i = 0; i < CONFIG_GROUPS.length; i += 1) {
      if (CONFIG_GROUPS[i].id === id) return CONFIG_GROUPS[i];
    }
    return null;
  }

  function defaultConfig(group) {
    var source = typeof group === 'string' ? builtinGroup(group) : group;
    var out = {};
    if (!source) return out;
    source.fields.forEach(function (item) {
      out[item.key] = item.secret ? '' : item.default;
    });
    return out;
  }

  /** 用户配置键不能占用内置组的环境变量名，也不能占用 MW_ 前缀。 */
  function isReservedKey(key) {
    var text = String(key == null ? '' : key).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return text.indexOf('LC_') === 0
      || text.indexOf('MW_') === 0
      || builtinEnvNames[ENV_PREFIX + text] === true
      || builtinEnvNames[text] === true;
  }

  var KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
  var CUSTOM_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
  var CUSTOM_FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

  return {
    ENV_PREFIX: ENV_PREFIX,
    BUILTIN_GROUPS: BUILTIN_GROUPS,
    CONFIG_GROUPS: CONFIG_GROUPS,
    RECOMMENDED_DEFINITIONS: RECOMMENDED_DEFINITIONS,
    KEY_RE: KEY_RE,
    CUSTOM_ID_RE: CUSTOM_ID_RE,
    CUSTOM_FIELD_RE: CUSTOM_FIELD_RE,
    snake: snake,
    envNameForBuiltin: envNameForBuiltin,
    envNameForKey: envNameForKey,
    customKey: customKey,
    builtinGroup: builtinGroup,
    configGroup: configGroup,
    defaultConfig: defaultConfig,
    isReservedKey: isReservedKey,
    builtinEnvNames: builtinEnvNames
  };
});
