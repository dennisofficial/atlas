import { runSupervisorCli } from '@dltech/atlas-harness'
import { startServe } from './index'
import { logServeFatal, serveOpLog } from './fatal-log'
import { ServeNeedsConfiguration } from './serve-config'

if (process.argv[2] === '--shell-supervise') {
  await runSupervisorCli({ argv: process.argv.slice(3) })
  process.exit(0)
}

const FATAL = 1

const logCrash = (args: { event: string; error: unknown }): void => {
  const detail =
    args.error instanceof Error ? (args.error.stack ?? args.error.message) : String(args.error)
  process.stderr.write(`${JSON.stringify({ event: args.event, reason: detail })}\n`)
}

const serve = await startServe().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error)
  const reason =
    error instanceof ServeNeedsConfiguration ? detail : `atlas serve could not start: ${detail}`

  logServeFatal({ log: serveOpLog(), error, env: process.env })
  process.stderr.write(`${JSON.stringify({ event: 'serve.fatal', reason })}\n`)
  process.exit(FATAL)
})

let closing = false

const handleSignal = (signal: string) => {
  if (closing) return
  closing = true

  process.stderr.write(`${JSON.stringify({ event: 'serve.stopping', signal })}\n`)
  void serve.close({ reason: signal }).then(() => process.exit(0))
}

process.on('SIGTERM', () => handleSignal('SIGTERM'))
process.on('SIGINT', () => handleSignal('SIGINT'))

process.on('unhandledRejection', (reason: unknown) => {
  logCrash({ event: 'serve.unhandled-rejection', error: reason })
  process.exit(FATAL)
})
process.on('uncaughtException', (error: Error) => {
  logCrash({ event: 'serve.uncaught-exception', error })
  process.exit(FATAL)
})
