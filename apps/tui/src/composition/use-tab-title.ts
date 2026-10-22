import { useEffect } from 'react'

import { isWaiting, type BackgroundWork } from '../ui/background-wait'
import {
  IDLE_TITLE_GLYPH,
  NEEDS_OPERATOR_TITLE_GLYPH,
  WORKING_TITLE_FRAME_MS,
  workingTitleFrame,
} from '../ui/glyphs'
import { subscribeTicker } from '../ui/hooks/use-shimmer-clock'
import type { Conversation } from './conversation-types'
import { terminalTitleSequence } from './terminal-title'
import { ETitleState, titleStateOf } from './title-state'

export function useTabTitle(args: {
  conversation: Pick<
    Conversation,
    'sessionName' | 'projectDirectory' | 'working' | 'operatorInput' | 'endedOnQuestion'
  >
  background: BackgroundWork
}): void {
  const { conversation, background } = args
  const name = conversation.sessionName
  const directory = conversation.projectDirectory
  const state = titleStateOf({
    working: conversation.working,
    asking: conversation.operatorInput.state !== null,
    endedOnQuestion: conversation.endedOnQuestion,
    backgroundBusy: isWaiting(background),
  })

  useEffect(() => {
    const writeTitle = (glyph: string): void => {
      process.stdout.write(terminalTitleSequence({ name, directory, glyph }))
    }
    if (state === ETitleState.Idle) {
      writeTitle(IDLE_TITLE_GLYPH)
      return
    }
    if (state === ETitleState.NeedsOperator) {
      writeTitle(NEEDS_OPERATOR_TITLE_GLYPH)
      return
    }
    return subscribeTicker({
      intervalMs: WORKING_TITLE_FRAME_MS,
      onTick: (now) => writeTitle(workingTitleFrame(now)),
    })
  }, [name, directory, state])
}
