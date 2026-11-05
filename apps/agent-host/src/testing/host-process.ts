import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

import { ControlPlane } from '@dltech/atlas-control'
import { ModelPort } from '@dltech/atlas-core'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool } from '@dltech/atlas-db'
import { RandomIds } from '../runtime/random-ids'
import { SessionHolder, systemTimers } from '@dltech/atlas-host'
import { createPgHostPresence } from '../presence/pg-host-presence'
import { LogPort, logFieldsOf } from '@dltech/atlas-observability'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'

import { createHostBus } from '../bus/host-bus'
import { startPgWakeListener } from '../bus/pg-wake-listener'
import { createRedisLiveFrames } from '../bus/redis-live-frames'
import type { ConfigSource } from '../config/agent-host-config'
import { createSessionRuntimeFactory } from '../runtime/session-runtime-factory'
import { FixedEndpointSandboxProvider } from './fixed-endpoint-sandbox-provider'

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is unset`)
  return value
}

const numberEnv = (name: string, fallback: number): number => {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} is not a number: ${value}`)
  return parsed
}

class FirstChunkMarker extends ModelPort {
  private marked = false

  constructor(
    private readonly inner: ModelPort,
    private readonly path: string,
  ) {
    super()
  }

  get identity(): ModelPort['identity'] {
    return this.inner.identity
  }

  step: ModelPort['step'] = (args) => {
    const onChunk = args.onChunk
    return this.inner.step({
      ...args,
      onChunk: (chunk) => {
        if (!this.marked && chunk.type === 'text-delta') {
          this.marked = true
          writeFileSync(this.path, '1')
        }
        return onChunk?.(chunk) ?? chunk
      },
    })
  }
}

const withFirstChunkMarker = (model: ModelPort): ModelPort => {
  const path = process.env.FIRST_CHUNK_FILE
  if (path === undefined || path === '') return model
  return new FirstChunkMarker(model, path)
}

const tapToolOutput = (liveFrames: ReturnType<typeof createRedisLiveFrames>): void => {
  const path = process.env.TOOL_OUTPUT_FILE
  if (path === undefined || path === '') return
  const live = liveFrames.live.bind(liveFrames)
  liveFrames.live = (args) => {
    if (args.frame.type === 'tool-output') appendFileSync(path, args.frame.text)
    live(args)
  }
}

class JsonLog extends LogPort {
  record(entry: Parameters<LogPort['record']>[0]): void {
    console.log(JSON.stringify(entry))
  }
}

const testSource = (): ConfigSource => ({
  read: async () => ({
    userId: 'user-1',
    projectId: 'proj-1',
    model: { configured: false, gap: 'scripted model in test' },
    vercel: { configured: true, token: '', teamId: '', projectId: '' },
    workspace: { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript: '' },
    skills: [],
  }),
})

const testTokens = () => ({
  issue: async (): Promise<never> => {
    throw new Error('unused')
  },
})

const main = async (): Promise<void> => {
  const holderLabel = requireEnv('HOLDER_ID')
  const daemonSecret = requireEnv('DAEMON_SECRET')
  const daemonUrl = requireEnv('DAEMON_URL')
  const workspace = requireEnv('WORKSPACE_DIR')
  const scripts = JSON.parse(readFileSync(requireEnv('SCRIPT_FILE'), 'utf8')) as Record<
    string,
    ScriptedModelStep[]
  >

  const pool = createPool(requireEnv('DATABASE_URL'), {
    queryTimeoutMs: numberEnv('DB_QUERY_TIMEOUT_MS', 10_000),
  })
  const plane = new ControlPlane({ store: new PostgresControlStore(createDb(pool)) })
  const log = new JsonLog()
  const liveFrames = createRedisLiveFrames({ url: requireEnv('REDIS_URL'), log })
  tapToolOutput(liveFrames)
  const wakes = startPgWakeListener({ url: requireEnv('DATABASE_DIRECT_URL'), log })
  const bus = createHostBus({ wakes, liveFrames })
  const timers = { now: () => Date.now(), ...systemTimers }
  const sandbox = new FixedEndpointSandboxProvider({ url: daemonUrl, daemonSecret })
  const pgPresence = createPgHostPresence({
    url: requireEnv('PRESENCE_DATABASE_URL'),
    label: holderLabel,
    log,
  })
  let hostId = -1
  const presence = {
    ...pgPresence,
    register: async () => {
      hostId = await pgPresence.register()
      return hostId
    },
  }
  const generations = new Map<string, number>()
  const holder = new SessionHolder({
    presence,
    plane,
    bus,
    timers,
    runtimes: createSessionRuntimeFactory({
      config: testSource(),
      tokens: testTokens(),
      github: { read: async () => null },
      sandbox,
      daemonSecret,
      timers,
      modelFor: ({ sessionId }) => {
        const generation = (generations.get(sessionId) ?? 0) + 1
        generations.set(sessionId, generation)
        const script = scripts[`${sessionId}@${generation}`] ?? scripts[sessionId] ?? []
        return withFirstChunkMarker(new ScriptedModel(script, undefined, existsSync))
      },
      launchDirectory: workspace,
      log,
      pingMs: numberEnv('PING_MS', 10_000),
    }),
    ids: new RandomIds(),
    maxSessions: 25,
    appendRetryMs: numberEnv('APPEND_RETRY_MS', 2_500),
    idleMinutes: 30,
    log,
  })
  await holder.start()
  log.info({ source: 'host-process', message: `started hostId=${hostId} label=${holderLabel}` })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    log.info({ source: 'host-process', message: 'draining' })
    await holder.drain({ deadline: Date.now() + numberEnv('DRAIN_MS', 270_000) })
    await pgPresence.close()
    await wakes.close()
    await liveFrames.close()
    await pool.end()
    process.exit(0)
  }
  const handleSignal = (): void => {
    shutdown().catch((error: unknown) => {
      log.error({ source: 'host-process', message: 'shutdown failed', ...logFieldsOf({ error }) })
      process.exit(1)
    })
  }
  process.on('SIGTERM', handleSignal)
  process.on('SIGINT', handleSignal)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
