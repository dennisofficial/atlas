import { useCallback } from 'react'

import type { Attachment, SaidUpload } from '@dltech/atlas-core'
import { signInRetryTextOf } from '@dltech/atlas-plugin-mcp/client'

import type { SessionSend } from '../use-session-send'

export type SignInRetryMessage = {
  text: string
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}

export const signInRetryMessageOf = (server: string): SignInRetryMessage => ({
  text: signInRetryTextOf(server),
  media: [],
  uploads: [],
})

export const useSignInRetry = (handleSend: SessionSend['handleSend']): ((server: string) => void) =>
  useCallback(
    (server: string) => {
      void handleSend(signInRetryMessageOf(server))
    },
    [handleSend],
  )
