'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'

import type { V2Event } from '@dltech/atlas-core'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'
import { useAccountLabel } from '@/features/threads/data/use-account-label'
import type { RepairCardProps } from '@/features/threads/transcript/repair-card'
import type { RunFailureCardProps } from '@/features/threads/transcript/run-failure-card'

import { sessionFailureCardOf, sessionAttentionOf } from './session-run-attention'
import { retrySessionNow } from './use-retry-session'

export type SessionRepair = {
  card: RepairCardProps | null
  canRepair: boolean
  accountKnown: boolean
  openPrimary: () => void
}

export function useSessionRunFailure(args: {
  sessionId: string
  events: readonly V2Event[]
  working: boolean
  openAgent: (agentId: string) => void
  onSwitchModel: () => void
  repair: SessionRepair
}): { card: RunFailureCardProps | null; repairCard: RepairCardProps | null; failedLabel: null } {
  const { sessionId, events, working, openAgent, onSwitchModel, repair } = args
  const router = useRouter()
  const accountLabelOf = useAccountLabel()

  const attention = useMemo(() => sessionAttentionOf({ events, working }), [events, working])

  const handleRetry = useCallback(() => {
    void retrySessionNow(sessionId)
  }, [sessionId])
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
            handlers: {
              retry: handleRetry,
              fixCredential: handleFixCredential,
              switchModel: onSwitchModel,
              openAgent,
            },
          }),
    [attention, accountLabelOf, handleRetry, handleFixCredential, onSwitchModel, openAgent],
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
