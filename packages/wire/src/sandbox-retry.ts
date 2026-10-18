/** Injectable so a spec passes zero delays rather than sleeping through the real ones. */
export type RetryPolicy = {
  attempts: number
  delayMs: number
}

/**
 * The sandbox-name settle the mount rides out: a fresh create can land before Vercel's name
 * registry has caught up. 30 × 5s = 150s, sized for the slow settles observed in the October
 * 2026 wake probes.
 */
export const settleRetry: RetryPolicy = { attempts: 30, delayMs: 5_000 }

/**
 * The first boot of a freshly published image waits on Vercel optimizing that digest — the
 * create call answers 409 `image_not_ready` until it finishes (about two minutes end-to-end in
 * the October 2026 probes). The budget outlasts a slow optimization, not the permanent failure,
 * which `isImageOptimizeFailure` cuts off immediately.
 */
export const imageOptimizeRetry: RetryPolicy = { attempts: 12, delayMs: 30_000 }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const retrySleep = (policy: RetryPolicy): Promise<void> => sleep(policy.delayMs)
