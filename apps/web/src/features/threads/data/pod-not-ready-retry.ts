import { EPodNotReady, POD_PARKED_MESSAGE } from '@dltech/atlas-protocol'

import { CloudApiError } from '@/lib/cloud-api'

export const POD_RETRY_FIRST_MS = 500
export const POD_RETRY_CAP_MS = 4_000
export const POD_RETRY_TOTAL_MS = 30_000

export type PodRetryNotice = { attempt: number; delayMs: number }

export const isPodNotReady = (failure: unknown): boolean => {
  if (!(failure instanceof CloudApiError)) return false
  return failure.code === EPodNotReady.NotReady || failure.message === POD_PARKED_MESSAGE
}

export const podRetryDelayMs = (args: { attempt: number }): number =>
  Math.min(POD_RETRY_FIRST_MS * 2 ** args.attempt, POD_RETRY_CAP_MS)

export const withinPodRetryBudget = (args: { elapsedMs: number; totalMs: number }): boolean =>
  args.elapsedMs < args.totalMs

const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const retryPodNotReady = async <T>(args: {
  work: () => Promise<T>
  signal?: AbortSignal | undefined
  onWaiting?: ((notice: PodRetryNotice) => void) | undefined
  now?: (() => number) | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  totalMs?: number | undefined
}): Promise<T> => {
  const now = args.now ?? (() => Date.now())
  const sleep = args.sleep ?? sleepMs
  const totalMs = args.totalMs ?? POD_RETRY_TOTAL_MS
  const startedAt = now()
  let attempt = 0
  for (;;) {
    args.signal?.throwIfAborted()
    try {
      return await args.work()
    } catch (failure) {
      if (!isPodNotReady(failure)) throw failure
      args.signal?.throwIfAborted()
      const delayMs = podRetryDelayMs({ attempt })
      if (!withinPodRetryBudget({ elapsedMs: now() - startedAt + delayMs, totalMs })) throw failure
      args.onWaiting?.({ attempt, delayMs })
      await sleep(delayMs)
      attempt += 1
    }
  }
}
