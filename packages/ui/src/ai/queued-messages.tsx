'use client'

import { useState } from 'react'

import { cn } from '#lib/utils'
import { QueuedMessageRow } from './internal/queued-message-row'
import { isEmptyDraft } from './queued-message-ops'
import type { QueuedMessageEntry, QueuedMessageSave } from './queued-message-types'

export {
  EQueuedAttachmentKind,
  type QueuedAttachment,
  type QueuedMessageEntry,
  type QueuedMessageSave,
} from './queued-message-types'

export interface QueuedMessagesProps {
  messages: QueuedMessageEntry[]
  onSave: (save: QueuedMessageSave) => void
  onRemove: (id: string) => void
  editingId?: string
  onEditingChange?: (id: string | undefined) => void
  stagedIds?: ReadonlySet<string>
  className?: string
}

export function QueuedMessages({
  messages,
  onSave,
  onRemove,
  editingId,
  onEditingChange,
  stagedIds,
  className,
}: QueuedMessagesProps) {
  const [internalEditingId, setInternalEditingId] = useState(editingId)
  const activeId = onEditingChange ? editingId : internalEditingId

  if (messages.length === 0) return null

  const setEditing = (id: string | undefined) => {
    setInternalEditingId(id)
    onEditingChange?.(id)
  }

  const handleStartEdit = (id: string) => setEditing(id)
  const handleCancelEdit = () => setEditing(undefined)

  const handleSave = (save: QueuedMessageSave) => {
    setEditing(undefined)
    if (isEmptyDraft(save)) {
      onRemove(save.id)
      return
    }
    onSave({ ...save, text: save.text.trim() })
  }

  const handleRemove = (id: string) => {
    if (id === activeId) setEditing(undefined)
    onRemove(id)
  }

  return (
    <ul aria-label="Queued messages" className={cn('flex flex-col items-stretch gap-3', className)}>
      {messages.map((message) => (
        <QueuedMessageRow
          key={message.id}
          message={message}
          editing={message.id === activeId}
          staged={stagedIds?.has(message.id) ?? false}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onSave={handleSave}
          onRemove={handleRemove}
        />
      ))}
    </ul>
  )
}
