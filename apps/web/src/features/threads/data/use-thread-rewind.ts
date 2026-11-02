import { useMemo } from 'react'

import type { Event } from '@dltech/atlas-core'

import { restoredDraftOf } from './take-back'
import { userRewindPoints } from './rewind'
import type { RewindSituation } from './rewind-flow'
import type { ThreadSource } from './thread-source'
import { useRewind } from './use-rewind'

export function useThreadRewind(args: {
  threadId: string
  events: readonly Event[]
  source: Pick<ThreadSource, 'applyRewind' | 'readRoster' | 'refreshEvents' | 'live'>
  working: boolean
  podState: RewindSituation['podState']
  setDraft: (update: (current: string) => string) => void
}) {
  const { threadId, events, source, working, podState, setDraft } = args
  const rewindPoints = useMemo(() => new Set(userRewindPoints(events).keys()), [events])
  const rewind = useRewind({
    situation: () => ({ threadId, events, live: source.live, working, podState }),
    source,
    onRestore: (restored) => setDraft((current) => restoredDraftOf({ current, restored })),
  })
  return { rewind, rewindPoints }
}
