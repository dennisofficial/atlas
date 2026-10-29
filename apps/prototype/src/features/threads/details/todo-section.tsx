import { CircleCheckIcon, CircleIcon, LoaderCircleIcon } from 'lucide-react'
import { useState } from 'react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { TODOS } from './details-fixtures'
import { ETodoStatus, foldTodos, todoCountOf, todoDoneLabelOf, todoLabelOf } from './details-model'
import { DetailsSection } from './section'

const ICON: Record<ETodoStatus, React.JSX.Element> = {
  [ETodoStatus.Done]: (
    <CircleCheckIcon role="img" aria-label="Done" className="size-3.5 text-success" />
  ),
  [ETodoStatus.Running]: (
    <LoaderCircleIcon role="img" aria-label="In progress" className="size-3.5 animate-spin" />
  ),
  [ETodoStatus.Pending]: (
    <CircleIcon role="img" aria-label="Pending" className="size-3.5 text-muted-foreground" />
  ),
}

export function TodoSection() {
  const [expanded, setExpanded] = useState(false)
  const fold = foldTodos({ tasks: TODOS, expanded })

  return (
    <DetailsSection title="Todo" count={todoCountOf(TODOS)}>
      {fold.shown.map((task) => (
        <DetailRow
          key={task.id}
          icon={ICON[task.status]}
          label={
            <span className={cn(task.status === ETodoStatus.Done && 'text-muted-foreground')}>
              {todoLabelOf(task)}
            </span>
          }
        />
      ))}
      {fold.hidden > 0 ? (
        <DetailRow
          onClick={() => setExpanded((held) => !held)}
          label={
            <span className="text-xs text-muted-foreground">
              {todoDoneLabelOf({ hidden: fold.hidden, expanded })}
            </span>
          }
        />
      ) : null}
    </DetailsSection>
  )
}
