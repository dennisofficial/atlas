'use client'

import { useEffect, useRef, useState } from 'react'

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
  className?: string
}

export function QueuedMessages({
  messages,
  onSave,
  onRemove,
  editingId,
  onEditingChange,
  className,
}: QueuedMessagesProps) {
  const [internalEditingId, setInternalEditingId] = useState(editingId)
  const listRef = useRef<HTMLUListElement>(null)
  const activeId = onEditingChange ? editingId : internalEditingId

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

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
    <ul
      ref={listRef}
      aria-label="Queued messages"
      className={cn('flex max-h-[40vh] flex-col items-stretch gap-3 overflow-y-auto', className)}
    >
      {messages.map((message) => (
        <QueuedMessageRow
          key={message.id}
          message={message}
          editing={message.id === activeId}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onSave={handleSave}
          onRemove={handleRemove}
        />
      ))}
    </ul>
  )
}
