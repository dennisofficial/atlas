# @dltech/atlas-mac

macOS client: the apps/web Next build (`output: 'standalone'`) run as a local server on 127.0.0.1 inside the app, fronted by a Desktop Host that proxies `/api/*` and `/v1/*` to the Atlas API (`ATLAS_API_ORIGIN`, default `https://api.byatlas.io`) and everything else to the app server. The app server runs on the app's own Bun runtime, so the packaged app ships no Node. Sign-in is an RFC 8252 loopback redirect with PKCE: the host opens `${ATLAS_WEB_ORIGIN}/desktop/authorize` (default `https://byatlas.io`) in the system browser, which redirects back to `http://127.0.0.1:<port>/desktop/auth/callback`; the host exchanges the code at the API and stores the bearer.

## Run on a Mac

1. `bun install` at the repo root.
2. `cd apps/mac && bun run dev` (release bundle: `bun run build:app`) (builds the web app's standalone server into `web-standalone/`, launches the app).

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

## Chromium in the browser pane

The app ships Chromium (`build.mac.bundleCEF` in `electrobun.config.ts`, plus the JIT and executable-memory
entitlements a hardened-runtime Chromium needs) for the right-hand **Browser** pane, while the window and
every other view stay on WKWebView: only the pane's `<electrobun-webview>` is created with `renderer="cef"`.
`BuildConfig.getSync().availableRenderers` decides at launch whether the build can paint Chromium, and that
answer travels to the page as `chromium` on `/desktop/version`; a dev build without CEF reports false and the
pane falls back to WKWebView. The pane keeps one persistent profile (`persist:atlas-browser` under Chromium),
so a site login survives restarts and every session.

Electrobun's CEF artifact is roughly 150 MB compressed and several hundred MB installed. The first release
that carries it is therefore a full download — there is nothing to delta against — and releases after it
patch as usual, because the pinned Chromium is byte-identical between them.

## Updates

Two paths, so a change to the interface never waits on a signed app build.

**App updates** — `src/main/auto-update.ts` checks on launch and every 5 minutes via Electrobun's `Updater` against `https://github.com/dennisofficial/atlas/releases/latest/download` (`<channel>-<os>-<arch>-update.json`, patches and `.tar.zst` artifacts must be uploaded as release assets). Downloads in the background, then prompts "Restart to update". **Atlas → Check for Updates…** runs the same check immediately and offers to restart when an update is ready. This path covers the shell: `src/main`, `src/host`, `electrobun.config.ts`.

**Web payload updates** — the interface (`apps/web`, copied in at `app/web`) also ships on its own. `.github/workflows/web-ota.yml` builds it on every push to `main` on ubuntu with no signing, notarization, CEF or DMG, and uploads `web-update.json` and `web-<hash>.tar.gz` to the `web-ota` release tag. `src/host/web-payload/` reads that manifest on launch and every five minutes, checks the size and sha256, unpacks the payload into `~/Library/Application Support/Atlas/web/<hash>` and keeps the current and previous ones. On launch the app runs the newest complete payload and starts the bundled copy if it will not answer; a payload that fails is recorded as `failed` and never selected again. **Check for Updates…** installs one and reloads the window — no app restart.
- A payload declares `requiresShell`, read from `src/host/contract.ts`. Raise `DESKTOP_CONTRACT` whenever a `/desktop/*` route changes shape, so an installed app never runs an interface that speaks a newer contract; the app then updates itself instead.
- An installed payload is pinned to the app version that installed it (`state.json`'s `appVersion`). After an app update the shell runs its own bundled interface and installs the payload published for that commit, so a native update is never served an interface older than the one it shipped with.
- A merge that changes only the interface cuts no app build. `apps/tui/scripts/release-version.ts` reports whether a change reached `apps/mac` or a package it depends on, and `mac-release` runs only for those, so `releases/latest` — the URL the app updater reads — advances only when a new app was built. The release itself is still cut for the TUI and serve binaries, so an API change still gets the `serve` it needs.
- `ATLAS_WEB_PAYLOAD_URL` points the check at another manifest, and `ATLAS_WEB_ROOT` runs the window against an arbitrary build directory (`web-standalone/apps/web` after `bun run build:web`).
- `bun run pack:web-payload` writes a manifest and tarball into `artifacts/` from the local `web-standalone`.
- Install and apply failures land in `~/Library/Logs/Atlas/main.log` as `web-payload` and `web-payload-restart`.

## Serve version pin

Pods boot serve at the app's own version (`Updater.getLocalInfo().version`). Only the `dev` channel falls back to "latest"; a release build with an empty version throws at startup. `ATLAS_SERVE_VERSION` overrides in any channel.

## Branded DMG

Electrobun's own DMG is off (`createDmg: false`); `build:app` ends with `scripts/make-dmg.ts`, which builds `artifacts/macos-arm64-Atlas-<version>.dmg` (when `ATLAS_VERSION` is set, as the release job does) and copies it to the stable `artifacts/macos-arm64-Atlas.dmg` that the app's download button links to, from `build/stable-macos-*/Atlas.app` with `create-dmg` (`brew install create-dmg`) using the background in `assets/dmg/` (`background.svg` is the source; `background.png` and `background@2x.png` are rendered from it with `bunx sharp-cli --density`). With the `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_APPLEAPIKEY`, `ELECTROBUN_APPLEAPIISSUER` and `ELECTROBUN_APPLEAPIKEYPATH` env it also signs, notarizes and staples the DMG; under `ATLAS_MAC_UNSIGNED=1` it leaves it unsigned. macOS only.


## The Swift shell (slice 1)

`swift/` holds the native shell that replaces electrobun at cutover: window, web view, menus and the
supervision of the Bun desktop host. It is additive until then — `bun run build:app` still ships the
electrobun app. `src/desktop-host/index.ts` is the entry the shell spawns: it starts the Next server,
creates the desktop host and prints `ATLAS_URL=…` for the shell to load. Design:
`docs/mac-native-shell.md`.
