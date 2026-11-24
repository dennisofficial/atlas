import { EClientAction } from '@dltech/atlas-commands'
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
  onSkills: () => void
  onMcp: () => void
  onSettings: () => void
  onAuth: () => void
  onProblem: (reason: string) => void
}): TuiCommands {
  const { sessionId, cwd, onProblem } = args
  const { onNew, onSessions, onQuit, onModel, onHelp, onRewind, onWake, onShells } = args
  const { onSkills, onMcp, onSettings, onAuth } = args

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

      if (name === 'settings') {
        onSettings()
        return
      }

      if (name === 'auth') {
        onAuth()
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
    [cwd, onAuth, onNew, onProblem, onQuit, onRewind, onSessions, onSettings, onWake, sessionId],
  )

  const action = useCallback(
    (picked: EClientAction) => {
      if (picked === EClientAction.ModelPicker) {
        onModel()
        return
      }
      if (picked === EClientAction.Skills) {
        onSkills()
        return
      }
      if (picked === EClientAction.Mcp) {
        onMcp()
        return
      }
      if (picked === EClientAction.Shells) {
        onShells()
        return
      }
      onHelp()
    },
    [onHelp, onMcp, onModel, onShells, onSkills],
  )

  return useMemo(() => ({ run, action }), [action, run])
}
