import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

export const ORPHAN_SCAN_LIMIT = 1_000

export const wakeOrphans = async (args: {
  plane: Pick<ControlPlane, 'sessionsNeedingHolder' | 'wake'>
  log?: LogPort | undefined
}): Promise<number> => {
  const sessionIds = await args.plane.sessionsNeedingHolder({ limit: ORPHAN_SCAN_LIMIT })
  if (sessionIds.length === 0) return 0
  await args.plane.wake({ sessionIds })
  args.log?.info({
    source: 'host-watch',
    message: `woke ${sessionIds.length} sessions needing a holder`,
    data: { count: sessionIds.length },
  })
  return sessionIds.length
}
