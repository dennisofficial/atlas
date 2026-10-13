---
name: video
description: Create videos programmatically — product demos, README clips, feature announcements, explainers, and motion graphics — rendered deterministically from code. Use when the user wants to make, generate, or render a video, demo GIF, product walkthrough, launch clip, or animated showcase of an app, CLI, library, PR, or website. Covers HyperFrames (HTML-native), Remotion (React), terminal recording (VHS, asciinema), ffmpeg assembly, the deterministic-frame rendering pattern, and browser demo recording of a live web app with a visible cursor (Playwright screencast, proof-of-work, PR demo). Not for generative AI video (Veo/Sora), which cannot show a real product.
---

# Video creation

Make videos by rendering them from code. A rendered video is deterministic — the same input
produces the same frames — so it can be iterated like code: change a line, re-render one frame,
compare. A screen recording bakes in wall-clock jank, machine load, and mistimed keystrokes that
no amount of post-processing removes. The one sanctioned exception is a proof-of-work recording
of a real, live web app, which cannot be rendered deterministically; it must follow
[references/browser-recording.md](references/browser-recording.md).

## Pick the approach

| If the video is…                                      | Use            | Read                                        |
| ----------------------------------------------------- | -------------- | ------------------------------------------- |
| A product demo, launch clip, explainer, motion graphic | **HyperFrames** | [references/hyperframes.md](references/hyperframes.md) |
| Mostly a terminal session                             | **VHS or asciinema** | [references/terminal.md](references/terminal.md) |
| Built on an existing React/Remotion codebase          | **Remotion**   | [references/remotion.md](references/remotion.md) |
| A simple slideshow, title card, or diagram animation  | **ffmpeg only** | [references/assembly.md](references/assembly.md) |
| A recording of a real web app flow (proof-of-work, PR demo, authenticated staging) | **Playwright screencast + injected cursor** | [references/browser-recording.md](references/browser-recording.md) |

Default to HyperFrames. It renders plain HTML files with `data-*` timing attributes through
headless Chrome + ffmpeg — no build step, Apache-2.0, purpose-built for agents — and its own
installable skills carry the production-loop detail this skill deliberately does not duplicate.
Remotion is the heavier React alternative; keep it for codebases already invested in it.

For any approach, the workflow and the deterministic-rendering rules in
[references/workflow.md](references/workflow.md) apply — read it before writing composition code.

## The loop

1. **Plan the video in seconds.** Write the shot list: what is on screen at 0s, 3s, 8s, …,
   what the viewer should understand at each beat, and the total length (30–60s for a demo;
   under 10s for a motion graphic). Confirm direction with the user before building.
2. **Capture real data.** If the video shows a product, everything on screen comes from real
   runs: real CLI output, real test timings, real scores. Record stdout, exit codes, and
   durations into a JSON file the composition reads. Never invent plausible-looking output.
3. **Build the composition** with the chosen tool.
4. **Verify frame-by-frame.** Render single frames or short spans, look at the images, fix,
   repeat. Never render the full video as the first check.
5. **Draft render for review.** Render the whole video at draft spec (1920×1080, 30 fps, draft
   quality — about 10s for a 20s clip) and hand it over. Tell the user plainly that it is a
   low-resolution draft so iterations stay fast, and that the final export will be at their
   requested spec (default 4K at 60 fps). Iterate on drafts until they approve.
6. **Final export at the requested spec.** Only after approval: one full render at the
   requested resolution and frame rate (default 3840×2160, 60 fps, delivery quality — minutes,
   not seconds). Extract frames from the finished MP4 and check text legibility, pacing, and
   clipping. Deliver MP4 (H.264, `faststart`) and, for READMEs, a palette-based GIF — recipes
   in [references/assembly.md](references/assembly.md). HyperFrames' MP4 is already
   faststart, so it needs no re-mux; the assembly recipe is for hand-assembled frames.

The browser-recording lane has its own length and verification steps in
[references/browser-recording.md](references/browser-recording.md); those override the loop's.

## Environment

Needs Node 22+ and ffmpeg. Check `command -v ffmpeg` first; install with the platform's
package manager when missing. Browsers: HyperFrames and Remotion each manage their own
pinned Chrome; a Playwright-installed Chromium also works for hand-rolled capture.
