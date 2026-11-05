import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export const listNeedingHolder = async (args: {
  plane: ControlPlane
  limit: number
  log?: LogPort | undefined
}): Promise<string[] | undefined> => {
  try {
    return await args.plane.sessionsNeedingHolder({ limit: args.limit })
  } catch (error) {
    args.log?.error({
      source: 'holder.resync',
      message: 'listing sessions needing a holder failed',
      ...logFieldsOf({ error }),
    })
    return undefined
  }
}
