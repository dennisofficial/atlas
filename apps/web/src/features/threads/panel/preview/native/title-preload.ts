export const TITLE_MESSAGE_KIND = 'atlas-preview:title'

// CEF injects a custom preload as an inline <script> right after <head>, in the page's own world, so it can read document.title and reach the electrobun bridge.
// https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/native/macos/nativeWrapper.mm#L5667-L5687
export const TITLE_PRELOAD = `(() => {
  const send = window.__electrobunSendToHost
  if (typeof send !== 'function') return
  let last = ''
  const report = () => {
    const title = document.title
    if (title === '' || title === last) return
    last = title
    send({ kind: '${TITLE_MESSAGE_KIND}', title })
  }
  const watch = () => {
    if (document.head === null) return
    new MutationObserver(report).observe(document.head, { childList: true, subtree: true, characterData: true })
    report()
  }
  document.addEventListener('DOMContentLoaded', watch)
  window.addEventListener('load', report)
  window.addEventListener('pageshow', report)
  watch()
})()`

export function titleOfHostMessage(detail: unknown): string | null {
  if (typeof detail !== 'object' || detail === null) return null
  const { kind, title } = detail as { kind?: unknown; title?: unknown }
  if (kind !== TITLE_MESSAGE_KIND || typeof title !== 'string') return null
  return title
}
