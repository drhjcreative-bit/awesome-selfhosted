# DUANYSWRLD ✳ Visual Lab

An audio-reactive visual playground built with React + Vite and the Web Audio
API. It analyzes microphone input or a selected local audio file through an
`AnalyserNode` and renders it to a full-screen `<canvas>` in one of several
visual modes, with an on-screen control panel.

The chrome is a dark, editorial, typewriter-mono aesthetic: uppercase
`( PARENTHETICAL )` section labels, hairline rules (including a signature
vertical rule down the center of the stage), collapsible +/− panel sections,
ghost buttons that invert on hover, and an acid-green accent. The lyric
overlay defaults to `STAY STRANGE`.

## Modes

| Mode       | What it draws                                                       |
| ---------- | ------------------------------------------------------------------- |
| `SCOPE`    | Oscilloscope waveform from the time-domain data, with a glow.       |
| `SPECTRUM` | Classic frequency-bar spectrum, hue mapped across the spectrum.     |
| `LAVA`     | Grid of pulsing blobs driven by frequency bins + spectral centroid. |
| `PLASMA`   | Animated plasma field modulated by RMS loudness and centroid.       |
| `STARS`    | Orbiting particles whose radius follows overall loudness.           |
| `ORB`      | Spinning sphere of rainbow particle streaks (spin-illusion style); loudness drives spin speed, streak length, and radius. |

Two full-screen post effects — CRT scanlines and an RGB noise overlay — sit on
top of every mode. A lyrics/text overlay can be toggled and edited live, and an
optional beat detector pulses the visuals on bass hits.

## Controls

The panel is split into collapsible `( CONTROLS )` / `( SOURCE )` /
`( OUTPUT )` sections.

- **Mode** — pick the active visualizer.
- **Color** — base color for `SCOPE`.
- **Intensity** — scales reactivity, glow, and noise strength.
- **Show lyrics** — toggle the text overlay.
- **Beat pulse** — punch the visuals on detected bass hits (kick/beat).
- **Lyrics / text** — the overlay string.
- **Source** — switch the audio input between the **microphone** and a loaded
  **audio file**. When a file is selected it plays (looping) and drives the
  visuals; use the Play/Pause button to control it.
- **Input device** — in mic mode, when more than one audio input is available,
  pick which one drives the visuals (a specific mic, or a virtual
  loopback/DAW device exposed to the browser as an input). Device names appear
  once microphone access has been granted.
- **Record** — capture the live canvas (with the current audio) to a `.webm`
  clip; press again to stop, then use **Download clip**.

## Audio input

The visuals react to whichever source is selected:

- **Mic** — captures live microphone audio (analysis only; not routed to the
  speakers, so there's no feedback).
- **Audio file** — pick any local audio file; it's routed through the
  analyser to the speakers so you hear it while it drives the visuals. Use this
  to point at a track or a DAW's rendered output. For a live DAW feed, expose it
  to the browser as an input device (via the OS or a virtual audio driver) and
  select it from the **Input device** picker in mic mode.

## Recording

Press **Record** to capture the canvas via `canvas.captureStream()` and
`MediaRecorder`. The current audio is mixed in through a `MediaStreamDestination`
tap on the audio graph, so the exported clip has sound (works for both mic and
file sources). Press **Stop recording**, then **Download clip** to save the
`.webm`. Recording uses VP9/Opus when available, falling back to VP8 then plain
WebM; browsers without `MediaRecorder`/`captureStream` show a notice instead.

## Running

```bash
npm install
npm run dev
```

Then open the printed local URL. It starts on the mic, so **allow microphone
access** — or click **Audio file** to visualize a track instead. Click
anywhere once if audio does not start (browsers keep the `AudioContext`
suspended until a user gesture). The panel shows the current source status.

Other scripts:

```bash
npm run build     # production build to dist/
npm run preview   # serve the production build
npm run lint      # oxlint
npm test          # run the unit tests once (Vitest)
npm run test:watch # re-run tests on change
npm run coverage  # unit tests + coverage report for src/lib/
```

## Testing

Pure, browser-independent logic lives in `src/lib/` so it can be unit-tested
without a canvas, `AudioContext`, or DOM:

- `color.js` — `hexToRgb` / `hslToRgb` used by the render loop.
- `audioFeatures.js` — `computeAudioFeatures`, the per-frame loudness/centroid
  analysis and bass beat detection extracted from the draw loop.
- `mime.js` — `pickRecordingMime`, the recorder codec selection.

These helpers' branch/edge-case tests run under [Vitest](https://vitest.dev/) in
a `node` environment.

The component and audio-graph layers are covered by integration tests that run
in jsdom (opted in per file with a `// @vitest-environment jsdom` docblock)
against a shared fake-media harness in `src/test/mediaMocks.js`. jsdom ships none
of the Web Audio API, `MediaRecorder`, canvas rendering, `captureStream`, or
`getUserMedia`, so `installMediaMocks()` stands in fakes for all of them and
hands back spies/handles. These suites cover:

- **Interaction / a11y** (`App.interaction.test.jsx`) — control wiring, the
  collapsible panel sections, labelled controls, and the status region.
- **Audio graph** (`App.integration.test.jsx`) — mic-on-mount wiring, mic↔file
  switching (including the no-feedback invariant and the stale-request guard),
  file play/pause, and the input-device picker.
- **Recording** — the `MediaRecorder` lifecycle: unsupported environments,
  start → mix audio → stop → download, and error handling.
- **Cleanup** — unmount tears down the graph, stops live tracks and recordings,
  removes listeners, and revokes object URLs.

- **Draw loop** (`App.draw.test.jsx`) — the per-mode rendering
  (`SCOPE`/`SPECTRUM`/`LAVA`/`PLASMA`/`STARS`/`ORB`) plus the overlay/effect
  branches are smoke-tested: `installMediaMocks()` captures the loop's scheduled
  frame callback so a test can run exactly one frame per mode and assert it does
  not throw. Pixels aren't asserted (that needs a real canvas), but a mode that
  crashes the app is caught.

`npm run coverage` reports coverage for `src/lib/` and `src/App.jsx`.

## Notes

The grain overlay is drawn from a small (256×256) noise tile regenerated each
frame and blended over the canvas as a repeating `overlay` pattern, rather than
reading back and rewriting every pixel — much cheaper at high resolutions while
keeping the same look.

This is a prototype. The `AudioContext` and render loop are created once; the
animation loop reads control values live via refs, so changing the color or
typing lyrics does **not** rebuild the audio graph. The input source can be
swapped at runtime (mic ↔ file) without recreating the context — switching tears
down the previous source, stops any live mic tracks, and rewires the analyser.
