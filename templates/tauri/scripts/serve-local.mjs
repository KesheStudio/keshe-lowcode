#!/usr/bin/env node
// 本地静态预览服务：用来验证 server 接入与证书信任行为，不是生产服务器。
// 用法：node scripts/serve-local.mjs [--dir web] [--port 1420] [--tls] [--cert certs/site.crt] [--key certs/site.key]
// 只监听 127.0.0.1：不对外暴露，也不需要什么鉴权。

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const out = { dir: 'web', port: 1420, tls: false, cert: 'certs/site.crt', key: 'certs/site.key' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--port') out.port = Number.parseInt(argv[++i], 10);
    else if (a === '--tls') out.tls = true;
    else if (a === '--cert') out.cert = argv[++i];
    else if (a === '--key') out.key = argv[++i];
  }
  return out;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = parseArgs(process.argv.slice(2));
  const baseDir = path.resolve(root, args.dir);

  if (!fs.existsSync(baseDir)) {
    console.error(`目录不存在：${baseDir}`);
    process.exit(1);
  }

  const handler = (req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const mapped = urlPath === '/' ? '/index.html' : urlPath;
    const file = path.resolve(baseDir, `.${mapped}`);
    if (!file.startsWith(baseDir)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('越界路径');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`找不到 ${mapped}`);
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(data);
    });
  };

  const scheme = args.tls ? 'https' : 'http';
  const server = args.tls
    ? https.createServer({
      cert: fs.readFileSync(path.resolve(root, args.cert)),
      key: fs.readFileSync(path.resolve(root, args.key)),
    }, handler)
    : http.createServer(handler);

  server.listen(args.port, '127.0.0.1', () => {
    console.log(`预览地址：${scheme}://127.0.0.1:${args.port}/（目录 ${path.relative(root, baseDir)}）`);
    if (args.tls) {
      console.log('自签证书不会被浏览器/WebView 信任；先在系统里信任 certs/site.crt，否则会看到证书错误。');
    }
  });
}

main();
