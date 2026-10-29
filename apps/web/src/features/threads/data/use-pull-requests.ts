'use client'

import { useMemo } from 'react'

import { ESubscriptionStatusWire, type WireThread } from '@dltech/atlas-wire/web'

import { livePullRequestBadgeOf, type PullRequestBadge } from './header-model'
import type { ServeChannel } from './live-thread-view'
import { pullRequestListOf, type PullRequestRow } from './pull-request-rows'
import {
  pullRequestBellsOf,
  pullRequestTargetOfEntry,
  subscriptionForPullRequest,
  type PullRequestBell,
} from './subscription-model'
import { usePrStates } from './use-pr-states'
import { useSubscriptions } from './use-subscriptions'

export type PullRequestsView = {
  badge: PullRequestBadge | undefined
  rows: PullRequestRow[]
  bells: Record<string, PullRequestBell>
  pinnedKey: string | undefined
  handleToggle: (key: string) => void
}

export function usePullRequests(args: {
  threadId: string
  channel: ServeChannel | null
  thread: WireThread | undefined
}): PullRequestsView {
  const { threadId, channel, thread } = args
  const states = usePrStates(channel)
  const data = useSubscriptions({ threadId, channel })
  const list = useMemo(() => pullRequestListOf({ thread, states }), [thread, states])
  const badge = livePullRequestBadgeOf({ states, thread })
  const bells = pullRequestBellsOf({
    entries: list.entries,
    subscriptions: data.subscriptions,
    busy: data.busy,
  })

  const handleToggle = (key: string) => {
    const index = list.rows.findIndex((row) => row.key === key)
    const entry = list.entries[index]
    if (entry === undefined) return
    const target = pullRequestTargetOfEntry(entry)
    const existing = subscriptionForPullRequest({ subscriptions: data.subscriptions, target })
    if (existing?.status === ESubscriptionStatusWire.Active) data.remove(existing.id)
    else data.subscribePullRequest(target.input)
  }

  return { badge, rows: list.rows, bells, pinnedKey: list.pinnedKey, handleToggle }
}
