'use client'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { BrandMark, type EBrand } from '@dltech/atlas-ui/components/brand-mark'

import type { Account } from '../data/personal/accounts-api'
import {
  EProviderSignInState,
  type ProviderSignInControl,
} from '../data/personal/use-provider-sign-in'
import { SettingsRow } from '../settings-layout'
import { ProviderSignInPanel } from './provider-sign-in-panel'

export type ProviderCard = {
  name: string
  brand: EBrand
  idleDescription: string
}

const emailOf = (login: Account): string => login.email ?? login.label

const shortNameOf = (provider: ProviderCard): string => provider.name.split(' ')[0] ?? provider.name

function LoginRow({
  provider,
  login,
  active,
  busy,
  onSwitch,
  onRemove,
}: {
  provider: ProviderCard
  login: Account
  active: boolean
  busy: boolean
  onSwitch: (accountId: string) => void
  onRemove: (accountId: string) => void
}) {
  return (
    <SettingsRow
      media={<BrandMark brand={provider.brand} />}
      title={
        <>
          {provider.name}
          <Badge variant="secondary">{login.subscription ?? 'Connected'}</Badge>
          {active ? <Badge>Active</Badge> : null}
        </>
      }
      description={
        <>
          Signed in as <span className="font-mono text-xs text-foreground">{emailOf(login)}</span>
        </>
      }
      control={
        active ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onRemove(login.id)}>
            Sign out
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={() => onSwitch(login.id)}>
              Switch to
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onRemove(login.id)}>
              Remove
            </Button>
          </>
        )
      }
    />
  )
}

export function ProviderLoginsCard({
  provider,
  logins,
  activeId,
  busy,
  signIn,
  onSwitch,
  onRemove,
}: {
  provider: ProviderCard
  logins: readonly Account[]
  activeId: string | null
  busy: boolean
  signIn: ProviderSignInControl
  onSwitch: (accountId: string) => void
  onRemove: (accountId: string) => void
}) {
  const shortName = shortNameOf(provider)
  const signingIn = signIn.flow.status !== EProviderSignInState.Idle

  if (logins.length === 0) {
    return (
      <SettingsRow
        media={<BrandMark brand={provider.brand} />}
        title={
          <>
            {provider.name}
            <Badge variant="outline">Not connected</Badge>
          </>
        }
        description={provider.idleDescription}
        control={
          <Button size="sm" disabled={signingIn} onClick={signIn.start}>
            Sign in with {shortName}
          </Button>
        }
      >
        <ProviderSignInPanel name={shortName} control={signIn} />
      </SettingsRow>
    )
  }

  return (
    <>
      {logins.map((login) => (
        <LoginRow
          key={login.id}
          provider={provider}
          login={login}
          active={login.id === activeId}
          busy={busy}
          onSwitch={onSwitch}
          onRemove={onRemove}
        />
      ))}
      <SettingsRow
        media={<BrandMark brand={provider.brand} />}
        title={`Another ${shortName} account`}
        description="Sign in with a second plan, then choose which one Atlas uses."
        control={
          <Button variant="outline" size="sm" disabled={signingIn} onClick={signIn.start}>
            Add account
          </Button>
        }
      >
        <ProviderSignInPanel name={shortName} control={signIn} />
      </SettingsRow>
    </>
  )
}
