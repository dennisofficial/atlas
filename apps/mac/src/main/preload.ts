// WKWebView sends a keydown the page leaves unhandled back up the AppKit responder chain, where
// NSWindow's cancelOperation: turns Escape into "exit full screen". Marking every Escape handled
// after the page's own listeners have run (window is the last bubble stop) keeps Escape for the app.
const CLAIM_ESCAPE =
  "window.addEventListener('keydown', (event) => { if (event.key === 'Escape') event.preventDefault() })"

export const DESKTOP_PRELOAD = [
  'window.atlasDesktop = Object.freeze({ vibrancy: false })',
  CLAIM_ESCAPE,
].join(';\n')
