'use client'

import { useState } from 'react'
import { CircleCheckIcon, CircleIcon, LoaderCircleIcon } from 'lucide-react'

import { EPlanStatus, foldPlan, planFromEvents, planTaskLabel } from '@dltech/atlas-core'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { useThreadPanel } from '../thread-panel-context'
import { planCountOf, planDoneLabelOf } from './details-model'
import { DetailsSection, RowButton } from './section'

const ICON: Record<EPlanStatus, React.JSX.Element> = {
  [EPlanStatus.Completed]: (
    <CircleCheckIcon role="img" aria-label="Done" className="size-3.5 text-success" />
  ),
  [EPlanStatus.InProgress]: (
    <LoaderCircleIcon role="img" aria-label="In progress" className="size-3.5 animate-spin" />
  ),
  [EPlanStatus.Pending]: (
    <CircleIcon role="img" aria-label="Pending" className="size-3.5 text-muted-foreground" />
  ),
}

export function TodoSection() {
  const { details } = useThreadPanel()
  const [expanded, setExpanded] = useState(false)
  const tasks = planFromEvents(details.events)
  if (tasks.length === 0) return null

  const fold = foldPlan({ tasks, expanded })
  return (
    <DetailsSection title="Todo" count={planCountOf(tasks)}>
      {fold.shown.map((task) => (
        <p key={task.ordinal} className="flex min-w-0 items-center gap-2 px-1 py-0.5 text-sm">
          <span className="shrink-0">{ICON[task.status]}</span>
          <span
            className={cn(
              'truncate',
              task.status === EPlanStatus.Completed && 'text-muted-foreground',
            )}
          >
            {planTaskLabel(task)}
          </span>
        </p>
      ))}
      {fold.hidden > 0 ? (
        <RowButton onClick={() => setExpanded((held) => !held)}>
          <span className="text-xs text-muted-foreground">
            {planDoneLabelOf({ hidden: fold.hidden, expanded })}
          </span>
        </RowButton>
      ) : null}
    </DetailsSection>
  )
}
