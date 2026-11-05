import { currentUrlOf, type BrowserState } from '../../data/preview-browser/browser-model'
import { liveKeyOf, liveTabIdsOf } from '../../data/preview-browser/live-tabs'
import { parseWebUrl } from '../../data/preview-browser/web-url'
import type { FrameRegistry } from './frame-registry'

export type FrameSpec = { key: string; url: string }

export function framesOf(args: {
  states: Record<string, BrowserState>
  registry: FrameRegistry
  cap?: number
}): FrameSpec[] {
  const { states, registry, cap } = args
  const loadable: Record<string, BrowserState> = {}
  const urls = new Map<string, string>()
  for (const [threadId, state] of Object.entries(states)) {
    const tabs = state.tabs.filter((tab) => {
      const key = liveKeyOf({ threadId, tabId: tab.id })
      const url = currentUrlOf(tab)
      if (!registry.opened.has(key) || parseWebUrl(url) === null) return false
      urls.set(key, url)
      return true
    })
    loadable[threadId] = { ...state, tabs }
  }
  const live = liveTabIdsOf({ states: loadable, visibleThreadId: registry.visible?.threadId, cap })
  const inKeyOrder = (left: FrameSpec, right: FrameSpec) => left.key.localeCompare(right.key)
  return [...urls]
    .filter(([key]) => live.has(key))
    .map(([key, url]) => ({ key, url }))
    .sort(inKeyOrder)
}
