import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import type { Account } from '@dltech/atlas-core'

import { accountMeterSpans } from '../ui/account-meters'
import type { Span } from '../ui/components/spans'
import { ENoticeTone, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import { useAccounts } from './use-accounts'
import { useOnboarding } from './use-onboarding'
import type { SettingsControl } from './use-settings'

const CREDENTIAL_NOTICE_MS = 23_000

export function useWorkspaceAccounts(args: {
  app: AtlasApp
  credentialNotice: string | null
  usageWarn: SettingsControl['usageWarn']
  onChooseModel: (id: string) => void
}) {
  const { app, credentialNotice, usageWarn, onChooseModel } = args
  const { usage } = app
  const usageVersion = useSyncExternalStore(usage.subscribe, usage.version)

  const accounts = useAccounts({
    accounts: app.accounts,
    openUrl: app.openUrl,
    onAccounts: app.models.observeAccounts,
  })

  const accountsOpen = accounts.state !== null
  const accountRows = accounts.state?.rows

  useEffect(() => {
    if (!accountsOpen) return
    for (const row of accountRows ?? []) {
      for (const account of row.accounts) void usage.refresh({ accountId: account.id })
    }
  }, [accountRows, accountsOpen, usage])

  const accountMeters = useMemo(
    () =>
      (account: Account): readonly Span[] =>
        accountMeterSpans({
          usage: usage.snapshotFor({ accountId: account.id }),
          warn: usageWarn,
          now: Date.now(),
        }),
    [usageWarn, usage, usageVersion],
  )

  const notified = useRef(false)
  const pendingCredentialNotice = useRef<string | null>(null)
  useEffect(() => {
    if (credentialNotice === null || notified.current) return

    notified.current = true
    pendingCredentialNotice.current = credentialNotice
    notify({
      key: 'credential-failure',
      text: 'A provider login is failing — press ctrl+a or run /auth.',
      tone: ENoticeTone.Warn,
      ttlMs: CREDENTIAL_NOTICE_MS,
    })
  }, [credentialNotice])

  const handleOpenAccounts = useCallback(() => {
    const notice = pendingCredentialNotice.current
    pendingCredentialNotice.current = null
    accounts.handleOpen(notice ?? undefined)
  }, [accounts])

  const onboarding = useOnboarding({
    app,
    onChooseModel,
    onOpenAccounts: handleOpenAccounts,
  })

  return { accounts, accountMeters, handleOpenAccounts, onboarding }
}
