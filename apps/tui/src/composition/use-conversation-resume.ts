import { useEffect, useRef } from 'react'

import { EOpenMode } from './config'
import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'
import type { TurnDriver } from './use-turn-driver'

export function useResumeOnOpen(args: {
  app: AtlasApp
  opened: OpenedConversation
  turnDriver: TurnDriver
  moving: boolean
}): void {
  const { app, opened, turnDriver, moving } = args
  const resumeAtLaunch = useRef(app.config.open.mode !== EOpenMode.New)
  const resumeOnArrival = useRef(opened.resumeOnArrival === true)

  useEffect(() => {
    if (moving) return
    if (resumeOnArrival.current) {
      resumeOnArrival.current = false
      resumeAtLaunch.current = false
      turnDriver.handleResumeFresh()
      return
    }

    if (!resumeAtLaunch.current) return
    resumeAtLaunch.current = false
    if (turnDriver.isResumable) turnDriver.handleResume()
  }, [moving, turnDriver])
}
