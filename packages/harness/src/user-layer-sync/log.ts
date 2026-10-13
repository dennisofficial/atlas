import type { LogPort } from '@dltech/atlas-core'

const LOG_SOURCE = 'user-layer-sync'

export function warnSync(args: { log: LogPort; message: string; error?: unknown }): void {
  args.log.warn({
    source: LOG_SOURCE,
    message: args.message,
    ...(args.error === undefined
      ? {}
      : { error: args.error instanceof Error ? args.error.message : String(args.error) }),
  })
}
