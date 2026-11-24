import { useCallback, useRef, useState } from 'react'

import type { Attachment, SaidUpload } from '@dltech/atlas-core'
import { messageInputOf, postInputOf } from '@dltech/atlas-client/session'

import { rememberSentClientId } from './sent-client-ids'
import type { SessionApi } from './session-api'
import type { StagedState } from './staged-messages'

export type SessionSend = {
  sending: boolean
  sends: number
  handleSend: (args: {
    text: string
    media: readonly Attachment[]
    uploads: readonly SaidUpload[]
  }) => Promise<boolean>
  handleStop: () => void
}

type Attempt = { text: string; attachmentIds: readonly string[]; clientId: string }

const attachmentIdsOf = (args: {
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): readonly string[] => [
  ...args.media.map((attachment) => attachment.id),
  ...args.uploads.map((upload) => upload.uploadId),
]

export const stagedAttachmentsOf = (args: {
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): readonly Attachment[] =>
  messageInputOf({ text: '', media: args.media, uploads: args.uploads }).attachments ?? []

const sameAttempt = (args: {
  held: Attempt | null
  text: string
  attachmentIds: readonly string[]
}): boolean => {
  if (args.held === null) return false
  if (args.held.text !== args.text) return false
  if (args.held.attachmentIds.length !== args.attachmentIds.length) return false
  return args.held.attachmentIds.every((id, index) => id === args.attachmentIds[index])
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useSessionSend(args: {
  api: SessionApi
  sessionId: string
  staged: StagedState
  onProblem: (reason: string) => void
}): SessionSend {
  const [sending, setSending] = useState(false)
  const [sends, setSends] = useState(0)
  const attempt = useRef<Attempt | null>(null)
  const inFlight = useRef(false)
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem
  const { api, sessionId, staged } = args

  const handleSend = useCallback(
    async (message: {
      text: string
      media: readonly Attachment[]
      uploads: readonly SaidUpload[]
    }): Promise<boolean> => {
      if (
        message.text.trim() === '' &&
        message.media.length === 0 &&
        message.uploads.length === 0
      ) {
        problem.current('a message needs text or a picture')
        return false
      }
      if (inFlight.current) return false
      inFlight.current = true

      const attachmentIds = attachmentIdsOf(message)
      const held = attempt.current
      const clientId =
        held !== null && sameAttempt({ held, text: message.text, attachmentIds })
          ? held.clientId
          : crypto.randomUUID()

      attempt.current = { text: message.text, attachmentIds, clientId }
      rememberSentClientId(clientId)
      staged.stage({ clientId, text: message.text, attachments: stagedAttachmentsOf(message) })
      setSending(true)

      try {
        await api.post(
          postInputOf({
            sessionId,
            text: message.text,
            clientId,
            media: message.media,
            uploads: message.uploads,
          }),
        )
        setSends((count) => count + 1)
        attempt.current = null
        return true
      } catch (failure) {
        staged.withdraw(clientId)
        problem.current(messageOf(failure))
        return false
      } finally {
        inFlight.current = false
        setSending(false)
      }
    },
    [api, sessionId, staged],
  )

  const handleStop = useCallback(() => {
    void api.stop({ sessionId }).catch((failure: unknown) => {
      const reason = messageOf(failure)
      if (reason.includes('unknown')) return
      problem.current(reason)
    })
  }, [api, sessionId])

  return { sending, sends, handleSend, handleStop }
}
