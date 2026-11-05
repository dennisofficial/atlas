import { EViewportKind, type Viewport } from '@dltech/atlas-ui/ai/preview-browser'

export { EViewportKind, type Viewport }

export const NEW_TAB_URL = 'atlas://new-tab'

export const MAX_HISTORY = 50

export type BrowserTab = {
  id: string
  history: string[]
  index: number
  viewport: Viewport
  lastUsedAt: number
}

export type BrowserState = {
  tabs: BrowserTab[]
  activeId: string | undefined
  nextId: number
}

const FULL_VIEWPORT: Viewport = { kind: EViewportKind.Full }

const tabOf = (args: { id: number; url: string; now: number }): BrowserTab => ({
  id: `tab-${args.id}`,
  history: [args.url],
  index: 0,
  viewport: FULL_VIEWPORT,
  lastUsedAt: args.now,
})

export const freshBrowser = (args: { now: number }): BrowserState =>
  openTab({
    state: { tabs: [], activeId: undefined, nextId: 1 },
    now: args.now,
  })

export function currentUrlOf(tab: BrowserTab): string {
  return tab.history[tab.index] ?? NEW_TAB_URL
}

export const canGoBack = (tab: BrowserTab): boolean => tab.index > 0

export const canGoForward = (tab: BrowserTab): boolean => tab.index < tab.history.length - 1

export function activeTabOf(state: BrowserState): BrowserTab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeId)
}

export function openTab(args: { state: BrowserState; url?: string; now: number }): BrowserState {
  const { state, url = NEW_TAB_URL, now } = args
  const tab = tabOf({ id: state.nextId, url, now })
  const at = state.tabs.findIndex((candidate) => candidate.id === state.activeId)
  const tabs = [...state.tabs]
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab)
  return { tabs, activeId: tab.id, nextId: state.nextId + 1 }
}

export function closeTab(args: { state: BrowserState; id: string }): BrowserState {
  const { state, id } = args
  const at = state.tabs.findIndex((tab) => tab.id === id)
  if (at < 0) return state
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  if (state.activeId !== id) return { ...state, tabs }
  return { ...state, tabs, activeId: (tabs[at] ?? tabs[at - 1])?.id }
}

export function activateTab(args: { state: BrowserState; id: string; now: number }): BrowserState {
  const { state, id, now } = args
  if (!state.tabs.some((tab) => tab.id === id)) return state
  const tabs = state.tabs.map((tab) => (tab.id === id ? { ...tab, lastUsedAt: now } : tab))
  return { ...state, tabs, activeId: id }
}

export function updateTab(args: {
  state: BrowserState
  id: string
  change: (tab: BrowserTab) => BrowserTab
}): BrowserState {
  const { state, id, change } = args
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) }
}

export function navigated(args: { tab: BrowserTab; url: string }): BrowserTab {
  const { tab, url } = args
  if (currentUrlOf(tab) === url) return tab
  const history = [...tab.history.slice(0, tab.index + 1), url].slice(-MAX_HISTORY)
  return { ...tab, history, index: history.length - 1 }
}

export const steppedBack = (tab: BrowserTab): BrowserTab =>
  canGoBack(tab) ? { ...tab, index: tab.index - 1 } : tab

export const steppedForward = (tab: BrowserTab): BrowserTab =>
  canGoForward(tab) ? { ...tab, index: tab.index + 1 } : tab

export const withViewport = (args: { tab: BrowserTab; viewport: Viewport }): BrowserTab => ({
  ...args.tab,
  viewport: args.viewport,
})

export const openPageCount = (state: BrowserState): number =>
  state.tabs.filter((tab) => currentUrlOf(tab) !== NEW_TAB_URL).length
