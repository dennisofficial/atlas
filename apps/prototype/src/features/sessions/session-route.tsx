'use client'

import { ThreadRoute } from '../threads/thread-route'

export function SessionRoute({ sessionId }: { sessionId: string }) {
  return <ThreadRoute threadId={sessionId} />
}
