import { useCallback, useEffect, useRef, useState } from 'react'

import type { PendingEntryWire, WireEvent } from '@dltech/atlas-wire/web'

import { HANDOFF_TIMEOUT_MS, isHandedOff, type Handoff } from './composer-handoff'

export function useComposerHandoff(args: {
  events: readonly WireEvent[]
  pending: readonly PendingEntryWire[]
  onSettle: (handoff: Handoff) => void
}) {
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const settleRef = useRef(args.onSettle)
  useEffect(() => {
    settleRef.current = args.onSettle
  })

  if (handoff !== null && isHandedOff({ handoff, events: args.events, pending: args.pending })) {
    setHandoff(null)
    args.onSettle(handoff)
  }

  useEffect(() => {
    if (handoff === null) return undefined
    const timer = setTimeout(() => {
      setHandoff(null)
      settleRef.current(handoff)
    }, HANDOFF_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [handoff])

  const begin = useCallback((next: Handoff) => setHandoff(next), [])
  return { waiting: handoff !== null, begin }
}
