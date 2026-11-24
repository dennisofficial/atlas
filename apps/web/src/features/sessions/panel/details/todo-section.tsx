'use client'

import { EPlanStatus, foldPlan, planTaskLabel, type PlanTask } from '@dltech/atlas-core'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { CheckIcon, CircleDashedIcon, CircleIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { EmptyLine, Row, SectionHead } from './rows'

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

const foldLabelOf = (args: { hidden: number; expanded: boolean }): string =>
  args.expanded ? 'Show fewer' : `${args.hidden} earlier done`

export function SessionTodoSection(props: { tasks: readonly PlanTask[] }) {
  const [expanded, setExpanded] = useState(false)
  if (props.tasks.length === 0)
    return (
      <section data-session-todo aria-label="Todo" className="flex flex-col">
        <SectionHead title="Todo" />
        <EmptyLine>No plan yet</EmptyLine>
      </section>
    )

  const done = props.tasks.filter((task) => task.status === EPlanStatus.Completed).length
  const fold = foldPlan({ tasks: props.tasks, expanded })
  const handleToggle = () => setExpanded((held) => !held)

  return (
    <section data-session-todo aria-label="Todo" className="flex flex-col">
      <SectionHead title={`${done} / ${props.tasks.length} tasks`} />
      {fold.hidden > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={handleToggle}
          className="mb-0.5 ml-[1.625rem] w-fit rounded-sm text-[11px] leading-4 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {foldLabelOf({ hidden: fold.hidden, expanded })}
        </button>
      ) : null}
      {fold.shown.map((task) => (
        <Row
          key={task.ordinal}
          leading={GLYPH[task.status]}
          title={
            <span className={cn(task.status === EPlanStatus.Pending && 'text-muted-foreground')}>
              {planTaskLabel(task)}
            </span>
          }
        />
      ))}
    </section>
  )
}
