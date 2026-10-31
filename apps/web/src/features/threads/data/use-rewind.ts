'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { eventsFromWire } from './events-from-wire'
import { ERewindRoute } from './rewind'
import {
  applyRewindPick,
  decideRewind,
  ERewindDecision,
  REWIND_WAITS_FOR_SANDBOX,
  type RewindDecision,
  type RewindPick,
  type RewindSituation,
} from './rewind-flow'
import type { ThreadSource } from './thread-source'
import { useThreadBackend } from './use-thread-backend'
import { messageOf } from './use-send'

type RewindSource = Pick<
  ThreadSource,
  'applyRewind' | 'readRoster' | 'prepareRewind' | 'refreshEvents'
>

export function useRewind(args: {
  situation: () => RewindSituation
  source: RewindSource
  onRestore: (text: string) => void
}): {
  pick: RewindPick | null
  applying: boolean
  handlePick: (picked: { eventId: string; text: string }) => Promise<void>
  handleCancel: () => void
  handleConfirm: () => Promise<void>
} {
  const latest = useRef(args)
  latest.current = args
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
  const preparing = useRef(false)
  const selected = useRef<{ threadId: string; eventId: string; text: string } | null>(null)

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

  const decideLocal = async (picked: { eventId: string; text: string }) => {
    if (source.prepareRewind === undefined) throw new Error('Local rewind is not available')
    const threadId = latest.current.situation().threadId
    const prepared = await source.prepareRewind()
    const situation = latest.current.situation()
    if (situation.threadId !== threadId)
      throw new Error('The selected thread changed — pick the rewind point again')
    return decideRewind({
      situation: {
        ...situation,
        events: eventsFromWire(prepared.events),
        working: prepared.working,
        live: true,
      },
      ...picked,
      roster: prepared.roster,
    })
  }

  const handleDecision = async (decision: RewindDecision) => {
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

  const handlePick = async (picked: { eventId: string; text: string }) => {
    if (inFlight.current || preparing.current) return
    selected.current = { ...picked, threadId: args.situation().threadId }
    if (backend.local) {
      preparing.current = true
      setApplying(true)
      try {
        await handleDecision(await decideLocal(picked))
      } catch (failure) {
        toast.error(messageOf(failure))
      } finally {
        preparing.current = false
        setApplying(false)
      }
      return
    }
    const before = args.situation()
    const roster = before.live && !before.working ? await source.readRoster() : null
    await handleDecision(decideRewind({ situation: args.situation(), ...picked, roster }))
  }

  const handleCancel = () => {
    if (!inFlight.current && !preparing.current) setPick(null)
  }

  const handleConfirm = async () => {
    if (pick === null || inFlight.current || preparing.current) return
    if (backend.local) {
      if (selected.current === null) return
      if (selected.current.threadId !== latest.current.situation().threadId) {
        setPick(null)
        toast.warning('The selected thread changed — pick the rewind point again')
        return
      }
      preparing.current = true
      setApplying(true)
      try {
        const decision = await decideLocal(selected.current)
        if (decision.kind === ERewindDecision.Confirm || decision.kind === ERewindDecision.Apply) {
          const current = decision.pick
          if (
            current.toSeq !== pick.toSeq ||
            JSON.stringify(current.cuts) !== JSON.stringify(pick.cuts) ||
            JSON.stringify(current.kills) !== JSON.stringify(pick.kills)
          ) {
            setPick(current)
            toast.warning('The rewind changed — review it and confirm again')
            return
          }
          await apply(current)
        } else {
          setPick(null)
          await handleDecision(decision)
        }
      } catch (failure) {
        toast.error(messageOf(failure))
      } finally {
        preparing.current = false
        setApplying(false)
      }
      return
    }
    if (pick.route === ERewindRoute.Live && !args.situation().live) {
      toast.warning(REWIND_WAITS_FOR_SANDBOX)
      setPick(null)
      return
    }
    await apply(pick)
  }

  return { pick, applying, handlePick, handleCancel, handleConfirm }
}
