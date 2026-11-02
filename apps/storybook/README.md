# @dltech/atlas-storybook

The component workshop for `@dltech/atlas-ui`. Storybook 10 (nextjs-vite) with Tailwind v4. It is the
single Storybook host: it loads the stories co-located in `packages/ui/src`.

## Run

```sh
bun run --filter @dltech/atlas-storybook dev     # http://localhost:6006
bun run --filter @dltech/atlas-storybook build   # static build to storybook-static/
bun run --filter @dltech/atlas-storybook test    # affected-stories specs
```

## Render check

CI renders stories in headless Chromium and fails on an error display, a `pageerror`, a console
error, or a story that never mounts — but only the stories a change can affect. `bun run build`
writes `preview-stats.json` beside the static build; `scripts/affected-stories.ts` walks its importer
graph backwards from the changed files. A change to `.storybook/`, `scripts/`, any stylesheet,
`packages/ui/package.json`, or `bun.lock` — or one that reaches `.storybook/preview.tsx` — renders everything.

```sh
bun run --filter @dltech/atlas-storybook build
bun run --filter @dltech/atlas-storybook render-check        # stories affected vs origin/main plus uncommitted edits
RENDER_CHECK_ALL=1 bun run --filter @dltech/atlas-storybook render-check   # every story
bun run --filter @dltech/atlas-storybook render-check plan   # list the selection without rendering
```

## Theme

The toolbar **Theme** menu switches Dark (default) and Light. It toggles the `light` class on
`<html>` and drives next-themes' `ThemeProvider` (`forcedTheme`), so components that read
`useTheme()` (Sonner) follow it. To open a story in light mode directly:
`iframe.html?id=<story-id>&globals=theme:light`.

## Where stories go

| Story                | Location                                        | Title prefix   |
| -------------------- | ----------------------------------------------- | -------------- |
| A vendored component | `packages/ui/src/components/<name>.stories.tsx` | `Components/`  |
| An AI pattern        | `packages/ui/src/ai/<name>.stories.tsx`         | `AI/`          |
| Colors and type      | `packages/ui/src/tokens/`                       | `Foundations/` |

Page prototypes live in `apps/prototype`, not here.

The filename matches the component file. `packages/ui/src/__tests__/story-coverage.spec.ts` fails
when a component or AI pattern has no story next to it. Large stories split their data into a
sibling `*.fixtures.ts`; data shared with specs or prototypes lives in `packages/ui/src/fixtures/`
and is imported as `@dltech/atlas-ui/fixtures/<name>`.

Inside `packages/ui`, stories import Storybook types from `@storybook/react` and the component
under test relatively or via `#components/*`. Prototypes in this app import the public specifiers
(`@dltech/atlas-ui/components/button`). Use Atlas-flavored content (sessions, repos, models, tool
names), cover variants and states, and keep overlays clickable by rendering the trigger.
