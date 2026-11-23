import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DirectoryEntry } from '@dltech/atlas-core'

import {
  completedMention,
  mentionQueryOf,
  moveFileSelection,
  openFileMenu,
  type FileMenuState,
} from '../file-menu-model'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export type MentionListing = {
  list: (directory: string) => Promise<readonly DirectoryEntry[]>
}

export type FileMenuControl = {
  state: FileMenuState | null
  handleTextChanged: (text: string) => void
  handleKey: (key: KeyEvent) => boolean
  handleDismiss: () => void
}

type HeldMenu = {
  reader: MentionListing | undefined
  ticket: number
  menu: FileMenuState | null
}

export function useFileMenu(args: {
  reader?: MentionListing | undefined
  onComplete: (text: string) => void
  onProblem?: ((reason: string) => void) | undefined
}): FileMenuControl {
  const { reader, onComplete } = args
  const [held, setHeld] = useState<HeldMenu>({ reader, ticket: 0, menu: null })
  const current = useRef<HeldMenu>(held)
  const typed = useRef('')
  const asked = useRef(0)
  const reportProblem = useRef(args.onProblem)
  reportProblem.current = args.onProblem

  const setMenu = useCallback(
    (menu: FileMenuState | null): void => {
      const next = { reader, ticket: asked.current, menu }
      current.current = next
      setHeld(next)
    },
    [reader],
  )

  const ask = useCallback(
    (text: string) => {
      asked.current += 1
      setMenu(null)

      const query = mentionQueryOf(text)
      if (query === null || reader === undefined) return

      const ticket = asked.current
      reader.list(query.directory).then(
        (entries: readonly DirectoryEntry[]) => {
          if (ticket !== asked.current) return
          setMenu(openFileMenu({ query, entries }))
        },
        (error: unknown) => {
          if (ticket !== asked.current) return
          reportProblem.current?.(`could not list files to mention: ${messageOf(error)}`)
        },
      )
    },
    [reader, setMenu],
  )

  useEffect(() => {
    ask(typed.current)

    return () => {
      asked.current += 1
      current.current = { reader, ticket: asked.current, menu: null }
    }
  }, [ask, reader])

  const handleTextChanged = useCallback(
    (text: string) => {
      typed.current = text
      ask(text)
    },
    [ask],
  )

  const handleDismiss = useCallback(() => {
    asked.current += 1
    setMenu(null)
  }, [setMenu])

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      const shown = current.current
      if (shown.reader !== reader || shown.ticket !== asked.current || shown.menu === null)
        return false

      const state = shown.menu

      if (key.name === 'escape') {
        handleDismiss()
        return true
      }

      if (key.name === 'up' || key.name === 'down') {
        setMenu(moveFileSelection({ state, delta: key.name === 'up' ? -1 : 1 }))
        return true
      }

      if (key.name !== 'tab' && key.name !== 'return') return false

      const completed = completedMention({ text: typed.current, state })
      if (completed === null) return false
      if (key.name === 'return' && completed === typed.current) return false

      handleDismiss()
      onComplete(completed)
      return true
    },
    [reader, handleDismiss, onComplete, setMenu],
  )

  return useMemo(
    () => ({
      state: held.reader === reader ? held.menu : null,
      handleTextChanged,
      handleKey,
      handleDismiss,
    }),
    [reader, held, handleDismiss, handleKey, handleTextChanged],
  )
}
