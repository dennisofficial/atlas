import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Progress } from '@dltech/atlas-ui/components/progress'

import { SettingsRow } from '../settings-layout'
import { BrandMark, type EBrand } from '@dltech/atlas-ui/components/brand-mark'

export type SubscriptionAccount = {
  email: string
  plan: string
  limitUsedPercent: number
  limitHint: string
}

export function SubscriptionRow({
  name,
  brand,
  idleDescription,
  signInLabel,
  signOutLabel = 'Sign out',
  account,
  onSignIn,
  onSignOut,
}: {
  name: string
  brand: EBrand
  idleDescription: string
  signInLabel: string
  signOutLabel?: string
  account: SubscriptionAccount | null
  onSignIn: () => void
  onSignOut: () => void
}) {
  if (!account) {
    return (
      <SettingsRow
        media={<BrandMark brand={brand} />}
        title={
          <>
            {name}
            <Badge variant="outline">Not connected</Badge>
          </>
        }
        description={idleDescription}
        control={
          <Button size="sm" onClick={onSignIn}>
            {signInLabel}
          </Button>
        }
      />
    )
  }
  return (
    <SettingsRow
      media={<BrandMark brand={brand} />}
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
        <Button variant="outline" size="sm" onClick={onSignOut}>
          {signOutLabel}
        </Button>
      }
    >
      <div className="flex flex-col gap-1.5 pl-11">
        <Progress value={account.limitUsedPercent} />
        <p className="text-xs text-muted-foreground">{account.limitHint}</p>
      </div>
    </SettingsRow>
  )
}
