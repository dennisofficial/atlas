import type { EClientAction } from '@dltech/atlas-commands'
import { useEffect, useRef } from 'react'

import type { DraftControls } from '../ui/hooks/use-draft'
import { useCommandMenu, type CommandMenu } from './use-command-menu'
import type { SessionApi } from './session-api'
import { useTuiCommands } from './use-tui-commands'

export type SessionCommands = {
  menu: CommandMenu
  run: (name: string) => void
  action: (action: EClientAction) => void
}

export function useSessionCommands(args: {
  api: SessionApi
  draft: Pick<DraftControls, 'value' | 'setValue' | 'clear'> & { editor: DraftControls['editor'] }
  onSubmit: () => void
  sessionId: string
  cwd: string
  onNew: () => void
  onSessions: () => void
  onQuit: () => void
  onModel: () => void
  onRewind: () => void
  onWake: () => void
  onShells: () => void
  onSkills: () => void
  onMcp: () => void
  onSettings: () => void
  onAuth: () => void
  onProblem: (reason: string) => void
}): SessionCommands {
  const runName = useRef<(name: string) => void>(() => undefined)
  const runAction = useRef<(action: EClientAction) => void>(() => undefined)

  const menu = useCommandMenu({
    api: args.api,
    draft: args.draft,
    onAction: (action) => runAction.current(action),
    onLocal: (name) => runName.current(name),
    onRun: (text) => {
      args.draft.setValue(text)
      args.onSubmit()
    },
    onProblem: args.onProblem,
  })

  const commands = useTuiCommands({
    sessionId: args.sessionId,
    cwd: args.cwd,
    onNew: args.onNew,
    onSessions: args.onSessions,
    onQuit: args.onQuit,
    onModel: args.onModel,
    onHelp: menu.handleOpen,
    onRewind: args.onRewind,
    onWake: args.onWake,
    onShells: args.onShells,
    onSkills: args.onSkills,
    onMcp: args.onMcp,
    onSettings: args.onSettings,
    onAuth: args.onAuth,
    onProblem: args.onProblem,
  })
  runName.current = commands.run
  runAction.current = commands.action

  const readMenu = useRef(menu.handleText)
  readMenu.current = menu.handleText

  useEffect(() => {
    readMenu.current(args.draft.value)
  }, [args.draft.value, menu.entries])

  return { menu, run: commands.run, action: commands.action }
}
