# Screen Studio-style promo: a real app, camera-directed

The action-promo lane: a recording of a real web app, re-framed after the fact into a Screen
Studio cut — a rounded window on a gradient stage, captions, a large drawn cursor with a click
ripple, and a director camera that zooms onto whatever the viewer should be looking at. Read
[browser-recording.md](browser-recording.md) first for the agent-browser recorder; this lane adds
the camera, the cursor and the delivery bar on top of it.

## First-try recipe

Do these in order. Skipping a step is how every failed iteration started.

1. **Write the beat list** (one line per beat: click what, then what the viewer sees). 3–6 beats,
   one flow, under ~30s total. Nothing starts zoomed; frame 0 is wide.
2. **Write `promo.json`** (format below): URL, subjects to measure, steps to record, beats that
   map clicks to subjects, captions.
3. **Measure subjects**: `python3 measure.py promo.json subjects.json` — real element boxes via
   `agent-browser get box`, never hand-typed coordinates. `setup` must drive the app into the
   state every measured subject exists in — a subject that only appears after a UI change (e.g.
   an expanded diff card) fails with `Element not found` until `setup` performs that change.
4. **Record one real-time take**: `python3 record.py promo.json take.mp4 events.json`. No baked
   cursor (no `--cursor`), 4K/30 (`set viewport 1920 1080 2`). If the mp4 has no moov atom the
   recorder retries; on a busy 4 vCPU sandbox expect several attempts — retakes only succeeded
   once system load came down, so wait for idle rather than hammering the encoder.
5. **Plan the camera**: `python3 plan.py promo.json events.json subjects.json launch/beats.json
   verify/`. Read the margin table — it exits non-zero when a landed pose clips its subject.
6. **Compose**: copy `take.mp4` to `launch/media/take.mp4`, then `python3 gen_html.py launch`.
   Init the HyperFrames project once (`npx --yes hyperframes@0.9.5 init` gives `hyperframes.json`
   + `package.json`; `hyperframes lint` must pass).
7. **Draft render**: `npx --yes hyperframes@0.9.5 render --output launch/out/draft.mp4 --quality
   draft --fps 30` (~2–3 min on 4 vCPU). Lint's duration warnings matter: a caption ending past
   the composition duration (which plan.py derives from the last logged event, not the caption
   list) is a real bug — fix the caption times, don't ignore the warning.
8. **Run the verification gate below.** Read every strip yourself before rendering the final.
9. **Final render**: `--quality delivery --fps 60` → 1920×1080 60fps (~4–6 min on 4 vCPU).
10. **Deliver under a new filename.** Preview servers and browsers cache by filename; each
    iteration ships as a new name (`promo-v6.mp4`, not over `promo.mp4`).

## promo.json

One file drives all five scripts. Selector objects are `{"css": "…"}` or `{"name": "…accessible
name substring…"}` (resolved through `snapshot -i`; refs go stale across navigations, so resolve
right before each use — the scripts do).

```json
{
  "url": "http://localhost:25881/threads",
  "clockOffset": 0.12,
  "leadIn": 0.9,
  "startCursor": { "x": 960, "y": 880 },
  "subjects": {
    "transcript": [{ "css": "[class*=scroll-fade-b]" }],
    "composer":   [{ "css": "form" }],
    "diff":       [{ "css": "[role=tablist]" }, { "css": "[role=tabpanel] div.rounded-lg.border" }]
  },
  "setup": [
    { "do": "click", "name": "link \"Running Rebase ui on shadcn base-nova\"", "settle": 1.2 }
  ],
  "steps": [
    { "do": "click", "name": "link \"Running Rebase ui on shadcn base-nova\"", "action": "open_thread", "glideMs": 520 },
    { "do": "park", "x": 760, "y": 520, "label": "transcript" },
    { "do": "dwell", "s": 2.1 },
    { "do": "click", "css": "form", "action": "composer", "glideMs": 590 },
    { "do": "dwell", "s": 0.25 },
    { "do": "type", "chunks": ["when you", " land, tig", "hten the r", "ing"], "gap": 0.13 },
    { "do": "dwell", "s": 0.6 },
    { "do": "click", "name": "tab \"Changes\"", "action": "changes_tab", "glideMs": 590 },
    { "do": "dwell", "s": 0.65 },
    { "do": "click", "name": "button \"theme.css", "action": "expand_diff", "glideMs": 410 },
    { "do": "dwell", "s": 1.5 }
  ],
  "beats": [
    { "action": "open_thread", "subject": "transcript" },
    { "action": "composer",    "subject": "composer" },
    { "action": "changes_tab", "subject": "diff", "via": "wide" },
    { "action": "expand_diff", "subject": "diff", "result": "diff" }
  ],
  "captions": [
    { "id": "c1", "html": "One thread. <span class=\"accent\">Every agent.</span>", "t0": 2.6, "t1": 6.1, "subject": "transcript" }
  ],
  "closer": { "x": 1150, "y": 640, "hold": 1.4, "pull": 0.9 }
}
```

