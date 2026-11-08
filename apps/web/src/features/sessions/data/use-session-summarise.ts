'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { SummariseReach, V2Event } from '@dltech/atlas-core'

import { SUMMARISE_WAITS_FOR_TURN } from '@/features/threads/data/summarise'
import type { TranscriptSummarise } from '@/features/threads/data/use-summarise'
import { messageOf } from '@/features/threads/data/use-send'

import { sessionsApi } from './sessions-api'
import {
  ESummariseOutcome,
  requestSummarise,
  summariseCopyOf,
  summariseOutcomeOf,
  summarisePointsOf,
  type PendingSummarise,
} from './session-summarise'

export type SessionSummarise = {
  transcript: TranscriptSummarise
  dialog: {
    pick: SummariseReach | null
    onCancel: () => void
    onConfirm: () => void
    copyOf: typeof summariseCopyOf
  }
  refusal: string | null
}

export function useSessionSummarise(args: {
  sessionId: string
  events: readonly V2Event[]
  working: boolean
}): SessionSummarise {
  const { sessionId, events, working } = args
  const [pick, setPick] = useState<SummariseReach | null>(null)
  const [pending, setPending] = useState<PendingSummarise | undefined>(undefined)
  const points = useMemo(() => summarisePointsOf(events), [events])
  const outcome = pending === undefined ? undefined : summariseOutcomeOf({ events, pending })

  useEffect(() => {
    if (outcome?.kind === ESummariseOutcome.Applied) setPending(undefined)
  }, [outcome])

  const handleSummarise = useCallback(
    (eventId: string) => {
      if (working) {
        toast.warning(SUMMARISE_WAITS_FOR_TURN)
        return
      }
      const reach = points.get(eventId)
      if (reach !== undefined) setPick(reach)
    },
    [points, working],
  )
  const transcript = useMemo(
    () => ({ points, onSummarise: handleSummarise }),
    [points, handleSummarise],
  )

  const handleConfirm = () => {
    if (pick === null) return
    setPick(null)
    requestSummarise({ api: sessionsApi, sessionId, throughSeq: pick.throughSeq, events }).then(
      setPending,
      (failure) => toast.error(messageOf(failure)),
    )
  }

  return {
    transcript,
    dialog: {
      pick,
      onCancel: () => setPick(null),
      onConfirm: handleConfirm,
      copyOf: summariseCopyOf,
    },
    refusal: outcome?.kind === ESummariseOutcome.Refused ? outcome.reason : null,
  }
}
