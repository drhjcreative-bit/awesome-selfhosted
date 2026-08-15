# Unify Remote

Turn any of your Apple devices into a **remote, keyboard, and trackpad** for the
others — and **mirror screens** between them. One small server, no App Store
installs: every device joins from its browser (and can be added to the Home
Screen / Dock as an app).

- iPhone as a trackpad + keyboard for your **Mac** (full native control)
- iPad as a keyboard for your **Mac** (full native control)
- iPhone as a trackpad for your **iPad** (virtual pointer inside the app — see
  [Platform capabilities](#platform-capabilities))
- Cast/mirror a screen from any device to any other over WebRTC
- Media remote + presentation clicker (play/pause, volume, arrows, space)

Everything runs on your local network. Nothing leaves your Wi-Fi: the hub only
relays messages, and screen video streams peer-to-peer between the two devices.

## Quick start

Requirements: Node.js ≥ 18 on the machine that runs the hub (usually your Mac).
For native Mac control, the Xcode Command Line Tools (`xcode-select --install`).

```bash
cd unify-remote
npm install
npm start
```

The console prints the hub's addresses, e.g. `http://192.168.1.20:8765`, and a
6-digit **pairing PIN**. Open the URL in Safari on your iPhone/iPad (or any
browser on another Mac) and enter the PIN when prompted — each device asks
once and remembers it. Set `UNIFY_PIN=123456` to fix the PIN across restarts,
or `UNIFY_PIN=off` to disable pairing on a fully trusted network.
Tip: use Safari's **Share → Add to Home Screen** to get a full-screen app icon.

On first run on the Mac, the input bridge is compiled and macOS will ask for
**Accessibility** permission (System Settings → Privacy & Security →
Accessibility) for the terminal app running `npm start`. Grant it once; that is
what allows injected mouse/keyboard events.

### Using it

1. On the controlling device (say, your iPhone), pick the target in the
   **Controlling** dropdown — your Mac appears automatically.
2. **Trackpad** tab: one finger moves, tap clicks, two fingers scroll,
   two-finger tap right-clicks, double-tap-and-hold drags.
3. **Keyboard** tab: tap the field and type — keys stream live. Buttons for
   esc/tab/arrows and common shortcuts (⌘C, ⌘V, ⌘Tab, …), plus a box to send a
   block of text at once.
4. **Remote** tab: media keys and a presentation clicker (arrows + space).
5. **Screen** tab: *Share this screen* on the source device, then *Watch* it
   from any other device. Full-screen the viewer for a clean second display.
6. **Be controlled** tab: turns the current device into a target with a
   virtual pointer (this is how an iPad/iPhone can be "controlled" — see below).

### Other layouts

- Hub on the Mac, but you only want it to relay (no control): `npm run hub`
- Hub on one machine, control a *different* Mac: on the second Mac run
  `node server/host.js ws://<hub-address>:8765/ws <pairing-pin>`

## Platform capabilities

| Device | As controller (remote/keyboard/trackpad) | As controlled target | Share its screen | View a screen |
| --- | --- | --- | --- | --- |
| **Mac** | ✅ browser | ✅ full native control (CGEvent bridge) | ✅ full screen or single window | ✅ |
| **iPad** | ✅ browser | ⚠️ virtual pointer inside the app only | ⚠️ current Safari tab (iOS 17+) | ✅ |
| **iPhone** | ✅ browser | ⚠️ virtual pointer inside the app only | ⚠️ current Safari tab (iOS 17+) | ✅ |

The ⚠️ rows are **OS restrictions, not missing features**: iOS/iPadOS do not
allow any third-party app — native or web — to inject system-wide input into
other apps, and Safari only allows capturing its own tab. Within those rules,
Unify Remote does the most the platform permits: the *Be controlled* tab gives
iPad/iPhone a virtual pointer, remote-typed text, and remote scrolling inside
the app surface. Full system-wide control of an iPad from an iPhone would
require Apple-private APIs (what Apple's own Universal Control uses).

## Screen mirroring & "extend"

Mirroring is direct WebRTC between the two devices (the hub only carries the
initial handshake), so latency is low on a LAN.

To use a device as an **extended display** rather than a mirror:

- Share a **single window** from the Mac (the macOS picker lets you choose),
  move that app to the corner of your desktop, and full-screen the viewer on
  the iPad/iPhone — that device now dedicates itself to one app's window.
- For a true extra desktop space, pair this with a virtual display: macOS
  **Sidecar** (iPad) already does this natively, or create a headless virtual
  screen with a tool like BetterDisplay and share *that* screen through Unify
  Remote to any device, including another Mac or an iPhone — something Sidecar
  can't do.

## Architecture

```
┌─────────────┐   WebSocket (JSON)   ┌──────────────┐
│ any browser │ ◄──────────────────► │  hub (Node)  │
│  (client/)  │                      │  server/     │
└─────┬───────┘                      └──────┬───────┘
      │  WebRTC (screen video, P2P)         │ stdin (JSON lines)
      ▼                                     ▼
 other browsers                    bridge/inputbridge (Swift)
                                   CGEvent → macOS input
```

- `server/index.js` — static file server + WebSocket hub (`server/hub.js`)
- `server/host.js` — connects the Mac as a controllable target, feeds the bridge
- `bridge/InputBridge.swift` — compiled on first run; injects mouse moves,
  clicks, drags, scrolls, unicode text, key codes with modifiers, and media
  keys (volume / play-pause) via CGEvent + NSEvent
- `client/` — dependency-free PWA: trackpad gesture engine, live keyboard,
  media remote, WebRTC share/view, virtual-pointer receiver mode

## Security notes

Joining the hub requires the pairing PIN printed at startup, so a random
device on your Wi-Fi can't register itself and send input to the Mac. The
PIN travels over plain `ws://` on your LAN — keep the hub on a trusted
network, and rotate the PIN by restarting (or set `UNIFY_PIN`). A reasonable
next step is HTTPS/WSS with a self-signed cert, which also unlocks
`getDisplayMedia` screen sharing in browsers that require a secure context
for non-localhost origins.
