import { ENativeEvent, type NativeEvent, type NativeWebview, type NavState } from './webview-handle'

// 2.0.5 emits these three on the tag with the page URL as a plain string detail (only new-window-open and host-message are JSON-parsed).
// https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/core/main.zig#L1966
export function urlOfEvent(event: NativeEvent): string | null {
  return typeof event.detail === 'string' && event.detail !== '' ? event.detail : null
}

export function bindWebview(args: {
  webview: NativeWebview
  onNavigated: (url: string) => void
  onNavState: (state: NavState) => void
  onReady: () => void
}): () => void {
  const { webview, onNavigated, onNavState, onReady } = args
  let bound = true

  const refreshNavState = () => {
    void Promise.all([webview.canGoBack(), webview.canGoForward()])
      .then(([canGoBack, canGoForward]) => {
        if (bound) onNavState({ canGoBack, canGoForward })
      })
      .catch(() => undefined)
  }

  const handleNavigated = (event: NativeEvent) => {
    const url = urlOfEvent(event)
    if (url !== null) onNavigated(url)
    refreshNavState()
  }

  const handleReady = (event: NativeEvent) => {
    const url = urlOfEvent(event)
    if (url !== null) onNavigated(url)
    onReady()
    refreshNavState()
  }

  webview.on(ENativeEvent.DidNavigate, handleNavigated)
  webview.on(ENativeEvent.DidNavigateInPage, handleNavigated)
  webview.on(ENativeEvent.DomReady, handleReady)
  return () => {
    bound = false
    webview.off(ENativeEvent.DidNavigate, handleNavigated)
    webview.off(ENativeEvent.DidNavigateInPage, handleNavigated)
    webview.off(ENativeEvent.DomReady, handleReady)
  }
}
