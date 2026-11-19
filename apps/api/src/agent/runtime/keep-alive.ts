import type { HostTimers } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { SandboxProvider, SandboxTarget } from '../sandbox/sandbox-provider'

const RENEW_EVERY_MS = 10 * 60_000
export const POD_IDLE_WINDOW_MS = 30 * 60_000

export type PodKeepAlive = {
  stop(): void
  release(): Promise<void>
}

export const startKeepAlive = (args: {
  sandbox: SandboxProvider
  target: SandboxTarget
  timers: HostTimers
  signal: AbortSignal
  log?: LogPort | undefined
}): PodKeepAlive => {
  const { sandbox, target, timers, signal, log } = args
  let timer: unknown
  const pushDeadline = async (): Promise<void> => {
    try {
      await sandbox.keepAlive({ target, until: timers.now() + POD_IDLE_WINDOW_MS })
    } catch (error) {
      log?.error({
        source: 'runtime.keep-alive',
        message: `keep-alive for ${target.sandboxSessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
  const stop = (): void => {
    timers.clearTimeout(timer)
    signal.removeEventListener('abort', stop)
  }
  const renew = (): void => {
    void pushDeadline()
    timer = timers.setTimeout(renew, RENEW_EVERY_MS)
  }
  if (!signal.aborted) {
    void pushDeadline()
    timer = timers.setTimeout(renew, RENEW_EVERY_MS)
    signal.addEventListener('abort', stop, { once: true })
  }
  return {
    stop,
    release: async () => {
      stop()
      await pushDeadline()
    },
  }
}
