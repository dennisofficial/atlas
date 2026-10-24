import { useEffect, useState } from 'react'

import { usePageVisible } from '@/lib/use-page-visible'

import { createEventsPoller, INITIAL_THREAD_EVENTS, type ThreadEvents } from './events-poller'
import { fetchEvents, fetchHead } from './threads-api'

export type { ThreadEvents } from './events-poller'

export function useThreadEvents(threadId: string, enabled = true): ThreadEvents {
  const [state, setState] = useState(INITIAL_THREAD_EVENTS)
  const visible = usePageVisible()
  const polling = enabled && visible

  useEffect(() => {
    if (!polling) return undefined
    const poller = createEventsPoller({
      threadId,
      fetchHead,
      fetchEvents,
      onUpdate: (update) => setState(update),
    })
    poller.start()
    return poller.stop
  }, [threadId, polling])

  return state
}
