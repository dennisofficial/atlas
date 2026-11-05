import {
  currentUrlOf,
  type BrowserState,
  type FrameLoad,
} from '../../data/preview-browser/browser-model'
import { liveKeyOf } from '../../data/preview-browser/live-tabs'
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
}): FrameSpec[] {
  const { states, registry } = args
  const specs: FrameSpec[] = []
  for (const [threadId, state] of Object.entries(states)) {
    for (const tab of state.tabs) {
      const key = liveKeyOf({ threadId, tabId: tab.id })
      const url = currentUrlOf(tab)
      if (!registry.opened.has(key) || parseWebUrl(url) === null) continue
      specs.push({ key, threadId, tabId: tab.id, url, load: tab.load })
    }
  }
  return specs.sort((left, right) => left.key.localeCompare(right.key))
}
