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

## Running

```bash
npm install
npm run dev
```

Then open the printed local URL and **allow microphone access** — the visuals
react to whatever the mic hears. Click anywhere once if audio does not start
(browsers keep the `AudioContext` suspended until a user gesture). The panel
shows the current mic status.

Other scripts:

```bash
npm run build     # production build to dist/
npm run preview   # serve the production build
npm run lint      # oxlint
```

## Notes

This is a prototype. Audio setup runs once and the animation loop reads the
control values live, so changing the color or typing lyrics does **not** rebuild
the `AudioContext`. The mic input is a placeholder — the plan is to later wire
it to a file or DAW feed.
