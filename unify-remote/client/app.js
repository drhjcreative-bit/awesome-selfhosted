// Unify Remote — web client.
// Runs on iPhone, iPad, and Mac browsers. Talks to the hub over WebSocket
// and to other devices directly over WebRTC for screen mirroring.

/* ---------------------------------------------------------------- state */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let ws = null;
let myId = null;
let peers = [];
let receiving = false;

const deviceKind = /iPhone/.test(navigator.userAgent)
  ? 'iphone'
  : /iPad|Macintosh.*Mobile/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))
    ? 'ipad'
    : /Mac/.test(navigator.userAgent)
      ? 'mac'
      : 'other';

const deviceName =
  localStorage.getItem('unify-name') ||
  (() => {
    const n = `${{ iphone: 'iPhone', ipad: 'iPad', mac: 'Mac', other: 'Device' }[deviceKind]}-${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem('unify-name', n);
    return n;
  })();

/* ------------------------------------------------------------ hub link */

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    setConn(true);
    sendHello();
  };
  ws.onclose = () => {
    setConn(false);
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'auth' && msg.ok === false) {
      const entered = prompt('Enter the pairing PIN shown in the hub console:');
      if (entered !== null) {
        localStorage.setItem('unify-pin', entered.trim());
        sendHello();
      }
    } else if (msg.type === 'welcome') {
      myId = msg.id;
      updatePeers(msg.peers);
    } else if (msg.type === 'peers') {
      updatePeers(msg.peers);
    } else if (msg.type === 'input') {
      if (receiving) handleIncomingInput(msg.event);
    } else if (msg.type === 'rtc') {
      handleRtc(msg.from, msg.payload);
    }
  };
}

function sendHello() {
  const capabilities = receiving ? ['control'] : [];
  ws.send(
    JSON.stringify({
      type: 'hello',
      name: deviceName,
      kind: deviceKind,
      capabilities,
      pin: localStorage.getItem('unify-pin') || '',
    })
  );
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function setConn(online) {
  const el = $('#conn');
  el.textContent = online ? `online · ${deviceName}` : 'reconnecting…';
  el.className = `pill ${online ? 'online' : 'offline'}`;
}

/* ------------------------------------------------------ peers & target */

function updatePeers(list) {
  peers = list.filter((p) => p.id !== myId);
  const sel = $('#target');
  const prev = sel.value;
  const controllable = peers.filter((p) => p.capabilities.includes('control'));
  sel.innerHTML =
    '<option value="">— pick a device —</option>' +
    controllable.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if (controllable.some((p) => p.id === prev)) sel.value = prev;
  else if (controllable.length === 1) sel.value = controllable[0].id;
  renderShareList();
}

const target = () => $('#target').value || null;

function sendInput(event) {
  const t = target();
  if (t) send({ type: 'input', target: t, event });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/* -------------------------------------------------------------- tabs */

$$('#tabs button').forEach((btn) =>
  btn.addEventListener('click', () => {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${btn.dataset.tab}`));
  })
);

/* ----------------------------------------------------------- trackpad */

const pad = $('#pad');
const touches = new Map();
let padMode = null; // 'move' | 'scroll'
let moved = 0;
let downAt = 0;
let lastTapAt = 0;
let dragging = false;
let scrollAccum = { x: 0, y: 0 };

const speed = () => parseFloat($('#speed').value);

pad.addEventListener('pointerdown', (e) => {
  pad.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 1) {
    padMode = 'move';
    moved = 0;
    downAt = performance.now();
    // Double-tap & hold starts a drag.
    if (performance.now() - lastTapAt < 300) {
      dragging = true;
      pad.classList.add('dragging');
      sendInput({ t: 'down', btn: 'left' });
    }
  } else if (touches.size === 2) {
    padMode = 'scroll';
    scrollAccum = { x: 0, y: 0 };
  }
});

