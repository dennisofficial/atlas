'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { setSubscriptionStatus, subscribeTo, unsubscribeFrom } from '@dltech/atlas-client/channel'
import {
  ESubscriptionStatusWire,
  PULL_REQUEST_SUBSCRIPTION_PROVIDER,
  type SubscriptionReply,
  type SubscriptionWire,
} from '@dltech/atlas-wire/web'

import type { ServeChannel } from './live-thread-view'
import { watchSubscriptions } from './subscriptions-source'

export enum ESubscriptionsStatus {
  Loading = 'loading',
  Ready = 'ready',
  Unsupported = 'unsupported',
}

type Held =
  | { status: ESubscriptionsStatus.Loading | ESubscriptionsStatus.Unsupported }
  | { status: ESubscriptionsStatus.Ready; subscriptions: readonly SubscriptionWire[] }

const LOADING: Held = { status: ESubscriptionsStatus.Loading }
const NONE: readonly SubscriptionWire[] = []

export type SubscriptionsData = {
  status: ESubscriptionsStatus
  subscriptions: readonly SubscriptionWire[]
  busy: ReadonlySet<string>
  setPaused: (args: { subscriptionId: string; paused: boolean }) => void
  remove: (subscriptionId: string) => void
  subscribePullRequest: (input: string) => void
}

export function useSubscriptions(args: {
  threadId: string
  channel: ServeChannel | null
}): SubscriptionsData {
  const { threadId, channel } = args
  const [held, setHeld] = useState<Held>(LOADING)
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    if (channel === null) {
      setHeld(LOADING)
      return
    }
    return watchSubscriptions({
      channel,
      onSet: (set) =>
        setHeld({ status: ESubscriptionsStatus.Ready, subscriptions: set.subscriptions }),
      onUnsupported: () => setHeld({ status: ESubscriptionsStatus.Unsupported }),
    })
  }, [channel])

  const run = useCallback(
    (key: string, act: (live: ServeChannel) => Promise<SubscriptionReply>): void => {
      if (channel === null) return
      setBusy((current) => new Set(current).add(key))
      void act(channel)
        .then((reply) => {
          if (!reply.ok) toast.error(reply.error ?? 'The subscription change failed')
        })
        .finally(() =>
          setBusy((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          }),
        )
    },
    [channel],
  )

  const setPaused = useCallback(
    (change: { subscriptionId: string; paused: boolean }) =>
      run(change.subscriptionId, (live) =>
        setSubscriptionStatus({
          channel: live,
          subscriptionId: change.subscriptionId,
          status: change.paused ? ESubscriptionStatusWire.Paused : ESubscriptionStatusWire.Active,
        }),
      ),
    [run],
  )

  const remove = useCallback(
    (subscriptionId: string) =>
      run(subscriptionId, (live) => unsubscribeFrom({ channel: live, subscriptionId })),
    [run],
  )

  const subscribePullRequest = useCallback(
    (input: string) =>
      run(input, (live) =>
        subscribeTo({
          channel: live,
          threadId,
          provider: PULL_REQUEST_SUBSCRIPTION_PROVIDER,
          input,
        }),
      ),
    [run, threadId],
  )

  return {
    status: held.status,
    subscriptions: held.status === ESubscriptionsStatus.Ready ? held.subscriptions : NONE,
    busy,
    setPaused,
    remove,
    subscribePullRequest,
  }
}
