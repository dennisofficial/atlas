'use client'

import type { KeyboardEvent, ReactNode } from 'react'

import { clientActionOfEntries, EClientAction, type CommandEntry } from '@dltech/atlas-commands'

import { PromptInput, type PromptInputProps } from '@dltech/atlas-ui/ai/prompt-input'

import { CommandMenu, COMMAND_MENU_ID, optionIdOf } from './commands/command-menu'
import { useCommandMenu } from './commands/use-command-menu'

const NO_ENTRIES: readonly CommandEntry[] = []

export function ThreadComposer({
  value,
  onValueChange,
  onSubmit,
  onEscape,
  sending,
  working,
  onStop,
  placeholder,
  entries = NO_ENTRIES,
  clientActions,
  children,
  ...attach
}: Pick<
  PromptInputProps,
  'attachments' | 'onAttachFiles' | 'onRemoveAttachment' | 'sendsAttachmentsAlone'
> & {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (text: string) => void
  onEscape?: (() => void) | undefined
  sending: boolean
  working?: boolean | undefined
  onStop?: (() => void) | undefined
  placeholder?: string | undefined
  entries?: readonly CommandEntry[] | undefined
  clientActions?: Record<EClientAction, () => void> | undefined
  children?: ReactNode
}) {
  const menu = useCommandMenu({
    text: value,
    entries,
    onComplete: onValueChange,
  })
  const handleSubmit = (text: string) => {
    if (clientActions !== undefined) {
      const action = clientActionOfEntries({ text, entries })
      if (action !== null) {
        clientActions[action]()
        onValueChange('')
        return
      }
    }
    onSubmit(text)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return
    event.preventDefault()
    if (working === true && onStop !== undefined) {
      onStop()
      return
    }
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
        onSubmit={handleSubmit}
        sending={sending}
        busy={working}
        queueWhileBusy
        onStop={onStop}
        clearOnSubmit={false}
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
