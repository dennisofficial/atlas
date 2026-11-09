# The Mac browser pane

Design for ADR [0013](decisions/0013-host-owns-the-browser-pane.md). Not built yet.

## The contract

One browser view per window, owned by `apps/mac/src/main`. The web app never holds a native
object; it sends commands over the desktop host's guarded route family and listens for events.

Web → host, `POST /desktop/pane` (same `secret` guard as `/desktop/window`):

| command                                | body                                            | meaning                                     |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| `show`                                 | `{ url, rect: { x, y, width, height }, zoom? }` | create on first use, then show at `rect`    |
| `hide`                                 | `{}`                                            | take the view out of the window's hierarchy |
| `setRect`                              | `{ rect }`                                      | move/resize while shown                     |
| `navigate`                             | `{ url }`                                       | load a url (tab switch, typed address)      |
| `back` / `forward` / `reload` / `stop` | `{}`                                            | history and loading                         |
| `setObscured`                          | `{ obscured }`                                  | a popover or dialog covers the pane         |

Host → web, one dispatched event on the shell document:

```ts
window.dispatchEvent(new CustomEvent('atlas-pane:event', { detail: PaneEvent }))

type PaneEvent =
  | { kind: 'shown'; url: string }
  | { kind: 'navigated'; url: string; title: string }
  | { kind: 'loading'; loading: boolean }
  | { kind: 'crashed'; reason: string }
  | { kind: 'failed'; reason: string }
```

`navigated` carries the title because the host already runs in the page: a `WKUserScript` or the
CEF preload reports `document.title` on change, and the host folds it into the event. The web app's
existing reducer (`preview-browser/browser-model.ts`, `report-navigation.ts`) keeps working
unchanged — it is the tab strip, not the transport.

## Lifecycle, the part that matters

- **Create once.** The first `show` creates the view; every later `show` re-adds it. Nothing the
  web app does destroys it.
- **Hide means gone from the hierarchy**, not `toggleHidden`: a hidden view must not paint and must
  not hit-test. `show` re-adds, sets the frame, then orders it above the web view.
- **A shell document load does not touch the view.** `clearChildViews` and its document-request
  hook are deleted. After the reloaded document sends its first `show`, the same view is re-shown
  at the new rect. This is what removes the `Cmd+R` crash.
- **Creation failure is an event**, never a half-state: the host destroys the attempt and emits
  `{ kind: 'failed' }`. The app offers one explicit retry; there are no timers.
- **Window close or quit** is the only teardown path.
- `setRect` is coalesced to one call per animation frame on the web side.

## Tabs, history, everything around the view

`browser-model.ts` already models tabs as `{ history, index, url, title, viewport }`. That stays and
becomes the whole truth: a tab is a record, not a live document. Switching tabs sends `navigate`
(or `back`/`forward` to walk the tab's own history), and the tab strip keeps rendering from the
same reducer.

| feature                        | where it lives after the change                              |
| ------------------------------ | ------------------------------------------------------------ |
| titles                         | host, folded into `navigated`                                |
| overlays (popovers, dialogs)   | app sends `setObscured`; the host decides paint and hit-test |
| viewport presets               | app sends `setRect` from the preset box                      |
| new window / external links    | host, as today (`external-links`, `in-app-navigation`)       |
| downloads, `atlas://` callback | host, as today                                               |

## What is deleted

`apps/web/src/features/threads/panel/preview/native/` in full (`native-frame`, `native-frame-layer`,
`frame-driver`, `frame-ready`, `bind-webview`, `masks`, `clip`, `overlay-sync`, `placement`,
`native-controls`, `native-diagnostics`, `native-stats`, `webview-handle`, `title-preload`), plus
`apps/mac/src/main/clear-preview-views.ts` and `preview-views.ts`. The web iframe path
(`preview-frame-layer.tsx`, `use-frame-reports.ts`) stays for browser clients, so the pane still
works without the Mac.

## What is added

- `apps/mac/src/main/pane/pane-commands.ts` — parse and validate the command bodies (zod).
- `apps/mac/src/main/pane/pane-routes.ts` — the guarded route.
- `apps/mac/src/main/pane/pane-view.ts` — one view behind a small port:
  `create`, `show`, `hide`, `setRect`, `navigate`, `back`, `forward`, `reload`, `setObscured`,
  `destroy`, `on` (events). Everything testable against a fake.
- `apps/mac/src/main/pane/pane-engine.ts` — `IBrowserEngine`, one implementation per renderer.
- `apps/web/src/features/threads/panel/preview/desktop/pane-client.ts` — send commands, subscribe.
- `apps/web/src/features/threads/panel/preview/desktop/pane-slot.tsx` — a div that measures itself,
  sends `show`/`setRect`/`hide`, and tells the client when a dialog covers it.

## Engine: the one open decision

The pane is already a native view — `renderer="cef"`, and the `cef #2` in the on-screen diagnostics
is that view's host id. The iframe layer is the browser client's. So the question is not "native
versus iframe"; it is which native engine, behind the same port.
- **WKWebView** (electrobun's `native` renderer): Apple owns the view lifecycle, no upstream OOPIF
  flake, no ~300 MB CEF in the bundle, `WKUserScript` for titles. Older WebKit.
- **CEF**: Chromium rendering. Observed 2026-11-09: Google sign-in completes in CEF, so its
  compatibility edge is real and the embedded-browser argument against it does not hold. The cost is
  the ~300 MB bundle and CEF's own lifecycle flake, which is the seam this design has to survive.

WebAuthn is out either way: the embedded browser carries no macOS platform authenticator.

The seam is identical either way; only `pane-engine.ts` differs, so the port can ship first and the
engine chosen after a live comparison.

## Slices

1. Host pane module, routes and fake-engine specs. Nothing wired; no behaviour change.
2. Web pane client and slot, exercised against the web iframe path in tests.
3. Mac switches to the host view; tabs become records; titles, overlays, viewport, history and
   loading reach parity. Old per-tab layer deleted in the same PR it stops being used.
4. Engine decision: one implementation behind `IBrowserEngine`, plus the UA string if WKWebView.

## Tests

- `pane-commands`: malformed bodies rejected; `rect` bounds sane.
- `pane-view` on a fake engine: one create across many `show`s, hide removes from the hierarchy,
  `setRect` ordering, `navigate` per tab switch, creation failure emits `failed` and leaves no view,
  a document load destroys nothing.
- `pane-slot` in happy-dom: measures on mount, coalesces rect changes, hides on unmount.
- Mac rehearsal: the packaged app answers a pane command and reports `shown` with a stub engine.
- Live check on a Mac is the only proof of painting; note it in the PR that flips slice 3.
