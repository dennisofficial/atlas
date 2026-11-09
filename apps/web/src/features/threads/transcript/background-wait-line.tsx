'use client'

import { useEffect, useState } from 'react'
import { LoaderCircleIcon } from 'lucide-react'

import { EToolState, Tool } from '@dltech/atlas-ui/ai/tool'
import {
  backgroundWaitLabel,
  isWaiting,
  waitStartedAt,
  type BackgroundWork,
} from '@dltech/atlas-client/crew'
import { formatElapsed } from '@dltech/atlas-client/transcript'

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
  const title = backgroundWaitLabel({ work })
  if (title === null) return null
  const elapsed = since === null ? undefined : formatElapsed(Math.max(0, now - since))
  return (
    <div role="status">
      <Tool
        state={EToolState.Running}
        label={title}
        title={title}
        icon={<LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />}
        elapsed={elapsed}
      />
    </div>
  )
}
