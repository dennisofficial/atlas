'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  EAuthKind,
  ERepairAction,
  credentialRepairOf,
  providerLabelOf,
  repairActionsOf,
  toThreadId,
  type CredentialRepair,
  type V2Event,
} from '@dltech/atlas-core'
import type {
  RunAttentionAction,
  RunAttentionStripProps,
} from '@dltech/atlas-ui/ai/run-attention-strip'
import type { EOauthProvider } from '@dltech/atlas-wire/web'

import {
  activateAccount,
  createApiKeyAccount,
  fetchAccounts,
  replaceApiKey,
} from '@/features/settings/data/personal/accounts-api'
import { messageOf } from '@/features/threads/data/use-send'
import type { RepairCardProps } from '@/features/threads/transcript/repair-card'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import {
  accountKindOf,
  oauthProviderOf,
  otherAccountsOf,
  providerIdOf,
  repairActionSpecsOf,
  repairCardViewOf,
  retryTargetsOf,
  type RepairActionSpec,
} from './credential-repair-view'
import { retrySession } from './retry-session'
import { sessionsApi } from './sessions-api'

export enum ERepairDialog {
  SignIn = 'sign-in',
  Key = 'key',
}

const RETRY_ACTION: RunAttentionAction = {
  id: 'retry',
  label: 'Retry',
  primary: false,
  disabled: false,
  onSelect: () => undefined,
}

export type CredentialRepairControl = {
  repair: CredentialRepair | null
  card: RepairCardProps | null
  strip: RunAttentionStripProps | null
  canRepair: boolean
  accountKnown: boolean
  openPrimary: () => void
  handleModelSelected: () => void
  dialogs: {
    signIn: {
      open: boolean
      provider: EOauthProvider | null
      onOpenChange: (open: boolean) => void
      onRepaired: () => void
    }
    key: {
      open: boolean
      failing: boolean
      providerLabel: string | undefined
      onOpenChange: (open: boolean) => void
      onSubmit: (apiKey: string) => void
    }
  }
}

