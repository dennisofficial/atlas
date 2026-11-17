import 'reflect-metadata'

import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { LogPort } from '@dltech/atlas-observability'

import { HostShutdownSequence } from '../../host/shutdown-sequence'

class StdoutLog extends LogPort {
  record(entry: Parameters<LogPort['record']>[0]): void {
    console.log(JSON.stringify(entry))
  }
}

const slowDrainMs = Number(process.env.SLOW_DRAIN_MS ?? 7000)
const hardExitAfterMs = Number(process.env.HARD_EXIT_MS ?? 5000)

const instant = async (): Promise<void> => undefined

class SlowDrainHost extends HostShutdownSequence {
  constructor() {
    super({
      watch: { close: instant },
      presence: { close: instant },
      wakes: { close: instant },
      liveFrames: { close: instant },
      stream: {
        drain: async () => {
          await Bun.sleep(slowDrainMs)
          console.log('drained')
        },
        stop: instant,
      },
      holder: { drain: instant },
      follow: { close: instant },
      pool: { end: instant },
      log: new StdoutLog(),
      hardExitAfterMs,
    })
  }
}

const SLOW_DRAIN = Symbol('SLOW_DRAIN')

@Module({ providers: [{ provide: SLOW_DRAIN, useClass: SlowDrainHost }] })
class SlowDrainModule {}

const app = await NestFactory.create(SlowDrainModule, { logger: false })
app.enableShutdownHooks([], { useProcessExit: true })
await app.init()
console.log('ready')
setInterval(() => {}, 1000)
