import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool } from '@dltech/atlas-db'
import { logFieldsOf, LogPort } from '@dltech/atlas-observability'

import { createRedisBus } from './bus/redis-bus'
import { composeAgentHost } from './compose'
import { createAgentHostApi } from './config/agent-host-api'
import { AgentHostEnvError, readAgentHostEnv } from './config/env'
import { databaseUrlWithTls } from './config/database-url'
import { VercelSandboxProvider } from './sandbox/vercel-sandbox-provider'

class JsonLog extends LogPort {
  record(entry: Parameters<LogPort['record']>[0]): void {
    console.log(JSON.stringify(entry))
  }
}

const main = async (): Promise<void> => {
  const env = readAgentHostEnv()
  if (!(await Bun.file(env.daemonBundlePath).exists())) {
    console.error(`agent-host refuses to start; daemon bundle not found at ${env.daemonBundlePath}`)
    process.exit(78)
  }
  const databaseUrl = databaseUrlWithTls(env.databaseUrl)
  const pool = createPool(databaseUrl, { queryTimeoutMs: 10_000 })
  const plane = new ControlPlane({ store: new PostgresControlStore(createDb(pool)) })
  const leasePool = createPool(databaseUrl, { queryTimeoutMs: 5_000, max: 2 })
  const leasePlane = new ControlPlane({ store: new PostgresControlStore(createDb(leasePool)) })
  const log = new JsonLog()
  const bus = createRedisBus({ url: env.redisUrl, log })
  const api = createAgentHostApi({
    apiOrigin: env.apiOrigin,
    agentHostToken: env.agentHostToken,
  })
  const sandbox = new VercelSandboxProvider({
    image: env.sandboxImage,
    daemonBundle: { path: env.daemonBundlePath },
    daemonSecret: env.daemonSecret,
    cloudUrl: env.apiOrigin,
    log: (line) => console.log(JSON.stringify({ level: 'info', source: 'sandbox', message: line })),
  })
  const holder = composeAgentHost({ env, plane, leasePlane, bus, sandbox, api, log })
  await holder.start()
  log.info({ source: 'main', message: 'agent-host started' })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    log.info({ source: 'main', message: 'draining' })
    await holder.drain({ deadline: Date.now() + 270_000 })
    await bus.close()
    await pool.end()
    await leasePool.end()
    process.exit(0)
  }
  const handleSignal = (): void => {
    shutdown().catch((error: unknown) => {
      log.error({ source: 'main', message: 'shutdown failed', ...logFieldsOf({ error }) })
      process.exit(1)
    })
  }
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
