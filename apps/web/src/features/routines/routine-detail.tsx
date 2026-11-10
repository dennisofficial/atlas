'use client'

import { Play } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import type { Routine } from '@dltech/atlas-protocol'
import { Button } from '@dltech/atlas-ui/components/button'

import { useClock } from '@/features/shell/use-clock'
import { useV2Sessions } from '@/features/shell/use-v2-sessions'
import { messageOf } from '@/features/threads/data/use-send'
import { EQueryState } from '@/lib/use-cloud-query'

import { useRoutineRuns, useRunRoutineNow, useUpdateRoutine } from './data/routines-api'
import { clockAt, dateAt, relativeOf } from './routine-format'
import { RoutineCreateSheet } from './routine-create-sheet'
import { RoutineRunList } from './routine-run-list'
import { scheduleSummaryOf } from './routine-schedule'
import { isRoutineSessionLive, pushedSessionStateOf, routineStateOf } from './routine-state'
import { RoutineStatusWord } from './routine-status'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function RoutineDetail({ routine }: { routine: Routine }) {
  const router = useRouter()
  const now = useClock()
  const timeZone = routine.timezone
  const sessions = useV2Sessions()
  const sessionState = pushedSessionStateOf({ sessionId: routine.lastSessionId, sessions })
  const runs = useRoutineRuns(routine.routineId)
  const update = useUpdateRoutine()
  const runNow = useRunRoutineNow()
  const [editOpen, setEditOpen] = useState(false)
  const state = routineStateOf({ routine, sessionState })
  const running = isRoutineSessionLive(sessionState) && routine.lastSessionId !== null

  const handleEditOpenChange = (open: boolean) => setEditOpen(open)

  const handleToggleEnabled = () => {
    update
      .mutateAsync({ routineId: routine.routineId, enabled: !routine.enabled })
      .catch((failure: unknown) => toast.error(messageOf(failure)))
  }

  const handleRunNow = () => {
    runNow
      .mutateAsync(routine.routineId)
      .then((result) => router.push(`/sessions/${encodeURIComponent(result.sessionId)}`))
      .catch((failure: unknown) => toast.error(messageOf(failure)))
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-medium">{routine.name}</h1>
          <RoutineStatusWord state={state} />
          <span className="truncate text-xs text-muted-foreground">{routine.projectId}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={handleToggleEnabled}>
            {routine.enabled ? 'Pause' : 'Resume'}
          </Button>
          <Button size="sm" onClick={handleRunNow} disabled={runNow.isPending}>
            <Play data-icon="inline-start" />
            Run now
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-5">
          <p className="text-xs text-muted-foreground">
            Run now starts immediately, off schedule, and leaves the next run where it is.
          </p>

          <dl className="grid grid-cols-2 gap-4">
            <Fact label="Schedule">
              {scheduleSummaryOf(routine.cron)}
              <span className="ml-1.5 text-xs text-muted-foreground">{timeZone}</span>
            </Fact>
            <Fact label="Next run">
              <span className="font-mono tabular-nums">
                {dateAt({ iso: routine.nextRunAt, timeZone })}
              </span>
              <span className="ml-1.5 text-xs text-muted-foreground">
                {relativeOf({ from: now, to: routine.nextRunAt })}
              </span>
            </Fact>
            <Fact label="Project">{routine.projectId}</Fact>
            <Fact label="Model">
              <span className="font-mono text-xs">{routine.model ?? 'account default'}</span>
            </Fact>
          </dl>

          {running && routine.lastSessionId !== null ? (
            <section className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">Current run</span>
                <span className="text-xs text-muted-foreground">
                  started {clockAt({ iso: routine.lastRunAt ?? routine.lastSessionId, timeZone })} ·{' '}
                  {relativeOf({ from: now, to: routine.lastRunAt ?? routine.lastSessionId })}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/sessions/${encodeURIComponent(routine.lastSessionId)}`} />}
              >
                Open session
              </Button>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs text-muted-foreground">Prompt</h2>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Edit
              </button>
            </div>
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
              {routine.prompt}
            </p>
          </section>

          <section className="flex flex-col gap-1">
            <h2 className="text-xs text-muted-foreground">Recent runs</h2>
            {runs.state === EQueryState.Failed ? (
              <p className="py-2 text-xs text-destructive">{runs.error.message}</p>
            ) : (
              <RoutineRunList runs={runs.data ?? []} timeZone={timeZone} limit={6} />
            )}
          </section>
        </div>
      </div>

      <RoutineCreateSheet open={editOpen} onOpenChange={handleEditOpenChange} routine={routine} />
    </>
  )
}
