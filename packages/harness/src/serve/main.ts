import { startServe } from './index'
import { ServeNeedsConfiguration } from './serve-config'

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

  process.stderr.write(`${JSON.stringify({ event: 'serve.fatal', reason })}\n`)
  process.exit(FATAL)
})

let closing = false

const handleSignal = (signal: string) => {
  if (closing) return
  closing = true

  process.stderr.write(`${JSON.stringify({ event: 'serve.stopping', signal })}\n`)
  void serve.close().then(() => process.exit(0))
}

process.on('SIGTERM', () => handleSignal('SIGTERM'))
process.on('SIGINT', () => handleSignal('SIGINT'))

// The serve runs detached and unsupervised in the sandbox: a crash that only prints to a dead
// stdout is indistinguishable from a hang. Exit loud into the serve log so the next attach and
// the log tail can say what killed it.
process.on('unhandledRejection', (reason: unknown) => {
  logCrash({ event: 'serve.unhandled-rejection', error: reason })
  process.exit(FATAL)
})
process.on('uncaughtException', (error: Error) => {
  logCrash({ event: 'serve.uncaught-exception', error })
  process.exit(FATAL)
})
