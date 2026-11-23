import { Progress } from '@dltech/atlas-ui/components/progress'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { UsageMeter } from '../fixtures/settings-providers'
import { Mono } from '../settings-layout'

const WARNING_AT = 80
const DESTRUCTIVE_AT = 95

const toneOf = (percent: number): string => {
  if (percent >= DESTRUCTIVE_AT) return '**:data-[slot=progress-indicator]:bg-destructive'
  if (percent >= WARNING_AT) return '**:data-[slot=progress-indicator]:bg-warning'
  return ''
}

export function UsageMeters({ usage }: { usage: UsageMeter[] }) {
  if (usage.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
      {usage.map((meter) => (
        <div key={meter.window} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-12">{meter.window}</span>
          <Progress
            aria-label={`${meter.window} usage`}
            value={meter.percent}
            className={cn('w-20 gap-0', toneOf(meter.percent))}
          />
          <Mono className="w-8 text-right text-foreground">{meter.percent}%</Mono>
          <span>resets in {meter.resets}</span>
        </div>
      ))}
    </div>
  )
}
