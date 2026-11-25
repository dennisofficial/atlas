# apps/tui

## UI/UX

- Anything clickable must be hoverable. Hovering it changes the background, so the affordance is visible before the click.
- Use `useClickRegion` (`src/ui/hooks/use-click-region.ts`). It wires press, hover tracking and the `theme.hoverBg` background in one hook.

## Performance

OpenTUI repaints every visible renderable every frame, because it has no dirty regions. The cost is
renderable count multiplied by frame count. These rules were measured in the September 2026 perf
round (#338, #340, #342, #343, #346); the probe scripts that measured it were deleted in the
TUI v2 flip.
- **One `<text>` with styled spans, never a `<box>` + `<text>` per cell.** A row of N elements costs
  N × (5 native handles + a Yoga node) every frame. Gutters, signs and tints are all spans.
- **A React commit is a frame.** Never call `setState` on a timer. Subscribe to the shared ticker
  (`subscribeTicker` in `src/ui/hooks/use-shimmer-clock.ts`), and write to the renderable by ref.
- **An effect that awaits and then calls `setState` is keyed on content and bails when the content
  is unchanged.** Keyed on array identity, it loops at 60 fps. One such block pinned a CPU core per
  tile (`tool-block-idle.spec.tsx`).
- **Never `content={new StyledText(...)}` inline.** `content` compares by reference, so every render
  pushes the native buffer again. Memoize it.
- **`targetFps` is inert.** A frame happens only on `requestRender` (every React commit), capped by
  `maxFps` (60). For a tile that stays busy while idle, count the frames first
  (`renderer.getStats().frameCount` over a quiet window). A nonzero count means a state loop.

## Boundary

`apps/tui` is a v2 cloud client. It may import `@dltech/atlas-client/*`, `@dltech/atlas-api-router`,
`@dltech/atlas-protocol`, `@dltech/atlas-commands`, `@dltech/atlas-core`, `@dltech/atlas-models`,
`@dltech/atlas-syntax`, `@dltech/atlas-observability`, `@dltech/atlas-notifications` and
`@dltech/atlas-plugin-*/client|core`. It never imports `@dltech/atlas-wire`, `tsyringe` or
`reflect-metadata`. A row type the chrome reads from a snapshot is declared beside the
chrome, not borrowed from a server package. `src/__tests__/package.spec.ts` enforces the list.
