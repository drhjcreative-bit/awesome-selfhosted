// InputBridge — injects mouse, keyboard, and media-key events into macOS.
//
// Reads one JSON object per line from stdin:
//   {"t":"move","dx":3.5,"dy":-1.2}
//   {"t":"click","btn":"left","count":1}
//   {"t":"down","btn":"left"}            begin drag
//   {"t":"up","btn":"left"}              end drag
//   {"t":"scroll","dx":0,"dy":-8}
//   {"t":"text","s":"hello"}
//   {"t":"key","code":36,"mods":["cmd"]}
//   {"t":"media","action":"playpause"}
//
// Requires the Accessibility permission (System Settings → Privacy &
// Security → Accessibility) for the process that launches it.

import Cocoa
import CoreGraphics
import Foundation

let NX_KEYTYPE_SOUND_UP: Int32 = 0
let NX_KEYTYPE_SOUND_DOWN: Int32 = 1
let NX_KEYTYPE_MUTE: Int32 = 7
let NX_KEYTYPE_PLAY: Int32 = 16
let NX_KEYTYPE_NEXT: Int32 = 17
let NX_KEYTYPE_PREVIOUS: Int32 = 18

var leftButtonDown = false

func currentMouseLocation() -> CGPoint {
    CGEvent(source: nil)?.location ?? .zero
}

func clampToScreens(_ p: CGPoint) -> CGPoint {
    var union = CGRect.null
    for screen in NSScreen.screens {
        // NSScreen is bottom-left origin; CGEvent is top-left. Convert.
        let f = screen.frame
        let top = (NSScreen.screens.first?.frame.maxY ?? f.maxY) - f.maxY
        union = union.union(CGRect(x: f.minX, y: top, width: f.width, height: f.height))
    }
    if union.isNull { return p }
    return CGPoint(
        x: min(max(p.x, union.minX), union.maxX - 1),
        y: min(max(p.y, union.minY), union.maxY - 1)
    )
}

func postMouse(_ type: CGEventType, at point: CGPoint, button: CGMouseButton, clickCount: Int64 = 1) {
    guard let ev = CGEvent(
        mouseEventSource: nil, mouseType: type,
        mouseCursorPosition: point, mouseButton: button
    ) else { return }
    ev.setIntegerValueField(.mouseEventClickState, value: clickCount)
    ev.post(tap: .cghidEventTap)
}

func handleMove(dx: Double, dy: Double) {
    let target = clampToScreens(
        CGPoint(x: currentMouseLocation().x + dx, y: currentMouseLocation().y + dy))
    postMouse(leftButtonDown ? .leftMouseDragged : .mouseMoved, at: target, button: .left)
}

func handleClick(btn: String, count: Int64) {
    let point = currentMouseLocation()
    let (down, up, button): (CGEventType, CGEventType, CGMouseButton) =
        btn == "right"
        ? (.rightMouseDown, .rightMouseUp, .right)
        : (.leftMouseDown, .leftMouseUp, .left)
    for _ in 0..<max(count, 1) {
        postMouse(down, at: point, button: button, clickCount: count)
        postMouse(up, at: point, button: button, clickCount: count)
    }
}

func handleButton(btn: String, down: Bool) {
    let point = currentMouseLocation()
    if btn == "right" {
        postMouse(down ? .rightMouseDown : .rightMouseUp, at: point, button: .right)
    } else {
        leftButtonDown = down
        postMouse(down ? .leftMouseDown : .leftMouseUp, at: point, button: .left)
    }
}

func handleScroll(dx: Double, dy: Double) {
    guard let ev = CGEvent(
        scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
        wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0
    ) else { return }
    ev.post(tap: .cghidEventTap)
}

func handleText(_ s: String) {
    // Type arbitrary unicode text via a keyboard event with a unicode string.
    for chunk in s.unicodeScalars.map({ String($0) }) {
        let utf16 = Array(chunk.utf16)
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
        else { continue }
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
}

func handleKey(code: Int64, mods: [String]) {
    var flags: CGEventFlags = []
    for m in mods {
        switch m {
        case "cmd": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt": flags.insert(.maskAlternate)
        case "ctrl": flags.insert(.maskControl)
        default: break
        }
    }
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: false)
    else { return }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func handleMedia(_ action: String) {
    let key: Int32
    switch action {
    case "playpause": key = NX_KEYTYPE_PLAY
    case "next": key = NX_KEYTYPE_NEXT
    case "prev": key = NX_KEYTYPE_PREVIOUS
    case "volup": key = NX_KEYTYPE_SOUND_UP
    case "voldown": key = NX_KEYTYPE_SOUND_DOWN
    case "mute": key = NX_KEYTYPE_MUTE
    default: return
    }
    for down in [true, false] {
        let flags = NSEvent.ModifierFlags(rawValue: down ? 0xA00 : 0xB00)
        let data1 = Int((Int32(key) << 16) | ((down ? 0xA : 0xB) << 8))
        guard let ev = NSEvent.otherEvent(
            with: .systemDefined, location: .zero, modifierFlags: flags,
            timestamp: 0, windowNumber: 0, context: nil,
            subtype: 8, data1: data1, data2: -1
        ) else { continue }
        ev.cgEvent?.post(tap: .cghidEventTap)
    }
}

// Warn (but keep running) if Accessibility permission is missing, so the
// user sees the prompt and events start working once granted.
if !AXIsProcessTrusted() {
    FileHandle.standardError.write(
        "[bridge] Accessibility permission not granted yet — grant it in "
        + "System Settings → Privacy & Security → Accessibility\n".data(using: .utf8)!)
}

while let line = readLine(strippingNewline: true) {
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let t = obj["t"] as? String
    else { continue }

    let num = { (k: String) -> Double in (obj[k] as? NSNumber)?.doubleValue ?? 0 }

    switch t {
    case "move": handleMove(dx: num("dx"), dy: num("dy"))
    case "click":
        handleClick(btn: obj["btn"] as? String ?? "left",
                    count: (obj["count"] as? NSNumber)?.int64Value ?? 1)
    case "down": handleButton(btn: obj["btn"] as? String ?? "left", down: true)
    case "up": handleButton(btn: obj["btn"] as? String ?? "left", down: false)
    case "scroll": handleScroll(dx: num("dx"), dy: num("dy"))
    case "text": handleText(obj["s"] as? String ?? "")
    case "key":
        handleKey(code: (obj["code"] as? NSNumber)?.int64Value ?? 0,
                  mods: obj["mods"] as? [String] ?? [])
    case "media": handleMedia(obj["action"] as? String ?? "")
    default: break
    }
}
