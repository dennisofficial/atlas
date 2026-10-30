import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { SaidUpload } from '@dltech/atlas-core'
import type { SaidImageWire } from '@dltech/atlas-wire/web'

import { activityOverrides } from '@/features/shell/activity-overrides'

import { sameUploads } from './composer-attachments'
import { sameImages } from './composer-images'
import type { Handoff } from './composer-handoff'
import { deliverMessage } from './send-message'
import type { LiveSend } from './live-thread-view'
import { useThreadBackend } from './use-thread-backend'

type Attempt = {
  text: string
  images: SaidImageWire[]
  uploads: SaidUpload[]
  sendId: string
}

export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const isRetryOf = (args: {
  previous: {
    text: string
    images: readonly SaidImageWire[]
    uploads?: readonly SaidUpload[] | undefined
  } | null
  text: string
  images: readonly SaidImageWire[]
  uploads?: readonly SaidUpload[] | undefined
}): boolean =>
  args.previous !== null &&
  args.previous.text === args.text &&
  sameImages(args.previous.images, args.images) &&
  sameUploads(args.previous.uploads ?? [], args.uploads ?? [])

export function useSend() {
  const backend = useThreadBackend()
  const [sending, setSending] = useState(false)
  const attempt = useRef<Attempt | null>(null)

  const send = useCallback(
    async (args: {
      threadId: string
      text: string
      images?: SaidImageWire[]
      uploads?: SaidUpload[]
      liveSend: LiveSend
    }): Promise<Handoff | null> => {
      const images = args.images ?? []
      const uploads = args.uploads ?? []
      const sendId =
        attempt.current !== null &&
        isRetryOf({
          previous: attempt.current,
          text: args.text,
          images,
          uploads,
        })
          ? attempt.current.sendId
          : crypto.randomUUID()
      attempt.current = { text: args.text, images, uploads, sendId }
      setSending(true)
      const optimistic = activityOverrides.markWorking(args.threadId)
      try {
        await deliverMessage({ ...args, sendId, post: backend.postMessage })
        attempt.current = null
        return { text: args.text, sendId }
      } catch (failure) {
        if (optimistic !== undefined) {
          activityOverrides.revert({
            threadId: args.threadId,
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
