// WebSocket hub: keeps a registry of connected devices and relays
// messages between them. It never interprets input or media itself —
// it only routes.
//
// Protocol (JSON messages):
//   client → hub:
//     { type: 'hello', name, kind, capabilities, pin }   register this device
//     { type: 'input', target, event }              input event for a host device
//     { type: 'rtc', target, payload }              WebRTC signaling (offer/answer/ice)
//     { type: 'share-state', sharing }              announce screen-share availability
//   hub → client:
//     { type: 'auth', ok: false }                   wrong/missing pairing PIN
//     { type: 'welcome', id, peers }                your id + current peer list
//     { type: 'peers', peers }                      peer list changed
//     { type: 'input', from, event }                relayed input event
//     { type: 'rtc', from, payload }                relayed signaling

import { randomUUID } from 'node:crypto';

export function createHub(wss, { pin = null } = {}) {
  /** @type {Map<string, {ws: import('ws').WebSocket, info: object}>} */
  const peers = new Map();

  const peerList = () =>
    [...peers.entries()].map(([id, p]) => ({ id, ...p.info }));

  const broadcastPeers = () => {
    const msg = JSON.stringify({ type: 'peers', peers: peerList() });
    for (const { ws } of peers.values()) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  };

  wss.on('connection', (ws) => {
    const id = randomUUID();
    let registered = false;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === 'hello') {
        if (pin && String(msg.pin || '') !== pin) {
          ws.send(JSON.stringify({ type: 'auth', ok: false }));
          return;
        }
        peers.set(id, {
          ws,
          info: {
            name: String(msg.name || 'device').slice(0, 60),
            kind: String(msg.kind || 'unknown').slice(0, 20),
            capabilities: Array.isArray(msg.capabilities)
              ? msg.capabilities.map((c) => String(c).slice(0, 20)).slice(0, 10)
              : [],
            sharing: false,
          },
        });
        registered = true;
        ws.send(JSON.stringify({ type: 'welcome', id, peers: peerList() }));
        broadcastPeers();
        return;
      }

      if (!registered) return;

      if (msg.type === 'share-state') {
        const me = peers.get(id);
        if (me) {
          me.info.sharing = Boolean(msg.sharing);
          broadcastPeers();
        }
        return;
      }

      if ((msg.type === 'input' || msg.type === 'rtc') && msg.target) {
        const target = peers.get(msg.target);
        if (target && target.ws.readyState === target.ws.OPEN) {
          target.ws.send(
            JSON.stringify({
              type: msg.type,
              from: id,
              event: msg.event,
              payload: msg.payload,
            })
          );
        }
      }
    });

    ws.on('close', () => {
      if (peers.delete(id)) broadcastPeers();
    });
    ws.on('error', () => {
      if (peers.delete(id)) broadcastPeers();
    });
  });
}
