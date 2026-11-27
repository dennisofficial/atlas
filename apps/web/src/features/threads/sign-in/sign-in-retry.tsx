'use client'

import { postInputOf } from '@dltech/atlas-client/session'
import { signInRetryTextOf } from '@dltech/atlas-plugin-mcp/client'
import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { toast } from 'sonner'

import { sessionsApi } from '@/features/sessions/data/sessions-api'
import { messageOf } from '@/features/threads/data/message-of'

export type SignInRetry = (server: string) => void

export const SignInRetryContext = createContext<SignInRetry | null>(null)

export const useSignInRetry = (): SignInRetry | null => useContext(SignInRetryContext)

export const sendSignInRetry = async (args: {
  sessionId: string
  server: string
}): Promise<void> => {
  try {
    await sessionsApi.post({
      ...postInputOf({
        sessionId: args.sessionId,
        text: signInRetryTextOf(args.server),
        clientId: crypto.randomUUID(),
        media: [],
        uploads: [],
      }),
      sentAt: new Date().toISOString(),
    })
  } catch (failure) {
    toast.error(messageOf(failure))
  }
}

export function SignInRetryProvider({
  sessionId,
  children,
}: {
  sessionId: string
  children: ReactNode
}) {
  const retry = useCallback<SignInRetry>(
    (server) => {
      void sendSignInRetry({ sessionId, server })
    },
    [sessionId],
  )
  return <SignInRetryContext.Provider value={retry}>{children}</SignInRetryContext.Provider>
}
