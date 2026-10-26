import { Button } from '#components/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '#components/popover'
import { cn } from '#lib/utils'
import { ChipIcon } from './internal/pod-chip-icon'
import { PodPopoverBody } from './internal/pod-popover-body'
import { chipLabel, EPodState, type PodStatus } from './pod-status'

export {
  canResize,
  chipLabel,
  EPodState,
  ramOf,
  ResizeDeclinedError,
  sizeLabel,
  VCPU_STEPS,
  type PodStatus,
} from './pod-status'

export interface PodStatusChipProps {
  status: PodStatus
  defaultOpen?: boolean
  onResize?: (vcpus: number) => Promise<void>
  settingsHref?: string
}

export function PodStatusChip({
  status,
  defaultOpen = false,
  onResize,
  settingsHref,
}: PodStatusChipProps) {
  const parked = status.state === EPodState.Parked

  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Pod status"
            className={cn('text-xs', parked && 'text-muted-foreground')}
          />
        }
      >
        <ChipIcon state={status.state} />
        <span className="tabular-nums">{chipLabel(status)}</span>
      </PopoverTrigger>
      <PopoverContent align="end" initialFocus={false} className="w-80">
        <PopoverTitle className="text-sm font-medium">Pod</PopoverTitle>
        <PodPopoverBody status={status} onResize={onResize} settingsHref={settingsHref} />
      </PopoverContent>
    </Popover>
  )
}
