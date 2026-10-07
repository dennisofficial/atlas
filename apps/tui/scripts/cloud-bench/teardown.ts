export type TeardownResult = { sandboxAbsent: boolean; driveAbsent: boolean; attempts: number }

export class TeardownUnresolvedError extends Error {
  constructor(readonly result: TeardownResult) {
    super(
      `teardown unresolved after ${result.attempts} attempt(s): sandboxAbsent=${result.sandboxAbsent} driveAbsent=${result.driveAbsent}`,
    )
  }
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_TIMEOUT_MS = 60_000
const RETRY_DELAY_MS = 2_000

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const absent = async (present: () => Promise<boolean>): Promise<boolean> => {
  try {
    return !(await present())
  } catch {
    return false
  }
}

export const teardownUntilAbsent = async (args: {
  destroy: () => Promise<void>
  sandboxPresent: () => Promise<boolean>
  drivePresent: () => Promise<boolean>
  pending?: Promise<unknown> | undefined
  attempts?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<TeardownResult> => {
  const maxAttempts = args.attempts ?? DEFAULT_ATTEMPTS
  const sleep = args.sleep ?? sleepFor
  const deadline = Date.now() + (args.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const result: TeardownResult = { sandboxAbsent: false, driveAbsent: false, attempts: 0 }

  let expiredBudget = false
  const withinBudget = <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          expiredBudget = true
          reject(new TeardownUnresolvedError({ ...result }))
        },
        Math.max(0, deadline - Date.now()),
      )
    })
    return Promise.race([work, expired]).finally(() => clearTimeout(timer))
  }

  const run = async (): Promise<TeardownResult> => {
    await args.pending?.catch(() => undefined)
    while (result.attempts < maxAttempts && !expiredBudget) {
      result.attempts += 1
      await args.destroy().catch(() => undefined)
      result.sandboxAbsent = await absent(args.sandboxPresent)
      result.driveAbsent = await absent(args.drivePresent)
      if (result.sandboxAbsent && result.driveAbsent) return result
      if (result.attempts < maxAttempts) await sleep(RETRY_DELAY_MS)
    }
    throw new TeardownUnresolvedError({ ...result })
  }

  return withinBudget(run())
}
