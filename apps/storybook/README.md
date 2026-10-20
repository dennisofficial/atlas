# @dltech/atlas-storybook

The component workshop for `@dltech/atlas-ui`. Storybook 10 (react-vite) with Tailwind v4. Every
story lives here; `packages/ui` stays pure components.

## Run

```sh
bun run --filter @dltech/atlas-storybook dev     # http://localhost:6006
bun run --filter @dltech/atlas-storybook build   # static build to storybook-static/
bun run --filter @dltech/atlas-storybook test    # story-coverage spec
```

## Theme

The toolbar **Theme** menu switches Dark (default) and Light. It toggles the `light` class on
`<html>` and drives next-themes' `ThemeProvider` (`forcedTheme`), so components that read
`useTheme()` (Sonner) follow it. To open a story in light mode directly:
`iframe.html?id=<story-id>&globals=theme:light`.

## Where stories go

| Story                                  | Location                          | Title prefix   |
| -------------------------------------- | --------------------------------- | -------------- |
| A vendored component in `packages/ui/src/components` | `src/components/<name>.stories.tsx` | `Components/`  |
| An AI pattern in `packages/ui/src/ai`  | `src/ai/<name>.stories.tsx`       | `AI/`          |
| Colors and type                        | `src/foundations/`                | `Foundations/` |
| Full-page prototypes (never shipped)   | `src/views/`                      | `Views/`       |

The filename matches the component file. `__tests__/story-coverage.spec.ts` fails when a component
or AI pattern has no story. Large stories split their data into a sibling `*.fixtures.ts`.

Stories import from the public specifiers (`@dltech/atlas-ui/components/button`), never from
`packages/ui/src` by path. Use Atlas-flavored content (sessions, repos, models, tool names), cover
variants and states, and keep overlays clickable by rendering the trigger.
