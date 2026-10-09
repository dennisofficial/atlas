/**
 * Vercel detaches a drive asynchronously after its sandbox goes away, and both sides of that lag —
 * deleting the drive, mounting it on a new sandbox — retry through it with the same budget. One
 * policy so the two sides can never drift; injectable so a spec passes zero delays rather than
 * sleeping through the real ones.
 */
export type RetryPolicy = {
  attempts: number
  delayMs: number
}

// 30 × 5s = 150s per consumer (the detach poll, then the delete retry), so the full
// delete path outlasts the multi-minute detach Vercel actually takes in the slow case —
// the October 2026 bench teardown flaked on the old 20s budget while a drive sat wedged
// attached to an already-gone sandbox.
export const attachLagRetry: RetryPolicy = { attempts: 30, delayMs: 5_000 }

/**
 * The first boot of a freshly published image waits on Vercel optimizing that digest — the
 * create call answers 409 `image_not_ready` until it finishes (about two minutes end-to-end in
 * the October 2026 probes). The budget outlasts a slow optimization, not the permanent failure,
 * which `isImageOptimizeFailure` cuts off immediately.
 */
export const imageOptimizeRetry: RetryPolicy = { attempts: 12, delayMs: 30_000 }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const retrySleep = (policy: RetryPolicy): Promise<void> => sleep(policy.delayMs)
