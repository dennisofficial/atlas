import { existsSync, readFileSync } from 'node:fs'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool } from '@dltech/atlas-db'
import { RandomIds } from '@dltech/atlas-harness'
import { SessionHolder, systemTimers } from '@dltech/atlas-host'
import { LogPort, logFieldsOf } from '@dltech/atlas-observability'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'

import { createRedisBus } from '../bus/redis-bus'
import type { AgentHostApi } from '../config/agent-host-api'
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

class JsonLog extends LogPort {
  record(entry: Parameters<LogPort['record']>[0]): void {
    console.log(JSON.stringify(entry))
  }
}

const testApi = (): AgentHostApi => ({
  config: async () => ({
    userId: 'user-1',
    projectId: 'proj-1',
    model: { configured: false, gap: 'scripted model in test' },
    vercel: { configured: true, token: '', teamId: '', projectId: '' },
    config: {
      settings: {},
      secrets: [],
      harnessSecrets: [],
      mcpServers: [],
      fileMounts: [],
      provenance: {},
    },
    workspace: { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript: '' },
    revision: 'rev-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
  modelAccessToken: async () => {
    throw new Error('unused')
  },
  githubToken: async () => ({ token: null }),
})

const main = async (): Promise<void> => {
  const holderId = requireEnv('HOLDER_ID')
  const daemonSecret = requireEnv('DAEMON_SECRET')
  const daemonUrl = requireEnv('DAEMON_URL')
  const workspace = requireEnv('WORKSPACE_DIR')
  const scripts = JSON.parse(readFileSync(requireEnv('SCRIPT_FILE'), 'utf8')) as Record<
    string,
    ScriptedModelStep[]
  >

  const pool = createPool(requireEnv('DATABASE_URL'))
  const plane = new ControlPlane({ store: new PostgresControlStore(createDb(pool)) })
  const log = new JsonLog()
  const bus = createRedisBus({ url: requireEnv('REDIS_URL'), log })
  const timers = { now: () => Date.now(), ...systemTimers }
  const sandbox = new FixedEndpointSandboxProvider({ url: daemonUrl, daemonSecret })
  const holder = new SessionHolder({
    holderId,
    plane,
    bus,
    timers,
    runtimes: createSessionRuntimeFactory({
      api: testApi(),
      sandbox,
      daemonSecret,
      timers,
      modelFor: ({ sessionId }) =>
        new ScriptedModel(scripts[sessionId] ?? [], undefined, existsSync),
      launchDirectory: workspace,
      log,
    }),
    ids: new RandomIds(),
    maxSessions: 25,
    ttlMs: numberEnv('TTL_MS', 3_000),
    renewEveryMs: numberEnv('RENEW_MS', 500),
    fenceMarginMs: numberEnv('FENCE_MS', 1_000),
    inboxPollMs: numberEnv('INBOX_POLL_MS', 100),
    idleMinutes: 30,
    log,
  })
  await holder.start()
  log.info({ source: 'host-process', message: `started holderId=${holderId}` })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    log.info({ source: 'host-process', message: 'draining' })
    await holder.drain({ deadline: Date.now() + numberEnv('DRAIN_MS', 270_000) })
    await bus.close()
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
