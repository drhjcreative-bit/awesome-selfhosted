# Visual Lab Dupe

An audio-reactive visual playground built with React + Vite and the Web Audio
API. It analyzes microphone input or a selected local audio file through an
`AnalyserNode` and renders it to a full-screen `<canvas>` in one of several
visual modes, with a small on-screen control panel.

## Modes

| Mode       | What it draws                                                       |
| ---------- | ------------------------------------------------------------------- |
| `SCOPE`    | Oscilloscope waveform from the time-domain data, with a glow.       |
| `SPECTRUM` | Classic frequency-bar spectrum, hue mapped across the spectrum.     |
| `LAVA`     | Grid of pulsing blobs driven by frequency bins + spectral centroid. |
| `PLASMA`   | Animated plasma field modulated by RMS loudness and centroid.       |
| `STARS`    | Orbiting particles whose radius follows overall loudness.           |

Two full-screen post effects — CRT scanlines and an RGB noise overlay — sit on
top of every mode. A lyrics/text overlay can be toggled and edited live, and an
optional beat detector pulses the visuals on bass hits.

## Controls

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

- **🎤 Mic** — captures live microphone audio (analysis only; not routed to the
  speakers, so there's no feedback).
- **🎵 Audio file** — pick any local audio file; it's routed through the
  analyser to the speakers so you hear it while it drives the visuals. Use this
  to point at a track or a DAW's rendered output. For a live DAW feed, expose it
  to the browser as an input device (via the OS or a virtual audio driver) and
  select it from the **Input device** picker in mic mode.

## Recording

Press **⏺ Record** to capture the canvas via `canvas.captureStream()` and
`MediaRecorder`. The current audio is mixed in through a `MediaStreamDestination`
tap on the audio graph, so the exported clip has sound (works for both mic and
file sources). Press **⏹ Stop recording**, then **⬇ Download clip** to save the
`.webm`. Recording uses VP9/Opus when available, falling back to VP8 then plain
WebM; browsers without `MediaRecorder`/`captureStream` show a notice instead.

## Running

```bash
npm install
npm run dev
```

Then open the printed local URL. It starts on the mic, so **allow microphone
access** — or click **🎵 Audio file** to visualize a track instead. Click
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

Tests run under [Vitest](https://vitest.dev/) in a `node` environment and cover
these helpers' branches and edge cases. Component and audio-graph integration
tests (which need jsdom plus mocked Web Audio / `MediaRecorder` / canvas APIs)
are a planned next layer; new files can opt into the DOM with a
`// @vitest-environment jsdom` docblock.

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
