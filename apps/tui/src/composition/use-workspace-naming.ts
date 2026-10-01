import { useEffect, useRef } from 'react'

import type { ThreadId } from '@dltech/atlas-core'

import { TITLE_CELLS } from '../store/sidebar-text'
import { useNamingAnimation } from '../ui/hooks/use-naming-animation'
import type { useConversation } from './use-conversation'

type NamingWatch = { threadId: ThreadId; active: boolean; streamed: string | null }

export function useWorkspaceNaming(args: { conversation: ReturnType<typeof useConversation> }) {
  const { conversation } = args
  const namingAnimation = useNamingAnimation({ fallbackCells: TITLE_CELLS })
  const namingWatch = useRef<NamingWatch>({
    threadId: conversation.threadId,
    active: false,
    streamed: null,
  })

  useEffect(() => {
    const watching = namingWatch.current
    const request = conversation.namingRequest
    if (watching.threadId !== conversation.threadId) {
      namingWatch.current = { threadId: conversation.threadId, active: false, streamed: null }
      namingAnimation.end()
      return
    }
    if (request !== null && !watching.active) {
      watching.active = true
      watching.streamed = null
      namingAnimation.begin(request.from)
      if (request.answer !== null) {
        watching.streamed = request.answer
        namingAnimation.stream(request.answer)
      }
      return
    }
    if (request !== null && request.answer !== null && watching.streamed !== request.answer) {
      watching.streamed = request.answer
      namingAnimation.stream(request.answer)
    }
    if (request === null && watching.active) {
      watching.active = false
      watching.streamed = null
      namingAnimation.end()
    }
  })

  return namingAnimation.state
}
