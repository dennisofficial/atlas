import { EViewportKind, type Viewport } from '@/proto/fit-viewport'

export const NEW_TAB_URL = 'atlas://new-tab'

export type BrowserTab = {
  id: string
  history: string[]
  index: number
  viewport: Viewport
  fields: Record<string, string>
  reloads: number
}

export type BrowserState = {
  tabs: BrowserTab[]
  activeId: string | undefined
  nextId: number
}

const FULL: Viewport = { kind: EViewportKind.Full }

const tabOf = (args: { id: number; history: string[] }): BrowserTab => ({
  id: `tab-${args.id}`,
  history: args.history,
  index: args.history.length - 1,
  viewport: FULL,
  fields: {},
  reloads: 0,
})

export function currentUrlOf(tab: BrowserTab): string {
  return tab.history[tab.index] ?? NEW_TAB_URL
}

export const canGoBack = (tab: BrowserTab): boolean => tab.index > 0

export const canGoForward = (tab: BrowserTab): boolean => tab.index < tab.history.length - 1

export function activeTabOf(state: BrowserState): BrowserTab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeId)
}

export function browserOf(args: { histories: string[][]; active?: number }): BrowserState {
  const tabs = args.histories.map((history, at) => tabOf({ id: at + 1, history }))
  return { tabs, activeId: tabs[args.active ?? 0]?.id, nextId: tabs.length + 1 }
}

export function openTab(args: { state: BrowserState; url?: string }): BrowserState {
  const { state, url = NEW_TAB_URL } = args
  const tab = tabOf({ id: state.nextId, history: [url] })
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

export const activateTab = (args: { state: BrowserState; id: string }): BrowserState => ({
  ...args.state,
  activeId: args.id,
})

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
  const history = [...tab.history.slice(0, tab.index + 1), url]
  return { ...tab, history, index: history.length - 1 }
}

export const steppedBack = (tab: BrowserTab): BrowserTab =>
  canGoBack(tab) ? { ...tab, index: tab.index - 1 } : tab

export const steppedForward = (tab: BrowserTab): BrowserTab =>
  canGoForward(tab) ? { ...tab, index: tab.index + 1 } : tab

export const fieldKey = (args: { url: string; name: string }): string => `${args.url}#${args.name}`

export function fieldOf(args: { tab: BrowserTab; name: string }): string {
  return args.tab.fields[fieldKey({ url: currentUrlOf(args.tab), name: args.name })] ?? ''
}

export function withField(args: { tab: BrowserTab; name: string; value: string }): BrowserTab {
  const { tab, name, value } = args
  const key = fieldKey({ url: currentUrlOf(tab), name })
  return { ...tab, fields: { ...tab.fields, [key]: value } }
}

export function reloaded(tab: BrowserTab): BrowserTab {
  const prefix = `${currentUrlOf(tab)}#`
  const kept = Object.entries(tab.fields).filter(([key]) => !key.startsWith(prefix))
  return { ...tab, fields: Object.fromEntries(kept), reloads: tab.reloads + 1 }
}

export const withViewport = (args: { tab: BrowserTab; viewport: Viewport }): BrowserTab => ({
  ...args.tab,
  viewport: args.viewport,
})
