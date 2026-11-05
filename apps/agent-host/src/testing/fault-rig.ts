import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool, type Pool } from '@dltech/atlas-db'
import { FaultProxy } from '@dltech/atlas-host/testing'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { startDaemon, type RigDaemon } from './rig-daemon'
import { collectLines } from './rig-process'
import { proxiedDatabaseUrl, startOwnDaemonProxy } from './rig-proxies'

export type { RigDaemon } from './rig-daemon'

const hostEntry = join(import.meta.dir, 'host-process.ts')

export const RIG_SECRET = 'fault-rig-secret'

export type HostProcess = {
  label: string
  dbProxy?: FaultProxy
  daemonProxy?: FaultProxy
  kill(signal: 'SIGKILL' | 'SIGTERM'): void
  exited: Promise<number>
  logs(): string[]
}

export type ReadEvent = { seq: number; type: string; event: unknown }

export type HostKnobs = {
  appendRetryMs?: number
  pingMs?: number
  drainMs?: number
  queryTimeoutMs?: number
  toolOutputFile?: string
}

export type FaultRig = {
  plane: ControlPlane
  dbProxy: FaultProxy
  newSession(args: { sessionId: string; text: string; prepared?: boolean }): Promise<string>
  wake(sessionId: string): Promise<void>
  claim(args: { sessionId: string; label: string; timeoutMs?: number }): Promise<void>
  labelOf(hostId: number | null): Promise<string | undefined>
  waitForSeq(args: {
    threadId: string
    want: (events: readonly ReadEvent[]) => boolean
    timeoutMs?: number
  }): Promise<ReadEvent[]>
  spawnDaemonFor(args: { sessionId: string }): Promise<RigDaemon>
  spawnHost(args: {
    label: string
    daemonUrl: string
    scripts: Record<string, ScriptedModelStep[]>
    knobs?: HostKnobs
    dbProxy?: 'shared' | 'own'
    daemonProxy?: 'shared' | 'own'
    redisUrl?: string
    firstChunkFile?: string
  }): Promise<HostProcess>
  stop(): Promise<void>
}

const SEED_HOST_ID = 2_000_000_000

const seedPrepared = async (args: {
  plane: ControlPlane
  sessionId: string
  threadId: string
}): Promise<void> => {
  const { plane } = args
  const { epoch } = await plane.grant({ sessionId: args.sessionId, hostId: SEED_HOST_ID })
  const head = await plane.head({ threadId: args.threadId })
  const outcome = await plane.append({
    threadId: args.threadId,
    epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('seed-prepared'),
      epoch,
      at: new Date().toISOString(),
      bodies: [{ type: 'workspace-prepared' }],
      from: head,
    }),
  })
  if (!outcome.ok) throw new Error(`seeding prepared refused: ${JSON.stringify(outcome.refusal)}`)
  await plane.revoke({ sessionId: args.sessionId, wantsHolder: false })
}

