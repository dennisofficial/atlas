'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'

import type { V2Event } from '@dltech/atlas-core'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'
import { useAccountLabel } from '@/features/threads/data/use-account-label'
import type { RunFailureCardProps } from '@/features/threads/transcript/run-failure-card'

import { sessionFailureCardOf, sessionAttentionOf } from './session-run-attention'
import { retrySessionNow } from './use-retry-session'

const noop = () => undefined

export function useSessionRunFailure(args: {
  sessionId: string
  events: readonly V2Event[]
  working: boolean
  onSwitchModel: () => void
}): { card: RunFailureCardProps | null; failedLabel: null } {
  const { sessionId, events, working, onSwitchModel } = args
  const router = useRouter()
  const accountLabelOf = useAccountLabel()

  const attention = useMemo(() => sessionAttentionOf({ events, working }), [events, working])

  const handleRetry = useCallback(() => {
    void retrySessionNow(sessionId)
  }, [sessionId])
  const handleFixCredential = useCallback(() => router.push(PROVIDERS_HREF), [router])

  const card = useMemo(
    () =>
      attention === null
        ? null
        : sessionFailureCardOf({
            attention,
            accountLabelOf,
            handlers: {
              retry: handleRetry,
              fixCredential: handleFixCredential,
              switchModel: onSwitchModel,
              openAgent: noop,
            },
          }),
    [attention, accountLabelOf, handleRetry, handleFixCredential, onSwitchModel],
  )

  return { card, failedLabel: null }
}
