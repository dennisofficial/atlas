import { useState } from 'react'

import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'

import type { ProviderInfo } from '../fixtures/settings-providers'
import { SettingsCard, SettingsRow } from '../settings-layout'
import { ProviderAddMenu } from './provider-add-menu'
import { EKeyDialog, KeyDialog, type KeyDialogResult } from './provider-key-dialog'

function UnconnectedRow({
  provider,
  onSignIn,
  onAddKey,
}: {
  provider: ProviderInfo
  onSignIn: () => void
  onAddKey: (result: KeyDialogResult) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <SettingsRow
      media={<BrandMark brand={provider.brand} />}
      title={provider.name}
      description={provider.description}
      control={
        <>
          <ProviderAddMenu
            provider={provider}
            label="Connect"
            onSignIn={onSignIn}
            onAddKey={() => setOpen(true)}
          />
          <KeyDialog
            provider={provider}
            mode={EKeyDialog.Add}
            open={open}
            onOpenChange={setOpen}
            onSave={onAddKey}
          />
        </>
      }
    />
  )
}

export function UnconnectedProviders({
  providers,
  onSignIn,
  onAddKey,
}: {
  providers: ProviderInfo[]
  onSignIn: (provider: ProviderInfo) => void
  onAddKey: (provider: ProviderInfo, result: KeyDialogResult) => void
}) {
  if (providers.length === 0) return null
  return (
    <SettingsCard>
      {providers.map((provider) => (
        <UnconnectedRow
          key={provider.id}
          provider={provider}
          onSignIn={() => onSignIn(provider)}
          onAddKey={(result) => onAddKey(provider, result)}
        />
      ))}
    </SettingsCard>
  )
}
