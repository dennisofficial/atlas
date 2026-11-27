import type { Attachment, RecordEvent } from '@dltech/atlas-core'
import {
  requestRewind,
  rewindKillsOf,
  rewindLanded,
  rewindRefused,
  rewoundMessageOf,
  seqByEventIdOf,
  type RewindApi,
  type RewoundMessage,
} from '@dltech/atlas-client/session'
import { eventIdOfEntryKey } from '@dltech/atlas-client/transcript'
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Alert } from 'react-native'

import { rewindConfirmOf } from '../message-actions'
import type { MessageRow } from '../rows'

type Pending = { message: RewoundMessage; inboxId: number | undefined }

const applyRewind = async (args: {
  api: RewindApi
  sessionId: string
  message: RewoundMessage
  pending: RefObject<Pending | undefined>
  onNotice: (notice: string) => void
}): Promise<void> => {
  const waiting: Pending = { message: args.message, inboxId: undefined }
  args.pending.current = waiting
  try {
    const inboxId = await requestRewind({
      api: args.api,
      sessionId: args.sessionId,
      toSeq: args.message.toSeq,
    })
    if (args.pending.current === waiting) waiting.inboxId = inboxId
  } catch {
    if (args.pending.current === waiting) args.pending.current = undefined
    args.onNotice('Rewind failed. Try again.')
  }
}

export const useMessageRewind = (args: {
  sessionId: string
  events: readonly RecordEvent[]
  api: RewindApi | undefined
  onRestore: (restored: { text: string; attachments: readonly Attachment[] }) => void
  onNotice: (notice: string) => void
}): {
  rewindPoints: ReadonlySet<string>
  handleRewind: (row: MessageRow) => void
} => {
  const { sessionId, events, api, onRestore, onNotice } = args
  const pending = useRef<Pending | undefined>(undefined)
  const rewindPoints = useMemo(() => new Set(seqByEventIdOf(events).keys()), [events])

  useEffect(() => {
    const waiting = pending.current
    if (waiting === undefined) return
    if (waiting.inboxId !== undefined && rewindRefused({ events, inboxId: waiting.inboxId })) {
      pending.current = undefined
      onNotice('Rewind was refused.')
      return
    }
    if (!rewindLanded({ events, eventId: waiting.message.eventId })) return
    pending.current = undefined
    onRestore({ text: waiting.message.text, attachments: waiting.message.attachments })
  }, [events, onNotice, onRestore])

  const handleRewind = useCallback(
    (row: MessageRow) => {
      if (api === undefined) return
      const message = rewoundMessageOf({ events, eventId: eventIdOfEntryKey(row.id) })
      if (message === undefined) return
      const confirm = rewindConfirmOf(rewindKillsOf({ events, toSeq: message.toSeq }))
      Alert.alert(confirm.title, confirm.message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rewind',
          style: 'destructive',
          onPress: () => void applyRewind({ api, sessionId, message, pending, onNotice }),
        },
      ])
    },
    [api, events, sessionId, onNotice],
  )

  return { rewindPoints, handleRewind }
}
