import type { Event } from '@dltech/atlas-core'
import { publishProjections } from '@dltech/atlas-harness'
import { useCallback, useMemo } from 'react'

import { pendingRows, type PendingRow } from '../store'
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

type PendingRowsInput = Parameters<typeof pendingRows>[0]

export function usePendingRows(args: {
  queued: PendingRowsInput['entries']
  remoteEntries: PendingRowsInput['remoteEntries']
  wakeNotices: { shells: PendingRowsInput['notices']; agents: PendingRowsInput['agents']; services: PendingRowsInput['services'] }
  sending: PendingRowsInput['sending']
}): readonly PendingRow[] {
  const { queued, remoteEntries, wakeNotices, sending } = args

  return useMemo(
    () =>
      pendingRows({
        entries: queued,
        ...(remoteEntries === undefined ? {} : { remoteEntries }),
        notices: wakeNotices.shells,
        agents: wakeNotices.agents,
        services: wakeNotices.services,
        ...(sending === undefined ? {} : { sending }),
      }),
    [queued, remoteEntries, sending, wakeNotices.agents, wakeNotices.services, wakeNotices.shells],
  )
}
