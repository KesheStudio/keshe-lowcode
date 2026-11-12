/* 后端用户区白名单：路由（编辑）与导出（覆盖）共用同一份定义。 */

export const USER_ZONES = {
  node: {
    label: 'Node',
    templateRoot: 'templates/backend/node',
    prefixes: ['src/custom/', 'migrations/custom/'],
    extensions: ['.js', '.mjs', '.cjs', '.json', '.sql', '.md'],
    editor: 'javascript'
  },
  rust: {
    label: 'Rust',
    templateRoot: 'templates/backend/rust',
    prefixes: ['src/custom/', 'migrations/custom/'],
    extensions: ['.rs', '.sql', '.md', '.toml'],
    editor: 'rust'
  },
  go: {
    label: 'Go',
    templateRoot: 'templates/backend/go',
    prefixes: ['internal/custom/', 'migrations/custom/'],
    extensions: ['.go', '.sql', '.md'],
    editor: 'go'
  }
};

export function zoneForLanguage(language) {
  const key = String(language || '').toLowerCase();
  return { key, zone: USER_ZONES[key] || null };
}

export function isUserZonePath(zone, rel) {
  if (!zone) return false;
  const value = String(rel || '').replace(/\\/g, '/');
  if (!value || value.startsWith('/') || value.includes('..') || value.includes('\0')) return false;
  return zone.prefixes.some((prefix) => value.startsWith(prefix));
}
