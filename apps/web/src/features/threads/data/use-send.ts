import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { SaidImageWire } from '@dltech/atlas-wire/web'

import { sameImages } from './composer-images'
import type { Handoff } from './composer-handoff'
import { deliverMessage } from './send-message'
import type { LiveSend } from './live-thread-view'
import { provisionSandbox } from './threads-api'

type Attempt = { text: string; images: SaidImageWire[]; sendId: string }

export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const isRetryOf = (args: {
  previous: { text: string; images: readonly SaidImageWire[] } | null
  text: string
  images: readonly SaidImageWire[]
}): boolean =>
  args.previous !== null &&
  args.previous.text === args.text &&
  sameImages(args.previous.images, args.images)

export function useSend() {
  const [sending, setSending] = useState(false)
  const attempt = useRef<Attempt | null>(null)

  const send = useCallback(
    async (args: {
      threadId: string
      text: string
      images?: SaidImageWire[]
      liveSend: LiveSend
    }): Promise<Handoff | null> => {
      const images = args.images ?? []
      const sendId =
        attempt.current !== null &&
        isRetryOf({ previous: attempt.current, text: args.text, images })
          ? attempt.current.sendId
          : crypto.randomUUID()
      attempt.current = { text: args.text, images, sendId }
      setSending(true)
      try {
        await deliverMessage({ ...args, sendId })
        attempt.current = null
        return { text: args.text, sendId }
      } catch (failure) {
        toast.error(messageOf(failure))
        return null
      } finally {
        setSending(false)
      }
    },
    [],
  )

  const retryBoot = useCallback(async (threadId: string): Promise<void> => {
    try {
      await provisionSandbox({ threadId })
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }, [])

  return { sending, send, retryBoot }
}
