import type { LinkedPullRequest } from '@dltech/atlas-core'

import { linkKey } from './pull-target'

export type WatchedTarget = { repo: string; number: number }

export type WatchedPullRequest = LinkedPullRequest & { subscriptionOnly: boolean }

export const minimalLinkOf = (target: WatchedTarget): WatchedPullRequest => ({
  repo: target.repo,
  number: target.number,
  branch: '',
  url: `https://${target.repo}/pull/${target.number}`,
  subscriptionOnly: true,
})

export function reconcileWatched(args: {
  watched: Map<string, WatchedPullRequest>
  links: readonly LinkedPullRequest[]
  extra: readonly WatchedTarget[]
}): { gained: readonly WatchedPullRequest[]; dropped: readonly string[] } {
  const next = new Map<string, WatchedPullRequest>()
  for (const target of args.extra) next.set(linkKey(target), minimalLinkOf(target))
  for (const link of args.links) next.set(linkKey(link), { ...link, subscriptionOnly: false })

  const dropped: string[] = []
  for (const key of [...args.watched.keys()]) {
    if (next.has(key)) continue

    args.watched.delete(key)
    dropped.push(key)
  }

  const gained: WatchedPullRequest[] = []
  for (const [key, link] of next) {
    const held = args.watched.get(key)
    if (held !== undefined) {
      const upgraded = held.branch === '' && link.branch !== ''
      if (upgraded || held.subscriptionOnly !== link.subscriptionOnly) args.watched.set(key, link)
      continue
    }

    args.watched.set(key, link)
    gained.push(link)
  }
  return { gained, dropped }
}
