import {
  decideNavigation,
  ENavigationTarget,
  navigationRulesFor,
  navigationUrlOf,
} from './external-links'

const DEDUPE_WINDOW_MS = 1000

export interface ILinkWebview {
  setNavigationRules: (rules: string[]) => void
  on: (name: 'will-navigate', handler: (event: unknown) => void) => void
  loadURL: (url: string) => void
}

export function routeExternalLinks({
  webview,
  onNewWindow,
  hostOrigin,
  openExternal,
  now = Date.now,
}: {
  webview: ILinkWebview
  onNewWindow: (handler: (event: unknown) => void) => void
  hostOrigin: string
  openExternal: (url: string) => void
  now?: () => number
}): void {
  let lastUrl = ''
  let lastAt = 0
  const open = (url: string) => {
    if (url === lastUrl && now() - lastAt < DEDUPE_WINDOW_MS) return
    lastUrl = url
    lastAt = now()
    openExternal(url)
  }
  webview.setNavigationRules(navigationRulesFor({ hostOrigin }))
  webview.on('will-navigate', (event) => {
    const url = navigationUrlOf(event)
    if (url && decideNavigation({ url, hostOrigin }) === ENavigationTarget.External) open(url)
  })
  onNewWindow((event) => {
    const url = navigationUrlOf(event)
    if (!url) return
    if (decideNavigation({ url, hostOrigin }) === ENavigationTarget.External) open(url)
    else webview.loadURL(url)
  })
}