- `subjects`: name → 1+ selectors; several selectors are unioned into one box (a panel subject is
  usually tablist ∪ panel ∪ the card). A selector may carry `"cropH": 1` to contribute only its
  top edge to the union (e.g. a tabpanel whose full height would stretch the subject past the
  interesting content). Pick the element that matches what the viewer watches — the composer
  subject is the whole `form` (textarea + toolbar), not the textarea alone.
- `setup`: drives the app into the state `subjects` are measured in (measure.py only). Include
  every navigation or expansion the subjects need to exist.
- `steps`: the recorded take (record.py only). `click` steps measure the target box *before* the
  glide and log it; `park` glides the cursor clear of hover cards.
- `beats`: maps a recorded click `action` to its subject. `"click": true` includes the click
  point ±10px in the frame box, so the control that opened the view stays on screen (use it when
  the click target is outside the subject, e.g. a sidebar row that opens the framed transcript).
  `via: "wide"` forces pull-back-then-push-in for a far subject; `result` pans to that subject
  after the click. `push`/`pull`/`lead` override the timing defaults.
- `clockOffset`: the recorded video lags the event log by ~0.12s; measure yours once with
  `ffmpeg -vf select='gt(scene,0.003)',showinfo` (scene-change t vs logged click t) and set it.
  plan.py adds it to every event.
- `closer`: final park point (clear of hover cards) + hold; the camera pulls back to wide when
  the cursor departs for it.
- `captions`: plan.py errors when a caption is under 1.2s and picks a corner that doesn't
  intersect the subject's on-screen rect; `subject: null` centres it. Keep every caption inside
  the take's duration.

## Director rules (locked)

- **The zoom frames the subject being presented, never the cursor.** The composer fills the frame
  while typing; the diff fills it when showing diffs.
- **One real-time take.** No cuts, no sped-up sections, no retiming. Write the script tight enough
  that it doesn't need them.
- **Nothing starts zoomed.** Frame 0 is wide (scale 1); the establishing wide holds ~1s.
- **Zoom starts when the cursor departs** toward the subject (the logged `glide_start`) and lasts
  ~0.75–1s (`power3.inOut`), landing just before the click.
- **Pan when the next subject is near; pull back when it is far** (`via: "wide"`: ~0.67s
  `power2.inOut` pull-back starting ~0.3s before the glide, then push in).
