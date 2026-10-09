# HyperFrames

HTML-native video framework from HeyGen (Apache-2.0). Compositions are plain HTML files with
`data-*` timing attributes; the renderer seeks each frame in headless Chrome and encodes with
ffmpeg. No build step — an `index.html` composition plays as-is in a browser. This is the
default choice for product demos, launch clips, explainers, and motion graphics.

## Setup

```bash
npx hyperframes init my-video          # scaffold a project
cd my-video
npx hyperframes skills update          # install HyperFrames' own agent skills (non-interactive)
```

`skills update` installs HyperFrames' core skill set — a `/hyperframes` router plus
creation-workflow skills (`/product-launch-video`, `/pr-to-video`, `/faceless-explainer`,
`/motion-graphics`, …) and domain skills (`hyperframes-core`, `hyperframes-animation`,
`hyperframes-keyframes`, …). **Load those for production detail.** This file covers the
render contract and the agent workflow around them; their skills carry the authoring
reference (all animation runtimes, audio mixing, the catalog). Do not duplicate their
knowledge from memory — if a question their skills would answer comes up before they are
installed, install them.

Docs are fetchable as markdown: `https://hyperframes.heygen.com/llms.txt` indexes everything;
individual pages render as markdown.

## The composition contract

```html
<div id="stage" data-composition-id="launch" data-start="0" data-width="1920" data-height="1080">
  <video class="clip" data-start="0" data-duration="6" src="bg.mp4"></video>
  <h1 id="title" class="clip" data-start="1" data-duration="4" data-track-index="1">Launch day</h1>
</div>
```

- `data-start` / `data-duration` (seconds) place clips on the timeline; `data-track-index`
  layers them.
- Animate with GSAP, CSS animations, Lottie, Three.js, Anime.js, or WAAPI — but every
  animation must be **seekable**: the renderer pauses it and sets its time per frame. Wall-clock
  tricks (timeouts that mutate the DOM, unseeded randomness, live fetches) break
  determinism — see workflow.md.
- Reusable blocks install from the catalog instead of hand-building: `npx hyperframes add
  data-chart`, `npx hyperframes add flash-through-white`. Check the catalog
  (`hyperframes.heygen.com/catalog`) before writing a named effect by hand.

## CLI loop

```bash
npx hyperframes lint                   # validate composition and determinism rules
npx hyperframes snapshot               # frame probes without a full render
npx hyperframes preview                # browser preview with live reload (for the human)
npx hyperframes render                 # MP4 out; needs Node 22+ and ffmpeg
npx hyperframes doctor                 # environment diagnosis when render fails
```

All commands are non-interactive. `snapshot` is the iteration tool: probe the beats of the
shot list, look at the PNGs, fix, repeat — per workflow.md. `doctor` first when something
breaks; the common failures are a missing ffmpeg and Chrome-launch flags in containers.

In a container without a sandbox-enabled Chrome, headless Chrome needs `--no-sandbox`; the
HyperFrames doctor surfaces the current incantation when launch fails.

## When not to use it

- The project already has Remotion compositions — port with their `/remotion-to-hyperframes`
  skill, or stay on Remotion; don't run both in one video.
- The video is terminal-only — VHS is cheaper (terminal.md).
- The video needs real recorded footage as the primary content (a talking head) — HyperFrames
  can overlay on footage, but capture belongs to a recorder, not this skill.
