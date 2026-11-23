import { useCallback, useMemo, useState } from 'react'

import type { SessionViewOutput } from '@dltech/atlas-protocol'

import { messageOf } from './app-next-support'
import type { PullRequestEntry } from './pull-request'
import type { SessionApi } from './session-api'
import { bellCommandOf, subscriptionTo } from './subscription-rows'

export type SubscriptionControl = {
  subscriptions: SessionViewOutput['subscriptions']
  handleBell: (entry: PullRequestEntry) => void
  handleRemove: (subscription: { id: string }) => void
  busy: boolean
}

export function useSubscriptions(args: {
  api: SessionApi
  sessionId: string
  subscriptions: SessionViewOutput['subscriptions']
  entries: readonly PullRequestEntry[]
  onProblem: (reason: string) => void
}): SubscriptionControl {
  const { api, sessionId, subscriptions, onProblem } = args
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }, [])

  const handleBell = useCallback(
    (entry: PullRequestEntry) => {
      const subscription = subscriptionTo({
        subscriptions,
        repo: entry.repo,
        number: entry.number,
      })
      const command = bellCommandOf({ entry, subscription })
      void run(async () => {
        try {
          if (command.name === 'subscribe') {
            await api.subscribe({
              sessionId,
              provider: command.provider,
              target: command.target,
            })
            return
          }
          await api.unsubscribe({ sessionId, subscriptionId: command.subscriptionId })
        } catch (failure) {
          onProblem(`could not ${command.name} — ${messageOf(failure)}`)
        }
      })
    },
    [api, onProblem, run, sessionId, subscriptions],
  )

  const handleRemove = useCallback(
    (subscription: { id: string }) => {
      void run(async () => {
        try {
          await api.unsubscribe({ sessionId, subscriptionId: subscription.id })
        } catch (failure) {
          onProblem(`could not unsubscribe — ${messageOf(failure)}`)
        }
      })
    },
    [api, onProblem, run, sessionId],
  )

  return useMemo(
    () => ({ subscriptions, handleBell, handleRemove, busy }),
    [busy, handleBell, handleRemove, subscriptions],
  )
}
