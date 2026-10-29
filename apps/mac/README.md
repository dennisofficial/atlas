# @dltech/atlas-mac

macOS client: the apps/web static export in an Electrobun window, served by a local Desktop Host on 127.0.0.1 that also proxies `/api/*` and `/v1/*` to the Atlas API (`ATLAS_API_ORIGIN`, default `https://api.byatlas.io`).

## Run on a Mac

1. Install Hutch: `curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh`
2. `bun install` at the repo root.
3. `cd apps/mac && bun run dev` (builds the web export, copies it to `web-out/`, launches the app).

`bun run typecheck` and `bun run test` cover the host and run anywhere. `bun run typecheck:main` checks the Electrobun main process and needs the Hutch devkit.

## Sidebar vibrancy (Mac-only check)

The main process adds an `NSVisualEffectView` (material sidebar, behind-window blending, follows window active state) beneath the webview via `src/main/vibrancy.ts`, makes the window `transparent`, and injects `window.atlasDesktop = { vibrancy: true }` before page scripts. Web makes the sidebar background transparent only when `window.atlasDesktop?.vibrancy === true`; every other region must paint an opaque background.

1. `cd apps/mac && bun run dev` on an Apple Silicon Mac.
2. In devtools (View menu, Toggle DevTools) run `window.atlasDesktop` — expect `{vibrancy: true}`.
3. The sidebar should show the desktop through a blur; drag the window over a bright wallpaper to confirm.
4. Click another app: the blur should desaturate (follows window active state).
5. Resize and enter full screen: the effect view must keep covering the window.
6. Main area, dialogs and menus stay opaque. If the whole window is see-through, web is not painting an opaque background outside the sidebar.
7. Intel Macs and failures fall back to an opaque window with no global set.

## Serve version pin

Pods boot serve at the app's own version (`Updater.getLocalInfo().version`). Only the `dev` channel falls back to "latest"; a release build with an empty version throws at startup. `ATLAS_SERVE_VERSION` overrides in any channel.
