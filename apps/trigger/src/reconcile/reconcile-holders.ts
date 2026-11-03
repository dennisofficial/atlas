import { WAKE_CHANNEL, wakeMessageSchema, type WakeMessage } from '@dltech/atlas-protocol'

export type ReconcilePlane = {
  sessionsNeedingHolder: (params: { limit: number }) => Promise<string[]>
}

export type ReconcilePublish = (args: { channel: string; message: WakeMessage }) => Promise<void>

export type ReconcileResult = { woken: number; failed: number }

export async function reconcileHolders(params: {
  plane: ReconcilePlane
  publish: ReconcilePublish
  limit: number
}): Promise<ReconcileResult> {
  const { plane, publish, limit } = params
  const sessionIds = await plane.sessionsNeedingHolder({ limit })

  let failed = 0
  for (const sessionId of sessionIds) {
    try {
      await publish({ channel: WAKE_CHANNEL, message: wakeMessageSchema.parse({ sessionId }) })
    } catch {
      failed += 1
    }
  }
  return { woken: sessionIds.length - failed, failed }
}
