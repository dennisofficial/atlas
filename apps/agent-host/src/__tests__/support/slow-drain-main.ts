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
})

process.on('SIGTERM', handleSignal)
process.on('SIGINT', handleSignal)
console.log('ready')
setInterval(() => {}, 1000)
