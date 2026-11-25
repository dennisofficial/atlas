'use client'

import { useState } from 'react'

import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'
import { RadioGroup } from '@dltech/atlas-ui/components/radio-group'

import { EAccountKind, type Account } from '../data/personal/accounts-api'
import {
  EProviderSignInState,
  type ProviderSignInControl,
} from '../data/personal/use-provider-sign-in'
import type { ProviderInfo } from '../fixtures/settings-agent'
import { SettingsCard } from '../settings-layout'
import type { LibraryMenuAction } from './library-row-menu'
import { ProviderAccountRow } from './provider-account-row'
import { ProviderAddMenu } from './provider-add-menu'
import { EKeyDialogMode, type KeyDialogResult, ProviderKeyDialog } from './provider-key-dialog'
import { ProviderSignInPanel } from './provider-sign-in-panel'

export type ProviderCardActions = {
  onUse: (accountId: string) => void
  onSignIn: () => void
  onAddKey: (result: KeyDialogResult) => Promise<string | null>
  onRename: (args: { accountId: string; name: string }) => void
  onReplace: (args: { accountId: string; key: string }) => Promise<string | null>
  onRemove: (accountId: string) => void
}

type OpenDialog = { mode: EKeyDialogMode; account: Account | null } | null

function menuFor({
  account,
  inUse,
  actions,
  openDialog,
}: {
  account: Account
  inUse: boolean
  actions: ProviderCardActions
  openDialog: (dialog: OpenDialog) => void
}): LibraryMenuAction[] {
  const use = inUse
    ? []
    : [{ label: 'Use for this provider', onSelect: () => actions.onUse(account.id) }]
  if (account.kind === EAccountKind.Oauth) {
    return [
      ...use,
      { label: 'Sign in again', onSelect: actions.onSignIn },
      { label: 'Sign out', onSelect: () => actions.onRemove(account.id), destructive: true },
    ]
  }
  return [
    ...use,
    {
      label: 'Rename',
      onSelect: () => openDialog({ mode: EKeyDialogMode.Rename, account }),
    },
    {
      label: 'Replace key',
      onSelect: () => openDialog({ mode: EKeyDialogMode.Replace, account }),
    },
    { label: 'Remove', onSelect: () => actions.onRemove(account.id), destructive: true },
  ]
}

export function ProviderCard({
  provider,
  accounts,
  inUseId,
  signIn,
  actions,
}: {
  provider: ProviderInfo
  accounts: readonly Account[]
  inUseId: string | null
  signIn: ProviderSignInControl
  actions: ProviderCardActions
}) {
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const selectable = accounts.length > 1
  const signingIn = signIn.flow.status !== EProviderSignInState.Idle
  const shortName = provider.plan?.product ?? provider.name

  const handleSave = (result: KeyDialogResult): Promise<string | null> => {
    if (dialog === null) return Promise.resolve(null)
    if (dialog.mode === EKeyDialogMode.Add) return actions.onAddKey(result)
    if (dialog.account === null) return Promise.resolve(null)
    if (dialog.mode === EKeyDialogMode.Rename) {
      actions.onRename({ accountId: dialog.account.id, name: result.name })
      return Promise.resolve(null)
    }
    return actions.onReplace({ accountId: dialog.account.id, key: result.key })
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
          signInDisabled={signingIn}
          onSignIn={signIn.start}
          onAddKey={() => setDialog({ mode: EKeyDialogMode.Add, account: null })}
        />
      </div>
      {signingIn ? (
        <div className="px-4 pb-3">
          <ProviderSignInPanel name={shortName} control={signIn} />
        </div>
      ) : null}
      <RadioGroup
        aria-label={`${provider.name} account in use`}
        value={inUseId ?? ''}
        onValueChange={(value) => actions.onUse(String(value))}
        layout="rows"
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
      <ProviderKeyDialog
        providerName={provider.name}
        keyPrefix={provider.keyPrefix}
        mode={dialog?.mode ?? EKeyDialogMode.Add}
        open={dialog !== null}
        initialName={dialog?.account?.label ?? ''}
        offerUse={dialog?.mode === EKeyDialogMode.Add && accounts.length > 0}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        onSave={handleSave}
      />
    </SettingsCard>
  )
}
