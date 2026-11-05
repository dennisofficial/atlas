import { hostname } from 'node:os'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool } from '@dltech/atlas-db'
import { logFieldsOf, LogPort } from '@dltech/atlas-observability'

import { createHostBus } from './bus/host-bus'
import { startPgWakeListener } from './bus/pg-wake-listener'
import { createRedisLiveFrames } from './bus/redis-live-frames'
import { composeAgentHost } from './compose'
import { ConfigReader } from './config/config-reader'
import { ModelTokenService } from './tokens/model-token-service'
import { OauthConnectionStore } from './tokens/oauth-connection-store'
import { VercelTokenRefresher } from './tokens/vercel-token-refresher'
import { GithubTokenReader } from './tokens/github-token-reader'
import { SecretCipher } from './config/secret-cipher'
import { AgentHostEnvError, readAgentHostEnv } from './config/env'
import { databaseUrlWithTls } from './config/database-url'
import { createPgHostPresence } from './presence/pg-host-presence'
import { startHostWatch, type HostWatch } from './presence/pg-host-watch'
import { wakeOrphans } from './presence/wake-orphans'
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
  const pool = createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: 10_000 })
  const plane = new ControlPlane({ store: new PostgresControlStore(createDb(pool)) })
  const log = new JsonLog()
  const liveFrames = createRedisLiveFrames({ url: env.redisUrl, log })
  const wakes = startPgWakeListener({ url: databaseUrlWithTls(env.databaseDirectUrl), log })
  const bus = createHostBus({ wakes, liveFrames })
  const sandbox = new VercelSandboxProvider({
    image: env.sandboxImage,
    daemonBundle: { path: env.daemonBundlePath },
    daemonSecret: env.daemonSecret,
    cloudUrl: env.apiOrigin,
    log: (line) => console.log(JSON.stringify({ level: 'info', source: 'sandbox', message: line })),
  })
  const cipher = new SecretCipher(env.secretsEncryptionKey)
  const vercel = new VercelTokenRefresher({ db: createDb(pool), cipher, oauth: env.vercelOauth })
  const config = new ConfigReader({ db: createDb(pool), cipher, vercel })
  const github = new GithubTokenReader({ db: createDb(pool), cipher })
  const tokens = new ModelTokenService({
    store: new OauthConnectionStore(createDb(pool)),
    cipher,
  })
  const presence = createPgHostPresence({
    url: databaseUrlWithTls(env.databaseDirectUrl),
    label: `${hostname()}-${process.pid}`,
    log,
  })
  presence.onLost((hostId) => {
    log.error({ source: 'presence', message: 'presence lost', data: { hostId } })
  })
  let watch: HostWatch | undefined
  const holder = composeAgentHost({
    env,
    plane,
    bus,
    sandbox,
    config,
    tokens,
    github,
    presence,
    log,
    onHostIdChanged: () => watch?.recompute(),
  })
  await holder.start()
  watch = startHostWatch({
    url: databaseUrlWithTls(env.databaseDirectUrl),
    selfId: () => holder.hostId(),
    plane,
    onHostChange: (listener) => wakes.onHostChange(listener),
    log,
  })
  await wakeOrphans({ plane, log }).catch((error: unknown) => {
    log.error({ source: 'main', message: 'start-up orphan scan failed', ...logFieldsOf({ error }) })
  })
  log.info({ source: 'main', message: 'agent-host started' })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    log.info({ source: 'main', message: 'draining' })
    await holder.drain({ deadline: Date.now() + 270_000 })
    await watch?.close()
    await presence.close()
    await wakes.close()
    await liveFrames.close()
    await pool.end()
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
