import { useEffect } from 'react'

import type { ThreadId } from '@dltech/atlas-core'

import type { ConversationStore } from '../store'
import type { AtlasApp } from './compose'

/**
 * The placement flip is not a log append — the lift's marker lands after the archive seals — so a
 * move to the cloud never arrives through the channel. Republish on the placement change or the
 * divider a re-lift owes the transcript would wait for the next event to show up.
 */
export function usePlacementRepublish(args: {
  app: AtlasApp
  threadId: ThreadId
  store: ConversationStore
}): void {
  const { app, threadId, store } = args

  useEffect(() => {
    let held = app.executionLocation.of(threadId)
    return app.executionLocation.subscribe(() => {
      const next = app.executionLocation.of(threadId)
      if (next === held) return
      held = next
      store.republish()
    })
  }, [app.executionLocation, store, threadId])
}
