'use client'

import { useRef, useState } from 'react'
import type {
  AriaAttributes,
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  Ref,
} from 'react'
import { ArrowUpIcon, PlusIcon, SquareIcon } from 'lucide-react'

import { AttachmentGroup } from '#components/attachment'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '#components/input-group'
import { Spinner } from '#components/spinner'

import { type PromptAttachment, PromptAttachmentChip } from './prompt-attachment-chip'

export { EPromptAttachmentStatus, type PromptAttachment } from './prompt-attachment-chip'

export interface PromptInputProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  onSubmit?: (text: string) => void
  placeholder?: string
  busy?: boolean
  queueWhileBusy?: boolean
  sending?: boolean
  clearOnSubmit?: boolean
  onStop?: () => void
  attachments?: PromptAttachment[]
  onAttachFiles?: (files: File[]) => void
  accept?: string
  onRemoveAttachment?: (id: string) => void
  textareaRef?: Ref<HTMLTextAreaElement>
  onTextareaKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  textareaAria?: Pick<
    AriaAttributes,
    | 'aria-activedescendant'
    | 'aria-controls'
    | 'aria-haspopup'
    | 'aria-autocomplete'
    | 'aria-expanded'
  > & { role?: 'combobox' }
  children?: ReactNode
}

interface SendInput {
  text: string
  busy: boolean
  sending?: boolean
  queueWhileBusy?: boolean
}

export function canSend({
  text,
  busy,
  sending = false,
  queueWhileBusy = false,
}: SendInput): boolean {
  if (sending) return false
  if (busy && !queueWhileBusy) return false
  return text.trim().length > 0
}

const pastedFiles = (data: DataTransfer): File[] => {
  const files = Array.from(data.files ?? [])
  const candidates =
    files.length > 0
      ? files
      : Array.from(data.items ?? []).flatMap((item) => {
          const file = item.kind === 'file' ? item.getAsFile() : null
          return file === null ? [] : [file]
        })
  return candidates
}

const dragCarriesFiles = (data: DataTransfer): boolean =>
  Array.from(data.types ?? []).includes('Files')

const insertedByEditor = (text: string): boolean =>
  typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)

export function PromptInput({
  value,
  defaultValue = '',
  onValueChange,
  onSubmit,
  placeholder = 'Ask the agent to change your code...',
  busy = false,
  queueWhileBusy = false,
  sending = false,
  clearOnSubmit = true,
  onStop,
  attachments = [],
  onAttachFiles,
  accept,
  onRemoveAttachment,
  textareaRef,
  onTextareaKeyDown,
  textareaAria,
  children,
}: PromptInputProps) {
  const [draft, setDraft] = useState(defaultValue)
  const formRef = useRef<HTMLFormElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const text = value ?? draft
  const sendable = canSend({ text, busy, sending, queueWhileBusy })

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value)
    onValueChange?.(event.target.value)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!sendable) return
    onSubmit?.(text.trim())
    if (!clearOnSubmit) return
    setDraft('')
    onValueChange?.('')
  }

  const attachPastedImages = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (onAttachFiles === undefined || event.currentTarget.readOnly) return
    const files = pastedFiles(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    onAttachFiles(files)
  }

  // Chromium drops a native paste when the clipboard changes mid-paste, which clipboard-restoring
  // dictation tools (Wispr Flow) trigger; the paste event's own data survives. See
  // third_party/blink/renderer/core/editing/commands/clipboard_commands.cc (SequenceNumber checks).
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget
    const pasted = event.clipboardData.getData('text/plain')
    if (pasted === '') return attachPastedImages(event)
    if (field.readOnly) return
    event.preventDefault()
    if (insertedByEditor(pasted)) return
    const caret = field.selectionStart + pasted.length
    field.setRangeText(pasted, field.selectionStart, field.selectionEnd)
    field.setSelectionRange(caret, caret)
    setDraft(field.value)
    onValueChange?.(field.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onTextareaKeyDown?.(event)
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    formRef.current?.requestSubmit()
  }

  const handleFilesChosen = (event: ChangeEvent<HTMLInputElement>) => {
    onAttachFiles?.(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const acceptsDrops = onAttachFiles !== undefined && !sending

  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!acceptsDrops || !dragCarriesFiles(event.dataTransfer)) return
    event.preventDefault()
  }

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!acceptsDrops) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    event.preventDefault()
    onAttachFiles(files)
  }

  const handleAttachClick = () => fileRef.current?.click()

  return (
    <form ref={formRef} onSubmit={handleSubmit} onDragOver={handleDragOver} onDrop={handleDrop}>
      <InputGroup>
        {attachments.length > 0 ? (
          <InputGroupAddon align="block-start">
            <AttachmentGroup className="flex-wrap">
              {attachments.map((attachment) => (
                <PromptAttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={onRemoveAttachment}
                />
              ))}
            </AttachmentGroup>
          </InputGroupAddon>
        ) : null}
        <InputGroupTextarea
          ref={textareaRef}
          {...textareaAria}
          value={text}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoCorrect="off"
          readOnly={sending}
          aria-busy={sending}
          className={sending ? 'text-muted-foreground' : undefined}
          aria-label="Message"
        />
        <InputGroupAddon align="block-end">
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            multiple
            hidden
            onChange={handleFilesChosen}
          />
          <InputGroupButton
            size="icon-sm"
            variant="outline"
            shape="round"
            aria-label="Attach files"
            onClick={handleAttachClick}
          >
            <PlusIcon />
          </InputGroupButton>
          <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
          {busy ? (
            <InputGroupButton
              size="icon-sm"
              variant="default"
              shape="round"
              aria-label="Stop"
              onClick={onStop}
            >
              <SquareIcon />
            </InputGroupButton>
          ) : null}
          {busy && !queueWhileBusy ? null : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              shape="round"
              disabled={!sendable}
              aria-label={sending ? 'Sending' : 'Send'}
            >
              {sending ? <Spinner aria-hidden="true" /> : <ArrowUpIcon />}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
