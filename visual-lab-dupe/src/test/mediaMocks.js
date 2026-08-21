import { vi } from "vitest";

// Test harness for App.jsx's browser-media dependencies. jsdom implements none
// of the Web Audio API, MediaRecorder, canvas rendering, captureStream, or
// getUserMedia, and the app builds its whole audio graph + render loop on mount.
// installMediaMocks() stands in fakes for all of it and hands back spies/handles
// so tests can assert on the graph wiring, recording lifecycle, and cleanup.
//
// Usage:
//   let media;
//   beforeEach(() => { media = installMediaMocks(); });
//   afterEach(() => { media.uninstall(); cleanup(); });

// A canvas 2D context that answers data-returning calls with real buffers and
// treats every drawing call as a no-op, so the draw loop runs without throwing.
const makeCtx2d = () =>
  new Proxy(
    {
      createImageData: (w, h) => ({
        data: new Uint8ClampedArray((w | 0) * (h | 0) * 4),
      }),
      getImageData: (x, y, w, h) => ({
        data: new Uint8ClampedArray((w | 0) * (h | 0) * 4),
      }),
      putImageData: () => {},
      createPattern: () => ({}),
      drawImage: () => {},
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {}; // any other 2D method is a no-op
      },
      set() {
        return true; // swallow fillStyle/lineWidth/font/... assignments
      },
    },
  );

const makeTrack = (kind) => ({ kind, stop: vi.fn() });

const makeMediaStream = (audio = 1, video = 0) => {
  const audioTracks = Array.from({ length: audio }, () => makeTrack("audio"));
  const videoTracks = Array.from({ length: video }, () => makeTrack("video"));
  const added = [];
  return {
    getTracks: () => [...audioTracks, ...videoTracks, ...added],
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    addTrack: vi.fn((t) => added.push(t)),
    _added: added,
  };
};

// --- Fake Web Audio nodes -------------------------------------------------

const makeAnalyser = () => ({
  fftSize: 2048,
  frequencyBinCount: 1024,
  connect: vi.fn(),
  disconnect: vi.fn(),
  getByteTimeDomainData: vi.fn(),
  getByteFrequencyData: vi.fn(),
});

class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = { _role: "destination" };
    this.analyser = null;
    this.streamDest = { stream: makeMediaStream(1, 0), connect: vi.fn(), disconnect: vi.fn() };
    this.mediaStreamSources = [];
    this.mediaElementSources = [];
    this.resume = vi.fn(async () => {
      if (this.state === "suspended") this.state = "running";
    });
    this.close = vi.fn(async () => {
      this.state = "closed";
    });
    FakeAudioContext.instances.push(this);
  }
  createAnalyser() {
    this.analyser = makeAnalyser();
    return this.analyser;
  }
  createMediaStreamDestination() {
    return this.streamDest;
  }
  createMediaStreamSource(stream) {
    const node = { stream, connect: vi.fn(), disconnect: vi.fn() };
    this.mediaStreamSources.push(node);
    return node;
  }
  createMediaElementSource(el) {
    const node = { el, connect: vi.fn(), disconnect: vi.fn() };
    this.mediaElementSources.push(node);
    return node;
  }
}
FakeAudioContext.instances = [];

// --- Fake MediaRecorder ---------------------------------------------------

class FakeMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options?.mimeType;
    this.state = "inactive";
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    this.start = vi.fn(() => {
      this.state = "recording";
    });
    // stop() flips state and fires onstop synchronously, matching how tests
    // drive the lifecycle (real recorders fire it asynchronously).
    this.stop = vi.fn(() => {
      this.state = "inactive";
      this.onstop?.({});
    });
    FakeMediaRecorder.instances.push(this);
  }
  // Test helpers to simulate the browser delivering data / an error.
  emitData(size = 1024) {
    this.ondataavailable?.({ data: { size } });
  }
  emitError(name = "SecurityError") {
    this.onerror?.({ error: { name } });
  }
}
FakeMediaRecorder.instances = [];
FakeMediaRecorder.isTypeSupported = vi.fn(() => true);

