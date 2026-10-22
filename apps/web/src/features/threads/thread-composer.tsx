'use client'

import type { ReactNode } from 'react'

import { PromptInput } from '@dltech/atlas-ui/ai/prompt-input'

export function ThreadComposer({
  value,
  onValueChange,
  onSubmit,
  disabled,
  placeholder,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (text: string) => void
  disabled: boolean
  placeholder?: string | undefined
  children?: ReactNode
}) {
  return (
    <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
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
