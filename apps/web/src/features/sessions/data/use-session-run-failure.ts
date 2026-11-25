'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'

import { ERunRemedy, type RecordEvent } from '@dltech/atlas-core'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'
import { attentionKeyOf } from '@/features/threads/data/run-attention-pending'
import { useAccountLabel } from '@/features/threads/data/use-account-label'
import { usePendingRemedy } from '@/features/threads/data/use-pending-remedy'
import type { RepairCardProps } from '@/features/threads/transcript/repair-card'
import type { RunFailureCardProps } from '@/features/threads/transcript/run-failure-card'

import { sessionFailureCardOf, sessionAttentionOf } from './session-run-attention'
import type { ModelSwitchRetry } from './use-model-switch-retry'
import { retrySessionNow } from './use-retry-session'

export type SessionRepair = {
  card: RepairCardProps | null
  canRepair: boolean
  accountKnown: boolean
  openPrimary: () => void
}

export function useSessionRunFailure(args: {
  sessionId: string
  events: readonly RecordEvent[]
  working: boolean
  openAgent: (agentId: string) => void
  onSwitchModel: () => void
  retryAfterModel: ModelSwitchRetry
  repair: SessionRepair
}): { card: RunFailureCardProps | null; repairCard: RepairCardProps | null; failedLabel: null } {
  const { sessionId, events, working, openAgent, onSwitchModel, retryAfterModel, repair } = args
  const router = useRouter()
  const accountLabelOf = useAccountLabel()

  const attention = useMemo(() => sessionAttentionOf({ events, working }), [events, working])

  const attentionKey =
    attention === null
      ? null
      : attentionKeyOf({ failureSeq: attention.failureSeq, runId: attention.runId })
  const { pending, begin, clear } = usePendingRemedy({ key: attentionKey, working })

  const handleRetry = useCallback(async () => {
    if (!begin(ERunRemedy.Retry)) return
    if (await retrySessionNow(sessionId)) return
    clear()
  }, [begin, clear, sessionId])
  const handleSwitchModel = useCallback(() => {
    retryAfterModel.arm(() => void handleRetry())
    onSwitchModel()
  }, [retryAfterModel, handleRetry, onSwitchModel])
  const handleOpenProviders = useCallback(() => {
    router.push(PROVIDERS_HREF)
  }, [router])
  const handleFixCredential = useCallback(() => {
    if (repair.canRepair) {
      repair.openPrimary()
      return
    }
    router.push(PROVIDERS_HREF)
  }, [repair, router])

  const card = useMemo(
    () =>
      attention === null
        ? null
        : sessionFailureCardOf({
            attention,
            accountLabelOf,
            pending,
            handlers: {
              retry: handleRetry,
              fixCredential: handleFixCredential,
              switchModel: handleSwitchModel,
              openAgent,
            },
          }),
    [
      attention,
      accountLabelOf,
      pending,
      handleRetry,
      handleFixCredential,
      handleSwitchModel,
      openAgent,
    ],
  )

  const repairCard = useMemo<RepairCardProps | null>(() => {
    if (repair.card === null) return null
    if (repair.canRepair || repair.accountKnown) return repair.card
    return {
      ...repair.card,
      actions: [
        ...repair.card.actions,
        {
          id: 'providers',
          label: 'Update key',
          primary: false,
          disabled: false,
          onSelect: handleOpenProviders,
        },
      ],
    }
  }, [repair.card, repair.canRepair, repair.accountKnown, handleOpenProviders])

  return {
    card: repairCard === null ? card : null,
    repairCard,
    failedLabel: null,
  }
}
