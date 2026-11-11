# 0028. The Mac shell is Electron; electrobun is deleted

Accepted 2026-11-10. Supersedes [0014](0014-mac-shell-is-native.md).

## Context

0014 decided the Mac shell would be Swift with AppKit, replacing the electrobun window layer while
keeping `apps/mac/src/host` — the Atlas logic in TypeScript (pods, leases, auth, proxy, Next server
supervision, the `/desktop/*` routes) — exactly as it was.

A Swift shell was built under `apps/mac/swift` and driven against the real app. It did not hold up:
a stock `NSWindow` animated its traffic lights correctly but never performed close, zoom or
live-resize, so the window stopped behaving like a Mac window the moment it was not electrobun's.
CEF was initialised and immediately disabled, so the pane it was meant to host ran on WKWebView and
the C-compatible wrapper existed only as compile coverage.

An Electron shell (`apps/mac-electron` during the spike) reached parity first, including the browser
pane as a `WebContentsView` per target, the OTA web payload, the preview origin and the traffic-light
inset.

## Decision

The Mac shell is **Electron**, and it lives at **`apps/mac`**. Electrobun, hutch and the Swift shell
are deleted. `apps/mac/src/host` moves into the Electron app unchanged in behaviour, so the process
model 0014 relied on still holds: a Bun process runs the host and the Next server, and the shell is
the window around it.

The app is signed with the Developer ID identity and notarized in `mac-release`, and its DMG is
published as `macos-arm64-Atlas.dmg` — the filename the site's download button and the Mac updater
already read.

## Why

The shell is the part of the app that has to behave like a Mac app on every release, and Electron
delivers that behaviour without a second implementation of window management: close, zoom,
live-resize, full screen and the traffic lights are the framework's, not ours. The Swift shell spent
its effort re-creating them and never finished.

The browser pane — the reason 0014 wanted one z-order system — is a `WebContentsView` owned by the
shell, positioned by the contract the web app already speaks (`/desktop/pane`), so the pane and the
document are both native views in one window.

## Consequences

- `apps/mac/src/main/*`, `apps/mac/swift`, `electrobun.config.ts`, `hutch.config.ts` and the
  electrobun DMG scripts are deleted. `apps/mac/src/host/*`, the Next server supervision contract and
  every `/desktop/*` route survive unchanged, so the web UI does not change.
- One app, one asset: `releases/latest/download/macos-arm64-Atlas.dmg` serves the Electron build, and
  `mac-release` marks the release latest only after that file is attached.
- Sparkle is not adopted; electron-builder's notarization and the app's own OTA web payload cover
  updates.
- CI drops `mac-shell` and `mac-cef-build` (no Swift to build) and the `mac-electron` workflow; the
  unsigned rehearsal builds the Electron DMG on every PR whose change reaches `apps/mac`.
- The pane contract and its acceptance criteria stay in [0013](0013-host-owns-the-browser-pane.md) and
  `docs/mac-browser-pane.md`.
