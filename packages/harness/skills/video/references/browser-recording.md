# Browser recording: a real app, with a visible cursor

## When this lane applies

Proof-of-work or a demo of a **real, live app**: staging, an authenticated flow, a PR's UI
change. The state lives on a server, so there is no seekable, deterministic render to make. Drive
the real app with `agent-browser` and record it with its native recorder.

For a polished launch clip, a README hero, or anything you can compose from captured data,
render it with HyperFrames instead ([hyperframes.md](hyperframes.md)). For a Screen Studio-style
promo of the live app — a real recording re-framed with a director camera, drawn cursor and
captions — use [promo.md](promo.md), which records without `--cursor` and draws its own.

## The recorder

```bash
agent-browser record start out.mp4 --fps 60 --cursor
agent-browser record stop
```

`record` writes the mp4 itself (H.264, yuv420p, constant frame rate). `--cursor` draws an arrow,
a hover glow and a click ripple into the page, so the viewer sees what was clicked. The page is
recorded as-is: no new tab, no navigation. Do not hand-roll a cursor or a frame receiver.

Measured on a 4K take against https://demo.playwright.dev/todomvc:

- **Exactly one cursor**; the click ripple fires at the click point, in place; no ghost cursor.
- **A glide produces about 50 unique frames per second** at 60 fps (longest gap inside a glide:
  3 frames, 50 ms). Drive it with `mouse move --duration --steps`, see below.
- **`--fps` is the capture rate**, default 30. Always pass `--fps 60` for UI demos.
- A static page produces repeated frames, which is expected.

## Resolution and scale

Lay the page out at a **1920×1080 CSS viewport** whatever the output quality, so a 720p take and a
4K take show the same page. The default is **4K: 3840×2160**. Set the density with the scale
argument of `set viewport`:

```bash
agent-browser set viewport 1920 1080 2
```

Verified with `ffprobe` on the recorded mp4:

- `set viewport 1920 1080 2` gives true **3840×2160** frames, and the page still reports
  `innerWidth` 1920 (`devicePixelRatio` 2). A crop of text at 1:1 is crisp.
- `--args "--force-device-scale-factor=2"` alone does **not** raise the recording: the mp4 stays
  1920×1080. It is not needed.
- `set viewport 1920 1080` (no scale) records 1920×1080. For a 1280×720 file, re-encode the 4K
  take with `ffmpeg -vf scale=1280:-2`.

Set the viewport on a page that is already open, **before** `record start` and before navigating
to the page the video shows.

**4K at 60 fps can outrun the encoder on a heavy page.** On a 4 vCPU sandbox, a dense app UI died
with `Recording encoder fell behind by more than 16 buffered frames` and left an unplayable mp4
(`moov atom not found`). The same page recorded cleanly at 4K/30 fps and at 1080p/60 fps. If the
error appears, drop to one of those and say which in the handover; a light page (TodoMVC) records
4K/60 fine. The promo lane records at 4K/30 for exactly this reason and retakes automatically when
the mp4 comes out moov-less — see [promo.md](promo.md).

If a narrow app is unreadable at 1920 CSS px, run `agent-browser eval "document.body.style.zoom = '2'"`
after load. Use one fixed number for every output size, never one derived from it. `get box`
reports the zoomed geometry, so glides and clicks still land on the target. The promo lane never
uses this page zoom — it zooms the recorded frame in the composition instead.

## Hero script

Selectors (CSS) or snapshot refs (`agent-browser snapshot -i`, then `@e3`) both work. Refs only
exist after a `snapshot` in the current page, so re-snapshot after a navigation.

Move the cursor with `mouse move x y --duration <ms> --steps <n> --human`, to the centre of the
target from `get box`, then `click`. This runs as written against the TodoMVC demo:

