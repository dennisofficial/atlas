import { activeTabOf, type BrowserState } from './browser-model'

export const DEFAULT_LIVE_CAP = 8

export const liveKeyOf = (args: { threadId: string; tabId: string }): string =>
  `${args.threadId}:${args.tabId}`

type Candidate = { key: string; lastUsedAt: number }

export function liveTabIdsOf(args: {
  states: Record<string, BrowserState>
  visibleThreadId?: string
  cap?: number
}): Set<string> {
  const { states, visibleThreadId, cap = DEFAULT_LIVE_CAP } = args
  const live = new Set<string>()
  const visible = visibleThreadId === undefined ? undefined : states[visibleThreadId]
  const pinned = visible === undefined ? undefined : activeTabOf(visible)
  if (visibleThreadId !== undefined && pinned !== undefined) {
    live.add(liveKeyOf({ threadId: visibleThreadId, tabId: pinned.id }))
  }
  const candidates: Candidate[] = Object.entries(states).flatMap(([threadId, state]) =>
    state.tabs.map((tab) => ({
      key: liveKeyOf({ threadId, tabId: tab.id }),
      lastUsedAt: tab.lastUsedAt,
    })),
  )
  const recent = candidates.sort(
    (left, right) => right.lastUsedAt - left.lastUsedAt || left.key.localeCompare(right.key),
  )
  for (const { key } of recent) {
    if (live.size >= cap) break
    live.add(key)
  }
  return live
}
