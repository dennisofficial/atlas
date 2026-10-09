# ffmpeg: assembly, encoding, GIF, and frame capture

ffmpeg is the final stage of every approach in this skill. The recipes here are tuned for
product demos; for anything deeper (filters, concatenation edge cases, audio mixing), the
ffmpeg docs are the source of truth.

## Encoding the deliverables

MP4 for delivery (H.264, visually lossless-ish, web-friendly faststart):

```bash
ffmpeg -framerate 30 -i frames/%04d.png -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart out.mp4
```

GIF for READMEs — two-pass palette generation is what keeps text crisp and size small:

```bash
ffmpeg -i out.mp4 -vf "fps=12,scale=960:-1:flags=lanczos,palettegen=max_colors=96" palette.png
ffmpeg -i out.mp4 -i palette.png -lavfi "fps=12,scale=960:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=sierra2_4a:diff_mode=rectangle" out.gif
```

`diff_mode=rectangle` redraws only changed regions — a 40s terminal GIF stays around 1 MB.
Above ~5 MB, ship the MP4 instead.

Extract a frame from a finished video to check compression artifacts:

```bash
ffmpeg -i out.mp4 -vf "select=eq(n\,90)" -vframes 1 frame90.png
ffmpeg -ss 12.5 -i out.mp4 -vframes 1 at-12s.png   # by timestamp
```

Trim, cut, or speed up segments:

```bash
ffmpeg -ss 2 -to 14 -i in.mp4 -c copy cut.mp4                    # keyframe-aligned, instant
ffmpeg -i in.mp4 -filter:v "setpts=0.5*PTS" -an 2x.mp4           # 2x speed, drop audio
```

## ffmpeg-only videos

For slideshows, title cards, and diagram animations, skip the browser: generate PNG frames
or slides with plain scripts (SVG → PNG via `rsvg-convert`/ImageMagick, or canvas in Node),
then assemble. Crossfade between slides:

```bash
ffmpeg -i a.png -i b.png -filter_complex \
  "xfade=transition=fade:duration=0.5:offset=2.5" -c:v libx264 -crf 20 -pix_fmt yuv420p out.mp4
```

This is the cheapest option in tokens and infrastructure, and fully deterministic. The
ceiling is fidelity: no real DOM, no real terminal. Reach for it when the content is
generated graphics rather than a product UI.

## Hand-rolled deterministic capture (no framework)

When neither HyperFrames nor Remotion fits — a one-off, or a page that must be a real app
route — the core trick is small enough to write inline. Drive headless Chromium with
Playwright; for each frame, pause every animation and set its time, tick a page hook for
anything CSS can't express, then screenshot:

```js
const frame = 90, fps = 30;
await page.evaluate((t) => {
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
  window.tick?.(t);              // page-owned hook: typed text so far, counters, meters
}, (frame / fps) * 1000);
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.screenshot({ path: `frames/${String(frame).padStart(4, "0")}.png` });
```

Rules that make this work:

- The page must expose determinism: all motion via CSS/WAAPI/GSAP animations (seekable by
  `currentTime`), everything else behind `window.tick(ms)`.
- Add a `PREVIEW=5000,15000` env check that renders only those timestamps as PNGs — that is
  the iteration loop from workflow.md, in ten lines.
- Wait two animation frames before each screenshot so style/layout settle.
- Fixed viewport (e.g. 1600×900) and fixed `deviceScaleFactor`; fonts inlined or local.
