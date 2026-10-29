'use client'

import { useCallback, useMemo } from 'react'

import { ESubscriptionStatusWire, type WireThread } from '@dltech/atlas-wire/web'

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
  rows: PullRequestRow[]
  bells: Record<string, PullRequestBell>
  handleToggle: (key: string) => void
}

export function usePullRequests(args: {
  threadId: string
  channel: ServeChannel | null
  thread: WireThread | undefined
}): PullRequestsView {
  const { threadId, channel, thread } = args
  const states = usePrStates(channel)
  const { subscriptions, busy, remove, subscribePullRequest } = useSubscriptions({
    threadId,
    channel,
  })
  const list = useMemo(() => pullRequestListOf({ thread, states }), [thread, states])
  const bells = useMemo(
    () => pullRequestBellsOf({ entries: list.entries, subscriptions, busy }),
    [list, subscriptions, busy],
  )

  const handleToggle = useCallback(
    (key: string) => {
      const index = list.rows.findIndex((row) => row.key === key)
      const entry = list.entries[index]
      if (entry === undefined) return
      const target = pullRequestTargetOfEntry(entry)
      const existing = subscriptionForPullRequest({ subscriptions, target })
      if (existing?.status === ESubscriptionStatusWire.Active) remove(existing.id)
      else subscribePullRequest(target.input)
    },
    [list, subscriptions, remove, subscribePullRequest],
  )

  return useMemo(() => ({ rows: list.rows, bells, handleToggle }), [list, bells, handleToggle])
}
