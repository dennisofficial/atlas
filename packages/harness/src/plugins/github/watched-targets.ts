import type { LinkedPullRequest } from '@dltech/atlas-core'

import { linkKey } from './pull-target'

export type WatchedTarget = { repo: string; number: number }

export const minimalLinkOf = (target: WatchedTarget): LinkedPullRequest => ({
  repo: target.repo,
  number: target.number,
  branch: '',
  url: `https://${target.repo}/pull/${target.number}`,
})

export function reconcileWatched(args: {
  watched: Map<string, LinkedPullRequest>
  links: readonly LinkedPullRequest[]
  extra: readonly WatchedTarget[]
}): { gained: readonly LinkedPullRequest[]; dropped: readonly string[] } {
  const next = new Map<string, LinkedPullRequest>()
  for (const target of args.extra) next.set(linkKey(target), minimalLinkOf(target))
  for (const link of args.links) next.set(linkKey(link), link)

  const dropped: string[] = []
  for (const key of [...args.watched.keys()]) {
    if (next.has(key)) continue

    args.watched.delete(key)
    dropped.push(key)
  }

  const gained: LinkedPullRequest[] = []
  for (const [key, link] of next) {
    const held = args.watched.get(key)
    if (held !== undefined) {
      if (held.branch === '' && link.branch !== '') args.watched.set(key, link)
      continue
    }

    args.watched.set(key, link)
    gained.push(link)
  }
  return { gained, dropped }
}
