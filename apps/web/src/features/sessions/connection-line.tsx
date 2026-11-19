'use client'

import type { SessionSnapshot } from '@dltech/atlas-client/stream'
import { Button } from '@dltech/atlas-ui/components/button'

import { canReconnectOf, sessionStateLineOf } from './data/session-state'

export function ConnectionLine({
  snapshot,
  onReconnect,
}: {
  snapshot: Pick<SessionSnapshot, 'status' | 'connection' | 'error'>
  onReconnect: () => void
}) {
  const line = sessionStateLineOf(snapshot)
  if (line === null) return null
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <p role="status" className="truncate">
        {line}
      </p>
      {canReconnectOf(snapshot) ? (
        <Button size="sm" variant="ghost" onClick={onReconnect}>
          Reconnect now
        </Button>
      ) : null}
    </div>
  )
}
