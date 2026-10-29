'use client'

import { useState } from 'react'
import { CircleCheckIcon, CircleIcon, LoaderCircleIcon } from 'lucide-react'

import { EPlanStatus, foldPlan, planFromEvents, planTaskLabel } from '@dltech/atlas-core'
import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { useThreadPanel } from '../thread-panel-context'
import { planCountOf, planDoneLabelOf } from './details-model'
import { DetailsSection } from './section'

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
        <DetailRow
          key={task.ordinal}
          icon={ICON[task.status]}
          label={
            <span className={cn(task.status === EPlanStatus.Completed && 'text-muted-foreground')}>
              {planTaskLabel(task)}
            </span>
          }
        />
      ))}
      {fold.hidden > 0 ? (
        <DetailRow
          onClick={() => setExpanded((held) => !held)}
          label={
            <span className="text-xs text-muted-foreground">
              {planDoneLabelOf({ hidden: fold.hidden, expanded })}
            </span>
          }
        />
      ) : null}
    </DetailsSection>
  )
}
