import { useEffect, useRef, useState } from "react";

const modes = ["SCOPE", "SPECTRUM", "LAVA", "PLASMA", "STARS"];

export default function App() {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animRef = useRef(null);

  const [mode, setMode] = useState("SCOPE");
  const [color, setColor] = useState("#00f0ff");
  const [intensity, setIntensity] = useState(0.7);
  const [showText, setShowText] = useState(true);
  const [lyrics, setLyrics] = useState("Night lights flicker in slow motion");
  const [status, setStatus] = useState("Allow mic access to see audio-reactive visuals.");

  // Live snapshot of the controls so the animation loop can read current values
  // without tearing down and rebuilding the AudioContext on every keystroke.
  const controlsRef = useRef({ mode, color, intensity, showText, lyrics });
  controlsRef.current = { mode, color, intensity, showText, lyrics };

  // Resume a suspended AudioContext (browsers start it suspended until a gesture).
  const resumeAudio = () => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") ctx.resume();
  };

  // Audio + rendering are set up exactly once. Controls are read live via refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    // For demo: use mic; later replace with file/DAW feed
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const src = audioCtx.createMediaStreamSource(stream);
        src.connect(analyser);
        sourceRef.current = src;
        resumeAudio();
        setStatus("Mic connected. Later we'll wire this to your DAW.");
      })
      .catch((err) => {
        setStatus(`Mic unavailable (${err.name}). Visuals will stay idle.`);
      });

    const bufferLength = analyser.frequencyBinCount;
    const timeData = new Uint8Array(bufferLength);
    const freqData = new Uint8Array(bufferLength);

    const hexToRgb = (hex) => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return m
        ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
        : [0, 240, 255];
    };

    const draw = () => {
      const { mode, color, intensity, showText, lyrics } = controlsRef.current;

      ctx.fillStyle = "rgba(5,5,10,0.25)";
      ctx.fillRect(0, 0, width, height);

      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      const [r, g, b] = hexToRgb(color);
      const baseColor = `rgb(${r}, ${g}, ${b})`;
      const intensityFactor = 0.4 + intensity * 1.2;

      // Audio features
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += freqData[i];
      const rms = sum / bufferLength / 255;
      const centroid =
        freqData.reduce((acc, v, i) => acc + v * i, 0) / (sum || 1);

      if (mode === "SCOPE") {
        ctx.lineWidth = 2;
        ctx.strokeStyle = baseColor;
        ctx.shadowBlur = 10 * intensity;
        ctx.shadowColor = baseColor;
        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = timeData[i] / 128.0;
          const y = (v * height) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (mode === "SPECTRUM") {
        const barWidth = (width / bufferLength) * 2.5;
        let bx = 0;
        for (let i = 0; i < bufferLength; i++) {
          const barHeight =
            (freqData[i] / 255) * (height * 0.6) * intensityFactor;
          const hue = (i / bufferLength) * 360;
          ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.9)`;
          ctx.fillRect(bx, height - barHeight, barWidth, barHeight);
          bx += barWidth + 1;
          if (bx > width) break;
        }
      } else if (mode === "LAVA") {
        const cols = 40;
        const rows = 25;
        const cellW = width / cols;
        const cellH = height / rows;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const i = Math.floor((x / cols) * bufferLength);
            const v = (freqData[i] / 255) * intensityFactor;
            const size = cellW * 0.8 * (0.2 + v);
            const cx = x * cellW + cellW / 2;
            const cy = y * cellH + cellH / 2;
            const hueShift = (centroid / bufferLength) * 60;
            ctx.beginPath();
            ctx.arc(cx, cy, size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${(x / cols) * 360 + hueShift}, 70%, 50%, ${
              0.15 + v * 0.4
            })`;
            ctx.fill();
          }
        }
      } else if (mode === "PLASMA") {
        const time = audioCtx.currentTime * 0.5;
        for (let y = 0; y < height; y += 6) {
          for (let x = 0; x < width; x += 6) {
            const nx = x / width;
            const ny = y / height;
            const v =
              Math.sin(nx * 6 + time) +
              Math.sin(ny * 4 - time) +
              Math.sin((nx + ny) * 5 + time) +
              (rms * 2 - 1) * intensityFactor;
            const val = (v + 3) / 6;
            const hue = (centroid / bufferLength) * 360 + val * 360;
            ctx.fillStyle = `hsla(${hue}, 80%, ${40 + val * 40}%, ${
              0.15 + val * 0.4
            })`;
            ctx.fillRect(x, y, 6, 6);
          }
        }
      } else if (mode === "STARS") {
        const count = 200;
        for (let i = 0; i < count; i++) {
          const t = (i / count) * Math.PI * 2;
          const radius = height * 0.25 * (0.5 + rms * intensityFactor);
          const cx = width / 2 + Math.cos(t + audioCtx.currentTime) * radius;
          const cy =
            height / 2 + Math.sin(t + audioCtx.currentTime * 1.2) * radius;
          const size =
            1 + (freqData[i % bufferLength] / 255) * 3 * intensityFactor;
          ctx.beginPath();
          ctx.arc(cx, cy, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${
            0.3 + (freqData[i % bufferLength] / 255) * 0.7
          })`;
          ctx.fill();
        }
      }

      // FX: CRT scanlines
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 2);
      }

      // FX: noise overlay
      if (intensity > 0 && width > 0 && height > 0) {
        const noiseData = ctx.getImageData(0, 0, width, height);
        const d = noiseData.data;
        for (let i = 0; i < d.length; i += 4) {
          const n = (Math.random() - 0.5) * 20 * intensity;
          d[i] = Math.min(255, Math.max(0, d[i] + n));
          d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
          d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
        }
        ctx.putImageData(noiseData, 0, 0);
      }

      // Lyrics overlay
      if (showText) {
        ctx.font = "24px sans-serif";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 6;
        ctx.fillText(lyrics, width / 2, height - 60);
        ctx.shadowBlur = 0;
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", handleResize);
      if (sourceRef.current) sourceRef.current.disconnect();
      audioCtx.close();
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        background: "#05050a",
        overflow: "hidden",
      }}
      onClick={resumeAudio}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          color: "#fff",
          fontFamily: "sans-serif",
          background: "rgba(0,0,0,0.4)",
          padding: 10,
          borderRadius: 8,
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 18 }}>
          Visual Lab Dupe (Prototype)
        </h1>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            style={{ padding: 6 }}
          >
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <label>
            Color
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ marginLeft: 6, verticalAlign: "middle" }}
            />
          </label>
          <label>
            Intensity
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={intensity}
              onChange={(e) => setIntensity(parseFloat(e.target.value))}
              style={{ marginLeft: 6, verticalAlign: "middle" }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={showText}
              onChange={(e) => setShowText(e.target.checked)}
              style={{ marginLeft: 6 }}
            />
            Show lyrics
          </label>
          <input
            type="text"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="Lyrics / text"
            style={{ padding: 6, minWidth: 220 }}
          />
        </div>
        <p style={{ fontSize: 12, opacity: 0.8, margin: "6px 0 0" }}>{status}</p>
      </div>
    </div>
  );
}
