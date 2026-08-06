import { describe, it, expect, afterEach, vi } from "vitest";
import { pickRecordingMime } from "./mime.js";

// pickRecordingMime reads the global MediaRecorder, which doesn't exist in the
// node test environment. Each test installs a stub and cleans it up after.
afterEach(() => {
  vi.unstubAllGlobals();
});

const stubMediaRecorder = (isTypeSupported) => {
  vi.stubGlobal("MediaRecorder", { isTypeSupported });
};

describe("pickRecordingMime", () => {
  it("returns null when MediaRecorder is unavailable", () => {
    // No stub installed -> global is undefined in the node environment.
    expect(typeof MediaRecorder).toBe("undefined");
    expect(pickRecordingMime()).toBeNull();
  });

  it("prefers vp9 when everything is supported", () => {
    stubMediaRecorder(() => true);
    expect(pickRecordingMime()).toBe("video/webm;codecs=vp9,opus");
  });

  it("falls back to vp8 when vp9 is unsupported", () => {
    stubMediaRecorder((t) => t !== "video/webm;codecs=vp9,opus");
    expect(pickRecordingMime()).toBe("video/webm;codecs=vp8,opus");
  });

  it("falls back to plain webm when only it is supported", () => {
    stubMediaRecorder((t) => t === "video/webm");
    expect(pickRecordingMime()).toBe("video/webm");
  });

  it("returns null when MediaRecorder exists but supports no candidate", () => {
    stubMediaRecorder(() => false);
    expect(pickRecordingMime()).toBeNull();
  });

  it("queries candidates in priority order", () => {
    const seen = [];
    stubMediaRecorder((t) => {
      seen.push(t);
      return false;
    });
    pickRecordingMime();
    expect(seen).toEqual([
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ]);
  });
});
