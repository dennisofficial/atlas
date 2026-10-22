import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { sendMessage } from './send-message'
import { provisionSandbox } from './threads-api'

type Attempt = { text: string; sendId: string }

export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useSend() {
  const [sending, setSending] = useState(false)
  const attempt = useRef<Attempt | null>(null)

  const send = useCallback(async (args: { threadId: string; text: string }): Promise<boolean> => {
    const sendId =
      attempt.current?.text === args.text ? attempt.current.sendId : crypto.randomUUID()
    attempt.current = { text: args.text, sendId }
    setSending(true)
    try {
      await sendMessage({ ...args, sendId })
      attempt.current = null
      return true
    } catch (failure) {
      toast.error(messageOf(failure))
      return false
    } finally {
      setSending(false)
    }
  }, [])

  const retryBoot = useCallback(async (threadId: string): Promise<void> => {
    try {
      await provisionSandbox({ threadId })
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }, [])

  return { sending, send, retryBoot }
}
