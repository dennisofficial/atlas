import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import type { SessionHolder } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'

import { AgentHostEnvError, readAgentHostEnv } from './config/env'
import { HostModule } from './host/host.module'
import type { StreamService } from './host/stream-service'
import { HOLDER, LOG, STREAM } from './host/tokens'
import { createGracefulShutdown } from './shutdown/graceful-shutdown'

const SHUTDOWN_GRACE_MS = 20_000

const main = async (): Promise<void> => {
  const env = readAgentHostEnv()
  if (!(await Bun.file(env.daemonBundlePath).exists())) {
    console.error(`agent-host refuses to start; daemon bundle not found at ${env.daemonBundlePath}`)
    process.exit(78)
  }
  const app = await NestFactory.createApplicationContext(HostModule.forRoot(env), { logger: false })
  const log = app.get<LogPort>(LOG)
  const holder = app.get<SessionHolder>(HOLDER)
  const stream = app.get<StreamService>(STREAM).running()
  log.info({ source: 'main', message: 'stream listening', data: { port: stream.port } })
  log.info({ source: 'main', message: 'agent-host started' })

  const handleSignal = createGracefulShutdown({
    hardExitAfterMs: env.drainMs + SHUTDOWN_GRACE_MS,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    drain: async () => {
      await Promise.all([stream.drain({}), holder.drain({ deadline: Date.now() + env.drainMs })])
      await app.close()
    },
    exit: (code) => process.exit(code),
    log,
  })
  process.on('SIGTERM', handleSignal)
  process.on('SIGINT', handleSignal)
}

main().catch((error: unknown) => {
  if (error instanceof AgentHostEnvError) {
    console.error(error.message)
    process.exit(78)
  }
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
