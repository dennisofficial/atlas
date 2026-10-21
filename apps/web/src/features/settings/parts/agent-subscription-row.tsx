'use client'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Progress } from '@dltech/atlas-ui/components/progress'

import { SettingsRow } from '../settings-layout'
import { ProviderTile } from './agent-provider-tile'

export type SubscriptionAccount = {
  email: string
  plan: string
  limitUsedPercent?: number
  limitHint?: string
}

export function SubscriptionRow({
  name,
  letter,
  idleDescription,
  signInLabel,
  signOutLabel = 'Sign out',
  account,
  busy = false,
  signInHint,
  onSignIn,
  onSignOut,
}: {
  name: string
  letter: string
  idleDescription: string
  signInLabel: string
  signOutLabel?: string
  account: SubscriptionAccount | null
  busy?: boolean
  signInHint?: string
  onSignIn?: () => void
  onSignOut: () => void
}) {
  if (!account) {
    return (
      <SettingsRow
        media={<ProviderTile letter={letter} />}
        title={
          <>
            {name}
            <Badge variant="outline">Not connected</Badge>
          </>
        }
        description={signInHint ? `${idleDescription} ${signInHint}` : idleDescription}
        control={
          <Button size="sm" disabled={onSignIn === undefined} onClick={onSignIn}>
            {signInLabel}
          </Button>
        }
      />
    )
  }
  return (
    <SettingsRow
      media={<ProviderTile letter={letter} />}
      title={
        <>
          {name}
          <Badge variant="secondary">{account.plan}</Badge>
        </>
      }
      description={
        <>
          Signed in as <span className="font-mono text-xs text-foreground">{account.email}</span>
        </>
      }
      control={
        <Button variant="outline" size="sm" disabled={busy} onClick={onSignOut}>
          {signOutLabel}
        </Button>
      }
    >
      {account.limitUsedPercent === undefined ? null : (
        <div className="flex flex-col gap-1.5 pl-11">
          <Progress value={account.limitUsedPercent} />
          <p className="text-xs text-muted-foreground">{account.limitHint}</p>
        </div>
      )}
    </SettingsRow>
  )
}
