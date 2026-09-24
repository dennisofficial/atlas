# packages/ui — the design system

The component library for Atlas's web surfaces. **Atoms and stable molecules live here; views
are pages in each app.** This file is the consumption and authoring contract. The repo
`CLAUDE.md` has the repo-wide philosophy; read it first.

## What this package is

Two distinct tiers, one taxonomy:

- **The design system** (`src/atoms/`) — buttons, inputs, dialogs, tables. Pure primitives:
  platform-agnostic, app-agnostic, know nothing about Atlas.
- **Agent composites** (`src/molecules/`) — `chat-bubble`, `tool-call-card`, `approval-prompt`,
  `diff-viewer`, `model-picker`, `command-palette`. These *do* encode Atlas's domain (a tool
  call, an approval gate, a diff). They are still **stable, exported, first-class API** — the
  TUI, the future web session view, and the cloud console all consume them. They are not
  prototypes.

`src/views/` is the exception: Storybook-only compositions, never exported (see "Workshop" below).

## Commands

- `bun run --filter @dltech/atlas-ui storybook` — component workshop
- `bun run --filter @dltech/atlas-ui test` — `bun test`, colocated `*.spec.tsx`
- `bun run --filter @dltech/atlas-ui typecheck`
- `bun run --filter @dltech/atlas-ui build-storybook` — static build smoke check

## Consuming the system (rules for apps)

- **Atoms come from `@dltech/atlas-ui` only.** When an atom exists here, do not hand-roll one in
  an app and do not add a second component library. Missing atom? Add it here, not in the app.
- **Molecules in `src/molecules/` are exported and consumed directly** (`@dltech/atlas-ui/chat-bubble`).
  App-specific compositions — a factory settings card, a work-items table bound to a Prisma
  model — do **not** belong in this package. Those live in the app (e.g.
  `apps/web/src/app/factory/*-card.tsx`), because they know about a feature name or a data model.
  The rule: if it imports a Prisma type, a route, or a feature flag, it's the app's, not ours.
- **Views are pages.** Routes own layout and data; they compose molecules and atoms.
- **Tokens only.** Never a raw hex, never an arbitrary value (`h-[28px]`) in app screens. Use the
  semantic utilities this package exposes (`bg-primary`, `text-meta`, `text-hint`,
  `border-border`, `bg-card`, …). The raw `warm-*`/`clay-*` scale is for this package's internals.
- **Styles**: import the package's stylesheets once in the app's global CSS —
  `@import '@dltech/atlas-ui/theme.css'; @import '@dltech/atlas-ui/base.css';` — then point
  Tailwind's `@source` at this package's `src/` so component classes are generated. The package
  ships source (no build step); apps consume it via `transpilePackages` (wired in `apps/web`).
- **`@dltech/atlas-ui/cn`** is exported for app-level composition — conditional class merging on
  plain layout wrappers. It is never an excuse to pass a raw class string that a variant prop
  should carry.

## Authoring atoms (rules for this package)

- One file per component, kebab-case, in `src/atoms/` or `src/molecules/`, with a colocated
  `*.stories.tsx`. A component isn't done without its story. Behavioral components (anything with
  state, focus, or interaction) also carry a colocated `*.spec.tsx`.
- Variants via **CVA**; merge classes with `cn()` (`src/lib/cn.ts`). `className` is permitted
  _inside_ this package only, merged through `cn()`.
- **Interactive components start with `"use client"`** — apps/web renders them from Server
  Components, and without the directive they're treated as server code and their hooks never run.
  (Spinner, ToolCallCard, ApprovalPrompt, and the overlay atoms all need this.)
- Overlay/behavioral primitives come from **Base UI** (`@base-ui/react`) — Dialog, Popover,
  Tooltip, Tabs, Switch, etc. Hand-roll focus traps or portal logic never; that's the one thing we
  deliberately don't own. See "Decisions" below for the Radix→Base UI migration.
- **No build step, on purpose.** `exports` points at `src/`. A past class of bugs in this codebase
  family (stripped `.d.ts`, dropped `"use client"` directives) came from dist-building component
  libraries; don't reintroduce one.
- New visual values go through `src/tokens/` → `buildThemeCss()` → generated `src/styles/theme.css`
  → consumed as utilities. Never edit `theme.css` by hand; it's generated. The pure-TS token layer
  is the platform-portable contract (a future Expo app consumes `src/tokens/`, not the CSS).

## The workshop area: `src/views/`

`src/views/` holds **Storybook-only prototypes** — static full-page compositions with fixture
data, one `*.stories.tsx` each under the `Views/` title prefix. They exist so a full screen can be
designed and reviewed against the real atom set before a route exists to house it.

- They are **never exported** and **never imported by an app**. The runtime surface stays
  atoms + stable molecules.
- A view here is a draft. When a real route lands, the view's layout moves into that app's page
  and the prototype is deleted — don't let both live side by side.
- The same styling rules apply (tokens only; class merging only via internal `cn()`).

## Decisions specific to this package

- **Two-tier taxonomy, not three.** rs-crm-app (the discipline model for this package) uses
  atoms/molecules-in-app/views. We diverge on molecules: theirs are app-local because a CRM's
  composites are feature-specific; ours are exported because Atlas's agent composites are the
  product's shared language across every surface. Everything else — the token discipline, the
  no-build-step rule, the workshop `views/` — follows their model.
- **Base UI, not Radix** — following rs-crm-app's 2026 greenfield call: Radix Primitives is
  maintenance-mode and its authors moved to Base UI. Don't mix primitive libraries. `Toast` is a
  deliberate exception (a plain prop-driven atom; the queue is app-layer policy, not a primitive).
- **`lucide-react`** for icons. rs-crm-app uses `react-icons/lu`; we already standardize on
  `lucide-react` here. One icon convention, don't add a second.
- **Tokens are generated TS, not hand-authored CSS.** This is the inverse of rs-crm-app
  (`tokens.css` by hand → `@theme inline` bridge). Ours lives in `src/tokens/` as pure TS so the
  same values drive both the web CSS and any future native app. The generator is
  `tools/generate-css.ts`; run it after touching tokens.
- **Web-first, native-ready.** The atoms are honest web components (Tailwind v4). The token layer
  is deliberately platform-neutral so a future Expo app consumes `@dltech/atlas-ui/tokens`. That
  portability is why tokens are TS — don't collapse them into CSS-only.
