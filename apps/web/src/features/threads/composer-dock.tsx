'use client'

import { Context } from '@dltech/atlas-ui/ai/context'
import { QueuedMessages } from '@dltech/atlas-ui/ai/queued-messages'
import { PlanSummary } from '@dltech/atlas-ui/ai/plan-summary'

import type { ContextUsage } from './data/context-usage'
import type { useComposerDock } from './data/use-composer-dock'

export type ComposerDockState = ReturnType<typeof useComposerDock>

export function ComposerDock(props: { dock: ComposerDockState; onOpenDetails: () => void }) {
  const { dock, onOpenDetails } = props
  return (
    <>
      <PlanSummary steps={dock.steps} onOpen={onOpenDetails} />
      <QueuedMessages
        messages={dock.queued}
        onSave={(save) => void dock.handleSaveQueued(save)}
        onRemove={(id) => void dock.handleRemoveQueued(id)}
      />
    </>
  )
}

export function ComposerContext({ usage }: { usage: ContextUsage | null }) {
  if (usage === null) return null
  return <Context className="ml-auto" used={usage.used} limit={usage.limit} />
}
