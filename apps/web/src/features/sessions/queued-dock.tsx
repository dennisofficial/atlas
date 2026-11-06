'use client'

import { QueuedMessages } from '@dltech/atlas-ui/ai/queued-messages'

import type { useQueuedDock } from './data/use-queued-dock'

const noop = () => undefined

export type QueuedDockState = ReturnType<typeof useQueuedDock>

export function QueuedDock({ dock }: { dock: QueuedDockState }) {
  return (
    <QueuedMessages
      messages={dock.entries}
      onSave={noop}
      onRemove={dock.handleRemove}
      editingId={undefined}
      onEditingChange={dock.handleEdit}
    />
  )
}
