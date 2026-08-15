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

// Render App and wait for the on-mount mic connection to settle, so async
// status updates don't leak into the test as act() warnings.
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

beforeEach(() => {
  media = installMediaMocks();
});
afterEach(() => {
  cleanup();
  media.uninstall();
});

describe("App — rendering & accessibility", () => {
  it("renders the panel with an accessible mode selector listing every mode", async () => {
    await renderApp();
    const select = screen.getByLabelText("Visualization mode");
    const options = [...select.querySelectorAll("option")].map((o) => o.value);
    expect(options).toEqual([
      "SCOPE",
      "SPECTRUM",
      "LAVA",
      "PLASMA",
      "STARS",
      "ORB",
    ]);
  });

  it("exposes a labelled lyrics field and a status region", async () => {
    await renderApp();
    expect(screen.getByLabelText("Lyrics / text overlay")).toBeDefined();
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("shows the mic as the active source and no file-only controls initially", async () => {
    await renderApp();
    expect(screen.getByRole("button", { name: "Mic" }).className).toContain(
      "is-active",
    );
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Download clip" })).toBeNull();
  });
});

describe("App — control wiring", () => {
  it("updates the selected mode", async () => {
    await renderApp();
    const select = screen.getByLabelText("Visualization mode");
    fireEvent.change(select, { target: { value: "PLASMA" } });
    expect(select.value).toBe("PLASMA");
  });

  it("updates color and intensity", async () => {
    await renderApp();
    const color = screen.getByDisplayValue("#a7ff4a");
    fireEvent.change(color, { target: { value: "#ff0000" } });
    expect(color.value).toBe("#ff0000");

    const intensity = document.querySelector('input[type="range"]');
    fireEvent.change(intensity, { target: { value: "0.25" } });
    expect(intensity.value).toBe("0.25");
  });

  it("toggles the show-lyrics and beat checkboxes", async () => {
    await renderApp();
    const [showText, beat] = screen.getAllByRole("checkbox");
    expect(showText.checked).toBe(true);
    fireEvent.click(showText);
    expect(showText.checked).toBe(false);

    expect(beat.checked).toBe(true);
    fireEvent.click(beat);
    expect(beat.checked).toBe(false);
  });

  it("edits the lyrics overlay text", async () => {
    await renderApp();
    const lyrics = screen.getByLabelText("Lyrics / text overlay");
    fireEvent.change(lyrics, { target: { value: "new words" } });
    expect(lyrics.value).toBe("new words");
  });
});

describe("App — collapsible sections", () => {
  it("collapses the CONTROLS section, hiding its body, and reopens it", async () => {
    await renderApp();
    const head = screen.getByRole("button", { name: /CONTROLS/ });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Visualization mode")).toBeDefined();

    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Visualization mode")).toBeNull();

    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Visualization mode")).toBeDefined();
  });

  it("toggling a section does not rebuild the audio graph", async () => {
    await renderApp();
    expect(media.audioContexts.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /OUTPUT/ }));
    fireEvent.click(screen.getByRole("button", { name: /OUTPUT/ }));
    // Still exactly one AudioContext — the mount effect never re-ran.
    expect(media.audioContexts.length).toBe(1);
  });
});