pad.addEventListener('pointermove', (e) => {
  const prev = touches.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved += Math.abs(dx) + Math.abs(dy);

  if (padMode === 'move' && touches.size === 1) {
    // Light acceleration curve for fine + fast movement.
    const gain = speed() * (1 + Math.min(Math.hypot(dx, dy) / 12, 1.6));
    sendInput({ t: 'move', dx: dx * gain, dy: dy * gain });
  } else if (padMode === 'scroll' && touches.size === 2) {
    scrollAccum.x += dx / 2;
    scrollAccum.y += dy / 2;
    if (Math.abs(scrollAccum.x) >= 1 || Math.abs(scrollAccum.y) >= 1) {
      sendInput({ t: 'scroll', dx: Math.round(scrollAccum.x), dy: Math.round(scrollAccum.y) });
      scrollAccum = { x: 0, y: 0 };
    }
  }
});

function endPointer(e) {
  if (!touches.has(e.pointerId)) return;
  const wasTwo = touches.size === 2;
  touches.delete(e.pointerId);
  if (touches.size > 0) return;

  const quick = performance.now() - downAt < 250 && moved < 10;
  if (dragging) {
    dragging = false;
    pad.classList.remove('dragging');
    sendInput({ t: 'up', btn: 'left' });
  } else if (quick && padMode === 'scroll' && wasTwo) {
    sendInput({ t: 'click', btn: 'right', count: 1 });
  } else if (quick && padMode === 'move') {
    sendInput({ t: 'click', btn: 'left', count: 1 });
    lastTapAt = performance.now();
  }
  padMode = null;
}
pad.addEventListener('pointerup', endPointer);
pad.addEventListener('pointercancel', endPointer);

$('#btn-left').addEventListener('click', () => sendInput({ t: 'click', btn: 'left', count: 1 }));
$('#btn-right').addEventListener('click', () => sendInput({ t: 'click', btn: 'right', count: 1 }));

/* ----------------------------------------------------------- keyboard */

const KEY = { backspace: 51, return: 36 };

const kbInput = $('#kb-input');
kbInput.addEventListener('input', () => {
  const v = kbInput.value;
  if (v) sendInput({ t: 'text', s: v });
  kbInput.value = '';
});
kbInput.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    e.preventDefault();
    sendInput({ t: 'key', code: KEY.backspace, mods: [] });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    sendInput({ t: 'key', code: KEY.return, mods: [] });
  }
});

$('#kb-send').addEventListener('click', () => {
  const v = $('#kb-block').value;
  if (v) sendInput({ t: 'text', s: v });
  $('#kb-block').value = '';
});

// Special-key + shortcut buttons (also used on the Remote tab arrows).
$$('button[data-key]').forEach((btn) =>
  btn.addEventListener('click', () =>
    sendInput({
      t: 'key',
      code: Number(btn.dataset.key),
      mods: btn.dataset.mods ? btn.dataset.mods.split(',') : [],
    })
  )
);

/* ------------------------------------------------------------- remote */

$$('button[data-media]').forEach((btn) =>
  btn.addEventListener('click', () => sendInput({ t: 'media', action: btn.dataset.media }))
);

/* ----------------------------------------------------- screen sharing */

let shareStream = null;
const sharePcs = new Map(); // viewerId -> RTCPeerConnection (as sharer)
let viewPc = null; // pc as viewer
let viewingFrom = null;

const rtcConfig = {}; // LAN only: host candidates are enough, no STUN/TURN.

$('#share-btn').addEventListener('click', async () => {
  try {
    shareStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
  } catch (err) {
    alert(`Screen sharing not available: ${err.message}`);
    return;
  }
  $('#share-btn').hidden = true;
  $('#share-stop').hidden = false;
  send({ type: 'share-state', sharing: true });
  shareStream.getVideoTracks()[0].addEventListener('ended', stopSharing);
});

function stopSharing() {
  if (shareStream) shareStream.getTracks().forEach((t) => t.stop());
  shareStream = null;
  for (const pc of sharePcs.values()) pc.close();
  sharePcs.clear();
  $('#share-btn').hidden = false;
  $('#share-stop').hidden = true;
  send({ type: 'share-state', sharing: false });
}
$('#share-stop').addEventListener('click', stopSharing);

function renderShareList() {
  const list = $('#share-list');
  const sharing = peers.filter((p) => p.sharing);
  if (!sharing.length) {
    list.innerHTML = '<p class="note">No one is sharing yet.</p>';
    return;
  }
  list.innerHTML = '';
  for (const p of sharing) {
    const btn = document.createElement('button');
    btn.textContent = `▶ Watch ${p.name}`;
    btn.addEventListener('click', () => watch(p.id));
    list.appendChild(btn);
  }
}

