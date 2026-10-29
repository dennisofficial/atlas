'use client'

import type { WireThread } from '@dltech/atlas-wire/web'

import { livePullRequestBadgeOf, pullRequestBadgeOf, type PullRequestBadge } from './header-model'
import type { PrStatesChannel } from './pr-states-source'
import { usePrStates } from './use-pr-states'

export function usePullRequestBadge(args: {
  channel: PrStatesChannel | null
  thread: WireThread | undefined
}): PullRequestBadge | undefined {
  const states = usePrStates(args.channel)
  return livePullRequestBadgeOf({ states, thread: args.thread }) ?? pullRequestBadgeOf(args.thread)
}
