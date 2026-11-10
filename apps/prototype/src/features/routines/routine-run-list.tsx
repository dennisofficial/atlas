import Link from 'next/link'

import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  type AppRoutineRun,
  dayAt,
  durationOf,
  ERoutineOutcome,
  relativeOf,
  NOW,
} from './routines.fixtures'

const OUTCOME_WORD: Record<ERoutineOutcome, string> = {
  [ERoutineOutcome.Started]: 'started',
  [ERoutineOutcome.Settled]: 'settled',
  [ERoutineOutcome.SkippedBusy]: 'skipped, busy',
  [ERoutineOutcome.Skipped]: 'skipped',
  [ERoutineOutcome.Failed]: 'failed',
}

const OUTCOME_TONE: Record<ERoutineOutcome, string> = {
  [ERoutineOutcome.Started]: 'text-clay-600 dark:text-clay-400',
  [ERoutineOutcome.Settled]: 'text-foreground',
  [ERoutineOutcome.SkippedBusy]: 'text-amber-600 dark:text-amber-400',
  [ERoutineOutcome.Skipped]: 'text-amber-600 dark:text-amber-400',
  [ERoutineOutcome.Failed]: 'text-destructive',
}

export function RoutineRunRow({ run, dense }: { run: AppRoutineRun; dense?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-baseline gap-3 border-b border-border/60 py-2 last:border-b-0',
        dense && 'py-1.5',
      )}
    >
      <span className={cn('w-28 shrink-0 text-xs', OUTCOME_TONE[run.outcome])}>
        {OUTCOME_WORD[run.outcome]}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {dayAt(run.at)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {run.note ?? durationOf(run.durationMs)}
      </span>
      {run.sessionId !== undefined && (
        <Link
          href={`/sessions/${run.sessionId}`}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          open session
        </Link>
      )}
    </div>
  )
}

export function RoutineRunList({
  runs,
  limit,
  dense,
}: {
  runs: readonly AppRoutineRun[]
  limit?: number
  dense?: boolean
}) {
  const shown = limit === undefined ? runs : runs.slice(0, limit)
  return (
    <div className="flex flex-col">
      {shown.map((run) => (
        <RoutineRunRow key={run.id} run={run} dense={dense} />
      ))}
    </div>
  )
}

export function CurrentRunLine({ startedAt, state }: { startedAt: string; state: string }) {
  return (
    <span className="text-xs text-muted-foreground">
      {state} since {dayAt(startedAt)} · started {relativeOf({ from: NOW, to: startedAt })}
    </span>
  )
}
