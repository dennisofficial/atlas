import { PencilIcon, Trash2Icon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Bubble, BubbleContent } from '#components/bubble'
import { Button } from '#components/button'
import { QueuedMessageAttachments } from './queued-message-attachments'
import { QueuedMessageEditor } from '../queued-message-editor'
import type { QueuedMessageDraft, QueuedMessageEntry } from '../queued-message-types'

interface RowActionProps {
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
}

function RowAction({ label, onClick, className, children }: RowActionProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={onClick}
      className={className}
    >
      {children}
    </Button>
  )
}

function QueuedBubble({ message }: { message: QueuedMessageEntry }) {
  return (
    <Bubble align="end" variant="pending">
      <BubbleContent className="whitespace-pre-wrap">
        <div className="flex max-h-[min(30vh,16rem)] flex-col gap-1.5 overflow-y-auto overscroll-contain">
          <QueuedMessageAttachments attachments={message.attachments} />
          {message.text.length > 0 ? <span>{message.text}</span> : null}
        </div>
      </BubbleContent>
    </Bubble>
  )
}

export interface QueuedMessageRowProps {
  message: QueuedMessageEntry
  editing: boolean
  staged?: boolean
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  onSave: (draft: QueuedMessageDraft & { id: string }) => void
  onRemove: (id: string) => void
}

export function QueuedMessageRow({
  message,
  editing,
  staged = false,
  onStartEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: QueuedMessageRowProps) {
  const handleStartEdit = () => onStartEdit(message.id)
  const handleRemove = () => onRemove(message.id)
  const handleSave = (draft: QueuedMessageDraft) => onSave({ id: message.id, ...draft })

  if (staged) {
    return (
      <li aria-busy="true" className="flex items-end justify-end opacity-45 transition-opacity">
        <QueuedBubble message={message} />
      </li>
    )
  }

  if (editing) {
    return (
      <li className="flex justify-end">
        <QueuedMessageEditor initial={message} onSave={handleSave} onCancel={onCancelEdit} />
      </li>
    )
  }

  return (
    <li className="group/queued flex items-end justify-end gap-0.5">
      <div className="flex shrink-0 items-center gap-0.5 pb-1 opacity-0 transition-opacity group-focus-within/queued:opacity-100 group-hover/queued:opacity-100 pointer-coarse:opacity-100">
        <RowAction label="Edit queued message" onClick={handleStartEdit}>
          <PencilIcon />
        </RowAction>
        <RowAction
          label="Remove queued message"
          onClick={handleRemove}
          className="hover:text-destructive"
        >
          <Trash2Icon />
        </RowAction>
      </div>
      <QueuedBubble message={message} />
    </li>
  )
}