async function watch(peerId) {
  if (viewPc) viewPc.close();
  viewPc = new RTCPeerConnection(rtcConfig);
  viewingFrom = peerId;
  viewPc.ontrack = (e) => {
    const video = $('#viewer');
    video.srcObject = e.streams[0];
    video.hidden = false;
    $('#viewer-full').hidden = false;
  };
  viewPc.onicecandidate = (e) => {
    if (e.candidate) send({ type: 'rtc', target: peerId, payload: { kind: 'ice', candidate: e.candidate } });
  };
  send({ type: 'rtc', target: peerId, payload: { kind: 'request' } });
}

$('#viewer-full').addEventListener('click', () => {
  const v = $('#viewer');
  if (v.webkitEnterFullscreen && !v.requestFullscreen) v.webkitEnterFullscreen();
  else v.requestFullscreen?.();
});

async function handleRtc(from, payload) {
  if (payload.kind === 'request') {
    if (!shareStream) return;
    const pc = new RTCPeerConnection(rtcConfig);
    sharePcs.set(from, pc);
    shareStream.getTracks().forEach((t) => pc.addTrack(t, shareStream));
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'rtc', target: from, payload: { kind: 'ice', candidate: e.candidate } });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'rtc', target: from, payload: { kind: 'offer', sdp: pc.localDescription } });
  } else if (payload.kind === 'offer') {
    if (!viewPc || from !== viewingFrom) return;
    await viewPc.setRemoteDescription(payload.sdp);
    const answer = await viewPc.createAnswer();
    await viewPc.setLocalDescription(answer);
    send({ type: 'rtc', target: from, payload: { kind: 'answer', sdp: viewPc.localDescription } });
  } else if (payload.kind === 'answer') {
    const pc = sharePcs.get(from);
    if (pc) await pc.setRemoteDescription(payload.sdp);
  } else if (payload.kind === 'ice') {
    const pc = sharePcs.get(from) || (from === viewingFrom ? viewPc : null);
    if (pc) await pc.addIceCandidate(payload.candidate).catch(() => {});
  }
}

/* ------------------------------------------------- receiver (be host) */

const cursor = { x: 100, y: 100 };

$('#receive-toggle').addEventListener('click', () => {
  receiving = !receiving;
  $('#receive-toggle').textContent = receiving
    ? 'Stop being controlled'
    : 'Let other devices control this one';
  $('#receive-toggle').classList.toggle('accent', !receiving);
  $('#receive-surface').hidden = !receiving;
  sendHello(); // re-register with/without the 'control' capability
  if (receiving) placeCursor();
});

function placeCursor() {
  const el = $('#virtual-cursor');
  el.style.left = `${cursor.x}px`;
  el.style.top = `${cursor.y}px`;
}

function handleIncomingInput(ev) {
  const surface = $('#receive-surface');
  const canvas = $('#receive-canvas');
  if (!ev || surface.hidden) return;

  switch (ev.t) {
    case 'move': {
      cursor.x = Math.min(Math.max(cursor.x + ev.dx, 0), surface.clientWidth - 10);
      cursor.y = Math.min(Math.max(cursor.y + ev.dy, 0), surface.clientHeight - 10);
      placeCursor();
      break;
    }
    case 'click': {
      const el = $('#virtual-cursor');
      el.classList.add('clicking');
      setTimeout(() => el.classList.remove('clicking'), 150);
      const rect = surface.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + cursor.x, rect.top + cursor.y);
      if (hit && surface.contains(hit) && hit !== el) {
        hit.classList.add('hit');
        setTimeout(() => hit.classList.remove('hit'), 300);
        hit.click?.();
        hit.focus?.();
      }
      break;
    }
    case 'scroll':
      canvas.scrollTop -= ev.dy * 3;
      break;
    case 'text': {
      const box = $('#receive-text');
      box.value += ev.s;
      break;
    }
    case 'key': {
      const box = $('#receive-text');
      if (ev.code === 51) box.value = box.value.slice(0, -1); // backspace
      if (ev.code === 36) box.value += '\n'; // return
      break;
    }
  }
}

/* --------------------------------------------------------------- boot */

connect();
