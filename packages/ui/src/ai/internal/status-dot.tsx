import { Spinner } from '#components/spinner'
import { cn } from '#lib/utils'

export enum EStatusTone {
  Live = 'live',
  Pending = 'pending',
  Idle = 'idle',
  Error = 'error',
}

const TONE_CLASS: Record<EStatusTone, string> = {
  [EStatusTone.Live]: 'bg-success',
  [EStatusTone.Pending]: 'bg-warning',
  [EStatusTone.Idle]: 'bg-muted-foreground/50',
  [EStatusTone.Error]: 'bg-destructive',
}

export function StatusDot({ tone }: { tone: EStatusTone }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', TONE_CLASS[tone])} />
}

export function InlineSpinner() {
  return (
    <span className="inline-flex shrink-0 [&_svg]:size-3">
      <Spinner />
    </span>
  )
}
