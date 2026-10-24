'use client'

import { Context } from '@dltech/atlas-ui/ai/context'
import { TaskDock } from '@dltech/atlas-ui/ai/task-dock'

import type { ContextUsage } from './data/context-usage'
import type { useComposerDock } from './data/use-composer-dock'

export type ComposerDockState = ReturnType<typeof useComposerDock>

export function ComposerDock({ dock }: { dock: ComposerDockState }) {
  return (
    <TaskDock
      steps={dock.steps}
      queued={dock.queued}
      onRemoveQueued={(id) => void dock.handleRemoveQueued(id)}
    />
  )
}

export function ComposerContext({ usage }: { usage: ContextUsage | null }) {
  if (usage === null) return null
  return <Context className="ml-auto" used={usage.used} limit={usage.limit} />
}
