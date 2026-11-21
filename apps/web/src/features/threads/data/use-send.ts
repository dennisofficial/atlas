import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { Attachment } from '@dltech/atlas-core'

import { activityOverrides } from '@/features/shell/activity-overrides'

import { sameAttachments } from './composer-attachments'
import type { Handoff } from './composer-handoff'
import { promptLatency } from './prompt-latency'
import { deliverMessage } from './send-message'
import type { LiveSend } from './live-thread-view'
import { useThreadBackend } from './use-thread-backend'

type Attempt = {
  text: string
  attachments: Attachment[]
  sendId: string
}

export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const isRetryOf = (args: {
  previous: { text: string; attachments: readonly Attachment[] } | null
  text: string
  attachments: readonly Attachment[]
}): boolean =>
  args.previous !== null &&
  args.previous.text === args.text &&
  sameAttachments(args.previous.attachments, args.attachments)

export function useSend() {
  const backend = useThreadBackend()
  const [sending, setSending] = useState(false)
  const attempt = useRef<Attempt | null>(null)

  const send = useCallback(
    async (args: {
      threadId: string
      text: string
      attachments?: Attachment[]
      liveSend: LiveSend
      podState: string
      turnWasRunning: boolean
    }): Promise<Handoff | null> => {
      const { podState, turnWasRunning, ...message } = args
      const attachments = message.attachments ?? []
      const sendId =
        attempt.current !== null &&
        isRetryOf({
          previous: attempt.current,
          text: message.text,
          attachments,
        })
          ? attempt.current.sendId
          : crypto.randomUUID()
      attempt.current = { text: message.text, attachments, sendId }
      promptLatency.begin({ threadId: message.threadId, sendId, podState, turnWasRunning })
      setSending(true)
      const optimistic = activityOverrides.markWorking(message.threadId)
      try {
        await deliverMessage({ ...message, sendId, post: backend.postMessage })
        attempt.current = null
        return { text: message.text, sendId }
      } catch (failure) {
        promptLatency.drop({ threadId: message.threadId })
        if (optimistic !== undefined) {
          activityOverrides.revert({
            threadId: message.threadId,
            override: optimistic,
          })
        }
        toast.error(messageOf(failure))
        return null
      } finally {
        setSending(false)
      }
    },
    [backend],
  )

  const retryBoot = useCallback(
    async (threadId: string): Promise<void> => {
      try {
        await backend.provision({ threadId })
      } catch (failure) {
        toast.error(messageOf(failure))
      }
    },
    [backend],
  )

  return { sending, send, retryBoot }
}
