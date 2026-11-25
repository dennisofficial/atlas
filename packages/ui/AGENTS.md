# packages/ui — the design system

`@dltech/atlas-ui` owns the Atlas web components and the design tokens. shadcn/ui `base-nova` is the visual
language as shipped: spacing, radius, type sizes, shadows and motion. Atlas adds its own colors
and fonts. Read the repo `AGENTS.md` first. It holds the repo-wide philosophy.

## Layout

- `src/components/` — **vendored shadcn `base-nova` components**, written by the shadcn CLI.
- `src/ai/` — Atlas's agent patterns: message, tool, reasoning, prompt input, confirmation, diff
  viewer and others. Compose each pattern from `src/components`, as shadcn's AI Elements docs
  describe. Each pattern is presentational, with local prop types and no `ai` / `@ai-sdk/react`
  dependency.
- `src/hooks/`, `src/lib/` — CLI-installed (`lib/utils.ts` exports `cn`).
- `src/tokens/` — pure-TS design tokens. `tools/generate-css.ts` turns them into
  `src/styles/theme.css`. That CSS file is generated. Never hand-edit it.
- `src/styles/` — `theme.css` (generated), `base.css`, `fonts.css`.

A story lives next to the module it documents (`button.tsx` -> `button.stories.tsx`). Two more are
`src/tokens/{colors,typography}.stories.tsx`. Story data shared with specs lives in `src/fixtures/`
and is exported as `@dltech/atlas-ui/fixtures/<name>`. That data is for development only.
`apps/storybook` is the Storybook host. It loads these stories and owns the `App/` prototypes.

## Commands

- `bun run --filter @dltech/atlas-ui typecheck`
- `bun run --filter @dltech/atlas-ui test` — `bun test`, specs in `__tests__/`
- `bun run --filter @dltech/atlas-ui generate` — regenerate `theme.css` after touching tokens
- `bun run --filter @dltech/atlas-storybook dev` — component workshop (see `apps/storybook/README.md`)

## Consuming the system

Import through the package `exports`:

| Specifier                                             | What                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `@dltech/atlas-ui/components/<name>`                  | A vendored component (`button`, `dialog`, …)                   |
| `@dltech/atlas-ui/ai/<name>`                          | An AI pattern                                                  |
| `@dltech/atlas-ui/lib/utils`                          | `cn`                                                           |
| `@dltech/atlas-ui/hooks/<name>`                       | Hooks                                                          |
| `@dltech/atlas-ui/tokens`                             | Token values (`semantic`, `primitives`, `font`, `radiusScale`) |
| `@dltech/atlas-ui/theme.css`, `base.css`, `fonts.css` | Stylesheets                                                    |

Inside the package, use the `imports` aliases: `#components/*`, `#lib/*`, `#hooks/*`.
- An app imports the stylesheets once in its global CSS
  (`@import "@dltech/atlas-ui/theme.css"; @import "@dltech/atlas-ui/base.css";`). The app points
  Tailwind's `@source` at this package's `src/`, so component classes are generated. The package
  ships source with no build step. Next apps list it in `transpilePackages`.
- If a component is missing, add it here with the shadcn CLI. Do not add it in the app. Do not add a
  second component library.
- An app-specific composition belongs in the app. A composition is app-specific when it imports a
  Prisma type, a route or a feature flag.
- Use semantic utilities (`bg-primary`, `text-muted-foreground`, `border-border`, `bg-card`, …).
  Do not use a raw hex or an arbitrary value in app screens. The raw `warm-*` / `clay-*` ramps are
  for this package's internals.

## Vendored components (`src/components`)

- The shadcn CLI owns these files. Add or update a component with
  `bunx --bun shadcn@latest add <name>`. Compare with
  `bunx --bun shadcn@latest add <name> --diff`. The config is `components.json`.
- **Do not hand-edit them.** A hand-edited vendored file is a fork, and it breaks `add --diff`. Two
  changes are allowed. Add a token or color class that the variables cannot provide. Add a spacing
  guarantee or a variant listed under "Deliberate forks" below.
