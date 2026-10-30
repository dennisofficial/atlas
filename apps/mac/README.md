# @dltech/atlas-mac

macOS client: the apps/web static export in an Electrobun window, served by a local Desktop Host on 127.0.0.1 that also proxies `/api/*` and `/v1/*` to the Atlas API (`ATLAS_API_ORIGIN`, default `https://api.byatlas.io`). Sign-in is an RFC 8252 loopback redirect with PKCE: the host opens `${ATLAS_WEB_ORIGIN}/desktop/authorize` (default `https://byatlas.io`) in the system browser, which redirects back to `http://127.0.0.1:<port>/desktop/auth/callback`; the host exchanges the code at the API and stores the bearer.

## Run on a Mac

1. `bun install` at the repo root.
2. `cd apps/mac && bun run dev` (release bundle: `bun run build:app`) (builds the web export, copies it to `web-out/`, launches the app).

`bun run typecheck` and `bun run test` cover the host and run anywhere. `bun run typecheck:main` checks the Electrobun main process and needs the Hutch devkit.

Hutch is Electrobun 2.x's build tool: it downloads the pinned Electrobun core and Bun toolchain, bundles the main process, packages `Atlas.app`, signs, notarizes, and emits the `.dmg` and update files. There is nothing to install by hand. The `electrobun` devDependency (pinned to 2.0.5) downloads its paired Hutch (0.28.2) into `~/.hutch` on first use, and every script calls `electrobun …`, which forwards to `hutch electrobun …`.

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

## Branded DMG

`build:app` ends with `scripts/make-dmg.ts`, which rebuilds `artifacts/macos-arm64-Atlas.dmg` from `build/stable-macos-*/Atlas.app` with `create-dmg` (`brew install create-dmg`) using the background in `assets/dmg/` (`background.svg` is the source; `background.png` and `background@2x.png` are rendered from it with `bunx sharp-cli --density`). With the `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_APPLEAPIKEY`, `ELECTROBUN_APPLEAPIISSUER` and `ELECTROBUN_APPLEAPIKEYPATH` env it also signs, notarizes and staples the DMG; under `ATLAS_MAC_UNSIGNED=1` it leaves it unsigned. macOS only.
