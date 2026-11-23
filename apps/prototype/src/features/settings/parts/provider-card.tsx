import { useState } from 'react'

import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'
import { RadioGroup } from '@dltech/atlas-ui/components/radio-group'

import {
  EAccountKind,
  type ProviderAccount,
  type ProviderInfo,
} from '../fixtures/settings-providers'
import { SettingsCard } from '../settings-layout'
import type { LibraryMenuAction } from './library-row-menu'
import { ProviderAccountRow } from './provider-account-row'
import { ProviderAddMenu } from './provider-add-menu'
import { EKeyDialog, KeyDialog, type KeyDialogResult } from './provider-key-dialog'

export type ProviderCardActions = {
  onUse: (accountId: string) => void
  onSignIn: () => void
  onAddKey: (result: KeyDialogResult) => void
  onRename: (accountId: string, name: string) => void
  onReplace: (accountId: string, key: string) => void
  onRemove: (accountId: string) => void
}

type OpenDialog = { mode: EKeyDialog; account: ProviderAccount | null } | null

function menuFor({
  account,
  inUse,
  actions,
  openDialog,
}: {
  account: ProviderAccount
  inUse: boolean
  actions: ProviderCardActions
  openDialog: (dialog: OpenDialog) => void
}): LibraryMenuAction[] {
  const use = inUse
    ? []
    : [{ label: 'Use for this provider', onSelect: () => actions.onUse(account.id) }]
  if (account.kind === EAccountKind.Plan) {
    return [
      ...use,
      { label: 'Sign in again', onSelect: actions.onSignIn },
      { label: 'Sign out', onSelect: () => actions.onRemove(account.id), destructive: true },
    ]
  }
  return [
    ...use,
    { label: 'Rename', onSelect: () => openDialog({ mode: EKeyDialog.Rename, account }) },
    { label: 'Replace key', onSelect: () => openDialog({ mode: EKeyDialog.Replace, account }) },
    { label: 'Remove', onSelect: () => actions.onRemove(account.id), destructive: true },
  ]
}

export function ProviderCard({
  provider,
  accounts,
  inUseId,
  actions,
}: {
  provider: ProviderInfo
  accounts: ProviderAccount[]
  inUseId: string | null
  actions: ProviderCardActions
}) {
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const selectable = accounts.length > 1

  const handleSave = (result: KeyDialogResult) => {
    if (dialog?.mode === EKeyDialog.Add) return actions.onAddKey(result)
    if (!dialog?.account) return
    if (dialog.mode === EKeyDialog.Rename) return actions.onRename(dialog.account.id, result.name)
    actions.onReplace(dialog.account.id, result.key)
  }

  return (
    <SettingsCard>
      <div className="flex items-center gap-3 px-4 py-3">
        <BrandMark brand={provider.brand} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-sm font-medium">{provider.name}</h3>
          <p className="truncate text-sm text-muted-foreground">{provider.description}</p>
        </div>
        <ProviderAddMenu
          provider={provider}
          onSignIn={actions.onSignIn}
          onAddKey={() => setDialog({ mode: EKeyDialog.Add, account: null })}
        />
      </div>
      <RadioGroup
        aria-label={`${provider.name} account in use`}
        value={inUseId ?? ''}
        onValueChange={(value) => actions.onUse(String(value))}
        className="gap-0 divide-y"
      >
        {accounts.map((account) => (
          <ProviderAccountRow
            key={account.id}
            provider={provider}
            account={account}
            inUse={account.id === inUseId}
            selectable={selectable}
            actions={menuFor({
              account,
              inUse: account.id === inUseId,
              actions,
              openDialog: setDialog,
            })}
          />
        ))}
      </RadioGroup>
      <KeyDialog
        key={`${dialog?.mode}-${dialog?.account?.id}`}
        provider={provider}
        mode={dialog?.mode ?? EKeyDialog.Add}
        open={dialog !== null}
        initialName={dialog?.account?.name ?? ''}
        offerUse={dialog?.mode === EKeyDialog.Add && accounts.length > 0}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        onSave={handleSave}
      />
    </SettingsCard>
  )
}
