'use client'

import { useState } from 'react'

import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'

import {
  EProviderSignInState,
  type ProviderSignInControl,
} from '../data/personal/use-provider-sign-in'
import type { ProviderInfo } from '../fixtures/settings-agent'
import { SettingsCard, SettingsRow } from '../settings-layout'
import { ProviderAddMenu } from './provider-add-menu'
import { EKeyDialogMode, type KeyDialogResult, ProviderKeyDialog } from './provider-key-dialog'
import { ProviderSignInPanel } from './provider-sign-in-panel'

function UnconnectedRow({
  provider,
  signIn,
  onAddKey,
}: {
  provider: ProviderInfo
  signIn: ProviderSignInControl
  onAddKey: (result: KeyDialogResult) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const signingIn = signIn.flow.status !== EProviderSignInState.Idle
  const shortName = provider.plan?.product ?? provider.name
  return (
    <SettingsRow
      media={<BrandMark brand={provider.brand} />}
      title={provider.name}
      description={provider.description}
      control={
        <ProviderAddMenu
          provider={provider}
          label="Connect"
          signInDisabled={signingIn}
          onSignIn={signIn.start}
          onAddKey={() => setOpen(true)}
        />
      }
    >
      {signingIn ? <ProviderSignInPanel name={shortName} control={signIn} /> : null}
      <ProviderKeyDialog
        providerName={provider.name}
        keyPrefix={provider.keyPrefix}
        mode={EKeyDialogMode.Add}
        open={open}
        onOpenChange={setOpen}
        onSave={onAddKey}
      />
    </SettingsRow>
  )
}

export function UnconnectedProviders({
  providers,
  signInOf,
  onAddKey,
}: {
  providers: readonly ProviderInfo[]
  signInOf: (provider: ProviderInfo) => ProviderSignInControl
  onAddKey: (args: { provider: ProviderInfo; result: KeyDialogResult }) => Promise<string | null>
}) {
  if (providers.length === 0) return null
  return (
    <SettingsCard>
      {providers.map((provider) => (
        <UnconnectedRow
          key={provider.id}
          provider={provider}
          signIn={signInOf(provider)}
          onAddKey={(result) => onAddKey({ provider, result })}
        />
      ))}
    </SettingsCard>
  )
}
