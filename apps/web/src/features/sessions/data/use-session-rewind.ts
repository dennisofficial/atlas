import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { Attachment, V2Event } from '@dltech/atlas-core'

import {
  requestRewind,
  rewindKillsOf,
  rewindLanded,
  rewindRefused,
  rewoundMessageOf,
  seqByEventIdOf,
  type RewindApi,
  type RewindKillRow,
  type RewoundMessage,
} from '@dltech/atlas-client/session'
import { messageOf } from '@/features/threads/data/use-send'
import { mediaUrls } from '@/features/threads/data/media-urls'

type Pending = RewoundMessage & { inboxId: number | undefined }

export type RewindPick = {
  message: RewoundMessage
  toSeq: number
  kills: readonly RewindKillRow[]
}

/**
 * Rewinds to a message and, once the rewind lands in the stream, puts that message's text and
 * attachments back in the composer next to whatever is already there.
 */
export function useSessionRewind(args: {
  sessionId: string
  events: readonly V2Event[]
  api: RewindApi
  onRestore: (restored: {
    text: string
    attachments: readonly Attachment[]
    previewOf: (hash: string) => Promise<string>
  }) => void
}) {
  const { sessionId, events, api } = args
  const pending = useRef<Pending | undefined>(undefined)
  const restore = useRef(args.onRestore)
  restore.current = args.onRestore
  const [pick, setPick] = useState<RewindPick | null>(null)
  const [applying, setApplying] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    const waiting = pending.current
    if (waiting === undefined) return
    if (waiting.inboxId !== undefined && rewindRefused({ events, inboxId: waiting.inboxId })) {
      pending.current = undefined
      return
    }
    if (!rewindLanded({ events, eventId: waiting.eventId })) return
    pending.current = undefined
    restore.current({
      text: waiting.text,
      attachments: waiting.attachments,
      previewOf: (hash) => mediaUrls.urlOf({ sessionId, hash }),
    })
  }, [events, sessionId])

  const send = async (picked: RewindPick) => {
    const waiting: Pending = { ...picked.message, inboxId: undefined }
    pending.current = waiting
    try {
      const inboxId = await requestRewind({
        api,
        sessionId,
        toSeq: picked.message.toSeq,
      })
      if (pending.current === waiting) waiting.inboxId = inboxId
    } catch (failure) {
      if (pending.current === waiting) pending.current = undefined
      toast.error(messageOf(failure))
    }
  }

  const transcript = useMemo(
    () => ({
      points: new Set(seqByEventIdOf(events).keys()),
      onRewind: ({ eventId }: { eventId: string; text: string }) => {
        const message = rewoundMessageOf({ events, eventId })
        if (message === undefined) return
        setPick({
          message,
          toSeq: message.toSeq,
          kills: rewindKillsOf({ events, toSeq: message.toSeq }),
        })
      },
    }),
    [events],
  )

  const handleCancel = () => {
    if (!inFlight.current) setPick(null)
  }

  const handleConfirm = async () => {
    if (pick === null || inFlight.current) return
    inFlight.current = true
    setApplying(true)
    try {
      await send(pick)
      setPick(null)
    } finally {
      inFlight.current = false
      setApplying(false)
    }
  }

  return {
    ...transcript,
    dialog: { pick, applying, onCancel: handleCancel, onConfirm: () => void handleConfirm() },
  }
}
