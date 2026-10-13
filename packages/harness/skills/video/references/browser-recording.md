# Browser recording: a real app, with a visible cursor

## When this lane applies

Proof-of-work or a demo of a **real, live app**: staging, an authenticated flow, a PR's UI
change. The state lives on a server, so there is no seekable, deterministic render to make. Drive
the real app with Playwright and record its screencast.

For a polished launch clip, a README hero, or anything you can compose from captured data,
render it with HyperFrames instead ([hyperframes.md](hyperframes.md)).

## Why a cursor

Playwright's screencast captures the page, never the OS pointer, and the browser is usually
headless. Without help the viewer sees things change with no hint of what was clicked or typed.
The fix is an in-page virtual cursor: DOM the screencast captures natively.
[assets/cursor-inject.js](../assets/cursor-inject.js) installs an arrow, a hover glow, and a click
ripple, and exposes `window.__pwCursor = { tap, point, aside, move, hover, unhover, click }`.

## Resolution and scale

The page is always laid out at a **1920×1080 CSS viewport**, whatever the output quality. Only the
pixel density changes, so a 720p take and a 4K take show the same layout, the same amount of page
and the same cursor proportion. The cursor `SIZE` is 36 CSS px (1.9% of the frame width) and
scales with the output on its own.

The default is **4K: 3840×2160**. Smaller outputs reuse the same setup and only change the
screencast `size` (1920×1080, 1280×720).

How the density is set, all verified by reading the JPEG headers of the delivered frames:

- **Launch flag `--force-device-scale-factor=2`** gives the screencast true 3840×2160 pixels. Put
  it in a playwright-cli config file, with the viewport.
- **Context `deviceScaleFactor: 2` does not.** The page reports DPR 2, but the screencast still
  delivers 1920×1080 frames, so a "4K" file is an upscale.
- Under the flag, `devicePixelRatio` reads `1` and the viewport stays 1920×1080. Only the
  screencast gets the extra pixels.
- **Fractional DPR for 720p does not work**: `--force-device-scale-factor=0.6667` breaks the
  viewport (1921×1081) and no frames arrive. Keep the same launch and ask for
  `size: { width: 1280, height: 720 }`; the screencast scales down, layout unchanged.

If a narrow app is unreadable at 1920 CSS px, set `document.body.style.zoom = '2'` after load.
Use one fixed number for every output size, never one derived from it. `tap`, `point` and `aside`
read `getBoundingClientRect()`, which stays correct under zoom, and the cursor lives on
`documentElement`, so zoom does not scale it.

## Frame rate

`page.screencast.start` takes `path`, `size`, `quality` (JPEG quality), `onFrame` and `annotate`.
There is no fps option, and `playwright-cli video-start` only takes `--size`.

- **`path:` records a webm at a hard-coded 25 fps.** Measured: about 24 unique frames per second.
- **`onFrame` delivers the raw JPEG frames with timestamps.** Chromium produces a frame on each
  repaint, so a glide arrives at about 58 unique frames per second (the longest gap inside a glide
  was 35 ms), and a static page produces almost none. At 2560×1440 and at 3840×2160 the numbers
  were the same.

Place each frame on its 1/60 s tick yourself, as below. Do not feed the timestamps to ffmpeg's
concat demuxer: it reads images at 25 fps and rounds every duration to 40 ms, which halves the
glide frame rate (measured 26 unique fps in the mp4 from 63 in the raw frames) and reads as judder.

So record with `onFrame` and assemble the video yourself, as below. Frame interpolation
(`minterpolate`) is not needed and is not recommended: on a 25 fps take it smeared the cursor and
left ghost patches around the text.

## Setup

Save this as an absolute-path config file, for example `/tmp/browser-cli.json`:

```json
{
  "browser": {
    "launchOptions": { "args": ["--force-device-scale-factor=2"] },
    "contextOptions": { "viewport": { "width": 1920, "height": 1080 } }
  }
}
```

