import { startServe } from './index'
import { ServeNeedsConfiguration } from './serve-config'

const FATAL = 1

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
