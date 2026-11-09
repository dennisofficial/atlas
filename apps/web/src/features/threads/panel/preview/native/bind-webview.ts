import { titleOfHostMessage } from './title-preload'
import { ENativeEvent, type NativeEvent, type NativeWebview } from './webview-handle'

// 2.0.5 emits these three on the tag with the page URL as a plain string detail (only new-window-open and host-message are JSON-parsed).
// https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/core/main.zig#L1966
export function urlOfEvent(event: NativeEvent): string | null {
  return typeof event.detail === 'string' && event.detail !== '' ? event.detail : null
}

export function bindWebview(args: {
  webview: NativeWebview
  onNavigated: (url: string) => void
  onReady: () => void
  onTitle?: ((title: string) => void) | undefined
  onEvent?: ((event: ENativeEvent, url: string | undefined) => void) | undefined
}): () => void {
  const { webview, onNavigated, onReady, onTitle, onEvent } = args
  let bound = true

  const handleNavigated = (event: NativeEvent) => {
    const url = urlOfEvent(event)
    if (!bound) return
    onEvent?.(ENativeEvent.DidNavigate, url ?? undefined)
    if (url !== null) onNavigated(url)
  }

  const handleReady = (event: NativeEvent) => {
    const url = urlOfEvent(event)
    if (!bound) return
    onEvent?.(ENativeEvent.DomReady, url ?? undefined)
    if (url !== null) onNavigated(url)
    onReady()
  }

  const handleHostMessage = (event: NativeEvent) => {
    const title = titleOfHostMessage(event.detail)
    if (!bound || title === null) return
    onEvent?.(ENativeEvent.HostMessage, undefined)
    onTitle?.(title)
  }

  webview.on(ENativeEvent.DidNavigate, handleNavigated)
  webview.on(ENativeEvent.DidNavigateInPage, handleNavigated)
  webview.on(ENativeEvent.DomReady, handleReady)
  webview.on(ENativeEvent.HostMessage, handleHostMessage)
  return () => {
    bound = false
    webview.off(ENativeEvent.DidNavigate, handleNavigated)
    webview.off(ENativeEvent.DidNavigateInPage, handleNavigated)
    webview.off(ENativeEvent.DomReady, handleReady)
    webview.off(ENativeEvent.HostMessage, handleHostMessage)
  }
}
