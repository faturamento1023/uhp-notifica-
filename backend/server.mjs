import { createServer } from 'node:http';
import { chmodSync, createReadStream, mkdirSync, openSync, closeSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createApi } from './api.mjs';
import { openStore } from './store.mjs';

const origin = new URL(process.env.UHP_ORIGIN ?? 'http://127.0.0.1:3000');
const port = Number(process.env.UHP_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UHP_PORT inválida.');
if (origin.origin !== origin.href.slice(0, -1)) throw new Error('UHP_ORIGIN deve conter apenas protocolo e domínio.');
if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  throw new Error('Use HTTPS no endereço institucional.');
}

process.umask(0o077);
const dbPath = resolve(process.env.UHP_DB ?? 'data/uhp.sqlite');
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
closeSync(openSync(dbPath, 'a', 0o600));
chmodSync(dbPath, 0o600);
const db = openStore(dbPath);
const api = createApi(db, { origin: origin.origin });

const frontend = process.env.UHP_FRONTEND_DIR ? realpathSync(process.env.UHP_FRONTEND_DIR) : null;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function findAsset(pathname) {
  if (!frontend) return null;
  try {
    const path = decodeURIComponent(pathname);
    const file = realpathSync(resolve(frontend, '.' + (path.endsWith('/') ? path + 'index.html' : path)));
    if (!file.startsWith(frontend + sep) || !statSync(file).isFile()) return null;
    const type = types[extname(file)];
    return type ? { file, type } : null;
  } catch {
    return null;
  }
}

const server = createServer({ requestTimeout: 30000, headersTimeout: 10000 }, async (incoming, outgoing) => {
  outgoing.setHeader('X-Content-Type-Options', 'nosniff');
  outgoing.setHeader('Referrer-Policy', 'no-referrer');
  outgoing.setHeader('X-Frame-Options', 'DENY');
  outgoing.setHeader('Cache-Control', 'no-store');
  try {
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//') || incoming.url.includes('\\')) {
      outgoing.writeHead(400).end();
      return;
    }
    const url = new URL(incoming.url, origin);
    if (!url.pathname.startsWith('/api/')) {
      const asset = ['GET', 'HEAD'].includes(incoming.method) ? findAsset(url.pathname) : null;
      if (!asset) {
        outgoing.writeHead(404).end();
        return;
      }
      outgoing.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
      outgoing.writeHead(200, { 'content-type': asset.type });
      if (incoming.method === 'HEAD') outgoing.end();
      else await pipeline(createReadStream(asset.file), outgoing);
      return;
    }

    const hasBody = !['GET', 'HEAD'].includes(incoming.method);
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(hasBody ? { body: Readable.toWeb(incoming), duplex: 'half' } : {})
    });
    const response = await api(request, incoming.socket.remoteAddress);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500).end();
    else outgoing.destroy();
  }
});

server.listen(port, '127.0.0.1', () => console.log('UHP Notifica ouvindo em 127.0.0.1:' + port));
