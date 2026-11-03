'use client'

import { useMemo, useRef, useState } from 'react'

import type { Event } from '@dltech/atlas-core'
import { toast } from 'sonner'

import { ERewindRoute, userRewindPoints } from './rewind'
import {
  applyRewindPick,
  decideRewind,
  ERewindDecision,
  REWIND_WAITS_FOR_SANDBOX,
  type RewindPick,
  type RewindSituation,
} from './rewind-flow'
import type { ThreadSource } from './thread-source'
import { useThreadBackend } from './use-thread-backend'
import { messageOf } from './use-send'

type RewindSource = Pick<ThreadSource, 'applyRewind' | 'readRoster' | 'refreshEvents'>

export type RewindTranscript = {
  points: ReadonlySet<string>
  onRewind: (picked: { eventId: string; text: string }) => void
}

export type RewindDialogProps = {
  pick: RewindPick | null
  applying: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function useRewind(args: {
  events: readonly Event[]
  situation: () => RewindSituation
  source: RewindSource
  onRestore: (text: string) => void
}): { transcript: RewindTranscript; dialog: RewindDialogProps } {
  const { source, onRestore } = args
  const backend = useThreadBackend()
  const applyOffline = async (offline: {
    threadId: string
    toSeq: number
    cutAgents: string[]
  }) => {
    await backend.rewind(offline)
  }
  const [pick, setPick] = useState<RewindPick | null>(null)
  const [applying, setApplying] = useState(false)
  const inFlight = useRef(false)

  const apply = async (picked: RewindPick) => {
    if (inFlight.current) return
    inFlight.current = true
    setApplying(true)
    try {
      await applyRewindPick({
        threadId: args.situation().threadId,
        pick: picked,
        appliers: {
          applyLive: source.applyRewind,
          applyOffline,
          refreshEvents: source.refreshEvents,
        },
      })
      setPick(null)
      onRestore(picked.text)
    } catch (failure) {
      toast.error(messageOf(failure))
    } finally {
      inFlight.current = false
      setApplying(false)
    }
  }

  const handlePick = async (picked: { eventId: string; text: string }) => {
    if (inFlight.current) return
    const before = args.situation()
    const roster = before.live && !before.working ? await source.readRoster() : null
    const decision = decideRewind({ situation: args.situation(), ...picked, roster })
    switch (decision.kind) {
      case ERewindDecision.Warn:
        toast.warning(decision.message)
        return
      case ERewindDecision.Refuse:
        toast.error(decision.message)
        return
      case ERewindDecision.Confirm:
        setPick(decision.pick)
        return
      case ERewindDecision.Apply:
        await apply(decision.pick)
        return
      case ERewindDecision.Ignore:
        return
    }
  }

  const handleCancel = () => {
    if (!inFlight.current) setPick(null)
  }

  const handleConfirm = async () => {
    if (pick === null) return
    if (pick.route === ERewindRoute.Live && !args.situation().live) {
      toast.warning(REWIND_WAITS_FOR_SANDBOX)
      setPick(null)
      return
    }
    await apply(pick)
  }

  const points = useMemo(() => new Set(userRewindPoints(args.events).keys()), [args.events])
  return {
    transcript: { points, onRewind: (picked) => void handlePick(picked) },
    dialog: { pick, applying, onCancel: handleCancel, onConfirm: () => void handleConfirm() },
  }
}
