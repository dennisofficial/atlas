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

export const attachLagRetry: RetryPolicy = { attempts: 10, delayMs: 2_000 }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const retrySleep = (policy: RetryPolicy): Promise<void> => sleep(policy.delayMs)
