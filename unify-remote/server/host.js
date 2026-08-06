// macOS native input host.
//
// Connects to the hub as a controllable device and injects the input
// events it receives (trackpad moves, clicks, scrolls, keys, media keys)
// into macOS using a small Swift helper built on CGEvent.
//
// The Swift helper is compiled on first run with `swiftc` (ships with the
// Xcode Command Line Tools). macOS will prompt once for Accessibility
// permission — grant it in System Settings → Privacy & Security →
// Accessibility for the terminal app running this process.
//
// Standalone usage (hub running elsewhere):
//   node server/host.js ws://<hub-address>:8765/ws

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SRC = path.join(__dirname, '..', 'bridge', 'InputBridge.swift');
const BRIDGE_BIN = path.join(__dirname, '..', 'bridge', 'inputbridge');

function ensureBridgeBuilt() {
  if (process.platform !== 'darwin') {
    throw new Error('native input injection is only supported on macOS');
  }
  const srcTime = fs.statSync(BRIDGE_SRC).mtimeMs;
  const binTime = fs.existsSync(BRIDGE_BIN) ? fs.statSync(BRIDGE_BIN).mtimeMs : 0;
  if (binTime > srcTime) return;
  console.log('[host] compiling input bridge (first run)...');
  const res = spawnSync('swiftc', ['-O', BRIDGE_SRC, '-o', BRIDGE_BIN], {
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(
      'swiftc failed — install the Xcode Command Line Tools with: xcode-select --install'
    );
  }
}

function startBridge() {
  const bridge = spawn(BRIDGE_BIN, [], { stdio: ['pipe', 'inherit', 'inherit'] });
  bridge.on('exit', (code) => {
    console.error(`[host] input bridge exited (code ${code}); restarting in 2s`);
    setTimeout(() => Object.assign(bridgeRef, { current: startBridge() }), 2000);
  });
  return bridge;
}

const bridgeRef = { current: null };

export async function startHost(hubUrl) {
  ensureBridgeBuilt();
  bridgeRef.current = startBridge();

  const send = (event) => {
    const b = bridgeRef.current;
    if (b && b.stdin.writable) b.stdin.write(JSON.stringify(event) + '\n');
  };

  const connect = () => {
    const ws = new WebSocket(hubUrl);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          name: `${os.hostname().replace(/\.local$/, '')} (Mac)`,
          kind: 'mac',
          capabilities: ['control'],
        })
      );
      console.log('[host] connected to hub — this Mac can now be controlled');
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === 'input' && msg.event) send(msg.event);
    });

    const retry = () => setTimeout(connect, 2000);
    ws.on('close', retry);
    ws.on('error', () => ws.close());
  };

  connect();
}

// Run directly: `node server/host.js [ws://hub:8765/ws]`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2] || 'ws://localhost:8765/ws';
  startHost(url).catch((err) => {
    console.error('[host]', err.message);
    process.exit(1);
  });
}
