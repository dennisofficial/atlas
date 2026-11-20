'use client'

import { QueuedMessages } from '@dltech/atlas-ui/ai/queued-messages'
import { QueuedNotices } from '@dltech/atlas-ui/ai/queued-notices'

import type { useQueuedDock } from './data/use-queued-dock'

const noop = () => undefined

export type QueuedDockState = ReturnType<typeof useQueuedDock>

export function QueuedDock({ dock }: { dock: QueuedDockState }) {
  return (
    <>
      <QueuedNotices notices={dock.notices} />
      <QueuedMessages
        messages={dock.entries}
        stagedIds={dock.stagedIds}
        onSave={noop}
        onRemove={dock.handleRemove}
        editingId={undefined}
        onEditingChange={dock.handleEdit}
      />
    </>
  )
}
