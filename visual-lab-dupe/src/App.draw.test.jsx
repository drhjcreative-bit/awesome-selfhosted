// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  await act(async () => {
    render(<App />);
  });
  await waitFor(() =>
    expect(media.mediaDevices.getUserMedia).toHaveBeenCalled(),
  );
}

const setMode = (mode) =>
  fireEvent.change(screen.getByLabelText("Visualization mode"), {
    target: { value: mode },
  });

beforeEach(() => {
  media = installMediaMocks();
});
afterEach(() => {
  cleanup();
  media.uninstall();
});

// The render loop can't be pixel-asserted without a real canvas, but each mode
// branch is defensively smoke-tested: a mode that throws would blank the whole
// app. drawFrame() runs one frame using the loop's most recently scheduled
// callback, reading the live mode from controlsRef.
describe("draw loop — every mode renders a frame without throwing", () => {
  for (const mode of ["SCOPE", "SPECTRUM", "LAVA", "PLASMA", "STARS", "ORB"]) {
    it(`renders ${mode}`, async () => {
      await renderApp();
      setMode(mode);
      expect(() => media.drawFrame()).not.toThrow();
    });
  }
});

describe("draw loop — overlay/effect branches", () => {
  it("draws with the lyrics overlay disabled", async () => {
    await renderApp();
    fireEvent.click(screen.getByLabelText(/Show lyrics/i)); // turn overlay off
    expect(() => media.drawFrame()).not.toThrow();
  });

  it("draws with the beat pulse disabled", async () => {
    await renderApp();
    fireEvent.click(screen.getByLabelText(/Beat pulse/i));
    expect(() => media.drawFrame()).not.toThrow();
  });

  it("skips the noise overlay at zero intensity without throwing", async () => {
    await renderApp();
    fireEvent.change(screen.getByLabelText(/Intensity/i), {
      target: { value: "0" },
    });
    expect(() => media.drawFrame()).not.toThrow();
  });
});