- Vendored files are exempt from repo house style: the 300-line cap, no comments, the `handle`
  prefix, named parameters and `E`-enums. Everything else in this package follows that style,
  including `src/ai`, `src/tokens` and the specs.
- Compose the component. Do not restyle it. Select a variant with the component's own props. Use `className` only for
  layout. `src/ai/__tests__/no-chrome-overrides.spec.ts` and
  `apps/web/src/__tests__/no-chrome-overrides.spec.ts` fail on a chrome class passed to a DS
  component. A chrome class sets padding, gap, height or size, radius, border, ring, shadow or
  background.
- A component is not done until a `<name>.stories.tsx` sits next to it.

### Deliberate forks

Each container owns its inset. A caller does not add an inset. `shadcn add --diff` noise on these
files is expected.
- `select.tsx`: the inset moved from the optional `SelectGroup` onto the internal `SelectPrimitive.List`, so ungrouped items are inset too. `SelectTrigger` has `variant: 'default' | 'ghost'`. The ghost variant is borderless and takes the Button-ghost hover. Consumers do not fake it with `border-0`.
- `command.tsx`: `CommandGroup` lost its extra `p-1`. Items use the shared menu row (`rounded-md px-1.5 py-1 gap-1.5`), so Command rows match DropdownMenu.
- `popover.tsx`: a popover whose direct child is a `Command` drops its own padding and gap. Consumers do not pass `p-0 gap-0`.
- `popover.tsx`: `size: 'default' | 'sm'`. `sm` is a tighter inset and gap (`p-1.5 gap-1`) for a popover that holds one inline control row.
- `sheet.tsx`: `SheetContent` owns `p-4`. `SheetHeader`/`SheetFooter` carry no padding, and `SheetHeader` reserves `pr-8` for the close button. Its top, left and right edges sit inside the safe-area insets (`--safe-area-*` from `base.css`), so a sheet never opens under the iOS status bar. The bottom edge stays at 0, and the body pads `max(1rem, var(--safe-area-bottom))` so its content clears the home indicator.
- `drawer.tsx`: `DrawerContent` owns `p-4 gap-4`. `DrawerHeader`/`DrawerFooter` carry no padding.
- `attachment.tsx`: content padding sits on the base of each size, not behind `has-data-[slot=attachment-content]`. The media override stays.
- `input.tsx`: `size: 'default' | 'sm' | 'lg'` (lg = `h-9`, matching Button `lg`; sm = `h-7`, the height of Button `sm`).
- `input-group.tsx`: `InputGroupButton` `sm` is an explicit `h-7`. It inherited Button's `h-8`. `shape: 'default' | 'round'`. `InputGroupInput` accepts Input's `size`. The group's disabled dimming keys on a disabled `input-group-control`, not on any disabled descendant, so a disabled addon button (an empty composer's Send) does not grey out the whole field.
- `input-otp.tsx`: `size: 'default' | 'lg'` on `InputOTP`, read by every slot.
- `radio-group.tsx`: `layout: 'default' | 'rows'`. `rows` sets `gap-0 divide-y`, so a list of selectable account rows runs edge to edge with a hairline between rows.
- `slider.tsx`: a scalar `value`/`defaultValue` renders one thumb. The upstream thumb count treats a
  non-array value as unknown and falls back to `[min, max]`, so `<Slider value={2} />` rendered two
  focusable thumbs on top of each other. The count now comes from the scalar itself. `aria-label` on
  the slider names the range input. Upstream puts the label on the wrapper `div` and leaves the
  input unnamed. `size: 'default' | 'lg'` is for a slider that must carry a short track, such as the
  composer's effort dial. `lg` gives an `h-1.5` track and a `size-4.5` thumb. Control and thumb take
  `cursor-pointer`, because the track is press-to-set and showed a plain arrow. Thumb and fill ease
  to a new value (`transition-[inset-inline-start]` / `width`, 200ms), but only after the slider has
  been pressed or focused. Base UI paints the thumb at 0% and moves it when it has measured the
  track, so an unconditional transition animates the wrong way on mount. The transition cannot be
  suppressed while dragging. Base UI counts a track press as dragging from pointerdown, which would
  kill the animation on the click it exists for.
