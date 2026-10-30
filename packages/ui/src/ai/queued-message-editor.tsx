'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { PaperclipIcon } from 'lucide-react'

import { Bubble, BubbleContent } from '#components/bubble'
import { Button } from '#components/button'
import { QueuedMessageAttachments } from './internal/queued-message-attachments'
import { attachmentsFromFiles } from './queued-message-ops'
import type { QueuedAttachment, QueuedMessageDraft } from './queued-message-types'

export interface QueuedMessageEditorProps {
  initial: QueuedMessageDraft
  onSave: (draft: QueuedMessageDraft) => void
  onCancel: () => void
}

export function QueuedMessageEditor({ initial, onSave, onCancel }: QueuedMessageEditorProps) {
  const [text, setText] = useState(initial.text)
  const [attachments, setAttachments] = useState<QueuedAttachment[]>(initial.attachments)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])

  const handleSave = () => onSave({ text, attachments })

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)

  const handleRemoveAttachment = (id: string) =>
    setAttachments((previous) => previous.filter((attachment) => attachment.id !== id))

  const handlePickFiles = () => fileRef.current?.click()

  const handleFilesChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const added = attachmentsFromFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
    setAttachments((previous) => [...previous, ...added])
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    handleSave()
  }

  return (
    <Bubble align="end" variant="pending">
      <BubbleContent className="min-w-64">
        <div className="flex flex-col gap-1.5">
          <QueuedMessageAttachments attachments={attachments} onRemove={handleRemoveAttachment} />
          <textarea
            ref={inputRef}
            value={text}
            aria-label="Edit queued message"
            autoCorrect="off"
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className="field-sizing-content w-full resize-none bg-transparent leading-relaxed outline-none"
          />
          <div className="flex items-center gap-1.5">
            <input ref={fileRef} type="file" multiple hidden onChange={handleFilesChosen} />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Add files"
              onClick={handlePickFiles}
            >
              <PaperclipIcon />
            </Button>
            <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" size="xs" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </BubbleContent>
    </Bubble>
  )
}
