# Terminal video: VHS and asciinema

For videos that are mostly a terminal session, skip the browser entirely. Both tools render
a *scripted* session, so the output is deterministic and the script is trivially small to
author — tens of tokens per segment.

## VHS (charmbracelet/vhs)

A declarative `.tape` file drives a headless terminal and emits GIF or MP4:

```tape
Output demo.mp4
Set FontSize 18
Set Width 1200
Set Height 675
Set Theme "Catppuccin Mocha"

Type "bun test"
Sleep 500ms
Enter
Sleep 2s
Type "bun run build"
Sleep 500ms
Enter
Sleep 3s
```

```bash
vhs < demo.tape        # renders demo.mp4 (docker image: ghcr.io/charmbracelet/vhs)
```

- `Type` types at a human cadence; `Sleep` sets pacing; `Ctrl+L`, `Tab`, arrows work as keys.
- Use `Hide` / `Show` around setup commands you don't want on camera.
- VHS renders its own terminal — it does not capture a real TUI. It shows what you script,
  not what a live program draws, so for a real interactive app the honest options are
  scripting the expected output or capturing real output into an asciicast (below).

## asciinema + agg

Record once (`asciinema rec session.cast`) or **write the `.cast` file directly** — the
asciicast v2 format is plain JSON lines of `[time, "o", "output"]` events, so the agent can
author a session from real captured stdout without recording anything:

```json
{"version": 2, "width": 100, "height": 28}
[0.0, "o", "$ bun test\r\n"]
[0.8, "o", " 42 pass, 0 fail\r\n$ "]
```

Then render to GIF/MP4 with `agg` (asciinema/agg):

```bash
agg --font-size 18 --fps-cap 30 session.cast session.gif
```

Authoring the cast by hand is the most deterministic option in this whole skill: zero
runtime variance, diffable source, and real captured output spliced in verbatim.

## Combining with other footage

Terminal segments compose into a larger HyperFrames/Remotion video as pre-rendered clips
(`<Video>` / a `.clip` element) — render the terminal part with VHS/agg first, then place it.
Keep the terminal's pixel size and theme identical between renders so cuts don't jump.
