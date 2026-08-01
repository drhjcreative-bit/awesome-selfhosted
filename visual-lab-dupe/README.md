# Visual Lab Dupe

An audio-reactive visual playground built with React + Vite and the Web Audio
API. It captures live audio (currently the microphone) through an
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
top of every mode. A lyrics/text overlay can be toggled and edited live.

## Controls

- **Mode** — pick the active visualizer.
- **Color** — base color for `SCOPE`.
- **Intensity** — scales reactivity, glow, and noise strength.
- **Show lyrics** — toggle the text overlay.
- **Lyrics / text** — the overlay string.
- **Source** — switch the audio input between the **microphone** and a loaded
  **audio file**. When a file is selected it plays (looping) and drives the
  visuals; use the Play/Pause button to control it.

## Audio input

The visuals react to whichever source is selected:

- **🎤 Mic** — captures live microphone audio (analysis only; not routed to the
  speakers, so there's no feedback).
- **🎵 Audio file** — pick any local audio file; it's routed through the
  analyser to the speakers so you hear it while it drives the visuals. This is
  the path to point at a track or a DAW's rendered output for now; a direct DAW
  device feed can be selected via the OS/browser as a mic-style input later.

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
```

## Notes

This is a prototype. The `AudioContext` and render loop are created once; the
animation loop reads control values live via refs, so changing the color or
typing lyrics does **not** rebuild the audio graph. The input source can be
swapped at runtime (mic ↔ file) without recreating the context — switching tears
down the previous source, stops any live mic tracks, and rewires the analyser.
