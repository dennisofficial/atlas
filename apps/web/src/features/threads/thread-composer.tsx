'use client'

import type { KeyboardEvent, ReactNode } from 'react'

import { PromptInput, type PromptInputProps } from '@dltech/atlas-ui/ai/prompt-input'

export function ThreadComposer({
  value,
  onValueChange,
  onSubmit,
  onEscape,
  sending,
  working,
  onStop,
  placeholder,
  children,
  ...attach
}: Pick<PromptInputProps, 'attachments' | 'onAttachFiles' | 'onRemoveAttachment'> & {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (text: string) => void
  onEscape?: (() => void) | undefined
  sending: boolean
  working?: boolean | undefined
  onStop?: (() => void) | undefined
  placeholder?: string | undefined
  children?: ReactNode
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    onEscape?.()
  }
  return (
    <fieldset onKeyDown={handleKeyDown} className="m-0 min-w-0 border-0 p-0">
      <PromptInput
        value={value}
        onValueChange={onValueChange}
        onSubmit={onSubmit}
        sending={sending}
        busy={working}
        queueWhileBusy
        onStop={onStop}
        clearOnSubmit={false}
        accept="image/*"
        {...attach}
        {...(placeholder === undefined ? {} : { placeholder })}
      >
        {children}
      </PromptInput>
    </fieldset>
  )
}
