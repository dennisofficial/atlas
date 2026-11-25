import { SandboxUnavailableError } from '@dltech/atlas-host'

export const WAKE_DEADLINE_MS = 5 * 60_000

export const abortedWake = (args: { signal: AbortSignal; caller: AbortSignal }): Promise<never> =>
  new Promise((_, reject) => {
    const fail = (): void =>
      reject(
        new SandboxUnavailableError(
          args.caller.aborted
            ? 'waking the sandbox was cancelled'
            : 'the sandbox did not finish waking within 5 minutes',
        ),
      )
    if (args.signal.aborted) fail()
    else args.signal.addEventListener('abort', fail, { once: true })
  })
