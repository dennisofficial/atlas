'use client'

import { EPlanStatus, foldPlan, planTaskLabel, type PlanTask } from '@dltech/atlas-core'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { CheckIcon, ChevronDownIcon, CircleDashedIcon, CircleIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Row } from './rows'

const GLYPH: Record<EPlanStatus, ReactNode> = {
  [EPlanStatus.Completed]: (
    <span
      role="img"
      aria-label="Done"
      className="flex size-3.5 items-center justify-center rounded-full bg-success text-background"
    >
      <CheckIcon aria-hidden className="size-2.5" strokeWidth={3} />
    </span>
  ),
  [EPlanStatus.InProgress]: (
    <CircleIcon
      role="img"
      aria-label="In progress"
      className="size-3.5 text-primary"
      strokeWidth={2.5}
    />
  ),
  [EPlanStatus.Pending]: (
    <CircleDashedIcon
      role="img"
      aria-label="Pending"
      className="size-3.5 text-muted-foreground/50"
    />
  ),
}

export function SessionTodoSection(props: { tasks: readonly PlanTask[] }) {
  const [open, setOpen] = useState(false)
  if (props.tasks.length === 0) return null

  const done = props.tasks.filter((task) => task.status === EPlanStatus.Completed).length
  const current = props.tasks.find((task) => task.status === EPlanStatus.InProgress)
  const fold = foldPlan({ tasks: props.tasks, expanded: open })
  const handleToggle = () => setOpen((held) => !held)

  return (
    <section data-session-todo aria-label="Todo" className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={handleToggle}
        className="flex w-full items-center gap-2 rounded-sm py-1 text-left outline-none hover:[&_span]:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="text-[11px] leading-4 font-medium text-muted-foreground tabular-nums">
          {done} / {props.tasks.length} tasks
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            'size-3 shrink-0 text-muted-foreground transition-transform',
            !open && '-rotate-90',
          )}
        />
        {open ? null : (
          <span className="min-w-0 truncate text-[13px] leading-4">
            {current === undefined ? 'All tasks done' : planTaskLabel(current)}
          </span>
        )}
      </button>
      {open
        ? fold.shown.map((task) => (
            <Row
              key={task.ordinal}
              leading={GLYPH[task.status]}
              title={
                <span
                  className={cn(task.status === EPlanStatus.Pending && 'text-muted-foreground')}
                >
                  {planTaskLabel(task)}
                </span>
              }
            />
          ))
        : null}
    </section>
  )
}
