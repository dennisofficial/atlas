import Link from 'next/link'

import type { RoutineRunRow } from '@dltech/atlas-protocol'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { dateAt } from './routine-format'

type Outcome = RoutineRunRow['outcome']

const OUTCOME_WORD: Record<Outcome, string> = {
  started: 'started',
  'skipped-busy': 'skipped, busy',
  skipped: 'skipped',
  failed: 'failed',
}

const OUTCOME_TONE: Record<Outcome, string> = {
  started: 'text-clay-600 dark:text-clay-400',
  'skipped-busy': 'text-amber-600 dark:text-amber-400',
  skipped: 'text-amber-600 dark:text-amber-400',
  failed: 'text-destructive',
}

export function RoutineRunRow({ run, timeZone }: { run: RoutineRunRow; timeZone: string }) {
  return (
    <div
      data-routine-run={run.runId}
      className="flex min-w-0 items-baseline gap-3 border-b border-border/60 py-2 last:border-b-0"
    >
      <span className={cn('w-28 shrink-0 text-xs', OUTCOME_TONE[run.outcome])}>
        {OUTCOME_WORD[run.outcome]}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {dateAt({ iso: run.at, timeZone })}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {run.reason ?? ''}
      </span>
      {run.sessionId === null ? null : (
        <Link
          href={`/sessions/${encodeURIComponent(run.sessionId)}`}
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
  timeZone,
  limit,
}: {
  runs: readonly RoutineRunRow[]
  timeZone: string
  limit?: number
}) {
  const shown = limit === undefined ? runs : runs.slice(0, limit)
  if (shown.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">No runs yet.</p>
  }
  return (
    <div className="flex flex-col">
      {shown.map((run) => (
        <RoutineRunRow key={run.runId} run={run} timeZone={timeZone} />
      ))}
    </div>
  )
}
