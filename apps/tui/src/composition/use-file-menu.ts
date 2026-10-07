import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DirectoryEntry } from '@dltech/atlas-core'
import type { MentionReader } from '@dltech/atlas-harness'

import {
  completedMention,
  mentionQueryOf,
  moveFileSelection,
  openFileMenu,
  type FileMenuState,
} from '../ui/file-menu-model'
import { messageOf } from './error-text'

export type FileMenuControl = {
  state: FileMenuState | null
  handleTextChanged: (text: string) => void
  handleKey: (key: KeyEvent) => boolean
  handleDismiss: () => void
}

type HeldMenu = {
  reader: MentionReader | undefined
  menu: FileMenuState | null
}

export function useFileMenu(args: {
  files?: MentionReader | undefined
  onComplete: (text: string) => void
  onProblem?: ((reason: string) => void) | undefined
}): FileMenuControl {
  const { files, onComplete } = args
  const [held, setHeld] = useState<HeldMenu>({ reader: files, menu: null })
  const state = held.reader === files ? held.menu : null
  const typed = useRef('')
  const asked = useRef(0)
  const reportProblem = useRef(args.onProblem)
  reportProblem.current = args.onProblem

  const close = useCallback(() => {
    setHeld((current) =>
      current.menu === null && current.reader === files ? current : { reader: files, menu: null },
    )
  }, [files])

  const ask = useCallback(
    (text: string) => {
      asked.current += 1
      close()

      const query = mentionQueryOf(text)
      if (query === null || files === undefined) return

      const ticket = asked.current
      files.list(query.directory).then(
        (entries: readonly DirectoryEntry[]) => {
          if (ticket !== asked.current) return
          setHeld({ reader: files, menu: openFileMenu({ query, entries }) })
        },
        (error: unknown) => {
          if (ticket !== asked.current) return
          reportProblem.current?.(`could not list files to mention: ${messageOf(error)}`)
        },
      )
    },
    [close, files],
  )

  useEffect(() => {
    ask(typed.current)

    return () => {
      asked.current += 1
    }
  }, [ask])

  const handleTextChanged = useCallback(
    (text: string) => {
      typed.current = text
      ask(text)
    },
    [ask],
  )

  const handleDismiss = useCallback(() => {
    asked.current += 1
    close()
  }, [close])

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (state === null) return false

      if (key.name === 'escape') {
        handleDismiss()
        return true
      }

      if (key.name === 'up' || key.name === 'down') {
        setHeld({
          reader: files,
          menu: moveFileSelection({ state, delta: key.name === 'up' ? -1 : 1 }),
        })
        return true
      }

      if (key.name !== 'tab' && key.name !== 'return') return false

      const completed = completedMention({ text: typed.current, state })
      if (completed === null) return false
      if (key.name === 'return' && completed === typed.current) return false

      close()
      onComplete(completed)
      return true
    },
    [close, files, handleDismiss, onComplete, state],
  )

  return useMemo(
    () => ({ state, handleTextChanged, handleKey, handleDismiss }),
    [handleDismiss, handleKey, handleTextChanged, state],
  )
}
