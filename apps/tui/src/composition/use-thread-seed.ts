import { useCallback } from 'react'

import type { OpenedConversation } from './open-conversation'
import type { ThreadSeed } from './use-thread-view'

export function useThreadSeed(opened: OpenedConversation): () => ThreadSeed {
  return useCallback(
    (): ThreadSeed => ({
      events: opened.events,
      turns: opened.turns,
      ...(opened.base === undefined ? {} : { base: opened.base }),
      ...(opened.identity === undefined ? {} : { identity: opened.identity }),
      ...(opened.appliedEvents === undefined ? {} : { appliedEvents: opened.appliedEvents }),
    }),
    [opened],
  )
}
