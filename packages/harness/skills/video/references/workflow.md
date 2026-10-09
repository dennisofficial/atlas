# Deterministic rendering and the agent workflow

These rules apply to every approach in this skill. They are what separates a rendered video
from a screen recording, and a three-iteration build from a thirty-iteration one.

## Deterministic time is the whole idea

Wall-clock recording captures whatever the machine happened to do. Deterministic rendering
makes time a function argument: for each frame number, the scene is computed at exactly that
timestamp, then captured. Machine speed never affects the output, and re-rendering after an
edit changes only the frames the edit touches.

Each tool achieves it differently, but never mix models inside one composition:

- **HyperFrames / hand-rolled capture**: animation must be *seekable* — every visual property
  is a pure function of time. GSAP timelines, CSS/WAAPI animations, and Lottie all qualify
  because the renderer pauses them and sets `currentTime` per frame.
- **Remotion**: every visual property derives from `useCurrentFrame()`. CSS transitions,
  CSS animations, and Tailwind animation classes are forbidden — they run on the wall clock
  and render incorrectly.
- **VHS / asciinema**: the script (a `.tape` or asciicast JSON) is the timeline; playback
  speed is fixed at render time.

Corollaries:

- **No `Math.random()` without a seed.** Seed it, or hardcode the values.
- **No live fetches during render.** Fetch data beforehand, save it as JSON, and read the
  file from the composition. A network call mid-render makes frames non-reproducible.
- **Fonts must be local or inlined.** A CDN font that loads late (or 404s a month later)
  changes the render. Download fonts into the project and `@font-face` them by relative path.

## Real data first

For product demos, capture before composing:

1. Run the real thing — the CLI, the test suite, the library call — and record stdout,
   exit codes, timings, and scores into a `data.json` beside the composition.
2. Bake that JSON into the page (inline `<script>` or a static import), never fetch it.
3. Slow down reveals for legibility if needed, and say so in a footer or caption when the
   on-screen timing no longer matches the measured timing.

The viewer can feel invented output: rounded fake timings, lorem-ipsum commit messages,
terminal output that doesn't wrap the way the real tool wraps. Real captures also survive
scrutiny — someone will run the commands.

## The iteration loop

Full renders cost minutes; frame probes cost seconds. Structure the work as:

1. **Static check** — render one frame per beat of the shot list (opening, each reveal,
   end card). Look at every image. Fix layout, contrast, and clipping here, where a render
   is one screenshot.
2. **Motion check** — render a 1–2 second span around each transition at reduced fps and
   check the movement reads correctly.
3. **Full render** — only after 1 and 2 pass.
4. **Output check** — extract frames from the *encoded MP4* (not the source page) with
   `ffmpeg -i out.mp4 -vf "select=eq(n\,90)" -vframes 1 frame90.png` and verify text is
   legible at the delivery size. Compression softens small text; bump font sizes and
   contrast until the extracted frames read cleanly.

Common failures caught by probes, not full renders: text overflowing its container at one
timestamp, an animation ending one frame before its cut (a black flash), a font swap at t=0,
and elements positioned for 16:9 that clip at 1:1.

## Pacing that reads well

- Hold on any text long enough to read it twice at a normal pace; ~3 words per second plus
  a half-second settle is a safe floor.
- Type terminal/code text at 60–80 characters per second — fast enough to feel real, slow
  enough to follow.
- One idea per cut. A 45s demo is 8–12 beats, not 25.
- End on a static card with the product name and where to get it; hold it at least a second.

## Sizes

- **README / docs**: 1280×720 or 1600×900 at 24–30 fps. GitHub scales down, so favor large
  text over fine detail.
- **Social clips**: check the target platform; 1080×1080 (1:1) and 1080×1920 (9:16) need
  their own compositions, not a crop of 16:9.
- **GIF for a README**: 960px wide, 10–12 fps, palette-based (see assembly.md). Above ~5MB,
  serve an MP4 instead — GitHub autoplays muted looping MP4s in READMEs.
