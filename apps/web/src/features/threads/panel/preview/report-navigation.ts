import { reconciled, updateTab, type BrowserState } from '../../data/preview-browser/browser-model'
import { parseWebUrl } from '../../data/preview-browser/web-url'

export function reportedState(args: {
  state: BrowserState
  tabId: string
  url: string
}): BrowserState {
  const { state, tabId, url } = args
  if (parseWebUrl(url) === null) return state
  const tab = state.tabs.find((held) => held.id === tabId)
  if (tab === undefined || reconciled({ tab, url }) === tab) return state
  return updateTab({ state, id: tabId, change: (held) => reconciled({ tab: held, url }) })
}
