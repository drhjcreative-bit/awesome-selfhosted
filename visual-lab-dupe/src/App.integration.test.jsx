// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { installMediaMocks } from "./test/mediaMocks.js";
import App from "./App.jsx";

let media;

async function renderApp() {
  let utils;
  await act(async () => {
    utils = render(<App />);
  });
  await waitFor(() =>
    expect(media.mediaDevices.getUserMedia).toHaveBeenCalled(),
  );
  return utils;
}

const fileInput = () => document.getElementById("audio-file-input");

async function pickFile(name = "song.mp3") {
  const file = new File(["audio-bytes"], name, { type: "audio/mpeg" });
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } });
  });
  return file;
}

function makeDeferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  media = installMediaMocks();
});
afterEach(() => {
  cleanup();
  media.uninstall();
});

// --- Group 3: audio-graph state machine ----------------------------------

describe("audio graph — mic on mount", () => {
  it("wires the mic into the analyser and reports connected", async () => {
    await renderApp();
    const ctx = media.lastAudioContext();
    expect(media.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: true,
    });
    // The mic source node was created and connected to the analyser.
    expect(ctx.mediaStreamSources.length).toBe(1);
    expect(ctx.mediaStreamSources[0].connect).toHaveBeenCalledWith(ctx.analyser);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Mic connected."),
    );
  });

  it("surfaces a mic failure in the status line", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    media.mediaDevices.getUserMedia.mockRejectedValueOnce(err);
    await renderApp();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(
        /Mic unavailable \(NotAllowedError\)/,
      ),
    );
  });
});

describe("audio graph — switching sources", () => {
  it("routes a picked file to the speakers and switches to file mode", async () => {
    await renderApp();
    const ctx = media.lastAudioContext();
    await pickFile("track.mp3");

    // A single MediaElementSource is created and connected to the analyser,
    // and the analyser is routed to the destination so the file is audible.
    expect(ctx.mediaElementSources.length).toBe(1);
    expect(ctx.mediaElementSources[0].connect).toHaveBeenCalledWith(ctx.analyser);
    expect(ctx.analyser.connect).toHaveBeenCalledWith(ctx.destination);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Playing: track.mp3"),
    );
    // File-mode UI appears.
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    expect(screen.getByText("track.mp3")).toBeDefined();
  });

  it("stops the live mic stream when switching to a file", async () => {
    await renderApp();
    const micStream = await media.mediaDevices.getUserMedia.mock.results[0]
      .value;
    await pickFile();
    expect(micStream.getAudioTracks()[0].stop).toHaveBeenCalled();
  });

  it("drops the analyser->destination edge when leaving file mode (no feedback)", async () => {
    await renderApp();
    const ctx = media.lastAudioContext();
    await pickFile();
    ctx.analyser.disconnect.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mic" }));
    });
    // Leaving the file tears down the audible route so mic input can't feed back.
    expect(ctx.analyser.disconnect).toHaveBeenCalledWith(ctx.destination);
  });

  it("reuses the one MediaElementSource across file swaps and revokes the old URL", async () => {
    await renderApp();
    const ctx = media.lastAudioContext();
    await pickFile("first.mp3");
    const revokesBefore = media.revokeObjectURL.mock.calls.length;
    await pickFile("second.mp3");

    // createMediaElementSource is legal only once per element — still just one.
    expect(ctx.mediaElementSources.length).toBe(1);
    // The previous object URL was revoked before creating the new one.
    expect(media.revokeObjectURL.mock.calls.length).toBeGreaterThan(
      revokesBefore,
    );
  });
});

describe("audio graph — stale request guard", () => {
  it("drops a mic stream whose request was superseded before it resolved", async () => {
    const deferred = makeDeferred();
    media.mediaDevices.getUserMedia.mockReturnValueOnce(deferred.promise);

    await act(async () => {
      render(<App />); // mount's connectMic awaits the deferred stream (reqId 1)
    });

    // Supersede it by picking a file before the mic stream resolves.
    await pickFile();

    // A stream we control, so we can assert its tracks get stopped.
    const track = { kind: "audio", stop: vi.fn() };
    const superseded = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
      getVideoTracks: () => [],
    };
    await act(async () => {
      deferred.resolve(superseded);
      await deferred.promise;
    });

    const ctx = media.lastAudioContext();
    // The stale stream was stopped and never wired into the graph.
    expect(track.stop).toHaveBeenCalled();
    expect(ctx.mediaStreamSources.length).toBe(0);
  });
});