export const startRig = async (args: {
  databaseUrl: string
  redisUrl: string
}): Promise<FaultRig> => {
  const target = new URL(args.databaseUrl)
  const dbProxy = await FaultProxy.start({
    target: { host: target.hostname, port: Number(target.port) },
  })
  const pool: Pool = createPool(args.databaseUrl)
  const plane = new ControlPlane({ store: new PostgresControlStore(createDb(pool)) })
  const closers: (() => Promise<void>)[] = []
  const labelOf = async (hostId: number | null): Promise<string | undefined> => {
    if (hostId === null) return undefined
    const result = await pool.query<{ label: string }>(
      'SELECT "label" FROM "v2"."V2Host" WHERE "id" = $1',
      [hostId],
    )
    return result.rows[0]?.label
  }

  return {
    plane,
    dbProxy,
    labelOf,

    async newSession({ sessionId, text, prepared }) {
      const mainThreadId = `thread-${sessionId}`
      await plane.createSession({
        sessionId,
        userId: 'user-1',
        projectId: 'proj-1',
        mainThreadId,
      })
      if (prepared !== false) await seedPrepared({ plane, sessionId, threadId: mainThreadId })
      await plane.post({
        sessionId,
        kind: INBOX_KIND_MESSAGE,
        payload: JSON.stringify({ text }),
      })
      return mainThreadId
    },

    async wake(sessionId) {
      await plane.wake({ sessionIds: [sessionId] })
    },

    async claim({ sessionId, label, timeoutMs }) {
      const deadline = Date.now() + (timeoutMs ?? 15_000)
      for (;;) {
        await plane.wake({ sessionIds: [sessionId] }).catch(() => undefined)
        const current = await plane.currentLease({ sessionId })
        if (current.live && (await labelOf(current.lease.holderHostId)) === label) return
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${label} to hold ${sessionId}: ${JSON.stringify(current)}`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    },

    async waitForSeq({ threadId, want, timeoutMs }) {
      const deadline = Date.now() + (timeoutMs ?? 30_000)
      let last: ReadEvent[] = []
      while (Date.now() < deadline) {
        const page = await plane.readEvents({ threadId, afterSeq: 0, limit: 1_000, visible: true })
        last = page.events.map((row) => ({ seq: row.seq, type: row.type, event: row }))
        if (want(last)) return last
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      throw new Error(
        `timed out; last events: ${last.map((row) => `${row.seq}:${row.type}`).join(', ')}`,
      )
    },

    async spawnDaemonFor({ sessionId }) {
      const daemon = await startDaemon({ sessionId, secret: RIG_SECRET })
      closers.push(daemon.stop)
      return daemon
    },

    async spawnHost({
      label,
      daemonUrl,
      scripts,
      knobs,
      dbProxy: dbProxyMode,
      daemonProxy: daemonProxyMode,
      redisUrl,
      firstChunkFile,
    }) {
      const dir = mkdtempSync(join(tmpdir(), `atlas-fault-rig-host-${label}-`))
      closers.push(async () => {
        rmSync(dir, { recursive: true, force: true })
      })
      const workspace = join(dir, 'workspace')
      mkdirSync(workspace, { recursive: true })
      const scriptFile = join(dir, 'scripts.json')
      writeFileSync(scriptFile, JSON.stringify(scripts))
      let ownProxy: FaultProxy | undefined
      if (dbProxyMode === 'own') {
        ownProxy = await FaultProxy.start({
          target: { host: '127.0.0.1', port: dbProxy.port },
        })
        const stopping = ownProxy
        closers.push(() => stopping.stop())
      }
      const ownDaemon =
        daemonProxyMode === 'own' ? await startOwnDaemonProxy({ daemonUrl }) : undefined
      if (ownDaemon !== undefined) closers.push(async () => ownDaemon.proxy.stop())
      const databaseUrl = (): string => {
        if (ownProxy === undefined) {
          return proxiedDatabaseUrl({ databaseUrl: args.databaseUrl, port: dbProxy.port })
        }
        const url = new URL(args.databaseUrl)
        url.hostname = '127.0.0.1'
        url.port = String(ownProxy.port)
        return url.toString()
      }
      const child = Bun.spawn({
        cmd: ['bun', hostEntry],
        env: {
          ...process.env,
          ATLAS_HOME: join(dir, 'atlas-home'),
          DATABASE_URL: databaseUrl(),
          DATABASE_DIRECT_URL: args.databaseUrl,
          PRESENCE_DATABASE_URL: ownProxy === undefined ? args.databaseUrl : databaseUrl(),
          REDIS_URL: redisUrl ?? args.redisUrl,
          HOLDER_ID: label,
          DAEMON_URL: ownDaemon?.url ?? daemonUrl,
          DAEMON_SECRET: RIG_SECRET,
          SCRIPT_FILE: scriptFile,
          WORKSPACE_DIR: workspace,
          APPEND_RETRY_MS: String(knobs?.appendRetryMs ?? 2_500),
          PING_MS: String(knobs?.pingMs ?? 10_000),
          ...(knobs?.drainMs === undefined ? {} : { DRAIN_MS: String(knobs.drainMs) }),
          ...(knobs?.queryTimeoutMs === undefined
            ? {}
            : { DB_QUERY_TIMEOUT_MS: String(knobs.queryTimeoutMs) }),
          ...(knobs?.toolOutputFile === undefined
            ? {}
            : { TOOL_OUTPUT_FILE: knobs.toolOutputFile }),
          ...(firstChunkFile === undefined ? {} : { FIRST_CHUNK_FILE: firstChunkFile }),
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const lines: string[] = []
      collectLines(child.stdout, lines)
      collectLines(child.stderr, lines)
      closers.push(async () => {
        child.kill('SIGKILL')
        await child.exited.catch(() => undefined)
      })
      return {
        label,
        ...(ownProxy === undefined ? {} : { dbProxy: ownProxy }),
        ...(ownDaemon === undefined ? {} : { daemonProxy: ownDaemon.proxy }),
        kill(signal) {
          child.kill(signal)
        },
        exited: child.exited,
        logs: () => [...lines],
      }
    },

    async stop() {
      for (const closer of closers.splice(0).reverse()) {
        await closer().catch(() => undefined)
      }
      await pool.end()
      await dbProxy.stop()
    },
  }
}
