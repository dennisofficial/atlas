import { LogPort } from '@dltech/atlas-observability'

import { createGracefulShutdown } from '../../shutdown/graceful-shutdown'

class StdoutLog extends LogPort {
  record(entry: Parameters<LogPort['record']>[0]): void {
    console.log(JSON.stringify(entry))
  }
}

const handleSignal = createGracefulShutdown({
  drain: async () => {
    await Bun.sleep(Number(process.env.SLOW_DRAIN_MS ?? 7000))
    console.log('drained')
  },
  exit: (code) => process.exit(code),
  log: new StdoutLog(),
  hardExitAfterMs: Number(process.env.HARD_EXIT_MS ?? 60_000),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
})

process.on('SIGTERM', handleSignal)
process.on('SIGINT', handleSignal)
console.log('ready')
setInterval(() => {}, 1000)