```bash
set -e
glide() {
  read -r x y < <(agent-browser get box "$1" | awk '/^x:/{x=$2}/^y:/{y=$2}/^width:/{w=$2}/^height:/{h=$2}END{printf "%d %d\n", x+w/2, y+h/2}')
  agent-browser mouse move "$x" "$y" --duration "${2:-700}" --steps 90 --human >/dev/null
}
agent-browser close >/dev/null 2>&1 || true
agent-browser open about:blank >/dev/null
agent-browser set viewport 1920 1080 2 >/dev/null
agent-browser open https://demo.playwright.dev/todomvc >/dev/null
agent-browser wait --load networkidle >/dev/null
agent-browser eval 'localStorage.clear()' >/dev/null
agent-browser reload >/dev/null
agent-browser wait --load networkidle >/dev/null
agent-browser mouse move 160 900 >/dev/null
agent-browser record start /abs/path/hero.mp4 --fps 60 --cursor
sleep 0.3
INPUT='input.new-todo'
glide $INPUT; agent-browser click $INPUT >/dev/null; sleep 0.2
agent-browser type $INPUT "Record a demo with a cursor" >/dev/null; agent-browser press Enter >/dev/null; sleep 0.5
agent-browser type $INPUT "Verify the output" >/dev/null; agent-browser press Enter >/dev/null; sleep 0.8
glide "li:first-child input.toggle"; agent-browser click "li:first-child input.toggle" >/dev/null; sleep 1.0
glide "a[href='#/completed']"; agent-browser click "a[href='#/completed']" >/dev/null; sleep 1.2
agent-browser record stop
```

- **Glide, then click.** `click` alone teleports the cursor to the target; `mouse move` with
  `--duration` and `--steps` is what makes it travel. Measured with 60, 90 and 120
  steps: all gave ~50 unique fps.
- **Skip the dead lead-in:** navigate and wait for the load state *then* `record start`, and park
  the mouse off the area of interest first (`mouse move 160 900`): the cursor sits where the last
  move left it.
- **Typing:** after the click the cursor sits on the text being typed. Move it aside
  (`mouse move` to a point clear of the field) before a long type.
- **Layout shifts after a click:** glide to the result before a long hold.
- Use `sleep` for dwell times; `agent-browser wait <ms>` also works.
- Retakes in the same browser keep state such as localStorage. Reset with `eval 'localStorage.clear()'`
  plus `reload`, or `agent-browser close` and reopen.
- Always run `record stop`; the mp4 is finalised there.

## Pacing

- Keep it short: one flow is about 15 seconds. A three-minute video to show one dropdown is too long.
- Hold 1–2 seconds only on the states that matter (the open dropdown, the filtered result) so the
  viewer can follow. Don't dwell between actions.
- No chapter cards on short flows.

## Auth reuse

Right after the first interactive login (magic link, OAuth), save the state, and load it on later
takes instead of logging in again:

```bash
agent-browser state save auth.json
agent-browser state load auth.json
```

The file holds live session credentials. Keep it out of git (add it to `.gitignore` or save it
outside the repo) and never paste it into a PR or chat.

## Verify the output

Look at the video before delivering it. Check that there is **exactly one cursor** on screen, and
that each ripple fires in place. Check `ffprobe` reports the size you asked for and
`pix_fmt=yuv420p`:

```bash
ffprobe -v error -show_entries stream=width,height,pix_fmt,r_frame_rate -of default=nw=1 hero.mp4
```

Extract frames at the moments that matter, as in
[assembly.md](assembly.md#encoding-the-deliverables). Pick one mid-glide and one at a click, and
read the PNGs:

```bash
ffmpeg -ss 1.2 -i hero.mp4 -frames:v 1 mid-glide.png
```

To confirm the pixels are real and not an upscale, crop a block of text at 1:1: the letter edges
should be crisp. For an overview of a whole take, `ffmpeg -i hero.mp4 -vf "fps=3,scale=960:-1,tile=4x6" -frames:v 1 sheet.png`,
or pass `--contact-sheet` to `record start`.

To count unique frames in a glide, hash the frames and count changes:

```bash
ffmpeg -v error -i hero.mp4 -vf "scale=480:-1,format=gray" -f framemd5 - | grep -v '^#' | awk -F, '{print $6}' | uniq | wc -l
```