- **Landed pose** (checked by plan.py's margin assertion): the subject box — plus the click point
  ±10px for click-revealed poses — plus a 24 CSS px margin (capped at the distance to the nearest
  page edge) must fit inside the window's view rect. Centre on the box, then clamp the view to the
  page so a subject near an edge **anchors to that edge** instead of being clipped. If it doesn't
  fit at the chosen scale, step the scale down (fill 0.85 → 0.55) until it does. Mid-tween poses
  are free; only landed poses are asserted.
- **A click-then-result beat is two poses**: land on the clicked control, then pan to the result
  region (`result` in promo.json) so the opening click still punches.
- **The mouse is intentional.** Straight glides to targets, ~0.22s settle before each click, parks
  clear of hover cards, no wandering.
- **Camera segments never overlap.** plan.py asserts this — overlapping GSAP tweens on the same
  properties kill each other mid-flight (the overlap trap below).
- **One `tl.set` only, at t=0.** Never set a pose per segment; segments that start zoomed are the
  v1 bug ("starts zoomed, then zooms out").

## Pacing defaults (v4 tuning)

- Typing: chunked `keyboard type`, ~10 char chunks with 0.13s gaps. **`agent-browser type` has no
  `--delay` flag — it is silently ignored** and types at the multi-second default.
- Glides: `mouse move --steps 30` — wall time then matches `--duration`. `--steps 90` costs ~0.3s
  of per-step CDP overhead and takes ~1.5s whatever the duration says.
- Settle 0.22s before each click; captions on screen at least 1.2s (plan.py errors below that).
- The operator's v4 pacing: glides 410–590ms, camera pushes 0.75s, pull-backs 0.67s, closer 0.9s.

## Spec defaults

- **Record at 4K/30** (`set viewport 1920 1080 2`, `record start --fps 30`). The 4K pixels keep
  zooms up to 2.8x sharp in the 1080p render.
- **4K/60 dies on a 4 vCPU sandbox** on a dense UI: "encoder fell behind by more than 16 buffered
  frames", mp4 with no moov atom. record.py checks the mp4 with ffprobe and retakes up to 4 times.
- **Render 1080p60.** HyperFrames' render pipe is screenshot-capture on software GL; 4K is ~4x the
  render time and motion smoothness matters more than pixels for a camera-driven cut.

## Pitfalls (each one cost an iteration)

- **Counter-scaling a nested video**: never tween `width` on the zoom wrapper — GSAP sets it as a
  layout property and the video inside does not stretch, leaving a black band. The rig that works
  (in gen_html.py): one `#z` wrapper with `transform: scale(k) translate(-L,-T)` over a
  page-px viewport `{L,T,Wd}`, video at natural size, **no counter-scale**.
- **The GSAP overlap trap**: a `tl.to` that starts while a previous tween on the same properties
  is still running kills it mid-flight and starts from wherever it got to. plan.py refuses
  overlapping camera segments; the composition runs one proxy `clock` tween whose `onUpdate`
  samples camera and cursor from the same segment lists plan.py tabulates — the camera table *is*
  the camera. Any sampled replica must record start AND end of every tween (recording only end
  poses makes mid-move sampling read the destination for the whole segment, which put the drawn
  cursor tens of px off in v2).
- **Clamping**: clamp the view to the page (`L,T ≥ 0`, `L+Wd ≤ 1920`) so deep zooms near an edge
  never show out-of-bounds black.
- The event clock leads the video clock by ~0.12s — set `clockOffset` or the camera aims at where
  the click *would have been*.
- Snap the drawn cursor from **issued coordinates** (the logged glide endpoints + clicks), never
  from a sampled page mirror — sampling drifted 60px in v2. record.py asserts each click equals
  its glide end.

## The verification gate (mandatory, before any render is shown)

Checking only the click frames is what let every past bug through — the operator caught every one
of them in the motion. Before delivering, produce and **read** all of:

1. **A 10fps strip of every transition** (every camera segment, not just clicks):
   `ffmpeg -ss <t0> -to <t1> -i draft.mp4 -vf "fps=10,scale=480:-1,tile=8x5" -frames:v 1 strip.png`
   per segment. Watch for: the zoom starting before the cursor moves, snapped poses, clipped
   content at the window bezel, captions colliding with the subject.
2. **Frame 0 is wide**: extract the first frame and confirm scale 1.
3. **The margin assertion table** from plan.py — it exits non-zero on failure; never render past it.
4. **Click-tip check, in the DOM**: `python3 tipcheck.py launch` serves the composition, seeks the
   timeline to each click and compares the cursor SVG tip's `getScreenCTM` against the click mapped
   through `__sample(t).cam`. It fails above 2px. Do **not** pixel-diff the render against the
   take: stroke, shadow, hover state and compression make the diff 5–26px off even when the cursor
   is exactly right — that heuristic false-fails a correct cut. Also crop one landed frame 1:1
   from the render and look at it.
5. **One frame per beat**: the held pose with the subject framed, the cursor on the control.

Also `npx --yes hyperframes lint` must pass with 0 errors.

## Delivery

- Draft first (`--quality draft --fps 30`), final only after approval (`--quality delivery
  --fps 60`, 1920×1080).
- **New filename per iteration** — browsers cache preview servers by filename. `promo-v6.mp4`,
  never overwrite `promo.mp4`.
- No music without credentials (`npx hyperframes usage --json` → `unsupported_harness` in a
  credential-less sandbox).

## Files

All in `assets/promo/` (bundled with this skill; copy them into the working directory):

- `record.py` — recording driver: runs `steps`, logs every issued cursor coordinate and event to
  `events.json`, asserts clicks equal glide ends, retakes on a moov-less mp4.
- `measure.py` — subject measurer: drives `setup`, unions each subject's selectors into one box,
  writes `subjects.json`.
- `plan.py` — camera planner: writes `launch/beats.json` + `verify/camera-table.tsv`, prints the
  margin table, exits non-zero when a landed pose clips its subject, a caption is under 1.2s,
  caption placement collides, or camera segments overlap.
- `gen_html.py` — composition generator: writes `launch/index.html` (stage, window, camera rig,
  drawn cursor, ripples, captions) from `beats.json`.
- `tipcheck.py` — click-tip check: render-vs-take pixel diff around each click.
