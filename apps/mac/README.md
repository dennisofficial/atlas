# @dltech/atlas-mac

macOS client: the apps/web static export in an Electrobun window, served by a local Desktop Host on 127.0.0.1 that also proxies `/api/*` and `/v1/*` to the Atlas API (`ATLAS_API_ORIGIN`, default `https://api.byatlas.io`).

## Run on a Mac

1. Install Hutch: `curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh`
2. `bun install` at the repo root.
3. `cd apps/mac && bun run dev` (release bundle: `bun run build:app`) (builds the web export, copies it to `web-out/`, launches the app).

`bun run typecheck` and `bun run test` cover the host and run anywhere. `bun run typecheck:main` checks the Electrobun main process and needs the Hutch devkit.

## Sidebar vibrancy (disabled)

`src/main/vibrancy.ts` is not wired in. Electrobun runs `main-out/index.js` inside a Bun Worker, and AppKit aborts (SIGABRT) when `NSVisualEffectView` is created and added from a non-main thread; the signed build crashed ~1s after launch. The window is opaque and `window.atlasDesktop` is not set, so web paints its normal sidebar. Re-enable only with a main-thread dispatch (e.g. `dispatch_async_f` on the main queue) verified on a Mac.

## Startup log

`~/Library/Logs/Atlas/main.log` records startup, startup failures, uncaught exceptions and update errors with stacks.

## Build env

- `ATLAS_VERSION` (e.g. `1.42.0`) stamps the app version; default `0.1.0`. Pods pin serve to this version.
- `ATLAS_MAC_UNSIGNED=1` disables codesign and notarization.
- Icon: `icon.iconset/` generated from `apps/web/public/brand/atlas-icon.png`: the trimmed glyph (about 62% of the tile) on a cream rounded square with an 824/1024 body. The source is 512px, so the larger sizes are upscaled and slightly soft.

## Auto-update

`src/main/auto-update.ts` checks on launch and every 4h via Electrobun's `Updater` against `https://github.com/dennisofficial/atlas/releases/latest/download` (`<channel>-<os>-<arch>-update.json`, patches and `.tar.zst` artifacts must be uploaded as release assets). Downloads in the background, then prompts "Restart to update".

## Serve version pin

Pods boot serve at the app's own version (`Updater.getLocalInfo().version`). Only the `dev` channel falls back to "latest"; a release build with an empty version throws at startup. `ATLAS_SERVE_VERSION` overrides in any channel.
