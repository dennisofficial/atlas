'use client'

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { SummariseReach, RecordEvent } from '@dltech/atlas-core'

import type { TranscriptSummarise } from '@/features/threads/data/use-summarise'
import { messageOf } from '@/features/threads/data/message-of'

import { sessionsApi } from './sessions-api'
import type { RequestedCommandState } from './use-requested-command'
import { requestSummarise, summariseCopyOf, summarisePointsOf } from '@dltech/atlas-client/session'

const NO_POINTS: ReadonlyMap<string, SummariseReach> = new Map()

export type SessionSummarise = {
  transcript: TranscriptSummarise
  dialog: {
    pick: SummariseReach | null
    onCancel: () => void
    onConfirm: () => void
    copyOf: typeof summariseCopyOf
  }
}

export function useSessionSummarise(args: {
  sessionId: string
  events: readonly RecordEvent[]
  requested: RequestedCommandState
}): SessionSummarise {
  const { sessionId, events, requested } = args
  const { blocking, track } = requested
  const busy = blocking !== undefined
  const [pick, setPick] = useState<SummariseReach | null>(null)
  const points = useMemo(() => (busy ? NO_POINTS : summarisePointsOf(events)), [busy, events])

  const handleSummarise = useCallback(
    (eventId: string) => {
      const reach = points.get(eventId)
      if (reach !== undefined) setPick(reach)
    },
    [points],
  )
  const transcript = useMemo(
    () => ({ points, onSummarise: handleSummarise }),
    [points, handleSummarise],
  )

  const handleConfirm = () => {
    if (pick === null) return
    setPick(null)
    if (busy) return
    track({
      name: 'summarise',
      request: () => requestSummarise({ api: sessionsApi, sessionId, throughSeq: pick.throughSeq }),
    }).catch((failure) => toast.error(messageOf(failure)))
  }

  return {
    transcript,
    dialog: {
      pick,
      onCancel: () => setPick(null),
      onConfirm: handleConfirm,
      copyOf: summariseCopyOf,
    },
  }
}
