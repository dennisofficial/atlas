import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import type { Attachment, V2Event } from '@dltech/atlas-core'

import { messageOf } from '@/features/threads/data/use-send'
import { mediaUrls } from '@/features/threads/data/media-urls'

import {
  requestRewind,
  rewindLanded,
  rewindRefused,
  rewoundMessageOf,
  seqByEventIdOf,
  type RewindApi,
  type RewoundMessage,
} from './session-rewind'

type Pending = RewoundMessage & { inboxId: number | undefined }

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

  return useMemo(() => {
    const seqs = seqByEventIdOf(events)
    return {
      points: new Set(seqs.keys()),
      onRewind: ({ eventId }: { eventId: string; text: string }) => {
        const message = rewoundMessageOf({ events, eventId })
        if (message === undefined) return
        const waiting: Pending = { ...message, inboxId: undefined }
        pending.current = waiting
        requestRewind({ api, sessionId, toSeq: message.toSeq })
          .then((inboxId) => {
            if (pending.current === waiting) waiting.inboxId = inboxId
          })
          .catch((failure) => {
            if (pending.current === waiting) pending.current = undefined
            toast.error(messageOf(failure))
          })
      },
    }
  }, [events, sessionId, api])
}
