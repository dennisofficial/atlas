'use client'

import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from 'react'
import { ArrowUpIcon, FileIcon, PlusIcon, SquareIcon, XIcon } from 'lucide-react'

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '#components/attachment'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '#components/input-group'
import { Spinner } from '#components/spinner'

export interface PromptAttachment {
  id: string
  name: string
}

export interface PromptInputProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  onSubmit?: (text: string) => void
  placeholder?: string
  busy?: boolean
  sending?: boolean
  clearOnSubmit?: boolean
  onStop?: () => void
  attachments?: PromptAttachment[]
  onAttachFiles?: (files: File[]) => void
  onRemoveAttachment?: (id: string) => void
  children?: ReactNode
}

interface SendInput {
  text: string
  busy: boolean
}

export function canSend({ text, busy }: SendInput): boolean {
  return !busy && text.trim().length > 0
}

export function PromptInput({
  value,
  defaultValue = '',
  onValueChange,
  onSubmit,
  placeholder = 'Ask the agent to change your code...',
  busy = false,
  sending = false,
  clearOnSubmit = true,
  onStop,
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
  children,
}: PromptInputProps) {
  const [draft, setDraft] = useState(defaultValue)
  const formRef = useRef<HTMLFormElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const text = value ?? draft
  const sendable = canSend({ text, busy: busy || sending })

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

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    formRef.current?.requestSubmit()
  }

  const handleFilesChosen = (event: ChangeEvent<HTMLInputElement>) => {
    onAttachFiles?.(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleAttachClick = () => fileRef.current?.click()

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <InputGroup>
        {attachments.length > 0 ? (
          <InputGroupAddon align="block-start">
            <AttachmentGroup className="flex-wrap">
              {attachments.map((attachment) => (
                <Attachment key={attachment.id} size="xs">
                  <AttachmentMedia>
                    <FileIcon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{attachment.name}</AttachmentTitle>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => onRemoveAttachment?.(attachment.id)}
                    >
                      <XIcon />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          </InputGroupAddon>
        ) : null}
        <InputGroupTextarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          readOnly={sending}
          aria-busy={sending}
          className={sending ? 'text-muted-foreground' : undefined}
          aria-label="Message"
        />
        <InputGroupAddon align="block-end">
          <input ref={fileRef} type="file" multiple hidden onChange={handleFilesChosen} />
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
          ) : (
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
