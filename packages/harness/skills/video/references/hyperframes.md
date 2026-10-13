# HyperFrames

HTML-native video framework from HeyGen (Apache-2.0). Compositions are plain HTML files with
`data-*` timing attributes; the renderer seeks each frame in headless Chrome and encodes with
ffmpeg. No build step — an `index.html` composition plays as-is in a browser. This is the
default choice for product demos, launch clips, explainers, and motion graphics.

## Setup

```bash
npx -y hyperframes@latest init launch --non-interactive --example blank --resolution landscape
cd launch
```

Author the composition at 1920×1080 and never at the export size. `render --resolution
landscape-4k` re-renders the same composition at device-pixel ratio 2, which is pixel-sharp
4K with no layout changes. That keeps one composition serving both the fast draft and
the final export. The scale must be an integer multiple, so 1080 authoring gives 4K (2×) but
not 2560×1440.

`init` also installs HyperFrames' own agent skills, so no follow-up `skills update` is needed.
Non-TTY shells (agents, CI) need `--non-interactive`. `HYPERFRAMES_SKIP_SKILLS=1` opts out of
the skill install; `--skip-skills` is currently ignored. Both `init` and `skills update` write
user-global skill directories (`~/.agents/skills`, `~/.claude/skills`, …), not the project.

A bare `skills update` refreshes only the core set (`hyperframes` router, `-core`, `-cli`,
`-animation`, `-creative`, `-keyframes`, `-registry`, `-studio`, `-audio`, `media-use`).
Creation-workflow skills (`/product-launch-video`, `/pr-to-video`, `/motion-graphics`, …)
install on demand: `npx hyperframes skills update <workflow-name>`. **Load those for
production detail.** This file covers the render contract and the agent workflow around them;
their skills carry the authoring reference (all animation runtimes, audio mixing, the catalog).
Do not duplicate their knowledge from memory.

Docs are fetchable as markdown: `https://hyperframes.heygen.com/llms.txt` indexes everything;
individual pages render as markdown.

## The composition contract

```html
<div id="stage" data-composition-id="main" data-start="0" data-duration="6" data-width="1920" data-height="1080">
  <video class="clip" data-start="0" data-duration="6" src="bg.mp4"></video>
  <h1 id="title" class="clip" data-start="1" data-duration="4" style="z-index: 2">Launch day</h1>
</div>
```

- `data-start` / `data-duration` (seconds) place clips on the timeline. `data-track-index` is
  only a Studio display lane the renderer ignores; layer with CSS `z-index`.
- Animate with GSAP, CSS animations, Lottie, Three.js, Anime.js, or WAAPI — but every
  animation must be **seekable**: the renderer pauses it and sets its time per frame. Wall-clock
  tricks (timeouts that mutate the DOM, unseeded randomness, live fetches) break
  determinism — see workflow.md.
- GSAP: register one `gsap.timeline({ paused: true })` at
  `window.__timelines["<data-composition-id>"]`, and only after the timeline is fully built —
  after `document.fonts.ready` if the build waits on it, or it renders blank.
- Never tween `display`, `visibility` or `autoAlpha` on a `.clip` element (lint rejects it;
  clip timing owns visibility). Animate a child wrapper instead, especially for media.
- Prefer `fromTo` over `from`: `from` snapshots its start state at registration and can desync
  when the playhead seeks back, which sub-compositions do.

```js
document.fonts.ready.then(() => {
  const tl = gsap.timeline({ paused: true });
  tl.fromTo("#title", { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.9, ease: "expo.out" }, 0.35);
  window.__timelines["main"] = tl; // key = root data-composition-id
});
```

- Reusable blocks install from the catalog instead of hand-building: `npx hyperframes add
  data-chart`, `npx hyperframes add flash-through-white`. Search it by intent first — local,
  nothing is sent: `npx hyperframes catalog --query "<effect in plain English>"`.

## CLI loop

```bash
npx hyperframes lint                   # validate composition and determinism rules
npx hyperframes snapshot --at 2.5,6.6 --no-end   # frame probes without a full render
npx hyperframes check                  # final gate: lint, runtime, layout, contrast, motion
npx hyperframes preview --background   # Studio preview that outlives the command (for the human)
npx hyperframes render --output out/draft.mp4 --quality draft --fps 30   # draft for review
npx hyperframes render --output out/launch.mp4 --resolution landscape-4k --quality delivery --fps 60   # final export
npx hyperframes doctor                 # environment diagnosis when render fails
```

- `snapshot` is the iteration tool: probe the beats of the shot list, look at the PNGs, fix,
  repeat — per workflow.md. `--at` takes exact seconds and appends an end-of-timeline frame
  unless `--no-end`; `--range START,END` and `--frames N` sample evenly instead.
- Run `check` before any full render; fix what it reports.
- `preview` blocks in the foreground. Agents use `preview --background`, then `--status` to
  verify and `--stop` when review is finished.
- `render` defaults to `renders/<name>.mp4`; pass `--output <path>` to choose it.
  `--quality` is `draft`, `looks` (default) or `delivery`.
- Draft, then final, per the SKILL.md loop. The two can differ widely: for a 20s clip the
  draft took about 10s, while the 4K/60 delivery export took about 77s.
- Always pass `--fps` on the final. Without it, `render` uses the root's `data-fps`, else 30,
  which looks choppy on high-refresh displays. `--fps` accepts 1–240. 120 fps is an option for
  high-refresh displays; measured against 60, it roughly doubles render time, while the file
  grows only about 25%.

Every command is non-interactive except a foreground `preview`. `doctor` first when
something breaks; the common failures are a missing ffmpeg and Chrome-launch flags in
containers.

In a container without a sandbox-enabled Chrome, headless Chrome needs `--no-sandbox`; the
HyperFrames doctor surfaces the current incantation when launch fails.

## When not to use it

- The project already has Remotion compositions — port with their `/remotion-to-hyperframes`
  skill, or stay on Remotion; don't run both in one video.
- The video is terminal-only — VHS is cheaper (terminal.md).
- The video needs real recorded footage as the primary content (a talking head) — HyperFrames
  can overlay on footage, but capture belongs to a recorder, not this skill.
