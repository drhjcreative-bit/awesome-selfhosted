import { useEffect, useRef, useState } from "react";

const modes = ["SCOPE", "SPECTRUM", "LAVA", "PLASMA", "STARS"];

export default function App() {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null); // current input node feeding the analyser
  const micStreamRef = useRef(null);
  const audioElRef = useRef(null);
  const mediaElSrcRef = useRef(null); // MediaElementSource can be created only once per element
  const animRef = useRef(null);
  const streamDestRef = useRef(null); // taps the audio graph for recording
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const [mode, setMode] = useState("SCOPE");
  const [color, setColor] = useState("#00f0ff");
  const [intensity, setIntensity] = useState(0.7);
  const [showText, setShowText] = useState(true);
  const [lyrics, setLyrics] = useState("Night lights flicker in slow motion");
  const [beat, setBeat] = useState(true);
  const [status, setStatus] = useState("Allow mic access to see audio-reactive visuals.");
  const [sourceType, setSourceType] = useState("mic"); // "mic" | "file"
  const [fileName, setFileName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");

  // Live snapshot of the controls so the animation loop can read current values
  // without tearing down and rebuilding the AudioContext on every keystroke.
  const controlsRef = useRef({ mode, color, intensity, showText, lyrics, beat });
  controlsRef.current = { mode, color, intensity, showText, lyrics, beat };

  const resumeAudio = () => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") ctx.resume();
  };

  // Tear down whatever is currently feeding the analyser, so we can switch inputs
  // (mic <-> file) without stacking connections or leaking a live mic stream.
  const disconnectCurrentSource = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        /* already disconnected */
      }
      sourceRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioElRef.current) audioElRef.current.pause();
    // The file path routes analyser -> destination so it's audible; drop that
    // edge when leaving file mode so mic input can't feed back to the speakers.
    if (analyserRef.current && audioCtxRef.current) {
      try {
        analyserRef.current.disconnect(audioCtxRef.current.destination);
      } catch {
        /* not connected */
      }
    }
  };

  const connectMic = async () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    disconnectCurrentSource();
    setSourceType("mic");
    setIsPlaying(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyserRef.current);
      sourceRef.current = src;
      await ctx.resume();
      setStatus("Mic connected.");
    } catch (err) {
      setStatus(`Mic unavailable (${err.name}). Visuals will stay idle.`);
    }
  };

  const connectFile = async (file) => {
    const ctx = audioCtxRef.current;
    const el = audioElRef.current;
    if (!ctx || !el || !file) return;
    disconnectCurrentSource();

    if (el.src) URL.revokeObjectURL(el.src);
    el.src = URL.createObjectURL(file);
    el.loop = true;

    try {
      // Reuse the element's source across file swaps — the API allows exactly one.
      if (!mediaElSrcRef.current) {
        mediaElSrcRef.current = ctx.createMediaElementSource(el);
      }
      const src = mediaElSrcRef.current;
      src.connect(analyserRef.current);
      analyserRef.current.connect(ctx.destination); // route audio so it's audible
      sourceRef.current = src;
    } catch (err) {
      setStatus(`Could not route audio file (${err.name}).`);
      return;
    }

    setSourceType("file");
    setFileName(file.name);
    await ctx.resume();
    try {
      await el.play();
      setIsPlaying(true);
      setStatus(`Playing: ${file.name}`);
    } catch {
      setIsPlaying(false);
      setStatus(`Loaded: ${file.name} — press Play.`);
    }
  };

  const togglePlay = async () => {
    const el = audioElRef.current;
    const ctx = audioCtxRef.current;
    if (!el || !el.src) return;
    await ctx?.resume();
    if (el.paused) {
      await el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    if (file) connectFile(file);
  };

  const pickRecordingMime = () => {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || null;
  };

  const toggleRecord = () => {
    // Stop an in-progress recording.
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== "function") {
      setStatus("Recording isn't supported in this browser.");
      return;
    }
    const mimeType = pickRecordingMime();
    if (!mimeType) {
      setStatus("Recording isn't supported in this browser.");
      return;
    }

    resumeAudio();
    const stream = canvas.captureStream(30);
    // Mix in whatever audio is currently reaching the analyser (mic or file).
    streamDestRef.current?.stream
      .getAudioTracks()
      .forEach((track) => stream.addTrack(track));

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      setStatus(`Could not start recording (${err.name}).`);
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setIsRecording(false);
      setStatus(`Recording ready (${(blob.size / 1e6).toFixed(1)} MB).`);
    };

    recorder.start();
    setIsRecording(true);
    setStatus("Recording…");
  };

  // Audio context + render loop are set up exactly once. Controls are read live
  // via refs; the input source can be swapped at runtime via the helpers above.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const audioEl = audioElRef.current; // captured for the cleanup closure

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    // A silent capture tap on the audio graph, used to add an audio track to
    // recordings. It's not the speakers, so wiring it up never causes feedback.
    const streamDest = audioCtx.createMediaStreamDestination();
    analyser.connect(streamDest);
    streamDestRef.current = streamDest;

    // Default to the mic, preserving the original prototype's behavior.
    connectMic();

    const bufferLength = analyser.frequencyBinCount;
    const timeData = new Uint8Array(bufferLength);
    const freqData = new Uint8Array(bufferLength);

    // Beat tracking: compare instantaneous bass energy against a running
    // average; a strong spike above it registers a beat and fires a decaying
    // pulse that briefly boosts the visuals.
    const bassBins = Math.max(1, Math.floor(bufferLength * 0.08));
    let bassAvg = 0;
    let pulse = 0;

    const hexToRgb = (hex) => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return m
        ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
        : [0, 240, 255];
    };

    const draw = () => {
      const { mode, color, intensity, showText, lyrics, beat } =
        controlsRef.current;

      ctx.fillStyle = "rgba(5,5,10,0.25)";
      ctx.fillRect(0, 0, width, height);

      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      const [r, g, b] = hexToRgb(color);
      const baseColor = `rgb(${r}, ${g}, ${b})`;

      // Audio features
      let sum = 0;
      let bassSum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += freqData[i];
        if (i < bassBins) bassSum += freqData[i];
      }
      const rms = sum / bufferLength / 255;
      const centroid =
        freqData.reduce((acc, v, i) => acc + v * i, 0) / (sum || 1);

      // Beat detection on bass energy, feeding a decaying pulse.
      const bass = bassSum / bassBins / 255;
      if (bass > bassAvg * 1.35 && bass > 0.12) pulse = 1;
      pulse *= 0.9;
      bassAvg = bassAvg * 0.92 + bass * 0.08;
      const beatBoost = beat ? pulse * 0.6 : 0;

      const intensityFactor = 0.4 + intensity * 1.2 + beatBoost;

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
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      disconnectCurrentSource();
      if (audioEl?.src) URL.revokeObjectURL(audioEl.src);
      mediaElSrcRef.current = null;
      audioCtx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <audio ref={audioElRef} style={{ display: "none" }} />
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
          <label>
            <input
              type="checkbox"
              checked={beat}
              onChange={(e) => setBeat(e.target.checked)}
              style={{ marginLeft: 6 }}
            />
            Beat pulse
          </label>
          <input
            type="text"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="Lyrics / text"
            style={{ padding: 6, minWidth: 220 }}
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <span style={{ fontSize: 13, opacity: 0.8 }}>Source:</span>
          <button
            type="button"
            onClick={connectMic}
            style={{
              padding: "4px 10px",
              cursor: "pointer",
              fontWeight: sourceType === "mic" ? 700 : 400,
            }}
          >
            🎤 Mic
          </button>
          <label
            style={{
              padding: "4px 10px",
              cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: 4,
              fontWeight: sourceType === "file" ? 700 : 400,
            }}
          >
            🎵 Audio file
            <input
              type="file"
              accept="audio/*"
              onChange={onPickFile}
              style={{ display: "none" }}
            />
          </label>
          {sourceType === "file" && fileName && (
            <>
              <button
                type="button"
                onClick={togglePlay}
                style={{ padding: "4px 10px", cursor: "pointer" }}
              >
                {isPlaying ? "⏸ Pause" : "▶ Play"}
              </button>
              <span
                style={{
                  fontSize: 12,
                  opacity: 0.8,
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {fileName}
              </span>
            </>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <button
            type="button"
            onClick={toggleRecord}
            style={{
              padding: "4px 10px",
              cursor: "pointer",
              color: isRecording ? "#ff5a5a" : undefined,
              fontWeight: isRecording ? 700 : 400,
            }}
          >
            {isRecording ? "⏹ Stop recording" : "⏺ Record"}
          </button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download="visual-lab-recording.webm"
              style={{ color: "#00f0ff", fontSize: 13 }}
            >
              ⬇ Download clip
            </a>
          )}
        </div>

        <p style={{ fontSize: 12, opacity: 0.8, margin: "6px 0 0" }}>{status}</p>
      </div>
    </div>
  );
}
