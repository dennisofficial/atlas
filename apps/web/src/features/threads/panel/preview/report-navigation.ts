import {
  reconciled,
  titled,
  updateTab,
  type BrowserState,
} from '../../data/preview-browser/browser-model'
import { parseWebUrl } from '../../data/preview-browser/web-url'

export function reportedTitle(args: {
  state: BrowserState
  tabId: string
  title: string
}): BrowserState {
  const { state, tabId, title } = args
  const tab = state.tabs.find((held) => held.id === tabId)
  if (tab === undefined) return state
  const next = titled({ tab, title })
  return next === tab ? state : updateTab({ state, id: tabId, change: () => next })
}

export function reportedState(args: {
  state: BrowserState
  tabId: string
  url: string
  title: string
}): BrowserState {
  const { state, tabId, url, title } = args
  if (parseWebUrl(url) === null) return state
  const tab = state.tabs.find((held) => held.id === tabId)
  if (tab === undefined) return state
  const next = titled({ tab: reconciled({ tab, url }), title })
  return next === tab ? state : updateTab({ state, id: tabId, change: () => next })
}
