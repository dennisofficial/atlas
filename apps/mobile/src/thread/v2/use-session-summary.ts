import { createSessionsFeed } from '@dltech/atlas-client/stream'
import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { sessionStream } from './session-stream'

export const useSessionSummary = (sessionId: string): StreamSessionRow | undefined => {
  const { api } = useAuth()
  const [rows, setRows] = useState<readonly StreamSessionRow[] | undefined>(undefined)

  useEffect(() => {
    if (api === undefined) return undefined
    return createSessionsFeed({
      follow: () => sessionStream(api).followSessions(),
      write: setRows,
    }).retain()
  }, [api])

  return useMemo(() => rows?.find((row) => row.sessionId === sessionId), [rows, sessionId])
}
