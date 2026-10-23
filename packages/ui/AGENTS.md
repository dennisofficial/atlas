# packages/ui — the design system

`@dltech/atlas-ui`: Atlas's web components and design tokens. shadcn/ui `base-nova` is the visual
language as shipped (spacing, radius, type sizes, shadows, motion); Atlas contributes its colors
and fonts. The repo `CLAUDE.md` has the repo-wide philosophy; read it first.

## Layout

- `src/components/` — **vendored shadcn `base-nova` components**, written by the shadcn CLI.
- `src/ai/` — Atlas's agent patterns (message, tool, reasoning, prompt input, confirmation, diff
  viewer, …), composed from `src/components` per shadcn's AI Elements docs. Presentational, local
  prop types, no `ai` / `@ai-sdk/react` dependency.
- `src/hooks/`, `src/lib/` — CLI-installed (`lib/utils.ts` exports `cn`).
- `src/tokens/` — pure-TS design tokens; `tools/generate-css.ts` turns them into
  `src/styles/theme.css` (generated, never hand-edited).
- `src/styles/` — `theme.css` (generated), `base.css`, `fonts.css`.

Stories live next to the module they document (`button.tsx` -> `button.stories.tsx`), plus
`src/tokens/{colors,typography}.stories.tsx`. Story data shared with specs lives in `src/fixtures/`
(exported as `@dltech/atlas-ui/fixtures/<name>`; dev data only). `apps/storybook` is the Storybook
host: it loads these stories and owns the `Views/` prototypes.

## Commands

- `bun run --filter @dltech/atlas-ui typecheck`
- `bun run --filter @dltech/atlas-ui test` — `bun test`, specs in `__tests__/`
- `bun run --filter @dltech/atlas-ui generate` — regenerate `theme.css` after touching tokens
- `bun run --filter @dltech/atlas-storybook dev` — component workshop (see `apps/storybook/README.md`)

## Consuming the system

Import through the package `exports`:

| Specifier                          | What                                              |
| ---------------------------------- | ------------------------------------------------- |
| `@dltech/atlas-ui/components/<name>` | A vendored component (`button`, `dialog`, …)    |
| `@dltech/atlas-ui/ai/<name>`       | An AI pattern                                     |
| `@dltech/atlas-ui/lib/utils`       | `cn`                                              |
| `@dltech/atlas-ui/hooks/<name>`    | Hooks                                             |
| `@dltech/atlas-ui/tokens`          | Token values (`semantic`, `primitives`, `font`, `radiusScale`) |
| `@dltech/atlas-ui/theme.css`, `base.css`, `fonts.css` | Stylesheets                    |

Inside the package, use the `imports` aliases: `#components/*`, `#lib/*`, `#hooks/*`.

- An app imports the stylesheets once in its global CSS
  (`@import "@dltech/atlas-ui/theme.css"; @import "@dltech/atlas-ui/base.css";`) and points
  Tailwind's `@source` at this package's `src/` so component classes are generated. The package
  ships source with no build step; Next apps list it in `transpilePackages`.
- Missing component? Add it here with the shadcn CLI, not in the app. Do not add a second
  component library.
- App-specific compositions (anything importing a Prisma type, a route, or a feature flag) belong
  in the app.
- Use semantic utilities (`bg-primary`, `text-muted-foreground`, `border-border`, `bg-card`, …).
  Never a raw hex or an arbitrary value in app screens. The raw `warm-*` / `clay-*` ramps are for
  this package's internals.

## Vendored components (`src/components`)

- Owned by the shadcn CLI. Add or update with `bunx --bun shadcn@latest add <name>`; compare with
  `bunx --bun shadcn@latest add <name> --diff`. Config is `components.json`.
- **Do not hand-edit them.** A hand-edited vendored file is a fork and breaks `add --diff`. The one
  allowed change is a token or color class we cannot get from the variables.
- They are exempt from repo house style (300-line cap, no comments, `handle` prefix, named
  parameters, `E`-enums). Everything else in this package follows it, including `src/ai`,
  `src/tokens`, and the specs.
- Compose, don't restyle: variants via the component's own props, `className` only for layout.
- A component is not done without a `<name>.stories.tsx` next to it.

## AI patterns (`src/ai`)

House style applies. Compose from `#components/*`; no direct Base UI imports unless a component
needs a primitive shadcn does not wrap. Every pattern ships a `<name>.stories.tsx` next to it in `src/ai`.

## Tokens

- `src/tokens` emits **colors only**, under shadcn's variable names (`--background`, `--primary`,
  `--sidebar-*`, `--chart-N`, …) plus Atlas extras (`success`, `warning`, `diff*`, `syntax*`).
  Spacing, type sizes, radius scale, shadows, and motion are shadcn's defaults.
- Dark is the default scheme; light applies under `[data-theme="light"]`, `[data-theme="day"]`, or
  `.light`.
- Fonts: Geist (sans), JetBrains Mono (mono), Space Grotesk (display).
- `theme.css` is generated. A spec in `src/tokens/__tests__` fails if it drifts from the tokens.
- The token layer has no platform imports. It is the contract a future Expo app consumes.

## Story coverage

`src/__tests__/story-coverage.spec.ts` fails if any `src/components/<name>.tsx` or
`src/ai/<name>.tsx` lacks a sibling `<name>.stories.tsx`.

Stories import Storybook types from `@storybook/react` (the renderer package), never from a
framework package, so `next` stays out of the design system.

## Decisions

- **Base UI, not Radix.** shadcn's `base` flavor. Don't mix primitive libraries.
- **Tokens are generated TS, not hand-authored CSS**, so the same values can drive a native app.
- **`lucide-react`** is the one icon library.
- **No build step.** `exports` points at `src/`; dist-building component libraries have cost this
  codebase family stripped `.d.ts` files and dropped `"use client"` directives.
