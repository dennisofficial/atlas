'use client'

import { useEffect, useState } from 'react'
import { LoaderCircleIcon } from 'lucide-react'

import {
  backgroundWaitLabel,
  isWaiting,
  waitStartedAt,
  type BackgroundWork,
} from '@dltech/atlas-client/crew'

import { useNow } from '../data/use-now'

function useSince(active: boolean): number | null {
  const [since, setSince] = useState<number | null>(() => (active ? Date.now() : null))

  useEffect(() => {
    setSince((held) => (active ? (held ?? Date.now()) : null))
  }, [active])

  return active ? since : null
}

export function BackgroundWaitLine({
  work,
  settledAt,
}: {
  work: BackgroundWork
  settledAt?: string | undefined
}) {
  const running = isWaiting(work)
  const held = useSince(running)
  const now = useNow(running)
  const since = waitStartedAt({ settledAt, held })
  const label = backgroundWaitLabel({
    work,
    ...(since === null ? {} : { waitedMs: Math.max(0, now - since) }),
  })
  if (label === null) return null
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-1 font-mono text-xs text-muted-foreground"
    >
      <LoaderCircleIcon
        aria-hidden
        className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <span className="truncate">{label}</span>
    </div>
  )
}
