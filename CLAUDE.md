# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## ⚠️ Read this first: two unrelated projects live here

This repository is a **fork of [awesome-selfhosted/awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)** that also carries an unrelated web app added by the fork owner. The two parts have completely different purposes, workflows, and rules:

| Path | What it is | Can you edit it? |
| --- | --- | --- |
| `README.md`, `non-free.md` | The Awesome-Selfhosted curated list | **No — auto-generated.** See below. |
| `visual-lab-dupe/` | An audio-reactive React + Vite web app | **Yes — this is the real dev target.** |
| `_static/`, `LICENSE` | Assets/license for the list | Rarely, and only alongside upstream. |
| `.github/` | Issue/PR templates for the list mirror | Rarely. |

Before doing anything, figure out **which part** a request targets. Almost all actual coding work in this fork happens in `visual-lab-dupe/`.

---

## Part 1 — The Awesome-Selfhosted list (`README.md`, `non-free.md`)

### These files are generated — do not hand-edit them

`README.md` and `non-free.md` are **built by a bot** from a separate data repository. The git history shows this clearly:

```
[bot] build markdown from awesome-selfhosted-data <sha>
```

The source of truth is **[awesome-selfhosted/awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data)**, where each application is a YAML file and the Markdown is regenerated from those. Editing `README.md` here directly is pointless — the next bot build overwrites it, and this fork is a downstream mirror anyway.

If a user asks to **add, remove, correct, or re-categorize a listed application**, the correct answer is: that change must be made in the upstream `awesome-selfhosted-data` repo, not here. `.github/PULL_REQUEST_TEMPLATE.md` and `.github/ISSUE_TEMPLATE/config.yml` both redirect contributors there.

### What the list is

A curated list of **Free Software** (per the [FSF definition](https://en.wikipedia.org/wiki/Free_software)) network services and web apps that can be self-hosted. Non-Free software is separated into `non-free.md`. The canonical rendered site is <https://awesome-selfhosted.net/>.

### Entry format (for reference / understanding diffs)

Entries live under `### Category` headings and follow a strict shape:

```
- [Name](homepage-url) - Short description ending with a period. ([Demo](demo-url), [Source Code](repo-url)) `LICENSE` `Language/Platform`
```

Conventions worth knowing:
- **Description** is one sentence, ends with a period, no marketing fluff.
- **Optional links** in parentheses: `Demo`, `Source Code`, `Clients`.
- **License tags** are SPDX-style backticked identifiers (e.g. `` `MIT` ``, `` `AGPL-3.0` ``); the full mapping is in the *List of Licenses* section of `README.md`.
- **Language/platform tags** describe the deployment stack (e.g. `` `Go/Docker` ``, `` `PHP` ``).
- **Anti-feature marker** `⚠` after the name means "depends on a proprietary service outside the user's control" (see the *Anti-features* section).
- Entries are alphabetized within each category; every category has a *back to top* link and often a `_Related:_` cross-reference line.

If you ever *do* need to touch these files (e.g. syncing an upstream build), preserve this format exactly — the upstream tooling and link-checkers depend on it.

---

## Part 2 — `visual-lab-dupe/` (the active development project)

An **audio-reactive visual playground** built with **React 19 + Vite** and the **Web Audio API**. It analyzes microphone input or a local audio file through an `AnalyserNode` and renders it full-screen to a `<canvas>`. This is where fork-specific feature work happens (see git history: `Add Visual Lab Dupe`, `Add audio-file input source`, `Add canvas recording`, `Add beat-reactive pulse`, etc.).

### Commands

Run all commands from inside `visual-lab-dupe/`:

```bash
cd visual-lab-dupe
npm install        # install dependencies
npm run dev        # Vite dev server (start here for local work)
npm run build      # production build to dist/
npm run preview    # serve the production build
npm run lint       # oxlint (the linter for this project — NOT eslint)
```

There is **no test suite** and **no `typecheck` script** — it's plain JSX (`.jsx`), not TypeScript, though `@types/react` is installed for editor tooling. `npm run lint` is the only automated check; run it before committing changes here.

### Architecture (`src/App.jsx`)

The entire app is one component, `App`, in `src/App.jsx` (~725 lines). `src/main.jsx` just mounts it; `src/index.css` holds styles; `index.html` is the Vite entry. Key design points to respect when editing:

- **Refs, not state, drive the render loop.** The `AudioContext`, `AnalyserNode`, and `requestAnimationFrame` loop are created **once**. Live control values (mode, color, intensity, lyrics, beat) are mirrored into `controlsRef` so the animation loop reads them via refs. **Changing a control must not tear down or rebuild the audio graph.** Follow this pattern — do not move these reads into React state inside the draw loop.
- **Input sources swap at runtime.** `sourceType` is `"mic"` or `"file"`. `connectMic()` / `connectFile()` set up the source; `disconnectCurrentSource()` tears down the previous one (stopping live mic tracks) and rewires the analyser **without recreating the `AudioContext`**. `sourceReqRef` is a counter that invalidates in-flight async source setup to avoid races.
- **`MediaElementSource` caveat:** a `MediaElementAudioSourceNode` can be created only once per `<audio>` element — hence `mediaElSrcRef` caches it.
- **Mic is analysis-only** (not routed to speakers, to avoid feedback); **file audio is routed to the speakers** so you hear it.
- **Recording:** `toggleRecord()` captures the canvas via `canvas.captureStream()` + `MediaRecorder`, mixing audio in through a `MediaStreamDestination` tap (`streamDestRef`). Codec preference is VP9/Opus → VP8 → plain WebM (`pickRecordingMime()`); exports a `.webm`. Object URLs are tracked in `downloadUrlRef` and revoked on unmount/replacement.
- **Visual modes** (`mode` state): `SCOPE` (oscilloscope), `SPECTRUM` (frequency bars), `LAVA` (blob grid), `PLASMA` (plasma field), `STARS` (orbiting particles). Two post effects (CRT scanlines, RGB noise) sit on top of every mode, plus an optional live-editable lyrics overlay and a beat detector.
- **Performance note:** the grain/noise overlay is drawn from a small (256×256) tile regenerated per frame and blended as a repeating pattern rather than per-pixel readback — keep this cheap approach if you touch it.

### Conventions in this sub-project

- **Linter:** oxlint, configured in `visual-lab-dupe/.oxlintrc.json` with the `react` and `oxc` plugins; `react/rules-of-hooks` is an **error**. Keep all hook calls unconditional and at the top level.
- **Style:** the existing code uses **double quotes** and **semicolons** in `App.jsx`; match the surrounding file.
- It's a **prototype** — the README in that folder documents intended behavior and known limitations. Preserve the ref-based, single-context architecture when extending it.
- **CodeRabbit** reviews PRs here (see commit `Address CodeRabbit review: races, leaks, a11y, PLASMA perf`); watch for resource leaks, async races, and accessibility.

---

## Git & contribution workflow

- **Default branch:** `master`.
- This is a fork: `origin` → `github.com/drhjcreative-bit/awesome-selfhosted`.
- **List content** (`README.md`/`non-free.md`) is *not* contributed here — direct changes upstream to `awesome-selfhosted-data`.
- **App changes** (`visual-lab-dupe/`) are normal feature work: branch, commit with a clear message, open a PR. Run `npm run lint` in `visual-lab-dupe/` first.
- Do not commit `visual-lab-dupe/node_modules/` or `dist/` (already covered by `visual-lab-dupe/.gitignore`).

## Licensing

- The **list** is under **CC BY-SA 3.0** (`LICENSE`).
- `visual-lab-dupe/` has no separate license file; treat it as part of this fork.