describe("audio graph — play/pause a loaded file", () => {
  it("pauses and resumes the element, tracking the button label", async () => {
    await renderApp();
    await pickFile("loop.mp3");
    // Auto-play on load flips the button to Pause.
    const pauseBtn = await screen.findByRole("button", { name: "Pause" });

    await act(async () => {
      fireEvent.click(pauseBtn);
    });
    const playBtn = await screen.findByRole("button", { name: "Play" });
    expect(playBtn).toBeDefined();

    await act(async () => {
      fireEvent.click(playBtn);
    });
    expect(await screen.findByRole("button", { name: "Pause" })).toBeDefined();
  });

  it("reports a blocked playback attempt", async () => {
    await renderApp();
    await pickFile("loop.mp3");
    const pauseBtn = await screen.findByRole("button", { name: "Pause" });
    await act(async () => {
      fireEvent.click(pauseBtn); // now paused
    });
    const playBtn = await screen.findByRole("button", { name: "Play" });

    const err = new Error("blocked");
    err.name = "NotAllowedError";
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(err);
    await act(async () => {
      fireEvent.click(playBtn);
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Playback blocked (NotAllowedError).",
    );
  });
});

describe("audio graph — input device picker", () => {
  const twoDevices = [
    { kind: "audioinput", deviceId: "dev-a", label: "Mic A" },
    { kind: "audioinput", deviceId: "dev-b", label: "Mic B" },
  ];

  it("shows the picker only when multiple inputs exist and reconnects on change", async () => {
    media.mediaDevices.enumerateDevices.mockResolvedValue(twoDevices);
    await renderApp();

    const picker = await screen.findByLabelText("Audio input device");
    expect([...picker.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "",
      "dev-a",
      "dev-b",
    ]);

    await act(async () => {
      fireEvent.change(picker, { target: { value: "dev-b" } });
    });
    // Reconnects the mic constrained to the chosen device.
    expect(media.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: "dev-b" } },
    });
  });

  it("hides the picker when only one input is available", async () => {
    media.mediaDevices.enumerateDevices.mockResolvedValue([twoDevices[0]]);
    await renderApp();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Mic connected."),
    );
    expect(screen.queryByLabelText("Audio input device")).toBeNull();
  });
});

// --- Group 4: recording lifecycle ----------------------------------------

describe("recording — unsupported environments", () => {
  it("reports when the canvas cannot be captured", async () => {
    await renderApp();
    HTMLCanvasElement.prototype.captureStream = undefined;
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Recording isn't supported in this browser.",
    );
    expect(media.recorders.length).toBe(0);
  });

  it("reports when no codec is supported", async () => {
    await renderApp();
    media.isTypeSupported.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Recording isn't supported in this browser.",
    );
    expect(media.recorders.length).toBe(0);
  });

  it("reports when the MediaRecorder constructor throws", async () => {
    await renderApp();
    class ThrowingRecorder {
      constructor() {
        const e = new Error("nope");
        e.name = "NotSupportedError";
        throw e;
      }
      static isTypeSupported() {
        return true;
      }
    }
    vi.stubGlobal("MediaRecorder", ThrowingRecorder);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Could not start recording (NotSupportedError).",
    );
  });
});

describe("recording — happy path", () => {
  it("starts, mixes in audio, then stops and offers a download", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    // Recording started: recorder created and running, audio track mixed in.
    const recorder = media.lastRecorder();
    expect(recorder.start).toHaveBeenCalled();
    expect(media.canvasStream.addTrack).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Recording…");
    const stopBtn = await screen.findByRole("button", {
      name: "Stop recording",
    });

    // Feed a chunk, then stop.
    recorder.emitData(2048);
    await act(async () => {
      fireEvent.click(stopBtn);
    });

    expect(recorder.stop).toHaveBeenCalled();
    // The canvas video track is released; audio tracks are left for reuse.
    expect(media.canvasStream.getVideoTracks()[0].stop).toHaveBeenCalled();
    expect(media.createObjectURL).toHaveBeenCalled();
    const link = await screen.findByRole("link", { name: "Download clip" });
    expect(link.getAttribute("download")).toBe("duanyswrld-recording.webm");
    expect(screen.getByRole("status").textContent).toMatch(/Recording ready/);
    expect(screen.getByRole("button", { name: "Record" })).toBeDefined();
  });

  it("reports a recorder error and resets", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    const recorder = media.lastRecorder();

    await act(async () => {
      recorder.emitError("SecurityError");
    });

    expect(screen.getByRole("status").textContent).toBe(
      "Recording failed (SecurityError).",
    );
    expect(screen.getByRole("button", { name: "Record" })).toBeDefined();
  });
});

// --- Group 5: unmount cleanup --------------------------------------------

describe("cleanup on unmount", () => {
  it("tears down the audio graph, listeners, and animation frame", async () => {
    const utils = await renderApp();
    const ctx = media.lastAudioContext();
    const micStream = await media.mediaDevices.getUserMedia.mock.results[0]
      .value;

    utils.unmount();

    expect(ctx.close).toHaveBeenCalled();
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    expect(micStream.getAudioTracks()[0].stop).toHaveBeenCalled();
    expect(media.mediaDevices.removeEventListener).toHaveBeenCalledWith(
      "devicechange",
      expect.any(Function),
    );
  });

  it("stops an in-progress recording on unmount", async () => {
    const utils = await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    const recorder = media.lastRecorder();

    utils.unmount();
    expect(recorder.stop).toHaveBeenCalled();
  });

  it("revokes a loaded file's object URL on unmount", async () => {
    const utils = await renderApp();
    await pickFile("bye.mp3");
    const audioSrc = document.querySelector("audio").src;
    expect(audioSrc).toMatch(/^blob:/);

    utils.unmount();
    expect(media.revokeObjectURL).toHaveBeenCalledWith(audioSrc);
  });
});
