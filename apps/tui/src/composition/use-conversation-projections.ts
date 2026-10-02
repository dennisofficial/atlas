import type { Event } from '@dltech/atlas-core'
import { publishProjections } from '@dltech/atlas-harness'
import { useCallback } from 'react'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'

export function useProjectEvents(args: {
  app: AtlasApp
}): (folded: { events: readonly Event[] }) => void {
  const { pluginProjections } = args.app

  return useCallback(
    ({ events: folded }: { events: readonly Event[] }) => {
      const broke = publishProjections({ projections: pluginProjections, events: folded })
      if (broke.length === 0) return

      notify({
        key: `projection:${broke.join(',')}`,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: `projection failed: ${broke.join(', ')}`,
      })
    },
    [pluginProjections],
  )
}
