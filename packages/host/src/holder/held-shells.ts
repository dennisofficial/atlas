import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'

const SHELL_COUNT_DEADLINE_MS = 10_000

export const countRunningShells = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
}): Promise<number> => {
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
      message: `counting running shells of ${deps.sessionId} failed, treating as none`,
      ...logFieldsOf({ error }),
    })
    return 0
  } finally {
    deps.timers.clearTimeout(timer)
  }
}
