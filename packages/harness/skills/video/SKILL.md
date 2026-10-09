---
name: video
description: Create videos programmatically — product demos, README clips, feature announcements, explainers, and motion graphics — rendered deterministically from code rather than screen-recorded. Use when the user wants to make, generate, or render a video, demo GIF, product walkthrough, launch clip, or animated showcase of an app, CLI, library, PR, or website. Covers HyperFrames (HTML-native), Remotion (React), terminal recording (VHS, asciinema), ffmpeg assembly, and the deterministic-frame rendering pattern. Not for generative AI video (Veo/Sora), which cannot show a real product.
---

# Video creation

Make videos by rendering them from code, never by screen-recording. A rendered video is
deterministic — the same input produces the same frames — so it can be iterated like code:
change a line, re-render one frame, compare. A screen recording bakes in wall-clock jank,
machine load, and mistimed keystrokes that no amount of post-processing removes.

## Pick the approach

| If the video is…                                      | Use            | Read                                        |
| ----------------------------------------------------- | -------------- | ------------------------------------------- |
| A product demo, launch clip, explainer, motion graphic | **HyperFrames** | [references/hyperframes.md](references/hyperframes.md) |
| Mostly a terminal session                             | **VHS or asciinema** | [references/terminal.md](references/terminal.md) |
| Built on an existing React/Remotion codebase          | **Remotion**   | [references/remotion.md](references/remotion.md) |
| A simple slideshow, title card, or diagram animation  | **ffmpeg only** | [references/assembly.md](references/assembly.md) |

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
5. **Render, then watch the output.** Extract frames from the finished MP4 and check text
   legibility, pacing, and clipping. Deliver MP4 (H.264, `faststart`) and, for READMEs, a
   palette-based GIF — recipes in [references/assembly.md](references/assembly.md).

## Environment

Needs Node 22+ and ffmpeg. Check `command -v ffmpeg` first; install with the platform's
package manager when missing. Browsers: HyperFrames and Remotion each manage their own
pinned Chrome; a Playwright-installed Chromium also works for hand-rolled capture.
