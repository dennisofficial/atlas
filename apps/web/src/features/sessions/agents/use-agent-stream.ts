'use client'

import { useMemo } from 'react'

import { memorySessionLog } from '@dltech/atlas-client/stream'

import { sessionStream } from '../data/session-stream'
import { useSessionStream, type SessionStream } from '../data/use-session-stream'

export function useAgentStream({
  sessionId,
  agentId,
}: {
  sessionId: string
  agentId: string
}): SessionStream {
  const log = useMemo(() => memorySessionLog(), [agentId])
  return useSessionStream({ sessionId, threadId: agentId, connection: sessionStream, log })
}
