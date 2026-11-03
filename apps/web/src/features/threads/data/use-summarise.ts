'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { summarisePoints, type Event, type SummariseReach } from '@dltech/atlas-core'
import { EConnectionView, type RemoteDeltaChannel } from '@dltech/atlas-client/channel'

import {
  decideSummarise,
  ESummariseDecision,
  requestSummarise,
  SUMMARISE_NEEDS_SANDBOX,
  SUMMARISING,
} from './summarise'
import { messageOf } from './use-send'

export type TranscriptSummarise = {
  points: ReadonlyMap<string, SummariseReach>
  onSummarise: (eventId: string) => void
}

type SummariseSituation = {
  threadId: string
  events: readonly Event[]
  channel: RemoteDeltaChannel | null
  live: boolean
  working: boolean
}

const connectedOf = (channel: RemoteDeltaChannel | null): RemoteDeltaChannel | null =>
  channel?.connection().state === EConnectionView.Connected ? channel : null

export function useSummarise(situation: SummariseSituation): {
  transcript: TranscriptSummarise
  dialog: { pick: SummariseReach | null; onCancel: () => void; onConfirm: () => void }
  summarising: boolean
} {
  const latest = useRef(situation)
  useEffect(() => {
    latest.current = situation
  })
  const running = useRef(false)
  const [summarising, setSummarising] = useState(false)
  const [pick, setPick] = useState<SummariseReach | null>(null)
  const points = useMemo(() => summarisePoints(situation.events), [situation.events])

  const onSummarise = useCallback(
    (eventId: string) => {
      const { live, working } = latest.current
      const decision = decideSummarise({
        points,
        eventId,
        live,
        working,
        running: running.current,
      })
      if (decision.kind === ESummariseDecision.Warn) toast.warning(decision.message)
      if (decision.kind === ESummariseDecision.Confirm) setPick(decision.pick)
    },
    [points],
  )
  const transcript = useMemo(() => ({ points, onSummarise }), [points, onSummarise])

  const handleCancel = () => setPick(null)

  const handleConfirm = () => {
    if (pick === null) return
    setPick(null)
    const channel = connectedOf(latest.current.channel)
    if (channel === null) {
      toast.warning(SUMMARISE_NEEDS_SANDBOX)
      return
    }
    running.current = true
    setSummarising(true)
    const summarised = requestSummarise({
      request: (call) => channel.request(call),
      threadId: latest.current.threadId,
      operationId: crypto.randomUUID(),
      pick,
    }).finally(() => {
      running.current = false
      setSummarising(false)
    })
    toast.promise(summarised, {
      loading: SUMMARISING,
      success: (notice) => notice,
      error: messageOf,
    })
  }

  return {
    transcript,
    dialog: { pick, onCancel: handleCancel, onConfirm: handleConfirm },
    summarising,
  }
}
