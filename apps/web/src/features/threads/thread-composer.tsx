'use client'

import type { KeyboardEvent, ReactNode } from 'react'

import { PromptInput } from '@dltech/atlas-ui/ai/prompt-input'

export function ThreadComposer({
  value,
  onValueChange,
  onSubmit,
  onEscape,
  disabled,
  placeholder,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (text: string) => void
  onEscape?: (() => void) | undefined
  disabled: boolean
  placeholder?: string | undefined
  children?: ReactNode
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    onEscape?.()
  }
  return (
    <fieldset disabled={disabled} onKeyDown={handleKeyDown} className="m-0 min-w-0 border-0 p-0">
      <PromptInput
        value={value}
        onValueChange={onValueChange}
        onSubmit={onSubmit}
        {...(placeholder === undefined ? {} : { placeholder })}
      >
        {children}
      </PromptInput>
    </fieldset>
  )
}
