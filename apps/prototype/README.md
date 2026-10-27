# @dltech/atlas-prototype

A clickable design prototype of `apps/web`. It is the north star: the pages as we want them, not as
they ship today. Everything is hardcoded fixtures. There is no backend, no saved state, and business
logic is not expected to work. Links navigate between real routes, nothing more.

## Flow

1. Explore variants in Paper or Storybook.
2. Move the chosen flow into `apps/prototype`.
3. `apps/web` implements it, skipping logic that is not supported yet.

The prototype may be ahead of web. It may never be behind.

## Run

```sh
bun run --filter @dltech/atlas-prototype dev
```

Open http://localhost:3100/proto. That is the entry point; the app also works stand-alone at `/`.

## The chrome

`/proto` wraps every page in three panels:

- **Left**: a tree of every page, generated from `src/app`. Dynamic routes list their samples. The
  filter box narrows it.
- **Centre**: the page in an iframe, so `h-svh`, `fixed` and `md:` breakpoints see the frame size.
  The top strip shows the URL (copy, open in a new tab), a dark/light toggle and a viewport menu
  (Full, then Chrome DevTools' responsive widths: 4K 2560, Laptop L 1440, Laptop 1024, Tablet 768,
  Mobile L 425, Mobile M 375, Mobile S 320; rotate, custom W×H). Fixed sizes are
  scaled down to fit and never above 100%.
- **Right**: the tweaks the current page declares, or "This page has no tweaks".

The selected page, tweak values and viewport live in the `/proto` URL, so any view is a link.
Only width and height are emulated: no touch events, user agent or device pixel ratio.

## Adding a page

Put it at the same path as web's route under `src/app/` (route groups included) and build the UI in
`src/features/<feature>/`, with mock data in `src/features/<feature>/fixtures/`.

For a dynamic route, add at least one sample to `src/proto/samples.ts`. The key is the route with
groups stripped:

```ts
'/threads/[threadId]': [{ label: 'Session', path: '/threads/thr-ui-rebase' }],
```

## Tweaks

A page declares its tweaks with `usePrototype`. Types are `select`, `boolean` and `range`; values
are read from the page URL (`?state=busy`), and a missing or invalid value falls back to the default.

```tsx
const { state, queued } = usePrototype({
  state: { type: 'select', label: 'State', options: ['busy', 'empty'], default: 'busy' },
  queued: { type: 'range', label: 'Queued', min: 0, max: 10, default: 3 },
  compact: { type: 'boolean', label: 'Compact', default: false },
})
```

## Mirror rules

`__tests__/mirror.spec.ts` enforces:

- Every `page.tsx` and `layout.tsx` under `apps/web/src/app` exists at the same path here. `api/`,
  `health/`, `route.ts` and `manifest.ts` are ignored, as is `src/app/proto/` (the chrome).
- Every folder under `apps/web/src/features` exists under `src/features`. Extras such as `shared`
  are fine.
- Every dynamic route has an entry in `PROTO_SAMPLES`, and each sample path matches its route.
- `apps/web` never imports the prototype, and the prototype never imports `apps/web`.

## `src/proto/`

The prototype kit: the chrome, `usePrototype`, and the samples. It must stay free of Atlas imports,
so it can be lifted out into its own package later by moving files.

The chrome deliberately does not look like Atlas. It uses its own vendored stock shadcn (base-nova,
neutral) in `src/proto/ui/`, themed by `src/proto/proto-chrome.css` under a `.proto-chrome` class
(`light` is added when the chrome's theme toggle is light). Only the iframed pages look like Atlas.
Portaled overlays read the class from `chrome-theme.tsx`; mono text uses `.proto-mono`.

`src/proto/` and `src/app/proto/` may import only `react`, `next`, `lucide-react`,
`@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge` and their own files. They
must not import `@dltech/atlas-ui` or `@/features`; `__tests__/chrome-imports.spec.ts` fails if
they do.
