# apps/tui

## UI/UX

- Anything clickable must be hoverable: hovering it changes the background so the affordance is visible before the click.
- Reach for `useClickRegion` (`src/ui/hooks/use-click-region.ts`) — it wires press, hover tracking, and the `theme.hoverBg` wash in one hook.

## Performance

OpenTUI repaints every visible renderable every frame (no dirty regions), so cost is renderable
count times frame count. Measured in the September 2026 perf round (#338, #340, #342, #343, #346)
with `scripts/proto-shimmer.tsx`.
- **One `<text>` with styled spans, never a `<box>` + `<text>` per cell.** A row of N elements costs
  N × (5 native handles + a Yoga node) every frame. Gutters, signs and tints are all spans.
- **A React commit is a frame.** Never `setState` on a timer: subscribe to the shared ticker
  (`subscribeTicker` in `src/ui/hooks/use-shimmer-clock.ts`) and write to the renderable by ref.
- **An effect that awaits and then `setState`s is keyed on content and bails when unchanged.** Keyed
  on array identity it loops at 60 fps; one such block pinned a core per tile
  (`tool-block-idle.spec.tsx`).
- **Never `content={new StyledText(...)}` inline.** `content` compares by reference, so every render
  re-pushes the native buffer. Memoize it.
- **`targetFps` is inert.** Frames happen only on `requestRender` (every React commit), capped by
  `maxFps` (60). For a tile that's hot while idle, count frames first
  (`renderer.getStats().frameCount` over a quiet window): nonzero means a state loop.
