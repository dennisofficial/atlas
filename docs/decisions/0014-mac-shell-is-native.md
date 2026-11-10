# 0014. The Mac shell is native; TypeScript stays behind it

Proposed 2026-11-09.

## Context

The Mac app is an electrobun shell whose main process is TypeScript. It creates the window, spawns
the Next server, hosts the desktop routes, and composites the browser pane as a native child view
over the app's web view. Mac is the only desktop platform: iOS is maintained separately.

Two z-order systems share the window, and every overlap has to be reconciled by hand — the modal
selector allowlist, the mask attribute, the clip strips, the frame loop that re-measures them. The
bugs that followed (an unclickable pane under a modal, a dead view left in the hierarchy, the reload
teardown) are that seam, not one framework's defect.

Only part of the current shell is shell. `apps/mac/src/main/*` (17 files) is window, menu, titlebar,
deep links, auto-update, external links and the pane views. `apps/mac/src/host/*` (26 files) is Atlas
logic in TypeScript — pods, leases, auth, proxy, routes — and it is served over HTTP to the web UI,
so it can keep running exactly as it does now.

## Decision

The Mac app shell is **Swift with AppKit**: the window, the split layout, the web views, the menus,
the sheets, Sparkle updates, the URL scheme and process supervision. A **Bun process still runs
today's `apps/mac/src/host`** and the Next server, unseen by the user.

The product UI and the pane are **sibling `WKWebView`s inside an `NSSplitView`**, so macOS lays them
out and orders them. Nothing is composited over the document.

The pane's renderer sits behind a `PaneEngine` protocol from the first slice, so a Chromium engine
can be added without touching the shell.

## Why

One z-order system is not a nicety on a browser pane — it is the difference between a design that
cannot produce the bug and a design that has to detect it. Mac-only means the cost of a
platform-specific shell buys nothing else, and iOS is already maintained apart.

## Consequences

- `apps/mac/src/main/*` is deleted at cutover. `apps/mac/src/host/*`, the Next server supervision
  contract and every `/desktop/*` route survive unchanged, so the web UI does not change at all.
- Electrobun stays until the Swift app reaches parity, because the app must keep working while it is
  replaced. No release ships in between that cannot open a window.
- Sparkle replaces electrobun's updater: an appcast, an EdDSA key, and the existing signed, notarised
  DMG.
- CI gains an `xcodebuild` job; the mac rehearsal keeps verifying that the packaged app answers a
  document and an RSC request.

## Follows

`docs/mac-native-shell.md` holds the process model, the Swift file map, the contract, the slices, the
risks and the tests.
