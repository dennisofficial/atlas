import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool, type Pool } from '@dltech/atlas-db'
import { FaultProxy } from '@dltech/atlas-host/testing'

import type { EHostFault } from './host-faults'
import { seedSession } from './rig-seed'
import { startDaemon, type RigDaemon } from './rig-daemon'
import { collectLines } from './rig-process'
import { hostEnv, RIG_SECRET } from './rig-host-env'
import { proxiedDatabaseUrl, startOwnDaemonProxy } from './rig-proxies'

export type { RigDaemon } from './rig-daemon'

const hostEntry = join(import.meta.dir, 'host-process.ts')

export { RIG_SECRET }

export type HostProcess = {
  label: string
  dbProxy?: FaultProxy
  daemonProxy?: FaultProxy
  kill(signal: 'SIGKILL' | 'SIGTERM'): void
  pause(): void
  resume(): void
  exited: Promise<number>
  logs(): string[]
}

export type ReadEvent = { seq: number; type: string; event: unknown }

export type HostKnobs = {
  appendRetryMs?: number
  pingMs?: number
  drainMs?: number
  maxSessions?: number
  poolMax?: number
  noRing?: boolean
  queryTimeoutMs?: number
  toolOutputFile?: string
  idleMs?: number
  sweepMs?: number
  fault?: EHostFault
}

export type FaultRig = {
  plane: ControlPlane
  dbProxy: FaultProxy
  newSession(args: { sessionId: string; text: string; prepared?: boolean }): Promise<string>
  wake(sessionId: string): Promise<void>
  claim(args: { sessionId: string; label: string; timeoutMs?: number }): Promise<void>
  waitHeldBy(args: { sessionId: string; label: string; timeoutMs?: number }): Promise<void>
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
    daemonUrls?: Record<string, string>
    daemonUrlFile?: string
    scripts: Record<string, ScriptedModelStep[]>
    knobs?: HostKnobs
    dbProxy?: 'shared' | 'own'
    daemonProxy?: 'shared' | 'own'
    redisUrl?: string
    firstChunkFile?: string
    directPresence?: boolean
  }): Promise<HostProcess>
  stop(): Promise<void>
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
  const store = new PostgresControlStore(createDb(pool))
  const plane = new ControlPlane({ store })
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

    newSession({ sessionId, text, prepared }) {
      return seedSession({ store, sessionId, text, prepared: prepared !== false })
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

    async waitHeldBy({ sessionId, label, timeoutMs }) {
      const deadline = Date.now() + (timeoutMs ?? 15_000)
      for (;;) {
        const current = await plane.currentLease({ sessionId })
        if (current.live && (await labelOf(current.lease.holderHostId)) === label) return
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${label} to hold ${sessionId}: ${JSON.stringify(current)}`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
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
      daemonUrls,
      daemonUrlFile,
      scripts,
      knobs,
      dbProxy: dbProxyMode,
      daemonProxy: daemonProxyMode,
      redisUrl,
      firstChunkFile,
      directPresence,
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
          ...hostEnv({
            home: join(dir, 'atlas-home'),
            databaseUrl: databaseUrl(),
            directUrl: args.databaseUrl,
            presenceUrl:
              ownProxy === undefined || directPresence === true ? args.databaseUrl : databaseUrl(),
            redisUrl: redisUrl ?? args.redisUrl,
            label,
            daemonUrl: ownDaemon?.url ?? daemonUrl,
            daemonUrls,
            daemonUrlFile,
            scriptFile,
            workspace,
            knobs,
            firstChunkFile,
          }),
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
        pause() {
          child.kill('SIGSTOP')
        },
        resume() {
          child.kill('SIGCONT')
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
