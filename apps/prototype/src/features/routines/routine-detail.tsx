'use client'

import { Play } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'

import { RoutineRunList } from './routine-run-list'
import { RoutineStatusWord } from './routine-status'
import { type AppRoutine, clockAt, dayAt, NOW, relativeOf, stateOf } from './routines.fixtures'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function RoutineDetail({ routine }: { routine: AppRoutine }) {
  const state = stateOf(routine)
  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-medium">{routine.name}</h1>
          <RoutineStatusWord state={state} />
          <span className="truncate text-xs text-muted-foreground">{routine.projectId}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            Edit
          </Button>
          <Button variant="outline" size="sm">
            {routine.enabled ? 'Pause' : 'Resume'}
          </Button>
          <Button size="sm">
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
              {routine.schedule}
              <span className="ml-1.5 text-xs text-muted-foreground">{routine.timezone}</span>
            </Fact>
            <Fact label="Next run">
              <span className="font-mono tabular-nums">{dayAt(routine.nextRunAt)}</span>
              <span className="ml-1.5 text-xs text-muted-foreground">
                {relativeOf({ from: NOW, to: routine.nextRunAt })}
              </span>
            </Fact>
            <Fact label="Project">{routine.projectId}</Fact>
            <Fact label="Model">
              <span className="font-mono text-xs">{routine.model}</span>
            </Fact>
          </dl>

          {routine.currentRun !== undefined && (
            <section className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">Current run</span>
                <span className="text-xs text-muted-foreground">
                  started {clockAt(routine.currentRun.startedAt)} ·{' '}
                  {relativeOf({ from: NOW, to: routine.currentRun.startedAt })}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/sessions/${routine.currentRun.sessionId}`} />}
              >
                Open session
              </Button>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs text-muted-foreground">Prompt</h2>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground">
                Edit
              </button>
            </div>
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
              {routine.prompt}
            </p>
          </section>

          <section className="flex flex-col gap-1">
            <h2 className="text-xs text-muted-foreground">Recent runs</h2>
            <RoutineRunList runs={routine.runs} limit={6} />
          </section>
        </div>
      </div>
    </>
  )
}
