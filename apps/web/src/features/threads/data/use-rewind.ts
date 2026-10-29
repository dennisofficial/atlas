'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import type { Event } from '@dltech/atlas-core'
import type { RewindCutWire } from '@dltech/atlas-wire/web'

import { planRewind, userRewindPoints, type RewindKillRow } from './rewind'
import type { ThreadSource } from './thread-source'
import { rewindThread } from './threads-api'
import { messageOf } from './use-send'

export const REWIND_WAITS_FOR_TURN =
  'Rewind has to wait for this turn — pick the point again when it settles'

export type RewindPick = {
  toSeq: number
  text: string
  cuts: readonly RewindCutWire[]
  cutAgents: string[]
  kills: RewindKillRow[]
}

type RewindSource = Pick<
  ThreadSource,
  'live' | 'working' | 'applyRewind' | 'readRoster' | 'refreshEvents'
>

const textOf = (args: { events: readonly Event[]; eventId: string }): string => {
  const said = args.events.find((event) => event.id === args.eventId)
  return said?.type === 'user-said' ? said.text : ''
}

export function useRewind(args: {
  threadId: string
  events: () => readonly Event[]
  source: RewindSource
  onRestore: (text: string) => void
}): {
  pick: RewindPick | null
  applying: boolean
  handlePick: (eventId: string) => Promise<void>
  handleCancel: () => void
  handleConfirm: () => Promise<void>
} {
  const { threadId, source, onRestore } = args
  const [pick, setPick] = useState<RewindPick | null>(null)
  const [applying, setApplying] = useState(false)

  const apply = async (picked: RewindPick) => {
    setApplying(true)
    try {
      if (source.live) {
        await source.applyRewind({ cuts: picked.cuts, toSeq: picked.toSeq })
      } else {
        await rewindThread({
          threadId,
          toSeq: picked.toSeq,
          cutAgents: picked.cutAgents,
        })
        source.refreshEvents()
      }
      setPick(null)
      onRestore(picked.text)
    } catch (failure) {
      toast.error(messageOf(failure))
    } finally {
      setApplying(false)
    }
  }

  const handlePick = async (eventId: string) => {
    if (source.working) {
      toast.warning(REWIND_WAITS_FOR_TURN)
      return
    }
    const events = args.events()
    const toSeq = userRewindPoints(events).get(eventId)
    if (toSeq === undefined) return
    const roster = source.live ? await source.readRoster() : null
    const plan = planRewind({ events, toSeq, roster })
    if (plan.kind === 'refused') {
      toast.error(plan.reason)
      return
    }
    const { kind, ...planned } = plan
    const picked: RewindPick = {
      ...planned,
      text: textOf({ events, eventId }),
    }
    if (picked.kills.length > 0) {
      setPick(picked)
      return
    }
    await apply(picked)
  }

  const handleCancel = () => {
    if (!applying) setPick(null)
  }

  const handleConfirm = async () => {
    if (pick === null || applying) return
    await apply(pick)
  }

  return { pick, applying, handlePick, handleCancel, handleConfirm }
}
