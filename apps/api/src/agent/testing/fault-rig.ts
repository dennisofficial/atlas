import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool, type Pool } from '@dltech/atlas-db'
import { FaultProxy } from '@dltech/atlas-host/testing'
import { PANEL_HOLD_CHANNEL } from '@dltech/atlas-protocol'
import { Redis } from 'ioredis'

import { controlEventSchema } from '../registered-plugins'
import type { EHostFault } from './host-faults'
import { seedSession, type NewSessionArgs } from './rig-seed'
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

export type PanelBeats = { stop(): Promise<void> }

export type HostKnobs = {
  appendRetryMs?: number
  pingMs?: number
  poolMax?: number
  noRing?: boolean
  queryTimeoutMs?: number
  toolOutputFile?: string
  sweepMs?: number
  fault?: EHostFault
  plugins?: boolean
  modelRequestsFile?: string
  contextMirrorDir?: string
}

/**
 * A host holds a session only while it has work, so it can claim, finish and release a session
 * between two polls of the lease. The host's own take-over log is the durable proof that it held
 * it, and keeps the wait meaningful where a lease read would have missed the hold entirely. A
 * command-only hold never reaches a first step, so replaying a consumed command after a take-over
 * counts as the same proof once that session's epoch has moved.
 */
const takeOversOf = (args: { host: HostProcess | undefined; sessionId: string }): number =>
  args.host === undefined
    ? 0
    : args.host
        .logs()
        .filter((line) => line.includes(`take-over of ${args.sessionId} reached its first step`))
        .length

const replaysAfterTakeOverOf = (host: HostProcess | undefined): number =>
  host === undefined ? 0 : host.logs().filter((line) => line.includes('after takeover')).length

export type FaultRig = {
  plane: ControlPlane
  sandboxHome: string
  dbProxy: FaultProxy
  newSession(args: NewSessionArgs): Promise<string>
  wake(sessionId: string): Promise<void>
  claim(args: { sessionId: string; label: string; timeoutMs?: number }): Promise<void>
  waitHeldBy(args: { sessionId: string; label: string; timeoutMs?: number }): Promise<void>
  labelOf(hostId: number | null): Promise<string | undefined>
  waitForSeq(args: {
    threadId: string
    want: (events: readonly ReadEvent[]) => boolean
    timeoutMs?: number
  }): Promise<ReadEvent[]>
  panelBeats(args: { sessionId: string; ttlMs: number; everyMs: number }): PanelBeats
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
    workspace?: string
    setupScript?: string
  }): Promise<HostProcess>
  stop(): Promise<void>
}

export const startRig = async (args: {
  databaseUrl: string
  redisUrl: string
  setupScript?: string
}): Promise<FaultRig> => {
  const target = new URL(args.databaseUrl)
  const dbProxy = await FaultProxy.start({
    target: { host: target.hostname, port: Number(target.port) },
  })
  const pool: Pool = createPool(args.databaseUrl)
  const store = new PostgresControlStore(createDb(pool))
  const plane = new ControlPlane({ store, eventSchema: controlEventSchema })
  const sandboxHome = mkdtempSync(join(tmpdir(), 'atlas-fault-rig-sandbox-home-'))
  const closers: (() => Promise<void>)[] = [
    async () => rmSync(sandboxHome, { recursive: true, force: true }),
  ]
  const hostsByLabel = new Map<string, HostProcess>()
  const labelOf = async (hostId: number | null): Promise<string | undefined> => {
    if (hostId === null) return undefined
    const result = await pool.query<{ label: string }>(
      'SELECT "label" FROM "v2"."V2Host" WHERE "id" = $1',
      [hostId],
    )
    return result.rows[0]?.label
  }

  const waitClaimedBy = async (args: {
    sessionId: string
    label: string
    timeoutMs: number
    wake: boolean
  }): Promise<void> => {
    const host = hostsByLabel.get(args.label)
    const seen = takeOversOf({ host, sessionId: args.sessionId })
    const seenReplays = replaysAfterTakeOverOf(host)
    const epochAtStart = (await plane.currentLease({ sessionId: args.sessionId })).lease.epoch
    const deadline = Date.now() + args.timeoutMs
    for (;;) {
      if (args.wake) await plane.wake({ sessionIds: [args.sessionId] }).catch(() => undefined)
      const current = await plane.currentLease({ sessionId: args.sessionId })
      if (current.live && (await labelOf(current.lease.holderHostId)) === args.label) return
      if (takeOversOf({ host, sessionId: args.sessionId }) > seen) return
      if (current.lease.epoch > epochAtStart && replaysAfterTakeOverOf(host) > seenReplays) return
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${args.label} to take over ${args.sessionId}: ${JSON.stringify(current)}\n${args.label} logs:\n${host?.logs().join('\n') ?? 'the rig never spawned that host'}`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  return {
    plane,
    sandboxHome,
    dbProxy,
    labelOf,

    newSession({ sessionId, text, prepared, files }) {
      return seedSession({ store, sessionId, text, prepared: prepared !== false, files })
    },

    async wake(sessionId) {
      await plane.wake({ sessionIds: [sessionId] })
    },

    claim({ sessionId, label, timeoutMs }) {
      return waitClaimedBy({ sessionId, label, timeoutMs: timeoutMs ?? 15_000, wake: true })
    },

    waitHeldBy({ sessionId, label, timeoutMs }) {
      return waitClaimedBy({ sessionId, label, timeoutMs: timeoutMs ?? 15_000, wake: false })
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

    panelBeats({ sessionId, ttlMs, everyMs }) {
      const publisher = new Redis(args.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 })
      const beat = (): void => {
        void publisher
          .publish(PANEL_HOLD_CHANNEL, JSON.stringify({ sessionId, ttlMs }))
          .catch(() => undefined)
      }
      beat()
      const timer = setInterval(beat, everyMs)
      return {
        async stop() {
          clearInterval(timer)
          await publisher.quit().catch(() => undefined)
        },
      }
    },

    async spawnDaemonFor({ sessionId }) {
      const daemon = await startDaemon({ sandboxSessionId: sessionId, secret: RIG_SECRET })
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
      workspace: sharedWorkspace,
      setupScript,
    }) {
      const dir = mkdtempSync(join(tmpdir(), `atlas-fault-rig-host-${label}-`))
      closers.push(async () => {
        rmSync(dir, { recursive: true, force: true })
      })
      // a second host that takes the session over sees the same workspace the first one used
      const workspace = sharedWorkspace ?? join(dir, 'workspace')
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
            sandboxHome,
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
            setupScript: setupScript ?? args.setupScript,
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
      const host: HostProcess = {
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
      hostsByLabel.set(label, host)
      return host
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
