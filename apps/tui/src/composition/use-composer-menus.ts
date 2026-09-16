import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo } from 'react'

import type { CommandSpec } from '@dltech/atlas-core'
import type { FileBrowser } from '@dltech/atlas-harness'

import { cdQueryOf } from '../ui/cd-menu-model'
import type { CommandMenuState } from '../ui/command-menu-model'
import type { FileMenuState } from '../ui/file-menu-model'
import { useCdMenu } from './use-cd-menu'
import { useCommandMenu } from './use-command-menu'
import { useFileMenu } from './use-file-menu'

export type ComposerMenus = {
  command: CommandMenuState | null
  file: FileMenuState | null
  cd: FileMenuState | null
  handleTextChanged: (text: string) => void
  handleKey: (key: KeyEvent) => boolean
  handleDismiss: () => void
}

export function useComposerMenus(args: {
  specs: readonly CommandSpec[]
  files?: FileBrowser | undefined
  currentDirectory: string
  onComplete: (text: string) => void
}): ComposerMenus {
  const { files, onComplete } = args

  const commands = useCommandMenu({ specs: args.specs, onComplete })
  const mentions = useFileMenu({ files, onComplete })
  const cd = useCdMenu({ files, currentDirectory: args.currentDirectory, onComplete })

  const handleTextChanged = useCallback(
    (text: string) => {
      commands.handleTextChanged(text)
      cd.handleTextChanged(text)

      if (cdQueryOf(text) === null) {
        mentions.handleTextChanged(text)
        return
      }
      mentions.handleDismiss()
    },
    [commands, mentions, cd],
  )

  const handleDismiss = useCallback(() => {
    commands.handleDismiss()
    mentions.handleDismiss()
    cd.handleDismiss()
  }, [commands, mentions, cd])

  const handleKey = useCallback(
    (key: KeyEvent): boolean =>
      commands.handleKey(key) || cd.handleKey(key) || mentions.handleKey(key),
    [commands, mentions, cd],
  )

  return useMemo(
    () => ({
      command: commands.state,
      file: mentions.state,
      cd: cd.state,
      handleTextChanged,
      handleKey,
      handleDismiss,
    }),
    [commands.state, cd.state, handleDismiss, handleKey, handleTextChanged, mentions.state],
  )
}
