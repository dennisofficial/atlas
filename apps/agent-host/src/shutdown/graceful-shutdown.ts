import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export const createGracefulShutdown = (args: {
  drain: () => Promise<void>
  exit: (code: number) => void
  log: LogPort
  hardExitAfterMs: number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (timer: unknown) => void
}): (() => void) => {
  let started = false
  return () => {
    if (started) {
      args.log.info({ source: 'main', message: 'repeat shutdown signal ignored' })
      return
    }
    started = true
    args.log.info({ source: 'main', message: 'draining' })
    const timer = args.setTimeout(() => {
      args.log.warn({
        source: 'main',
        message: `hard exit: the drain did not finish in ${args.hardExitAfterMs}ms`,
      })
      args.exit(1)
    }, args.hardExitAfterMs)
    args.drain().then(
      () => {
        args.clearTimeout(timer)
        args.exit(0)
      },
      (error: unknown) => {
        args.clearTimeout(timer)
        args.log.error({ source: 'main', message: 'shutdown failed', ...logFieldsOf({ error }) })
        args.exit(1)
      },
    )
  }
}