Open the browser with it, then install the cursor before the first navigation the video shows.
Init scripts apply on the next navigation, so installing after `goto` misses that page. The config
is read when the browser opens: to change it, `close` and reopen.

```bash
playwright-cli --config /tmp/browser-cli.json open
playwright-cli run-code --filename <skill dir>/assets/cursor-inject.js
playwright-cli run-code --filename hero.js
playwright-cli close
```

`<skill dir>` is the directory the skill loader names when it loads this skill.

Retakes inside the same `open` session keep earlier state, such as localStorage. Reset it with
`localStorage.clear()` plus a reload, as the script below does, or `close`, reopen, and inject
again.

## Receive the frames

`run-code` has no filesystem access and no `fetch`, but `page.request.post` works, so the script
posts each frame to a small local receiver, bundled as
[assets/recv.py](../assets/recv.py). Start it before the run as a background process or service,
and stop it afterwards. Use an empty output directory for each take:

```bash
python3 <skill dir>/assets/recv.py /abs/path/frames 8799
```

After the run, turn the frames into a constant 60 fps mp4 with
[assets/assemble.py](../assets/assemble.py). It puts each frame on its nearest 1/60 s tick, moves a
frame that would share a tick to the next free one, and repeats each frame until the next frame's
tick, writing one symlink per tick. The `scale` filter converts the JPEG's full range to the TV
range players expect. Use a fresh ticks directory per take:

```bash
python3 <skill dir>/assets/assemble.py frames ticks
ffmpeg -framerate 60 -i ticks/%06d.jpg \
  -vf "scale=in_range=full:out_range=tv,format=yuv420p" \
  -c:v libx264 -crf 18 -color_range tv -movflags +faststart out.mp4
```

Pacing flags such as `--disable-frame-rate-limit --disable-gpu-vsync` raise the raw frame count
but space the frames unevenly, so the motion gets jerkier. Leave them off.

## Hero script

Each action is two lines: `tap` on the element, then the real action. Type with `pressSequentially`
at a ~70ms delay. The screencast `size` picks the output quality; it must keep the 16:9 shape.

| Call | Does |
| --- | --- |
| `el => __pwCursor.tap(el)` | Glide to the center, hover glow, then ripple and press. Resolves as the effect fires, so the real `.click()` after it lands with the ripple. |
| `el => __pwCursor.point(el)` | Glide to the center and wait for it to arrive. For "look at this result" holds. |
| `el => __pwCursor.aside(el)` | Jump to a spot ~120px right and ~70px down of the center, clear of its text. |
| `move(x, y)`, `hover(x, y)`, `click(x, y)`, `unhover()` | The low-level pieces `tap` is built from. |

- **Call `aside` before typing.** After the click the cursor sits on top of the text being typed.
  Settle ~180ms first.
- **Layout shifts after a click** (a filter shrinks the list, the cursor is left over empty
  space): `point` at the result before a long hold.
- **Skip the dead lead-in:** `goto`, wait for the load state, *then* `screencast.start`, then
  settle ~250ms. The init script still applies.
- **Await every post** before returning, or the last frames are lost.

This script runs as written against https://demo.playwright.dev/todomvc, with the receiver on port
8799. Adapt the target locators and the dwell times.

```js
async page => {
  const SIZE = { width: 3840, height: 2160 };
  const RECEIVER = 'http://127.0.0.1:8799';
  const settle = ms => page.waitForTimeout(ms);
  const posts = [];

  await page.goto('https://demo.playwright.dev/todomvc');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await page.screencast.start({
    size: SIZE,
    onFrame: ({ data, timestamp }) => {
      posts.push(page.request.post(RECEIVER, { headers: { 'x-ts': String(timestamp) }, data }));
    },
  });
  await settle(250);

  const input = page.getByPlaceholder('What needs to be done?');
  await input.evaluate(el => __pwCursor.tap(el));
  await input.click();
  await settle(180);
  await input.evaluate(el => __pwCursor.aside(el));
  await input.pressSequentially('Record a demo with a cursor', { delay: 70 });
  await settle(250);
  await input.press('Enter');
  await settle(500);

  await input.pressSequentially('Verify the output', { delay: 70 });
  await settle(250);
  await input.press('Enter');
  await settle(800);

  const firstToggle = page.getByTestId('todo-item').first().getByRole('checkbox');
  await firstToggle.evaluate(el => __pwCursor.tap(el));
  await firstToggle.check();
  await settle(1300);

  const completed = page.getByRole('link', { name: 'Completed' });
  await completed.evaluate(el => __pwCursor.tap(el));
  await completed.click();
  await page.getByTestId('todo-item').first().evaluate(el => __pwCursor.point(el));
  await settle(1400);

  await page.screencast.stop();
  await Promise.all(posts);
}
```

