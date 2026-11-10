import { cn } from '@dltech/atlas-ui/lib/utils'

import { ERoutineState } from './routine-state'

const TONES: Record<ERoutineState, { dot: string; word: string; label: string }> = {
  [ERoutineState.Working]: {
    dot: 'bg-clay-500',
    word: 'text-clay-600 dark:text-clay-400',
    label: 'working',
  },
  [ERoutineState.Idle]: {
    dot: 'bg-muted-foreground/40',
    word: 'text-muted-foreground',
    label: 'idle',
  },
  [ERoutineState.Skipped]: {
    dot: 'bg-amber-500',
    word: 'text-amber-600 dark:text-amber-400',
    label: 'skipped',
  },
  [ERoutineState.Off]: {
    dot: 'bg-border',
    word: 'text-muted-foreground/60',
    label: 'off',
  },
}

export function RoutineStatusWord({
  state,
  className,
}: {
  state: ERoutineState
  className?: string
}) {
  const tone = TONES[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', tone.word, className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
      {tone.label}
    </span>
  )
}
