# 0013. The Mac browser pane is one host-owned view per window

Proposed 2026-11-09. Deferred the same day — see Outcome.

## Context

The pane is a native browser view painted over the web app. Today the app creates one view per
tab, keeps it alive across tab and session switches, positions it from JS, hides it with
`toggleHidden`, and clips it with mask selectors; the host separately destroys every child view
whenever it serves a new document (`clearChildViews` on any document request).

That gives three parties ownership of one native object. The observed failures are all that seam:
- a view registered but never initialised — the element exists, CEF never created a browser, the
  pane stays blank, `loadURL` is dropped, and reload cannot revive it;
- a native view left in the window's hierarchy after the pane closes, swallowing clicks over the app;
- `Cmd+R` reloading the shell, which destroys every child view, including one with no browser
  behind it — the crash path;
- a rebuilt view painting black, and Back on it crashing, because it is half-made too.

Each one was patched, and each patch moved the failure rather than removing it. A watchdog that
rebuilds a silent view turned a white pane into a black one.

## Decision

The **Mac host owns exactly one browser view per window**, created on first use and kept for the
window's life. The web app owns no native objects: it sends commands and renders a plain element
where the host paints.

## Why

One owner makes every state above unreachable rather than handled. There is no per-tab view to
outlive a tab, no view to destroy on a document load, no rebuild path that can land half-made, and
click-through is one boolean instead of a mask and geometry dance. A failure to create the browser
is then an explicit, reported event, not a silent half-state.

## Cost

A background tab is no longer a live document: switching tabs navigates the single view, so a tab
you are not looking at does not keep running audio or sockets. For an agent's browser pane that is
the right trade, and it is what makes the rest tractable.

## Follows

`docs/mac-browser-pane.md` holds the contract, the lifecycle and the migration.

## Outcome

Every failure above was reproduced in Chromium (CEF) and none of them in Apple's web view: the pane
was switched to it on 2026-11-09 (`paneRendererOf` in `apps/mac/src/main/pane-renderer.ts`, Chromium
kept behind `ATLAS_PANE_RENDERER=cef`) and the reported symptoms stopped. The white pane, the black
rebuilt pane and the crash on Back were all states of a CEF view that never got a browser.

So the engine was the immediate cause and this decision is deferred, not taken. What still stands
from it: a hidden pane view must not remain in the window's hierarchy (it swallowed clicks), and a
shell document load must not destroy pane views (`clearChildViews` is still the teardown path that a
`Cmd+R` runs through). Both are cheap to fix on their own. The one-owner contract here is the design
to reach for if the seam bites again, rather than something to build while it does not.
