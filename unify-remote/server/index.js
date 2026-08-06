// Unify Remote — hub server.
//
// Serves the web client and runs the WebSocket hub that connects every
// device on your local network. Run it on whichever machine is always on
// (usually the Mac):
//
//   npm start            # hub + (on macOS) native input host
//   npm run hub          # hub only, no input injection
//
// Then open http://<this-machine>:8765 on your iPhone / iPad / other Macs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createHub } from './hub.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const PORT = Number(process.env.PORT || 8765);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(CLIENT_DIR, filePath);
  if (!abs.startsWith(CLIENT_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
createHub(wss);

server.listen(PORT, () => {
  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('Unify Remote hub running:');
  for (const a of addrs) console.log(`  http://${a}:${PORT}`);
  console.log(`  http://localhost:${PORT}`);
});

// On macOS, also start the native input host so this machine can be
// controlled, unless the user asked for the hub only.
if (process.platform === 'darwin' && !process.argv.includes('--hub-only')) {
  const { startHost } = await import('./host.js');
  startHost(`ws://localhost:${PORT}/ws`).catch((err) => {
    console.error('[host] failed to start native input host:', err.message);
    console.error('[host] the hub still works; other devices can connect as remotes/screens.');
  });
}
