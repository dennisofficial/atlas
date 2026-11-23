import type { EClientAction } from '@dltech/atlas-commands'
import { useCallback, useMemo } from 'react'

import { buildInfo } from '../build/info'
import { performRespawn, realRespawnPorts, wiresSelfRestart } from './respawn'

export type TuiCommands = {
  run: (name: string) => void
  action: (action: EClientAction) => void
}

export function useTuiCommands(args: {
  sessionId: string | null
  cwd: string
  onNew: () => void
  onSessions: () => void
  onQuit: () => void
  onModel: () => void
  onHelp: () => void
  onRewind: () => void
  onWake: () => void
  onShells: () => void
  onProblem: (reason: string) => void
}): TuiCommands {
  const { sessionId, cwd, onProblem } = args
  const { onNew, onSessions, onQuit, onModel, onHelp, onRewind, onWake, onShells } = args

  const run = useCallback(
    (name: string) => {
      if (name === 'new') {
        onNew()
        return
      }

      if (name === 'sessions') {
        onSessions()
        return
      }

      if (name === 'exit') {
        onQuit()
        return
      }

      if (name === 'rewind') {
        onRewind()
        return
      }

      if (name === 'shells') {
        onShells()
        return
      }

      if (name === 'restart') {
        if (!wiresSelfRestart(buildInfo().kind)) {
          onProblem('restart is only wired in a built binary')
          return
        }
        performRespawn({
          execPath: process.execPath,
          cwd,
          resumeHandle: sessionId,
          ports: realRespawnPorts(process.execPath),
        })
        return
      }

      if (name === 'wake') {
        if (sessionId === null) {
          onProblem('there is no pod to wake yet')
          return
        }
        onWake()
        return
      }

      onProblem(`/${name} is not a command in this build`)
    },
    [cwd, onNew, onProblem, onQuit, onRewind, onSessions, onShells, onWake, sessionId],
  )

  const action = useCallback(
    (picked: EClientAction) => {
      if (picked === 'model-picker') {
        onModel()
        return
      }
      onHelp()
    },
    [onHelp, onModel],
  )

  return useMemo(() => ({ run, action }), [action, run])
}
