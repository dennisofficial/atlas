import { useCallback, useRef, useState } from 'react'

import type { SessionModelChoice } from '@dltech/atlas-protocol'

import type { ThreadRow } from '../ui/threads-model'
import {
  EScreen,
  screenOnBack,
  screenOnPick,
  screenOnReturn,
  screenOnTeammate,
  type OpenSession,
  type ScreenState,
} from './app-screen'

export type SessionNav = {
  handlePick: (row: ThreadRow) => void
  handleOpenSession: (agentId: string) => void
  handleBack: () => void
}

/**
 * One level of return, not a stack: a teammate row opens as an ordinary session and `esc` comes
 * back to the session the operator left, which is the only promise a terminal can keep honestly.
 */
export function useSessionNav(args: {
  screen: ScreenState
  setScreen: (next: ScreenState) => void
  modelOf: (sessionId: string) => SessionModelChoice | null
  titleOf: (sessionId: string) => string | null
}): SessionNav {
  const [back, setBack] = useState<OpenSession | null>(null)
  const { screen, setScreen } = args
  const reads = useRef({ modelOf: args.modelOf, titleOf: args.titleOf })
  reads.current = { modelOf: args.modelOf, titleOf: args.titleOf }

  const handlePick = useCallback(
    (row: ThreadRow) => {
      setBack(null)
      setScreen(screenOnPick({ row, model: reads.current.modelOf(row.threadId) }))
    },
    [setScreen],
  )

  const handleOpenSession = useCallback(
    (agentId: string) => {
      if (screen.screen !== EScreen.Transcript) return

      setBack({ sessionId: screen.sessionId, title: screen.title, model: screen.model })
      setScreen(
        screenOnTeammate({
          teammate: {
            sessionId: agentId,
            title: reads.current.titleOf(agentId),
            model: reads.current.modelOf(agentId),
          },
        }),
      )
    },
    [screen, setScreen],
  )

  const handleBack = useCallback(() => {
    const target = back
    setBack(null)
    setScreen(target === null ? screenOnBack() : screenOnReturn({ back: target }))
  }, [back, setScreen])

  return { handlePick, handleOpenSession, handleBack }
}