export function useCredentialRepair(args: {
  sessionId: string
  mainThreadId: string | undefined
  events: readonly V2Event[]
  onSwitchModel: () => void
}): CredentialRepairControl {
  const { sessionId, mainThreadId, events, onSwitchModel } = args
  const [dialog, setDialog] = useState<ERepairDialog | null>(null)
  const [failing, setFailing] = useState(false)
  const switchPending = useRef(false)
  const accounts = useCloudQuery({ key: 'failure-accounts', load: fetchAccounts })
  const { reload } = accounts
  const list = accounts.state === EQueryState.Ready ? accounts.data : undefined

  const repair = useMemo(
    () =>
      mainThreadId === undefined
        ? null
        : credentialRepairOf({ mainThreadId: toThreadId(mainThreadId), events }),
    [mainThreadId, events],
  )
  const account = useMemo(() => {
    if (repair === null || list === undefined) return undefined
    return list.find((candidate) => candidate.id === repair.accountId)
  }, [list, repair])
  const accountKind = account === undefined ? null : accountKindOf(account.kind)
  const others = useMemo(
    () =>
      repair === null
        ? []
        : otherAccountsOf({
            accounts: list ?? [],
            providerId: repair.providerId,
            accountId: repair.accountId,
          }),
    [list, repair],
  )
  const specs = useMemo(() => {
    if (repair === null) return []
    return repairActionSpecsOf({
      actions: repairActionsOf({
        repair,
        accountKind,
        otherAccountsOfProvider: others.length,
      }),
      otherAccounts: others,
    })
  }, [repair, accountKind, others])

  const retryAfterRepair = useCallback(async () => {
    if (repair === null) return
    for (const target of retryTargetsOf({ repair, sessionId })) {
      await retrySession({
        api: sessionsApi,
        sessionId,
        ...(target.agentId === undefined ? {} : { agentId: target.agentId }),
        notify: (message) => toast.error(message),
      })
    }
  }, [repair, sessionId])

  const runMutation = useCallback(
    async (mutate: () => Promise<void>) => {
      setFailing(true)
      try {
        await mutate()
      } catch (error) {
        toast.error(messageOf(error))
        setFailing(false)
        return
      }
      setFailing(false)
      setDialog(null)
      reload()
      await retryAfterRepair()
    },
    [reload, retryAfterRepair],
  )

  const selectAction = useCallback(
    (spec: RepairActionSpec) => {
      switch (spec.action) {
        case ERepairAction.ReSignIn:
          setDialog(ERepairDialog.SignIn)
          return
        case ERepairAction.ReplaceKey:
          setDialog(ERepairDialog.Key)
          return
        case ERepairAction.SwapAccount: {
          const provider = providerIdOf(repair?.providerId ?? null)
          const accountId = spec.accountId
          if (provider === null || accountId === undefined) return
          void runMutation(() => activateAccount({ provider, accountId }))
          return
        }
        case ERepairAction.SwapModel:
          switchPending.current = true
          onSwitchModel()
          return
        case ERepairAction.CheckAgain:
          void retryAfterRepair()
          return
      }
    },
    [repair, runMutation, onSwitchModel, retryAfterRepair],
  )

  const handleRetry = useCallback(() => {
    void retryAfterRepair()
  }, [retryAfterRepair])

  const handleModelSelected = useCallback(() => {
    if (!switchPending.current) return
    switchPending.current = false
    void retryAfterRepair()
  }, [retryAfterRepair])

  const actions = useMemo<RunAttentionAction[]>(() => {
    const offered = specs.map((spec, index) => ({
      id: spec.id,
      label: spec.label,
      primary: index === 0,
      disabled: failing,
      onSelect: () => selectAction(spec),
    }))
    return [...offered, { ...RETRY_ACTION, disabled: failing, onSelect: handleRetry }]
  }, [specs, failing, selectAction, handleRetry])

  const card = useMemo<RepairCardProps | null>(() => {
    if (repair === null) return null
    const view = repairCardViewOf({
      repair,
      providerLabel: providerLabelOf(repair.providerId ?? undefined),
      accountLabel: account?.label,
      accountKind,
      actions: specs,
    })
    return { title: view.title, detail: view.detail, notes: view.notes, actions }
  }, [repair, account, accountKind, specs, actions])

  const primary = actions[0]
  const primaryDetail = specs[0]?.detail
  const strip = useMemo<RunAttentionStripProps | null>(() => {
    if (repair === null || primary === undefined) return null
    const view = repairCardViewOf({
      repair,
      providerLabel: providerLabelOf(repair.providerId ?? undefined),
      accountLabel: account?.label,
      accountKind,
    })
    return {
      title: view.title,
      detail: primaryDetail ?? view.detail,
      actions: [primary],
    }
  }, [repair, primary, primaryDetail, account, accountKind])

  const handleSignInRepaired = useCallback(() => {
    setDialog(null)
    reload()
    void retryAfterRepair()
  }, [reload, retryAfterRepair])

  const handleSubmitKey = useCallback(
    (apiKey: string) => {
      const provider = providerIdOf(repair?.providerId ?? null)
      if (repair === null || provider === null) return
      const accountId = repair.accountId
      void runMutation(async () => {
        if (accountId !== null && accountKind === EAuthKind.ApiKey) {
          await replaceApiKey({ accountId, apiKey })
          return
        }
        await createApiKeyAccount({ provider, apiKey, makeActive: true })
      })
    },
    [repair, accountKind, runMutation],
  )

  const handleOpenPrimary = useCallback(() => {
    const first = specs[0]
    if (first === undefined) return
    selectAction(first)
  }, [specs, selectAction])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setDialog(null)
  }, [])

  return {
    repair,
    card,
    strip,
    canRepair: specs.length > 0,
    accountKnown: accountKind !== null,
    openPrimary: handleOpenPrimary,
    handleModelSelected,
    dialogs: {
      signIn: {
        open: dialog === ERepairDialog.SignIn,
        provider: oauthProviderOf(repair?.providerId ?? null),
        onOpenChange: handleOpenChange,
        onRepaired: handleSignInRepaired,
      },
      key: {
        open: dialog === ERepairDialog.Key,
        failing,
        providerLabel: providerLabelOf(repair?.providerId ?? undefined),
        onOpenChange: handleOpenChange,
        onSubmit: handleSubmitKey,
      },
    },
  }
}
