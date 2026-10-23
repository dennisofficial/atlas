# @dltech/atlas-storybook

The component workshop for `@dltech/atlas-ui`. Storybook 10 (nextjs-vite) with Tailwind v4. It is the
single Storybook host: it loads the stories co-located in `packages/ui/src` plus the prototypes here.

## Run

```sh
bun run --filter @dltech/atlas-storybook dev     # http://localhost:6006
bun run --filter @dltech/atlas-storybook build   # static build to storybook-static/
bun run --filter @dltech/atlas-storybook test    # prototype specs and the sitemap guard
```

## Theme

The toolbar **Theme** menu switches Dark (default) and Light. It toggles the `light` class on
`<html>` and drives next-themes' `ThemeProvider` (`forcedTheme`), so components that read
`useTheme()` (Sonner) follow it. To open a story in light mode directly:
`iframe.html?id=<story-id>&globals=theme:light`.

## Where stories go

| Story                                  | Location                                         | Title prefix   |
| -------------------------------------- | ------------------------------------------------ | -------------- |
| A vendored component                   | `packages/ui/src/components/<name>.stories.tsx`  | `Components/`  |
| An AI pattern                          | `packages/ui/src/ai/<name>.stories.tsx`          | `AI/`          |
| Colors and type                        | `packages/ui/src/tokens/`                        | `Foundations/` |
| Page prototypes (never shipped)        | `apps/storybook/src/app/<route>/`                | `App/`         |

Prototype folders and titles mirror the app sitemap: `src/app/auth/sign-in.stories.tsx` is
`App/Auth/Sign in`, `src/app/projects/settings/<section>.stories.tsx` is
`App/Projects/Settings/<Label>`, `src/app/settings/<slug>.stories.tsx` is `App/Settings/<Label>`
(the slug is the `ESettingsPage` value). Storybook is the design source of truth; `apps/web`
implements from it. `__tests__/sitemap.spec.ts` guards the layout.

The filename matches the component file. `packages/ui/src/__tests__/story-coverage.spec.ts` fails
when a component or AI pattern has no story next to it. Large stories split their data into a
sibling `*.fixtures.ts`; data shared with specs or prototypes lives in `packages/ui/src/fixtures/`
and is imported as `@dltech/atlas-ui/fixtures/<name>`.

Inside `packages/ui`, stories import Storybook types from `@storybook/react` and the component
under test relatively or via `#components/*`. Prototypes in this app import the public specifiers
(`@dltech/atlas-ui/components/button`). Use Atlas-flavored content (sessions, repos, models, tool
names), cover variants and states, and keep overlays clickable by rendering the trigger.
