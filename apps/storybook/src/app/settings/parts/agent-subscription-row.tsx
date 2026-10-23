import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Progress } from '@dltech/atlas-ui/components/progress'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  EUsageWindow,
  type SubscriptionAccount,
  type UsageReading,
} from '@dltech/atlas-ui/fixtures/settings-agent'
import { Mono, SettingsRow } from '../settings-layout'
import { BrandMark, type EBrand } from '@dltech/atlas-ui/components/brand-mark'

const WARNING_AT = 80
const DESTRUCTIVE_AT = 95

const WINDOW_LABELS: Record<EUsageWindow, string> = {
  [EUsageWindow.FiveHour]: '5-hour',
  [EUsageWindow.SevenDay]: 'Weekly',
}

const readingTone = (utilization: number | null): string => {
  if (utilization === null) return ''
  if (utilization >= DESTRUCTIVE_AT) return '**:data-[slot=progress-indicator]:bg-destructive'
  if (utilization >= WARNING_AT) return '**:data-[slot=progress-indicator]:bg-warning'
  return ''
}

function UsageMeter({ reading }: { reading: UsageReading }) {
  const { utilization } = reading
  const nearLimit = utilization !== null && utilization >= WARNING_AT
  const label = WINDOW_LABELS[reading.window]
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Progress
        aria-label={`${label} usage`}
        value={utilization ?? 0}
        className={cn('min-w-0 flex-1 gap-0', readingTone(utilization))}
      />
      <Mono className="w-9 shrink-0 text-right text-foreground">
        {utilization === null ? '—' : `${Math.round(utilization)}%`}
      </Mono>
      <span className="w-44 shrink-0 text-xs text-muted-foreground">
        resets {reading.resetsAt}
        {nearLimit ? <span className="font-medium text-foreground"> · near limit</span> : null}
      </span>
    </div>
  )
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
      <div className="flex flex-col gap-2 pl-11">
        {account.usage.map((reading) => (
          <UsageMeter key={reading.window} reading={reading} />
        ))}
      </div>
    </SettingsRow>
  )
}
