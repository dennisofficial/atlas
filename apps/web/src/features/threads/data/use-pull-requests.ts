'use client'

import { useCallback, useMemo, type RefCallback } from 'react'

import { ESubscriptionStatusWire, type WireThread } from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from './api-pr-states-source'
import type { ServeChannel } from './live-thread-view'
import { pullRequestListOf, type PullRequestRow } from './pull-request-rows'
import {
  pullRequestBellsOf,
  pullRequestTargetOfEntry,
  subscriptionForPullRequest,
  type PullRequestBell,
} from './subscription-model'
import { sessionCheckoutsOf, type CheckoutView } from './session-checkouts'
import { mergePrStates } from './pr-states-merge'
import { useApiPrStates } from './use-api-pr-states'
import { usePrStates } from './use-pr-states'
import { usePrObservationRef, usePrObservationRegistry } from './use-pr-observation'
import { useSubscriptions } from './use-subscriptions'

export type PullRequestsView = {
  rows: PullRequestRow[]
  bells: Record<string, PullRequestBell>
  handleToggle: (key: string) => void
  observationRef?: RefCallback<HTMLElement>
  checkouts: CheckoutView[]
  looseKeys: string[]
}

export function usePullRequests(args: {
  threadId: string
  channel: ServeChannel | null
  thread: WireThread | undefined
  family?: readonly WireThread[]
  subscribe?: ApiPrStatesSubscribe
}): PullRequestsView {
  const { threadId, channel, thread, family } = args
  const liveStates = usePrStates(channel)
  const { registry, observe } = usePrObservationRegistry()
  const cloud = thread !== undefined && thread.runner !== 'local'
  const observationRef = usePrObservationRef({
    registry,
    targets: cloud ? (thread.pullRequests ?? []).filter((entry) => entry.via === undefined) : [],
  })
  const apiStates = useApiPrStates({ observe, subscribe: args.subscribe, enabled: cloud })
  const states = useMemo(
    () => mergePrStates({ live: liveStates, api: apiStates }),
    [liveStates, apiStates],
  )
  const { subscriptions, busy, remove, subscribePullRequest } = useSubscriptions({
    threadId,
    channel,
  })
  const list = useMemo(() => pullRequestListOf({ thread, states }), [thread, states])
  const grouped = useMemo(
    () => sessionCheckoutsOf({ thread, family: family ?? [], entries: list.entries }),
    [thread, family, list],
  )
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

  return useMemo(
    () => ({ rows: list.rows, bells, handleToggle, observationRef, ...grouped }),
    [list, bells, handleToggle, observationRef, grouped],
  )
}
