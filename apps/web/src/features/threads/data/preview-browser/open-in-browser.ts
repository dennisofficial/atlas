import {
  activateTab,
  activeTabOf,
  currentUrlOf,
  navigated,
  NEW_TAB_URL,
  openTab,
  updateTab,
  type BrowserState,
} from './browser-model'

export function openUrlIn(args: { state: BrowserState; url: string; now: number }): BrowserState {
  const { state, url, now } = args
  const active = activeTabOf(state)
  if (active === undefined || currentUrlOf(active) !== NEW_TAB_URL) {
    return openTab({ state, url, now })
  }
  const touched = activateTab({ state, id: active.id, now })
  return updateTab({ state: touched, id: active.id, change: (tab) => navigated({ tab, url }) })
}
