# Remotion

React-based video framework. A composition is a React component that is a pure function of
`useCurrentFrame()`, registered with a duration, fps, and dimensions; the CLI renders it
through a pinned Chrome Headless Shell with bundled ffmpeg. Choose it when the codebase
already uses it or the video must live inside a React app; otherwise HyperFrames is lighter.

## Setup and iteration

```bash
npx create-video@latest --yes --blank --no-tailwind my-video
cd my-video
npx remotion studio            # interactive preview for the human (dev server)
npx remotion still MyComp out.png --frame=90
npx remotion render MyComp out.mp4
npx remotion render MyComp out/frames --frames=0,30,90 --image-format=png
```

`still --frame=N` and sparse `--frames=` probes are the agent's iteration loop — the exact
equivalent of the snapshot step in workflow.md. ffmpeg and the Chrome Headless Shell are
bundled and version-pinned by Remotion itself; do not pass `--browser-executable` overrides.

All `remotion` + `@remotion/*` packages must share one exact version. `npx remotion versions`
diagnoses drift.

## The frame-function rules

Everything animated derives from the frame — this is enforced, not suggested:

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

export const FadeIn = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 2 * fps], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return <div style={{ opacity }}>Hello</div>;
};
```

- CSS transitions and CSS/Tailwind animation classes are **forbidden** — they run on the wall
  clock and render wrong.
- `<Sequence from={…} durationInFrames={…}>` places items on the timeline.
- Assets go in `public/` and are referenced with `staticFile("name.png")`; `<Img>`, and
  `<Video>` / `<Audio>` from `@remotion/media`.
- Metadata (duration, dimensions, props) can be computed from data with `calculateMetadata`
  — the hook for the real-data-first pattern: fetch/capture first, bake into props, compute
  duration from real timings.

Docs are markdown-fetchable (`remotion.dev/docs/<page>.md`); the official skill set
(`npx skills add remotion-dev/skills`) is a router plus lazy sub-skills and is worth
installing for any substantial Remotion work. Note the license: source-available, free below
a company-size threshold — check it before adopting Remotion in a commercial product.

## Sharp edges in containers

- Linux needs Chrome's system libraries (`libnss3` et al. — the Docker guide lists them) and
  emoji/CJK fonts (`fonts-noto-color-emoji`, `fonts-noto-cjk`) if the video uses them.
- Pass `--cpus` to Docker; restricted containers render glacially otherwise.
- GPU-less cloud instances make box-shadow, blur, and gradient-heavy frames slow; prefer flat
  design in server-rendered videos.
