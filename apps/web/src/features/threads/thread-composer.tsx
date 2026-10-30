'use client'

import type { KeyboardEvent, ReactNode } from 'react'

import type { CommandSpec } from '@dltech/atlas-core'
import { PromptInput, type PromptInputProps } from '@dltech/atlas-ui/ai/prompt-input'

import { CommandMenu, COMMAND_MENU_ID, optionIdOf } from './commands/command-menu'
import { useCommandMenu } from './commands/use-command-menu'

const NO_SPECS: readonly CommandSpec[] = []

export function ThreadComposer({
  value,
  onValueChange,
  onSubmit,
  onEscape,
  sending,
  working,
  onStop,
  placeholder,
  commandSpecs = NO_SPECS,
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
  commandSpecs?: readonly CommandSpec[] | undefined
  children?: ReactNode
}) {
  const menu = useCommandMenu({
    text: value,
    specs: commandSpecs,
    onComplete: onValueChange,
  })
  const handleKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    onEscape?.()
  }
  return (
    <fieldset onKeyDown={handleKeyDown} className="relative m-0 min-w-0 border-0 p-0">
      {menu.open ? (
        <CommandMenu candidates={menu.candidates} active={menu.active} onSelect={menu.complete} />
      ) : null}
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
        onTextareaKeyDown={menu.handleKeyDown}
        textareaAria={
          menu.open
            ? {
                role: 'combobox',
                'aria-expanded': true,
                'aria-controls': COMMAND_MENU_ID,
                'aria-activedescendant': optionIdOf(menu.active),
                'aria-autocomplete': 'list',
                'aria-haspopup': 'listbox',
              }
            : undefined
        }
        {...attach}
        {...(placeholder === undefined ? {} : { placeholder })}
      >
        {children}
      </PromptInput>
    </fieldset>
  )
}