`run-code` takes a single function expression: no `import`, `require`, or filesystem access.

If you only need a quick, non-smooth clip, `page.screencast.start({ path: '/abs/path/demo.webm', size })`
writes a 25 fps webm at that absolute path with no receiver; a relative path resolves against the
directory `playwright-cli open` ran in. Convert it with
`ffmpeg -i in.webm -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart out.mp4`.

## Cursor correctness rules

Each rule below came from a bug in an earlier version. Keep all three when changing the script.

- **Position with `transform` only, never `left`/`top`.** Elements stay at `left:0; top:0` and are
  placed with `translate(x, y)`. The glow and ripple get their x/y with `transition: none`; only
  scale and opacity animate afterwards. Otherwise the ripple **travels** from its previous
  position to the new click.
- **Dedup with `document.getElementById('__pw-cursor')?.isConnected`.** The elements are appended
  to `documentElement`, a sibling of `body`, so `body.contains(cursor)` is always false and every
  call would append another cursor. The symptom is **stacked cursors**.
- **Move with a CSS `transition` on `transform`, not per-frame `requestAnimationFrame`.** Set each
  target instantly and let the transition animate. Playwright's screencast captures on damage
  rectangles and does not reliably repaint an overlay moved by per-frame script writes: the DOM
  holds one cursor, but the video keeps the old rasterized position on screen as a **ghost
  cursor**, which reads as several cursors. A real CSS transition is composited continuously and
  is captured cleanly. The same cause is why the cursor starts off-screen rather than at the
  default `0,0`: whatever paints first in a region the screencast never repaints stays there.

## Pacing

- Keep it short: one flow is about 15 seconds. A three-minute video to show one dropdown is too long.
- Hold 1–2 seconds only on the states that matter (the open dropdown, the filtered result) so the
  viewer can follow. Don't dwell between actions.
- No chapter cards on short flows.

## Auth reuse

Right after the first interactive login (magic link, OAuth), save the state, and load it on later
takes instead of logging in again:

```bash
playwright-cli state-save auth.json
playwright-cli state-load auth.json
```

The file holds live session credentials. Keep it out of git (add it to `.gitignore` or save it
outside the repo) and never paste it into a PR or chat.

## Verify the output

Look at the video before delivering it. Check that there is **exactly one cursor** on screen, and
that each ripple fires in place rather than sliding in from elsewhere. Zero cursors before the
first `move` is expected: the cursor starts off-screen. Check the first frame too: no cursor stuck
in the top-left corner. Check `ffprobe` reports the size you asked for and `pix_fmt=yuv420p`.

Extract frames at the moments that matter, as in
[assembly.md](assembly.md#encoding-the-deliverables). Pick one mid-glide and one at a click:

```bash
ffmpeg -ss 6.45 -i out.mp4 -frames:v 1 mid-glide.png
```

Read the PNGs. To confirm the pixels are real and not an upscale, crop a block of text at 1:1: the
letter edges should be crisp, not soft.

Then step through 6–8 consecutive frames mid-glide. The cursor must move on every frame, with
steps shrinking smoothly. Repeated positions mean the assembly snapped frames together:

```bash
ffmpeg -ss 6.2 -i out.mp4 -frames:v 8 glide-%02d.png
```
