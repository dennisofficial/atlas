'use client'

import type { WireThread } from '@dltech/atlas-wire/web'
import { ESubscriptionStatusWire } from '@dltech/atlas-wire/web'

import {
  pullRequestBellOf,
  pullRequestTargetOf,
  subscriptionForPullRequest,
  type PullRequestBell,
} from './subscription-model'
import type { ServeChannel } from './live-thread-view'
import { useSubscriptions } from './use-subscriptions'

export function usePullRequestBell(args: {
  threadId: string
  channel: ServeChannel | null
  thread: WireThread | undefined
}): { bell: PullRequestBell | undefined; handleToggle: () => void } {
  const { threadId, channel, thread } = args
  const data = useSubscriptions({ threadId, channel })
  const target = pullRequestTargetOf(thread)
  const bell = pullRequestBellOf({
    target,
    subscriptions: data.subscriptions,
    busy: data.busy,
  })

  const handleToggle = () => {
    if (target === undefined) return
    const existing = subscriptionForPullRequest({ subscriptions: data.subscriptions, target })
    if (existing?.status === ESubscriptionStatusWire.Active) data.remove(existing.id)
    else data.subscribePullRequest(target.input)
  }

  return { bell, handleToggle }
}
