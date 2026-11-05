import {
  activeTabOf,
  currentUrlOf,
  navigated,
  NEW_TAB_URL,
  openTab,
  updateTab,
  type BrowserState,
} from './browser-model'

export function openUrlIn(args: { state: BrowserState; url: string }): BrowserState {
  const { state, url } = args
  const active = activeTabOf(state)
  if (active === undefined || currentUrlOf(active) !== NEW_TAB_URL) {
    return openTab({ state, url })
  }
  return updateTab({ state, id: active.id, change: (tab) => navigated({ tab, url }) })
}
