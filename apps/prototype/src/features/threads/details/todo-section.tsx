import { CircleCheckIcon, CircleIcon, LoaderCircleIcon } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { TODOS } from './details-fixtures'
import { ETodoStatus, foldTodos, todoCountOf, todoDoneLabelOf, todoLabelOf } from './details-model'
import { DetailsSection, RowButton } from './section'

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
        <p key={task.id} className="flex min-w-0 items-center gap-2 px-1 py-0.5 text-sm">
          <span className="shrink-0">{ICON[task.status]}</span>
          <span
            className={cn('truncate', task.status === ETodoStatus.Done && 'text-muted-foreground')}
          >
            {todoLabelOf(task)}
          </span>
        </p>
      ))}
      {fold.hidden > 0 ? (
        <RowButton onClick={() => setExpanded((held) => !held)}>
          <span className="text-xs text-muted-foreground">
            {todoDoneLabelOf({ hidden: fold.hidden, expanded })}
          </span>
        </RowButton>
      ) : null}
    </DetailsSection>
  )
}
