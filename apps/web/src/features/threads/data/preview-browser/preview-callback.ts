import { activeTabOf, currentUrlOf, openTab, type BrowserState } from './browser-model'
import { parseWebUrl } from './web-url'

export function openPreviewCallback(args: {
  state: BrowserState
  tabId: string
  path: string
}): BrowserState {
  const { state, tabId, path } = args
  const tab = state.tabs.find((candidate) => candidate.id === tabId) ?? activeTabOf(state)
  const origin = tab === undefined ? undefined : parseWebUrl(currentUrlOf(tab))?.origin
  if (origin === undefined) return state
  return openTab({ state, url: `${origin}${path}` })
}
