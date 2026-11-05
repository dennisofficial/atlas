import {
  currentUrlOf,
  type BrowserState,
  type FrameLoad,
} from '../../data/preview-browser/browser-model'
import { liveKeyOf, liveTabIdsOf } from '../../data/preview-browser/live-tabs'
import { parseWebUrl } from '../../data/preview-browser/web-url'
import type { FrameRegistry } from './frame-registry'

export type FrameSpec = {
  key: string
  threadId: string
  tabId: string
  url: string
  load: FrameLoad
}

export function framesOf(args: {
  states: Record<string, BrowserState>
  registry: FrameRegistry
  cap?: number
}): FrameSpec[] {
  const { states, registry, cap } = args
  const loadable: Record<string, BrowserState> = {}
  const specs = new Map<string, FrameSpec>()
  for (const [threadId, state] of Object.entries(states)) {
    const tabs = state.tabs.filter((tab) => {
      const key = liveKeyOf({ threadId, tabId: tab.id })
      const url = currentUrlOf(tab)
      if (!registry.opened.has(key) || parseWebUrl(url) === null) return false
      specs.set(key, { key, threadId, tabId: tab.id, url, load: tab.load })
      return true
    })
    loadable[threadId] = { ...state, tabs }
  }
  const live = liveTabIdsOf({ states: loadable, visibleThreadId: registry.visible?.threadId, cap })
  const inKeyOrder = (left: FrameSpec, right: FrameSpec) => left.key.localeCompare(right.key)
  return [...specs.values()].filter((spec) => live.has(spec.key)).sort(inKeyOrder)
}
