/* 低代码平台 · 模板装配（F3 第③步）
 *
 * 只负责“把其它会话维护的模板装进导出包”：路径映射、排除规则、完整性校验、
 * 归属标注。不生成、不改写模板内容。
 *
 * 归属边界（当前会话不碰）：
 *   templates/backend/**   ← 后端与部署模板会话
 *   templates/deploy/**
 *   templates/tauri/**     ← 桌面与签名模板会话
 *   templates/signing/**
 *
 * 后端/前端“实例覆盖”的合并接口尚未由渲染层交付；这里只预留 ownership 与
 * merged 槽位，不做合并，也不静默覆盖调用方已放入 files 的用户文件。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./export-bundle.js'), require('./export-assets.js'));
  } else {
    root.LC = root.LC || {};
    root.LC.ExportTemplates = factory(root.LC.ExportBundle, root.LC.ExportAssets);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Bundle, Assets) {
  'use strict';

  if (!Bundle) throw new Error('LC.ExportTemplates 依赖 shared/export-bundle.js，请先加载');

  var BACKENDS = {
    none: { maturity: 'n/a', database: 'none', root: '', required: [] },
    rust: {
      maturity: 'full',
      database: 'sqlite',
      root: 'templates/backend/rust',
      required: ['server/Cargo.toml', 'server/Cargo.lock', 'server/src/main.rs', 'deploy/backend/config.generated.yaml']
    },
    node: {
      maturity: 'full',
      database: 'sqlite',
      root: 'templates/backend/node',
      required: ['server/package.json', 'server/package-lock.json', 'server/src/main.js']
    },
    go: {
      maturity: 'usable',
      database: 'sqlite',
      root: 'templates/backend/go',
      required: ['server/go.mod', 'server/main.go']
    }
  };

  var TAURI_REQUIRED = [
    'desktop/package.json',
    'desktop/package-lock.json',
    'desktop/config/desktop.json',
    'desktop/src-tauri/tauri.conf.json',
    'desktop/src-tauri/Cargo.toml',
    'desktop/src-tauri/src/main.rs',
    'web/desktop-config.js'
  ];

  var CONFIG_TARGETS = {
    generated: 'deploy/backend/config.generated.yaml',
    user: 'deploy/backend/config.yaml'
  };

  function backendInfo(language) {
    return BACKENDS[language] || { maturity: 'unknown', database: 'unknown', root: '', required: [] };
  }

  function isExcludedByCommonRules(rel) {
    if (!rel) return true;
    if (/^(?:node_modules|\.git|target|dist|out|coverage|\.lowcode)(?:\/|$)/.test(rel)) return true;
    if (/\.(tmp|corrupt|log)$/i.test(rel)) return true;
    if (/^(?:.*\/)?\.env$/i.test(rel)) return true;
    if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(rel)) return true;
    if (/(?:^|\/)data\/app\.db(?:-shm|-wal)?$/.test(rel)) return true;
    return false;
  }

  function includedIn(kind, rel) {
    if (isExcludedByCommonRules(rel)) return false;
    if (kind === 'tauri') {
      if (/^src-tauri\/gen\//.test(rel)) return false;
      const allowedWeb = rel === 'web/desktop-config.js';
      if (rel.indexOf('web/') === 0 && !allowedWeb) return false;
      return true;
    }
    if (kind.indexOf('backend-') === 0) {
      /* 配置底稿要读进来作为 config 候选，但不直接落到 server/ 下。 */
      if (/^static-test\//.test(rel)) return false;
      return true;
    }
    /* 部署说明只取 README.md，不要把整个 templates/deploy 再复制一遍。 */
    if (kind === 'deploy-docs') {
      return rel === 'README.md';
    }
    return true;
  }

  function planTemplates(input) {
    var opts = input || {};
    var target = opts.target || 'web-static';
    var language = (opts.backend && opts.backend.language) || 'none';
    var info = backendInfo(language);
    var rules = [];
    var required = [];
    var warnings = [];

    if (target === 'tauri-desktop') {
      rules.push({ kind: 'tauri', root: 'templates/tauri', artifact: 'desktop' });
      required = required.concat(TAURI_REQUIRED);
    }

    if (language !== 'none') {
      if (!info.root) {
        warnings.push({
          code: 'LC_W_TEMPLATE_MISSING',
          message: '后端语言 ' + language + ' 没有可用模板，server/ 不会生成'
        });
      } else {
        rules.push({ kind: 'backend-' + language, root: info.root, artifact: 'server', language: language });
        required = required.concat(info.required);
        required.push(CONFIG_TARGETS.generated, CONFIG_TARGETS.user);

        /* 一键部署脚本随包：任何后端都要有 install/migrate/start/... 的 sh + ps1。 */
        rules.push({ kind: 'deploy-scripts', root: 'templates/deploy/scripts', artifact: 'deploy/scripts' });
        rules.push({ kind: 'deploy-docs', root: 'templates/deploy', artifact: 'deploy' });
        required.push('deploy/scripts/install.sh', 'deploy/scripts/start-bg.sh', 'deploy/scripts/health.sh');
      }
    }

    if (opts.nginxEnabled) {
      rules.push({ kind: 'deploy-nginx', root: 'templates/deploy/nginx', artifact: 'deploy/nginx' });
      required.push('deploy/nginx/nginx.conf');
    }

    /* 签名模板是可选资料；缺了不影响可运行产物，但会记警告。 */
    if (target === 'tauri-desktop') {
      rules.push({ kind: 'signing', root: 'templates/signing', artifact: 'deploy/signing', optional: true });
    }

    var configCandidates = [];
    if (language !== 'none' && info.root) {
      configCandidates.push(info.root + '/config.generated.yaml', info.root + '/config.generated.yml');
      configCandidates.push('templates/backend/config.example.yaml', 'templates/backend/config.example.yml');
    }

    return {
      target: target,
      language: language,
      maturity: info.maturity,
      database: info.database,
      rules: rules,
      required: required,
      configCandidates: configCandidates,
      configTargets: CONFIG_TARGETS,
      warnings: warnings
    };
  }

  function ownershipFor(kind, artifact) {
    if (artifact === CONFIG_TARGETS.user) return 'user';
    if (artifact === CONFIG_TARGETS.generated) return 'platform';
    if (kind.indexOf('backend-') === 0) {
      if (/\/src\/custom\//.test(artifact) ||
        /\/migrations\/custom\//.test(artifact) ||
        /\/com\/[^/]+\/[^/]+\/custom\//.test(artifact)) return 'user';
    }
    return 'platform';
  }

  function matchRule(rules, sourcePath) {
    var best = null;
    rules.forEach(function (rule) {
      if (sourcePath.indexOf(rule.root + '/') !== 0) return;
      if (!best || rule.root.length > best.root.length) best = rule;
    });
    return best;
  }

  function artifactPathFor(rule, rel) {
    if (rule.kind === 'tauri' && rel === 'web/desktop-config.js') return 'web/desktop-config.js';
    return rule.artifact + '/' + rel;
  }

  function addOwnership(ownership, origin, artifact) {
    if (!ownership[origin]) ownership[origin] = [];
    if (ownership[origin].indexOf(artifact) === -1) ownership[origin].push(artifact);
  }

  /**
   * 把已读入内存的模板文件装进产物。
   * sources 的键是完整模板路径（templates/...），由调用方按 includedIn() 预过滤后读取。
   */
  function applyTemplates(input) {
    var opts = input || {};
    var plan = opts.plan || planTemplates(opts);
    var sources = opts.sources || {};
    var files = opts.files || {};
    var copied = [];
    var warnings = plan.warnings ? plan.warnings.slice() : [];
    var ownership = { platform: [], user: [], merged: [] };
    var usedRules = {};

    Object.keys(sources).sort().forEach(function (sourcePath) {
      var rule = matchRule(plan.rules, sourcePath);
      if (!rule) return;
      var rel = sourcePath.slice(rule.root.length + 1);
      if (!includedIn(rule.kind, rel)) return;
      usedRules[rule.kind] = true;
      if (rule.kind.indexOf('backend-') === 0 && /^config(?:\.generated)?\.(?:yaml|yml|json|toml)$/i.test(rel)) {
        return;
      }
      var target = artifactPathFor(rule, rel);
      if (files[target] != null) {
        warnings.push({
          code: 'LC_W_TEMPLATE_COLLISION',
          message: target + ' 已由调用方提供，保留现有内容，不覆盖模板 ' + sourcePath
        });
        return;
      }
      files[target] = sources[sourcePath];
      copied.push({ source: sourcePath, artifact: target, origin: ownershipFor(rule.kind, target) });
      addOwnership(ownership, ownershipFor(rule.kind, target), target);
    });

    /* 后端配置底稿：优先用该语言模板自带，其次用共享 config.example。 */
    if (plan.configCandidates && plan.configCandidates.length) {
      var configSource = plan.configCandidates.find(function (path) { return sources[path] != null; });
      if (configSource == null) {
        warnings.push({ code: 'LC_W_TEMPLATE_MISSING', message: '没有找到后端配置底稿，deploy/backend/ 将为空' });
      } else {
        [plan.configTargets.generated, plan.configTargets.user].forEach(function (target) {
          if (files[target] != null) {
            warnings.push({
              code: 'LC_W_TEMPLATE_COLLISION',
              message: target + ' 已存在，保留现有内容，不覆盖配置底稿'
            });
            return;
          }
          files[target] = sources[configSource];
          copied.push({ source: configSource, artifact: target, origin: ownershipFor('config', target) });
          addOwnership(ownership, ownershipFor('config', target), target);
        });
      }
    }

    plan.rules.forEach(function (rule) {
      if (rule.optional || usedRules[rule.kind]) return;
      warnings.push({
        code: 'LC_W_TEMPLATE_MISSING',
        message: '模板目录缺失或未读入：' + rule.root + '（' + rule.kind + '）'
      });
    });

    return {
      files: files,
      copied: copied,
      ownership: ownership,
      required: plan.required,
      warnings: warnings
    };
  }

  return {
    BACKENDS: BACKENDS,
    TAURI_REQUIRED: TAURI_REQUIRED,
    CONFIG_TARGETS: CONFIG_TARGETS,
    backendInfo: backendInfo,
    includedIn: includedIn,
    ownershipFor: ownershipFor,
    planTemplates: planTemplates,
    applyTemplates: applyTemplates
  };
}));
