import type { KeyEvent } from '@opentui/core'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { DirectoryEntry } from '@dltech/atlas-core'
import type { FileBrowser } from '@dltech/atlas-harness'

import { cdQueryOf, completedCdArgument, openCdMenu } from '../ui/cd-menu-model'
import { moveFileSelection, type FileMenuState } from '../ui/file-menu-model'
import { expandHome } from '../ui/paths'

export type CdMenuControl = {
  state: FileMenuState | null
  handleTextChanged: (text: string) => void
  handleKey: (key: KeyEvent) => boolean
  handleDismiss: () => void
}

const listingDirectoryOf = (args: { directory: string; current: string }): string => {
  if (args.directory === '') return args.current

  const expanded = expandHome({ path: args.directory, home: homedir() })
  if (isAbsolute(expanded)) return expanded

  return resolve(args.current, expanded)
}

export function useCdMenu(args: {
  files?: FileBrowser | undefined
  currentDirectory: string
  onComplete: (text: string) => void
}): CdMenuControl {
  const [state, setState] = useState<FileMenuState | null>(null)
  const typed = useRef('')
  const asked = useRef(0)
  const { files, currentDirectory, onComplete } = args

  const handleTextChanged = useCallback(
    (text: string) => {
      typed.current = text
      asked.current += 1

      const query = cdQueryOf(text)
      if (query === null || files === undefined) {
        setState(null)
        return
      }

      const ticket = asked.current
      const directory = listingDirectoryOf({ directory: query.directory, current: currentDirectory })
      void files.list(directory).then((entries: readonly DirectoryEntry[]) => {
        if (ticket !== asked.current) return
        setState(openCdMenu({ query, entries }))
      })
    },
    [files, currentDirectory],
  )

  const handleDismiss = useCallback(() => {
    asked.current += 1
    setState(null)
  }, [])

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (state === null) return false

      if (key.name === 'escape') {
        handleDismiss()
        return true
      }

      if (key.name === 'up' || key.name === 'down') {
        setState(moveFileSelection({ state, delta: key.name === 'up' ? -1 : 1 }))
        return true
      }

      if (key.name !== 'tab' && key.name !== 'return') return false

      const completed = completedCdArgument({ text: typed.current, state })
      if (completed === null) return false
      if (key.name === 'return' && completed === typed.current) return false

      setState(null)
      onComplete(completed)
      return true
    },
    [handleDismiss, onComplete, state],
  )

  return useMemo(
    () => ({ state, handleTextChanged, handleKey, handleDismiss }),
    [handleDismiss, handleKey, handleTextChanged, state],
  )
}