- `table.tsx`: header rows never take the body hover. `Table` has `variant: 'default' | 'framed'`. The framed variant is a bordered card container with `pl-4` and `pr-4` edge cells.
- `empty.tsx`: `variant: 'default' | 'outline'`.
- `avatar.tsx`: `size="xs"`. `AvatarFallback` text follows the avatar size.
- `sidebar.tsx`: `collapsible="none"` draws the same side edge border as the other modes. `SidebarFooter` has `variant: 'default' | 'bordered'`, where bordered adds a top `border-sidebar-border` edge. `SidebarMenuButton` has `size="avatar"` (`h-10`, `px-1` when collapsed) for the account row. `SidebarProvider` pads its wrapper by the top, left and right safe-area insets. The fixed desktop container offsets by the side insets. `sidebar-inner` pads the top, so the sidebar surface runs under the status bar.
- `card.tsx`: `CardFooter` owns `gap-2` between its buttons. `variant: 'default' | 'list'` and the `CardRow` part serve divided settings lists. A table directly inside a list card gets the card's edge inset. `tone: 'default' | 'destructive'` tints the ring for danger zones.
- `button.tsx`: `ghost` shows the selected state for `aria-current="page"` / `"true"`. Nav and tree rows do not add `bg-muted` themselves.
- `button.tsx`: `size="row"` is the action inside a dense row: `h-6`, `px-1.5`, `text-xs`, with the `xs` rounding and icon size.
- `button.tsx`: `variant="tree"` is `ghost` without the `aria-expanded` highlight, so open folder rows in the file tree stay unhighlighted. Only hover and the selected `aria-current="true"` row take `bg-muted`.
- `message.tsx`: `MessageHeader`/`MessageFooter` take the `px-3` bubble inset only when the message has a bubble. The header owns `gap-2`.
- `message-scroller.tsx`: `MessageScrollerContent` owns the transcript gutter (`px-4 py-6`).
- `bubble.tsx`: `variant: 'pending'` gives a muted surface and a dashed border: the unsent look. A `BubbleContent` that hosts a textarea shows the focus ring on the bubble border.
- `item.tsx`: `size="sm"` is smaller than default. It was identical before.
- `brand-mark.tsx`: `size: 'default' | 'sm'`, where sm is compact and borderless.

## AI patterns (`src/ai`)

House style applies. Compose each pattern from `#components/*`. Do not import Base UI directly,
unless a component needs a primitive that shadcn does not wrap. Every pattern ships a
`<name>.stories.tsx` next to it in `src/ai`.

## Tokens

- `src/tokens` emits **colors only**, under shadcn's variable names (`--background`, `--primary`,
  `--sidebar-*`, `--chart-N`, …) plus Atlas extras (`success`, `warning`, `diff*`, `syntax*`).
  Spacing, type sizes, radius scale, shadows and motion are shadcn's defaults.
- Dark is the default scheme. Light applies under `[data-theme="light"]`, `[data-theme="day"]` or
  `.light`.
- Fonts: Geist (sans), JetBrains Mono (mono), Space Grotesk (display).
- `theme.css` is generated. A spec in `src/tokens/__tests__` fails if it drifts from the tokens.
- The token layer has no platform imports. It is the contract a future Expo app consumes.

## Story coverage

`src/__tests__/story-coverage.spec.ts` fails if any `src/components/<name>.tsx` or
`src/ai/<name>.tsx` lacks a sibling `<name>.stories.tsx`.

Stories import Storybook types from `@storybook/react`, the renderer package. Do not import them
from a framework package. This keeps `next` out of the design system.

## Decisions

- **Base UI, not Radix.** The flavor is shadcn's `base`. Do not mix primitive libraries.
- **Tokens are generated TS, not hand-authored CSS**, so the same values can drive a native app.
- **`lucide-react`** is the one icon library.
- **No build step.** `exports` points at `src/`. A component library that builds a dist has stripped
  `.d.ts` files and dropped `"use client"` directives in this codebase family.
