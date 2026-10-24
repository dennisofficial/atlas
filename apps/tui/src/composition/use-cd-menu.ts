import type { KeyEvent } from '@opentui/core'
import { isAbsolute, resolve } from 'node:path'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { DirectoryEntry } from '@dltech/atlas-core'
import type { MentionReader } from '@dltech/atlas-harness'

import { cdQueryOf, completedCdArgument, openCdMenu } from '../ui/cd-menu-model'
import { moveFileSelection, type FileMenuState } from '../ui/file-menu-model'
import { messageOf } from './error-text'

export type CdMenuControl = {
  state: FileMenuState | null
  handleTextChanged: (text: string) => void
  handleKey: (key: KeyEvent) => boolean
  handleDismiss: () => void
}

type Opened = { ticket: number; menu: FileMenuState }

const listingDirectoryOf = (args: { directory: string; current: string }): string => {
  if (args.directory === '') return args.current

  if (args.directory === '~' || args.directory.startsWith('~/') || isAbsolute(args.directory))
    return args.directory
  return resolve(args.current, args.directory)
}

export function useCdMenu(args: {
  files?: Pick<MentionReader, 'list'> | undefined
  currentDirectory: string
  onComplete: (text: string) => void
  onProblem?: ((reason: string) => void) | undefined
}): CdMenuControl {
  const [opened, setOpened] = useState<Opened | null>(null)
  const current = useRef<Opened | null>(null)
  const typed = useRef('')
  const asked = useRef(0)
  const { files, currentDirectory, onComplete } = args

  const setMenu = useCallback((ticket: number, menu: FileMenuState | null): void => {
    const next = menu === null ? null : { ticket, menu }
    current.current = next
    setOpened(next)
  }, [])

  const handleTextChanged = useCallback(
    (text: string) => {
      typed.current = text
      asked.current += 1

      const query = cdQueryOf(text)
      if (query === null || files === undefined) {
        setMenu(asked.current, null)
        return
      }

      const ticket = asked.current
      const directory = listingDirectoryOf({
        directory: query.directory,
        current: currentDirectory,
      })
      void files
        .list(directory)
        .then((entries: readonly DirectoryEntry[]) => {
          if (ticket !== asked.current) return
          setMenu(ticket, openCdMenu({ query, entries }))
        })
        .catch((error: unknown) => {
          if (ticket !== asked.current) return
          setMenu(ticket, null)
          args.onProblem?.(`could not list directories: ${messageOf(error)}`)
        })
    },
    [files, currentDirectory, args.onProblem, setMenu],
  )

  const handleDismiss = useCallback(() => {
    asked.current += 1
    setMenu(asked.current, null)
  }, [setMenu])

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      const held = current.current
      if (held === null) return false
      if (held.ticket !== asked.current) return false

      const state = held.menu

      if (key.name === 'escape') {
        handleDismiss()
        return true
      }

      if (key.name === 'up' || key.name === 'down') {
        setMenu(held.ticket, moveFileSelection({ state, delta: key.name === 'up' ? -1 : 1 }))
        return true
      }

      if (key.name !== 'tab' && key.name !== 'return') return false

      const completed = completedCdArgument({ text: typed.current, state })
      if (completed === null) return false
      if (key.name === 'return' && completed === typed.current) return false

      handleDismiss()
      onComplete(completed)
      return true
    },
    [handleDismiss, onComplete, setMenu],
  )

  return useMemo(
    () => ({
      state: opened === null ? null : opened.menu,
      handleTextChanged,
      handleKey,
      handleDismiss,
    }),
    [opened, handleDismiss, handleKey, handleTextChanged],
  )
}
