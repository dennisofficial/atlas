import { hostname } from 'node:os'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool } from '@dltech/atlas-db'
import { LogPort } from '@dltech/atlas-observability'

import { createHostBus } from './bus/host-bus'
import { startPgChangeFeed } from './bus/pg-change-feed'
import { startPgWakeListener } from './bus/pg-wake-listener'
import { createRedisLiveFrames } from './bus/redis-live-frames'
import { createRedisLiveSource } from './bus/redis-live-source'
import { VercelMediaStore } from '@dltech/atlas-media'

import { composeAgentHost } from './compose'
import { ConfigReader } from './config/config-reader'
import { ModelTokenService } from './tokens/model-token-service'
import { OauthConnectionStore } from './tokens/oauth-connection-store'
import { VercelTokenRefresher } from './tokens/vercel-token-refresher'
import { GithubTokenReader } from './tokens/github-token-reader'
import { SigningKeyReader } from './tokens/signing-key-reader'
import { MediaSigner } from './media/media-signer'
import { PgMediaSigningWindows } from './media/pg-media-signing-windows'
import { SecretCipher } from './config/secret-cipher'
import { AgentHostEnvError, readAgentHostEnv } from './config/env'
import { databaseUrlWithTls } from './config/database-url'
import { createPgHostPresence } from './presence/pg-host-presence'
import { startHostWatch, type HostWatch } from './presence/pg-host-watch'
import { createPgStreamAuth } from './stream/pg-stream-auth'
import { createFollowSubscriptions } from './stream/follow-port'
import { systemHostTimers } from './stream/system-timers'
import { startStreamServer } from './stream/stream-server'
import { createGracefulShutdown } from './shutdown/graceful-shutdown'
import { VercelSandboxProvider } from './sandbox/vercel-sandbox-provider'

const SHUTDOWN_GRACE_MS = 20_000

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
  const signingKey = new SigningKeyReader({ db: createDb(pool), cipher })
  const tokens = new ModelTokenService({
    store: new OauthConnectionStore(createDb(pool)),
    cipher,
  })
  const media =
    env.mediaBlobToken === null
      ? undefined
      : new MediaSigner({
          store: new VercelMediaStore({ token: env.mediaBlobToken }),
          windows: new PgMediaSigningWindows(createDb(pool)),
          cipher,
          now: () => Date.now(),
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
    signingKey,
    media,
    presence,
    log,
    onHostIdChanged: () => watch?.recompute(),
  })
  await holder.start()
  watch = startHostWatch({
    url: databaseUrlWithTls(env.databaseDirectUrl),
    selfId: () => holder.hostId(),
    ring: () => holder.ring(),
    onHostChange: (listener) => wakes.onHostChange(listener),
    log,
  })
  const changeFeed = startPgChangeFeed({ url: databaseUrlWithTls(env.databaseDirectUrl), log })
  const liveSource = createRedisLiveSource({ url: env.redisUrl, log })
  const follow = createFollowSubscriptions({
    plane,
    feed: changeFeed,
    live: liveSource,
    timers: systemHostTimers,
    log,
  })
  const stream = startStreamServer({
    port: env.port,
    auth: createPgStreamAuth({ pool }),
    subscriptions: follow,
    timers: systemHostTimers,
    trustedOrigins: env.trustedOrigins,
    log,
  })
  log.info({ source: 'main', message: 'stream listening', data: { port: stream.port } })
  log.info({ source: 'main', message: 'agent-host started' })

  const handleSignal = createGracefulShutdown({
    hardExitAfterMs: env.drainMs + SHUTDOWN_GRACE_MS,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    drain: async () => {
      await Promise.all([stream.drain({}), holder.drain({ deadline: Date.now() + env.drainMs })])
      await watch?.close()
      await presence.close()
      await wakes.close()
      await liveFrames.close()
      await stream.stop()
      follow.close()
      await liveSource.close()
      await changeFeed.close()
      await pool.end()
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
