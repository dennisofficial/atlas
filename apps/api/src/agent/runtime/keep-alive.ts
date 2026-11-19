import type { HostTimers } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { SandboxProvider, SandboxTarget } from '../sandbox/sandbox-provider'

const KEEP_ALIVE_EVERY_MS = 10 * 60_000
const KEEP_ALIVE_WINDOW_MS = 45 * 60_000

export const startKeepAlive = (args: {
  sandbox: SandboxProvider
  target: SandboxTarget
  timers: HostTimers
  signal: AbortSignal
  log?: LogPort | undefined
}): (() => void) => {
  const { sandbox, target, timers, signal, log } = args
  let keepAlive = signal.aborted
    ? undefined
    : timers.setTimeout(function renew() {
        sandbox
          .keepAlive({ target, until: timers.now() + KEEP_ALIVE_WINDOW_MS })
          .catch((error: unknown) => {
            log?.error({
              source: 'runtime.keep-alive',
              message: `keep-alive for ${target.sandboxSessionId} failed`,
              ...logFieldsOf({ error }),
            })
          })
        keepAlive = timers.setTimeout(renew, KEEP_ALIVE_EVERY_MS)
      }, KEEP_ALIVE_EVERY_MS)
  const stop = (): void => {
    timers.clearTimeout(keepAlive)
    signal.removeEventListener('abort', stop)
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}