// --- Fake navigator.mediaDevices -----------------------------------------

const makeMediaDevices = () => {
  const listeners = {};
  return {
    getUserMedia: vi.fn(async () => makeMediaStream(1, 0)),
    enumerateDevices: vi.fn(async () => []),
    addEventListener: vi.fn((type, cb) => {
      (listeners[type] ||= []).push(cb);
    }),
    removeEventListener: vi.fn((type, cb) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== cb);
    }),
    _emit: (type, ev) => (listeners[type] || []).forEach((f) => f(ev)),
    _listeners: listeners,
  };
};

/**
 * Install browser-media mocks and return handles for controlling and inspecting them in tests.
 * @returns {Object} Mock handles, tracking collections, frame control, and an `uninstall()` method that restores the original browser implementations.
 */
export function installMediaMocks() {
  FakeAudioContext.instances = [];
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.isTypeSupported = vi.fn(() => true);

  const originals = {
    getContext: HTMLCanvasElement.prototype.getContext,
    captureStream: HTMLCanvasElement.prototype.captureStream,
    play: HTMLMediaElement.prototype.play,
    pause: HTMLMediaElement.prototype.pause,
    load: HTMLMediaElement.prototype.load,
    paused: Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "paused",
    ),
  };

  // jsdom's `paused` is always true (no real playback); back it with our own
  // flag so togglePlay's paused/playing branch is actually exercised.
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get() {
      return this._paused ?? true;
    },
  });

  HTMLCanvasElement.prototype.getContext = function (type) {
    return type === "2d" ? makeCtx2d() : null;
  };
  const canvasStream = makeMediaStream(0, 1);
  HTMLCanvasElement.prototype.captureStream = vi.fn(() => canvasStream);

  // jsdom's media element play/pause throw "Not implemented"; make them inert
  // and keep `paused` coherent so togglePlay's branch logic can be exercised.
  HTMLMediaElement.prototype.play = vi.fn(function () {
    this._paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  HTMLMediaElement.prototype.pause = vi.fn(function () {
    this._paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  HTMLMediaElement.prototype.load = vi.fn();

  const mediaDevices = makeMediaDevices();

  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("webkitAudioContext", FakeAudioContext);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  // Capture (but don't auto-run) the scheduled frame callback. The render loop
  // re-schedules itself at the end of each draw, so the latest callback is the
  // draw fn; tests call drawFrame() to execute exactly one frame on demand.
  const rafCallbacks = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb) => rafCallbacks.push(cb)),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  const createObjectURL = vi.fn(() => `blob:mock/${createObjectURL.mock.calls.length}`);
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });

  return {
    audioContexts: FakeAudioContext.instances,
    recorders: FakeMediaRecorder.instances,
    mediaDevices,
    canvasStream,
    createObjectURL,
    revokeObjectURL,
    isTypeSupported: FakeMediaRecorder.isTypeSupported,
    lastAudioContext: () => FakeAudioContext.instances.at(-1),
    lastRecorder: () => FakeMediaRecorder.instances.at(-1),
    // Run one more animation frame using the most recently scheduled callback.
    // Throws if nothing was scheduled, so a test asserting a frame renders can't
    // pass vacuously when the render loop never started.
    drawFrame: () => {
      const callback = rafCallbacks.at(-1);
      if (!callback) throw new Error("No animation frame has been scheduled");
      return callback(0);
    },
    uninstall() {
      HTMLCanvasElement.prototype.getContext = originals.getContext;
      HTMLCanvasElement.prototype.captureStream = originals.captureStream;
      HTMLMediaElement.prototype.play = originals.play;
      HTMLMediaElement.prototype.pause = originals.pause;
      HTMLMediaElement.prototype.load = originals.load;
      if (originals.paused) {
        Object.defineProperty(
          HTMLMediaElement.prototype,
          "paused",
          originals.paused,
        );
      } else {
        delete HTMLMediaElement.prototype.paused;
      }
      delete navigator.mediaDevices;
      vi.unstubAllGlobals();
    },
  };
}

export { FakeAudioContext, FakeMediaRecorder, makeMediaStream };
