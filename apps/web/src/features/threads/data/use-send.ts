import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ESandboxProvisionState } from '@dltech/atlas-wire/web'

import { setPendingSend } from './pending-sends'
import { ESendKind, NOT_CONFIGURED_FALLBACK, sendMessage } from './send-message'
import { provisionSandbox } from './threads-api'

type Attempt = { text: string; sendId: string }

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useSend() {
  const [sending, setSending] = useState(false)
  const [notConfigured, setNotConfigured] = useState<string | null>(null)
  const attempt = useRef<Attempt | null>(null)

  const send = useCallback(
    async (args: {
      threadId: string
      projectId?: string | undefined
      text: string
    }): Promise<boolean> => {
      const sendId =
        attempt.current?.text === args.text ? attempt.current.sendId : crypto.randomUUID()
      attempt.current = { text: args.text, sendId }
      setSending(true)
      setNotConfigured(null)
      try {
        const outcome = await sendMessage({ ...args, sendId })
        if (outcome.kind === ESendKind.NotConfigured) {
          setNotConfigured(outcome.error)
          return false
        }
        setPendingSend({ threadId: args.threadId, sendId, text: args.text })
        attempt.current = null
        return true
      } catch (failure) {
        toast.error(messageOf(failure))
        return false
      } finally {
        setSending(false)
      }
    },
    [],
  )

  const retryBoot = useCallback(async (threadId: string): Promise<void> => {
    setNotConfigured(null)
    try {
      const reply = await provisionSandbox({ threadId })
      if (reply.state === ESandboxProvisionState.NotConfigured) {
        setNotConfigured(reply.error ?? NOT_CONFIGURED_FALLBACK)
      }
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }, [])

  return { sending, notConfigured, send, retryBoot }
}
