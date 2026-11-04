export type ReconcilePlane = {
  sessionsNeedingHolder: (params: { limit: number }) => Promise<string[]>
  wake: (params: { sessionIds: readonly string[] }) => Promise<void>
}

export type ReconcileResult = { woken: number; failed: number }

export async function reconcileHolders(params: {
  plane: ReconcilePlane
  limit: number
}): Promise<ReconcileResult> {
  const { plane, limit } = params
  const sessionIds = await plane.sessionsNeedingHolder({ limit })
  if (sessionIds.length === 0) return { woken: 0, failed: 0 }
  try {
    await plane.wake({ sessionIds })
    return { woken: sessionIds.length, failed: 0 }
  } catch {
    return { woken: 0, failed: sessionIds.length }
  }
}
