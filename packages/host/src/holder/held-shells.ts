import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'

const SHELL_COUNT_DEADLINE_MS = 10_000

export const countRunningShells = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
}): Promise<number | undefined> => {
  const { deps } = args
  let timer: unknown
  const deadline = new Promise<never>((_, reject) => {
    timer = deps.timers.setTimeout(
      () => reject(new Error(`shell count not answered within ${SHELL_COUNT_DEADLINE_MS}ms`)),
      SHELL_COUNT_DEADLINE_MS,
    )
  })
  try {
    return await Promise.race([args.runtime.runningShells(), deadline])
  } catch (error) {
    deps.log?.warn({
      source: 'holder.idle',
      message: `counting running shells of ${deps.sessionId} failed, holding the shells the log has open`,
      ...logFieldsOf({ error }),
    })
    return undefined
  } finally {
    deps.timers.clearTimeout(timer)
  }
}

export const OWED_ENDING_GRACE_MS = 60_000

export const UNCOUNTED_SHELL_HOLD_MS = 10 * 60_000

export type ShellHold = { holding: number; owedSince: number | undefined }

export const shellHoldOf = (args: {
  counted: number | undefined
  openInLog: number
  owedSince: number | undefined
  now: number
}): ShellHold => {
  const counted = args.counted ?? 0
  if (counted > 0 || args.openInLog === 0) return { holding: counted, owedSince: undefined }
  const owedSince = args.owedSince ?? args.now
  const cap = args.counted === undefined ? UNCOUNTED_SHELL_HOLD_MS : OWED_ENDING_GRACE_MS
  const holding = args.now - owedSince < cap ? args.openInLog : 0
  return { holding, owedSince }
}
