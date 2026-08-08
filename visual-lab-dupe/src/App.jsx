import { useEffect, useRef, useState } from "react";
import { hexToRgb, hslToRgb } from "./lib/color.js";
import { computeAudioFeatures } from "./lib/audioFeatures.js";
import { pickRecordingMime } from "./lib/mime.js";

const modes = ["SCOPE", "SPECTRUM", "LAVA", "PLASMA", "STARS", "ORB"];

// Collapsible panel section in the Sidestage-style typewriter aesthetic:
// an uppercase ( LABEL ) row with a +/− toggle, hairline-separated.
function Section({ label, open, onToggle, children }) {
  return (
    <section className="panel-section">
      <button
        type="button"
        className="section-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>( {label} )</span>
        <span className="section-toggle" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

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
  const sourceReqRef = useRef(0); // invalidates in-flight async source setup
  const downloadUrlRef = useRef(""); // mirror of downloadUrl for unmount cleanup
  const selectedDeviceIdRef = useRef(""); // "" = default input; read by connectMic

  const [mode, setMode] = useState("SCOPE");
  const [color, setColor] = useState("#a7ff4a");
  const [intensity, setIntensity] = useState(0.7);
  const [showText, setShowText] = useState(true);
  const [lyrics, setLyrics] = useState("STAY STRANGE");
  const [beat, setBeat] = useState(true);
  const [status, setStatus] = useState("Allow mic access to see audio-reactive visuals.");
  const [sourceType, setSourceType] = useState("mic"); // "mic" | "file"
  const [fileName, setFileName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [inputDevices, setInputDevices] = useState([]); // available audio inputs
  const [selectedDeviceId, setSelectedDeviceId] = useState(""); // "" = default
  // Purely presentational accordion state; toggling never touches the audio graph.
  const [openSections, setOpenSections] = useState({
    controls: true,
    source: true,
    output: true,
  });
  const toggleSection = (key) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Live snapshot of the controls so the animation loop can read current values
  // without tearing down and rebuilding the AudioContext on every keystroke.
  const controlsRef = useRef({ mode, color, intensity, showText, lyrics, beat });
  useEffect(() => {
    controlsRef.current = { mode, color, intensity, showText, lyrics, beat };
  });

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

  // Enumerate audio inputs so the user can pick a specific device (e.g. a
  // second mic or a virtual loopback/DAW feed). Device labels are only exposed
  // once mic permission has been granted, so this is refreshed after connect.
  const refreshInputDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Drop Chrome's synthetic "default" input — the picker already renders its
      // own empty-value "Default input" option, and the synthetic entry would
      // otherwise duplicate it (and inflate the count that gates the picker).
      const inputs = devices.filter(
        (d) =>
          d.kind === "audioinput" && d.deviceId && d.deviceId !== "default",
      );
      setInputDevices(inputs);
      // If the previously selected device is gone (unplugged), fall back to the
      // default so the picker doesn't point at a device that no longer exists.
      if (
        selectedDeviceIdRef.current &&
        !inputs.some((d) => d.deviceId === selectedDeviceIdRef.current)
      ) {
        selectedDeviceIdRef.current = "";
        setSelectedDeviceId("");
        // If the mic is the live source, the stream we were capturing from is
        // now dead — reconnect to the default input (which tears down the stale
        // capture). In file mode there's nothing to reconnect.
        if (micStreamRef.current) connectMic();
      }
    } catch {
      /* enumeration unavailable */
    }
  };

  const connectMic = async () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    disconnectCurrentSource();
    const reqId = ++sourceReqRef.current;
    setSourceType("mic");
    try {
      // Honor the picked input device; "" means let the browser choose default.
      const deviceId = selectedDeviceIdRef.current;
      const audioConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      // A newer source request (or unmount) superseded this one while the
      // permission prompt was open — drop the stream instead of wiring it up.
      if (reqId !== sourceReqRef.current || ctx.state === "closed") {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      micStreamRef.current = stream;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyserRef.current);
      sourceRef.current = src;
      await ctx.resume();
      // Now that permission is granted, device labels are readable — populate
      // (or refresh) the picker.
      refreshInputDevices();
      setStatus("Mic connected.");
    } catch (err) {
      // Ignore rejections from a request that's already been superseded (a newer
      // connectMic/connectFile bumped sourceReqRef) or after teardown, so a
      // stale failure can't clobber the current source's status.
      if (reqId !== sourceReqRef.current || ctx.state === "closed") return;
      setStatus(`Mic unavailable (${err.name}). Visuals will stay idle.`);
    }
  };

  const onPickDevice = (e) => {
    const deviceId = e.target.value;
    selectedDeviceIdRef.current = deviceId;
    setSelectedDeviceId(deviceId);
    connectMic();
  };

  const connectFile = async (file) => {
    const ctx = audioCtxRef.current;
    const el = audioElRef.current;
    if (!ctx || !el || !file) return;
    disconnectCurrentSource();
    ++sourceReqRef.current; // invalidate any in-flight mic request

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
    // isPlaying is kept in sync by the element's play/pause events (see JSX).
    try {
      await el.play();
      setStatus(`Playing: ${file.name}`);
    } catch {
      setStatus(`Loaded: ${file.name} — press Play.`);
    }
  };

  const togglePlay = async () => {
    const el = audioElRef.current;
    const ctx = audioCtxRef.current;
    if (!el || !el.src) return;
    try {
      await ctx?.resume();
      if (el.paused) await el.play();
      else el.pause();
    } catch (err) {
      setStatus(`Playback blocked (${err.name}).`);
    }
  };

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      connectFile(file).catch((err) =>
        setStatus(`Could not load audio file (${err.name}).`),
      );
    }
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

    // Stop only the canvas video track; the audio tracks belong to the shared
    // streamDest and are reused by later recordings.
    const stopCapture = () => {
      stream.getVideoTracks().forEach((track) => track.stop());
      recorderRef.current = null;
    };

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stopCapture();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        const url = URL.createObjectURL(blob);
        downloadUrlRef.current = url;
        return url;
      });
      setIsRecording(false);
      setStatus(`Recording ready (${(blob.size / 1e6).toFixed(1)} MB).`);
    };
    recorder.onerror = (e) => {
      stopCapture();
      setIsRecording(false);
      setStatus(`Recording failed (${e.error?.name ?? "unknown error"}).`);
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

    // Small offscreen tile of grayscale noise, regenerated each frame and tiled
    // across the canvas as a repeating pattern. This keeps fine, animated grain
    // while avoiding a full-resolution getImageData/putImageData every frame.
    const NOISE_SIZE = 256;
    const noiseCanvas = document.createElement("canvas");
    noiseCanvas.width = NOISE_SIZE;
    noiseCanvas.height = NOISE_SIZE;
    const noiseCtx = noiseCanvas.getContext("2d");
    const noiseImage = noiseCtx.createImageData(NOISE_SIZE, NOISE_SIZE);
    for (let i = 3; i < noiseImage.data.length; i += 4) {
      noiseImage.data[i] = 255; // opaque; blend strength comes from globalAlpha
    }

    // PLASMA is a low-frequency field, so it's computed once into a small
    // ImageData buffer (no hsla strings / per-block fillRect) and upscaled with
    // drawImage, which is far cheaper than tens of thousands of fills per frame.
    // ORB: particles spread over a sphere with a Fibonacci lattice, spun around
    // the vertical axis and drawn as short rainbow streaks. Each particle keeps
    // its own speed multiplier so neighboring bands drift apart, which is what
    // sells the "which way is it spinning" illusion.
    const ORB_COUNT = 640;
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    const orbParticles = new Array(ORB_COUNT);
    for (let i = 0; i < ORB_COUNT; i++) {
      const y = 1 - (i / (ORB_COUNT - 1)) * 2;
      const ringRadius = Math.sqrt(1 - y * y);
      const theta = GOLDEN * i;
      orbParticles[i] = {
        x: Math.cos(theta) * ringRadius,
        y,
        z: Math.sin(theta) * ringRadius,
        hue: (i * 47) % 360,
        speed: 0.6 + ((i * 31) % 100) / 125,
      };
    }
    let orbAngle = 0;

    const PLASMA_W = 160;
    const PLASMA_H = 90;
    const plasmaCanvas = document.createElement("canvas");
    plasmaCanvas.width = PLASMA_W;
    plasmaCanvas.height = PLASMA_H;
    const plasmaCtx = plasmaCanvas.getContext("2d");
    const plasmaImage = plasmaCtx.createImageData(PLASMA_W, PLASMA_H);

    const draw = () => {
      const { mode, color, intensity, showText, lyrics, beat } =
        controlsRef.current;

      ctx.fillStyle = "rgba(5,5,10,0.25)";
      ctx.fillRect(0, 0, width, height);

      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      const [r, g, b] = hexToRgb(color);
      const baseColor = `rgb(${r}, ${g}, ${b})`;

      // Audio features + beat detection (single pass over the bins). The
      // running beat state (bassAvg/pulse) is threaded through frame to frame.
      const { level, centroid, intensityFactor, bassAvg: nextBassAvg, pulse: nextPulse } =
        computeAudioFeatures(freqData, {
          bufferLength,
          bassBins,
          bassAvg,
          pulse,
          beat,
          intensity,
        });
      bassAvg = nextBassAvg;
      pulse = nextPulse;

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
        const pd = plasmaImage.data;
        let p = 0;
        for (let y = 0; y < PLASMA_H; y++) {
          const ny = y / PLASMA_H;
          for (let x = 0; x < PLASMA_W; x++) {
            const nx = x / PLASMA_W;
            const v =
              Math.sin(nx * 6 + time) +
              Math.sin(ny * 4 - time) +
              Math.sin((nx + ny) * 5 + time) +
              (level * 2 - 1) * intensityFactor;
            const val = (v + 3) / 6;
            const hue = (centroid / bufferLength) * 360 + val * 360;
            const [rr, gg, bb] = hslToRgb(hue, 0.8, 0.4 + val * 0.4);
            pd[p] = rr;
            pd[p + 1] = gg;
            pd[p + 2] = bb;
            pd[p + 3] = (0.15 + val * 0.4) * 255;
            p += 4;
          }
        }
        plasmaCtx.putImageData(plasmaImage, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(plasmaCanvas, 0, 0, width, height);
      } else if (mode === "STARS") {
        const count = 200;
        for (let i = 0; i < count; i++) {
          const t = (i / count) * Math.PI * 2;
          const radius = height * 0.25 * (0.5 + level * intensityFactor);
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
      } else if (mode === "ORB") {
        const radius =
          Math.min(width, height) *
          0.32 *
          (0.85 + level * 0.35 * intensityFactor);
        const cx = width / 2;
        const cy = height / 2;
        orbAngle += 0.008 + level * 0.03 * intensityFactor;
        // Streak length (in radians of rotation) grows with loudness.
        const trail = 0.1 + level * 0.45 * intensityFactor;
        ctx.lineCap = "round";
        for (let i = 0; i < ORB_COUNT; i++) {
          const p = orbParticles[i];
          const a = orbAngle * p.speed;
          const cosA = Math.cos(a);
          const sinA = Math.sin(a);
          const headX = p.x * cosA - p.z * sinA;
          const headZ = p.x * sinA + p.z * cosA;
          const cosB = Math.cos(a - trail);
          const sinB = Math.sin(a - trail);
          const tailX = p.x * cosB - p.z * sinB;
          const depth = (headZ + 1) / 2; // 0 = back of sphere, 1 = front
          const bin = freqData[i % bufferLength] / 255;
          ctx.strokeStyle = `hsla(${(p.hue + centroid) % 360}, 90%, ${
            45 + depth * 25
          }%, ${0.2 + depth * 0.6})`;
          ctx.lineWidth = 1 + depth * 1.5 + bin * 2 * intensityFactor;
          ctx.beginPath();
          ctx.moveTo(cx + tailX * radius, cy + p.y * radius);
          ctx.lineTo(cx + headX * radius, cy + p.y * radius);
          ctx.stroke();
        }
        ctx.lineCap = "butt";
      }

      // FX: CRT scanlines
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 2);
      }

      // FX: noise overlay — regenerate the small tile, then blend it over the
      // whole frame in "overlay" mode (gray 128 is neutral, so it both lightens
      // and darkens like signed per-pixel noise, but far cheaper).
      if (intensity > 0 && width > 0 && height > 0) {
        const nd = noiseImage.data;
        for (let i = 0; i < nd.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          nd[i] = nd[i + 1] = nd[i + 2] = v;
        }
        noiseCtx.putImageData(noiseImage, 0, 0);
        const pattern = ctx.createPattern(noiseCanvas, "repeat");
        if (pattern) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, intensity * 0.3);
          ctx.globalCompositeOperation = "overlay";
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        }
      }

      // Lyrics overlay — typewriter caps to match the DUANYSWRLD chrome.
      if (showText) {
        ctx.font = '500 20px "Courier New", Courier, monospace';
        ctx.letterSpacing = "6px"; // no-op where unsupported
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 6;
        ctx.fillText(lyrics.toUpperCase(), width / 2, height - 60);
        ctx.shadowBlur = 0;
        ctx.letterSpacing = "0px";
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // Keep the input-device picker in sync as devices are plugged in/removed.
    const handleDeviceChange = () => refreshInputDevices();
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      handleDeviceChange,
    );

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", handleResize);
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        handleDeviceChange,
      );
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      disconnectCurrentSource();
      if (audioEl?.src) URL.revokeObjectURL(audioEl.src);
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      mediaElSrcRef.current = null;
      audioCtx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stage" onClick={resumeAudio}>
      <canvas ref={canvasRef} className="stage-canvas" />
      <audio
        ref={audioElRef}
        style={{ display: "none" }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      <div className="center-rule" aria-hidden="true" />

      <header className="hud-top">
        <h1 className="wordmark">
          DU<span className="wordmark-flip">A</span>NYSWRLD
          <span className="wordmark-glyph" aria-hidden="true">
            ✳
          </span>
        </h1>
        <div className="tagline">( AUDIO-REACTIVE VISUAL LAB )</div>
      </header>

      <aside className="panel">
        <Section
          label="CONTROLS"
          open={openSections.controls}
          onToggle={() => toggleSection("controls")}
        >
          <label className="field">
            Mode
            <select
              aria-label="Visualization mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Color
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <label className="field">
            Intensity
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={intensity}
              onChange={(e) => setIntensity(parseFloat(e.target.value))}
            />
          </label>
          <label className="field">
            Show lyrics
            <input
              type="checkbox"
              checked={showText}
              onChange={(e) => setShowText(e.target.checked)}
            />
          </label>
          <label className="field">
            Beat pulse
            <input
              type="checkbox"
              checked={beat}
              onChange={(e) => setBeat(e.target.checked)}
            />
          </label>
          <input
            type="text"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="LYRICS / TEXT"
            aria-label="Lyrics / text overlay"
          />
        </Section>

        <Section
          label="SOURCE"
          open={openSections.source}
          onToggle={() => toggleSection("source")}
        >
          <div className="btn-row">
            <button
              type="button"
              onClick={connectMic}
              className={`ghost-btn${sourceType === "mic" ? " is-active" : ""}`}
            >
              Mic
            </button>
            <label
              htmlFor="audio-file-input"
              className={`ghost-btn file-label${
                sourceType === "file" ? " is-active" : ""
              }`}
            >
              Audio file
              <input
                id="audio-file-input"
                type="file"
                accept="audio/*"
                onChange={onPickFile}
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
              />
            </label>
            {sourceType === "file" && fileName && (
              <button type="button" onClick={togglePlay} className="ghost-btn">
                {isPlaying ? "Pause" : "Play"}
              </button>
            )}
          </div>
          {sourceType === "mic" && inputDevices.length > 1 && (
            <label className="field">
              Input device
              <select
                aria-label="Audio input device"
                value={selectedDeviceId}
                onChange={onPickDevice}
              >
                <option value="">Default input</option>
                {inputDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {sourceType === "file" && fileName && (
            <span className="file-name">{fileName}</span>
          )}
        </Section>

        <Section
          label="OUTPUT"
          open={openSections.output}
          onToggle={() => toggleSection("output")}
        >
          <div className="btn-row">
            <button
              type="button"
              onClick={toggleRecord}
              className={`ghost-btn${isRecording ? " is-alarm" : ""}`}
            >
              {isRecording ? "Stop recording" : "Record"}
            </button>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download="duanyswrld-recording.webm"
                className="download-link"
              >
                Download clip
              </a>
            )}
          </div>
        </Section>

        <p className="status" role="status">
          {status}
        </p>
      </aside>

      <div className="hud-bottom" aria-hidden="true">
        ( STAY STRANGE )
      </div>
    </div>
  );
}
