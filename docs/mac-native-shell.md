# The native Mac shell

Design for ADR [0014](decisions/0014-mac-shell-is-native.md). Not built yet. It supersedes the
pane's own rebuild ([0013](decisions/0013-host-owns-the-browser-pane.md)) by moving the seam into a
shell that cannot express it: the pane becomes a sibling view, not a layer over the document.

## What stays, what moves, what goes

| piece                                                               | today                                                                       | after                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/mac/src/host/*` (26 files: pods, leases, auth, proxy, routes) | Bun in the electrobun main process                                          | the same files in the same Bun process, spawned by the shell |
| Next standalone server                                              | spawned by `host/next-server.ts`                                            | unchanged, spawned by that same Bun process                  |
| web UI                                                              | a web view pointed at `http://127.0.0.1:<port>/desktop/session?secret=…`    | the same URL in `WKWebView`                                  |
| `apps/mac/src/main/*` (17 files)                                    | the shell                                                                   | **deleted**; Swift replaces each one                         |
| pane views                                                          | native child views composited over the document, masked and clipped from JS | a `WKWebView` in the right split pane, laid out by AppKit    |
| updates                                                             | electrobun `Updater` + `update.json`                                        | Sparkle + appcast                                            |
| bundle                                                              | electrobun + bundled Bun + CEF                                              | Swift app + bundled Bun (no CEF in the first cut)            |

## Process model

```
Atlas.app  (Swift)
├─ AtlasShell            NSApplication, main window, NSSplitView, menus, sheets, Sparkle, URL scheme
├─ Bun child             `Contents/MacOS/bun Contents/Resources/app/host.js`
│   ├─ /desktop/* routes     the desktop host the web UI already calls
│   └─ Next standalone       spawned on a stable loopback port, as today
├─ WKWebView  (left)     http://127.0.0.1:<stable-port>/desktop/session?secret=<random>
└─ WKWebView  (right)    the pane; hidden while the web UI reports an overlay open
```

- The shell generates the `secret`, passes it in the environment to the Bun child, and passes it in
  the URL it loads. A port of its choosing is written to the same stable-port file the current shell
  writes, so a second instance focuses the first instead of starting another server.
- The Bun child is supervised: started at launch, restarted twice with backoff, and a persistent
  failure shows the same "could not start" dialog the shell already has, naming
  `~/Library/Logs/Atlas/main.log`.
- Quit stops the child; the child stops Next. No orphaned servers.

## The Swift file map, one file per today's file

| today (`src/main/`)                                         | after (`Shell/Sources/`)                                  |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `index.ts`                                                  | `AtlasApp.swift`, `MainWindow.swift`, `SplitLayout.swift` |
| `menu.ts`                                                   | `Menus.swift`                                             |
| `crash-log.ts`                                              | `Log.swift`                                               |
| `deep-link.ts`, `external-links*.ts`                        | `DeepLinks.swift`, `Links.swift`                          |
| `in-app-navigation.ts`, `preload.ts`                        | `WebBridge.swift` (one message handler, allowlisted)      |
| `auto-update.ts`, `check-for-updates.ts`, `update-state.ts` | `Updates.swift` (Sparkle)                                 |
| `fullscreen.ts`, `titlebar-action.ts`, `vibrancy.ts`        | `WindowChrome.swift`                                      |
| `preview-views.ts`, `clear-preview-views.ts`                | deleted — the pane is a view in a split, nothing to clear |

## The pane contract

The web UI keeps one client and one slot; the transport is HTTP to the Bun child, exactly like every
other desktop route, so nothing new crosses into Swift for this. The child holds a `pane` port and
`POST /desktop/pane` forwards each command to the shell's own loopback listener at `POST /pane`,
which answers `{ ok }` or `{ ok: false, error }`. The shell needs no channel into the child, and the
command surface is testable from curl before any Swift view exists.

Web → shell, `POST /desktop/pane`:

`show({url, rect})`, `hide()`, `setRect({rect})`, `navigate({url})`, `back`, `forward`, `reload`,
`stop`, `setObscured({obscured})`.

Shell → web, one dispatched `CustomEvent` on the document:

`shown({url})`, `navigated({url, title})`, `loading({loading})`, `crashed({reason})`,
`failed({reason})`.

`setObscured(true)` hides the pane view; it is the only rule the overlay problem needs, and it is one
call from a single app-level counter, not a selector list. Because the pane is a split sibling, the
counter is a courtesy for dialogs that must cover it, not the thing that stops clicks landing on a
hidden view.

Renderer: `PaneEngine` protocol with `WKWebViewEngine` first. `ChromiumEngine` (a vendored CEF
`CefBrowserView` in an `NSView`) is a later, separate decision: it costs a CEF framework, helper
app bundles and separate signing, and it must not block the shell. The protocol exists so that
cost stays contained.

## Slices

Each one leaves the shipped app working, because electrobun stays until the last slice.
1. **Shell skeleton.** Swift app: window, `WKWebView`, spawn the Bun child, stable port, load the
   session URL, menus, deep links. Development runs beside `bun run dev` for the web UI. No pane.
2. **Split layout and pane.** `NSSplitView`, pane `WKWebView`, the contract above, native tab strip
   and address bar, overlay hide. Parity for back/forward/reload, viewport presets, downloads,
   external links, `atlas://` callback.
3. **Updates.** Sparkle, an appcast generated from the releases, the EdDSA key stored as a project
   secret, and the "update ready → restart" flow the web UI already calls.
4. **Cutover.** `build:app` builds the Swift app, `apps/mac/src/main/*` and electrobun are deleted,
   the DMG comes from the existing `make-dmg`, notarisation unchanged, `mac-app-rehearsal` builds and
   probes the packaged app.

## Risks, named

- **Sparkle signing and hosting.** A new key and an appcast feed; the DMG signing path we already have
  is untouched. If Sparkle stalls, the slice 3 fallback is a "download the new DMG" prompt, which is
  what the app does today when the updater cannot prepare a patch.
- **The dev loop.** Swift changes need a build; the web UI keeps `next dev`. The shell reloads the
  web view, so front-end iteration stays fast.
- **Cutover day.** Two shells exist until slice 4, and only one can own the bundle id. The cutover PR
  is the single irreversible step; everything before it ships in the old shell.
- **CEF later.** Not in these slices. If Chromium content is needed for cookie or site compatibility,
  it arrives as `ChromiumEngine` behind the protocol, and it is the biggest piece of work in the
  whole plan — which is why it is last and separate.

## Tests

- Swift: `XCTest` for `PaneCommands` parsing, `OverlayCounter`, `DeepLinks` route parsing, and the
  supervisor (start, restart twice, give up with the dialog). Views stay untested; the behaviours
  that decide things do not.
- TypeScript: `apps/mac/src/host/*` tests are untouched, and keep running in `bun test`.
- Web: `pane-slot` measures and posts, reduced to a client with a fake transport — no native objects
  in React any more.
- CI: `xcodebuild` on the mac runner builds the app; `mac-app-rehearsal` launches the packaged app,
  fetches a document and its RSC payload, and asserts the pane command round-trips with a stub
  engine.
- Live: a real Mac release is the only proof of painting; the PR that flips slice 4 says so.
