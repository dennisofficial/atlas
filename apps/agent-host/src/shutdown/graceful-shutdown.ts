import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export const createGracefulShutdown = (args: {
  drain: () => Promise<void>
  exit: (code: number) => void
  log: LogPort
}): (() => void) => {
  let started = false
  return () => {
    if (started) {
      args.log.info({ source: 'main', message: 'repeat shutdown signal ignored' })
      return
    }
    started = true
    args.log.info({ source: 'main', message: 'draining' })
    args.drain().then(
      () => args.exit(0),
      (error: unknown) => {
        args.log.error({ source: 'main', message: 'shutdown failed', ...logFieldsOf({ error }) })
        args.exit(1)
      },
    )
  }
}
