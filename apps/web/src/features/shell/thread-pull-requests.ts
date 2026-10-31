import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'

import {
  pullRequestEntriesOf,
  pullRequestKeyOf,
  type PullRequestEntry,
} from '@/features/threads/data/pull-request-entries'

export function threadPullRequestsOf(args: {
  thread: WireThread
  teammates: readonly WireThread[]
  collapsed: boolean
  states: readonly PrStateWire[]
}): PullRequestEntry[] {
  const threads = args.collapsed ? [args.thread, ...args.teammates] : [args.thread]
  const byIdentity = new Map<string, PullRequestEntry>()
  for (const thread of threads) {
    for (const entry of pullRequestEntriesOf({ thread, states: args.states })) {
      if (!args.collapsed && entry.via !== undefined) continue
      const key = pullRequestKeyOf(entry)
      const previous = byIdentity.get(key)
      if (previous === undefined || (previous.via !== undefined && entry.via === undefined)) {
        byIdentity.set(key, entry)
      }
    }
  }
  return [...byIdentity.values()]
}

export function latestThreadPullRequestOf(
  entries: readonly PullRequestEntry[],
): PullRequestEntry | undefined {
  let latest = entries[0]
  if (latest === undefined) return undefined
  const repoKey = pullRequestKeyOf({ repo: latest.repo, number: 0 })
  for (const entry of entries) {
    if (pullRequestKeyOf({ repo: entry.repo, number: 0 }) !== repoKey) continue
    if (entry.number > latest.number) latest = entry
  }
  return latest
}
