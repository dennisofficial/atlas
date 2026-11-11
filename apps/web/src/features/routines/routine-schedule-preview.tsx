import { useMemo } from 'react'

import { FieldDescription } from '@dltech/atlas-ui/components/field'

import { dateAt } from './routine-format'
import { cronOf, isKnownTimezone, nextOccurrencesOf, scheduleSummaryOf } from './routine-schedule'

type Preview =
  | { kind: 'unknown-cron' }
  | { kind: 'unknown-timezone' }
  | { kind: 'ready'; occurrences: readonly string[]; runsPerDay: number }

const previewOf = ({ cron, timezone }: { cron: string; timezone: string }): Preview => {
  const parsed = cronOf(cron)
  if (parsed === null) return { kind: 'unknown-cron' }
  if (!isKnownTimezone(timezone)) return { kind: 'unknown-timezone' }
  return {
    kind: 'ready',
    occurrences: nextOccurrencesOf({ cron, timeZone: timezone, from: Date.now(), count: 3 }),
    runsPerDay: parsed.hours.length * parsed.minutes.length,
  }
}

export function RoutineSchedulePreview({ cron, timezone }: { cron: string; timezone: string }) {
  const preview = useMemo(() => previewOf({ cron, timezone }), [cron, timezone])

  if (preview.kind === 'unknown-cron') {
    return <FieldDescription>Atlas does not understand this schedule yet</FieldDescription>
  }

  if (preview.kind === 'unknown-timezone') {
    const message =
      timezone === ''
        ? 'Give the routine a timezone, like Europe/London'
        : `Unknown timezone: ${timezone}`
    return (
      <p role="alert" className="text-xs text-destructive">
        {message}
      </p>
    )
  }

  return (
    <>
      <FieldDescription>{`${scheduleSummaryOf(cron)} · ${timezone}`}</FieldDescription>
      {preview.occurrences.length === 0 ? null : (
        <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
          <p className="mb-1 text-muted-foreground">Next three runs</p>
          {preview.occurrences.map((occurrence) => (
            <p key={occurrence} className="font-mono tabular-nums">
              {dateAt({ iso: occurrence, timeZone: timezone })}
            </p>
          ))}
          {preview.runsPerDay > 1 ? (
            <p className="mt-1.5 text-muted-foreground">{preview.runsPerDay} runs a day</p>
          ) : null}
        </div>
      )}
    </>
  )
}
