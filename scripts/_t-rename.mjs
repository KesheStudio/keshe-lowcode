const BASE = 'http://127.0.0.1:9780';
const SITE = 'walkthrough-static-0908';

function log(name, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
  if (!ok) process.exitCode = 1;
}

async function token() {
  const html = await (await fetch(BASE + '/home.html')).text();
  const m = /<meta name="lc-token" content="([^"]+)"/.exec(html);
  if (!m) throw new Error('no token');
  return m[1];
}

async function main() {
  const TK = await token();
  const H = { 'x-lc-token': TK, 'content-type': 'application/json' };
  const api = async (p, opts = {}) => {
    const res = await fetch(BASE + p, { headers: H, ...opts });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };
  const collections = (id) => `/api/sites/${SITE}/data/collections` + (id ? '/' + id : '');
  const fs = await import('node:fs/promises');
  const colDir = `data/sites/${SITE}/data/collections`;

  /* 清掉上次残留的探针集合 */
  for (const name of await fs.readdir(colDir).catch(() => [])) {
    const textValue = await fs.readFile(colDir + '/' + name, 'utf8').catch(() => '');
    if (textValue.includes('改名探针')) await fs.unlink(colDir + '/' + name).catch(() => {});
  }

  const crt = await api(collections(), {
    method: 'POST',
    body: JSON.stringify({ name: '改名探针', fields: [{ name: '标题', type: 'text' }] })
  });
  log('创建临时集合', crt.status === 201 && crt.body && crt.body.ok, crt.body);
  if (!crt.body || !crt.body.ok) return;
  const id0 = crt.body.data.id;

  const nop = await api(collections(id0), {
    method: 'PUT',
    body: JSON.stringify({ id: id0, name: '改名探针', fields: [{ name: '标题', type: 'text' }] })
  });
  log('不改 ID 保存', nop.status === 200 && nop.body.ok, nop.body && nop.body.data && nop.body.data.renamed);

  const dup = await api(collections(id0), {
    method: 'PUT',
    body: JSON.stringify({ id: 'ass', name: '改名探针', fields: [{ name: '标题', type: 'text' }] })
  });
  log('重复 ID 拒绝', dup.status === 409 && dup.body.error.code === 'LC_E_COLLECTION_EXISTS', dup.body && dup.body.error);

  /* 写一份引用旧 ID 的页面，验证确认机制与引用改写 */
  const pagePath = `data/sites/${SITE}/pages/zz-rename-probe.json`;
  const page = {
    schemaVersion: 2, id: 'zz-rename-probe', title: '改名探针页', slug: 'zz-rename-probe',
    path: 'zz-rename-probe.html', nav: false,
    blocks: [{ id: 'p1', type: 'component', componentId: 'list', fields: { collectionId: id0 } },
      { id: 'p2', type: 'paragraph', md: 'x', dataset: { collection: id0 } }]
  };
  await fs.writeFile(pagePath, JSON.stringify(page, null, 2) + '\n');

  const to = id0 + '-next';
  const blocked = await api(collections(id0), {
    method: 'PUT',
    body: JSON.stringify({ id: to, name: '改名探针', fields: [{ name: '标题', type: 'text' }] })
  });
  log('有引用时未确认拒绝', blocked.status === 409 && blocked.body.error.code === 'LC_E_COLLECTION_RENAME_IN_USE',
    blocked.body && blocked.body.error && blocked.body.error.detail && blocked.body.error.detail.usage);

  const ok = await api(collections(id0), {
    method: 'PUT',
    body: JSON.stringify({ id: to, name: '改名探针', fields: [{ name: '标题', type: 'text' }], confirmRename: true })
  });
  log('确认后改名成功', ok.status === 200 && ok.body.ok && ok.body.data.collection.id === to,
    ok.body && ok.body.data && ok.body.data.renamed);

  const readOld = await fs.readFile(colDir + '/' + id0 + '.json', 'utf8').then(() => true, () => false);
  const readNew = await fs.readFile(colDir + '/' + to + '.json', 'utf8').then(() => true, () => false);
  log('旧集合文件已移除 / 新文件存在', !readOld && readNew, { readOld, readNew });

  const after = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  const refs = [after.blocks[0].fields.collectionId, after.blocks[1].dataset.collection];
  log('页面引用已同步改写', refs.every((v) => v === to), refs);
  await fs.unlink(pagePath).catch(() => {});

  /* 无引用时直接改 */
  const direct = await api(collections(to), {
    method: 'PUT',
    body: JSON.stringify({ id: to + '-b', name: '改名探针', fields: [{ name: '标题', type: 'text' }] })
  });
  log('无引用直接改名', direct.status === 200 && direct.body.ok && direct.body.data.collection.id === to + '-b',
    direct.body && direct.body.data && direct.body.data.renamed);

  const del = await api(collections(to + '-b'), { method: 'DELETE' });
  log('删除探针集合', del.status === 200 && del.body.ok, { status: del.status, body: del.body });
  await fs.unlink(pagePath).catch(() => {});
  const left = (await fs.readdir(colDir).catch(() => [])).filter((n) => n.startsWith(id0));
  log('清理完成', left.length === 0, left);
}

main().catch((e) => { console.error(e); process.exit(1); });
