import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool, type Pool } from '@dltech/atlas-db'
import { FaultProxy } from '@dltech/atlas-host/testing'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import { daemonTestEnv, spawnDaemon } from '@dltech/atlas-daemon/testing'

import { createRedisBus, type RedisBus } from '../bus/redis-bus'
import { sandboxNameOf } from '../sandbox/sandbox-provider'

const daemonEntry = join(import.meta.dir, '../../../daemon/src/index.ts')
const hostEntry = join(import.meta.dir, 'host-process.ts')

export const RIG_SECRET = 'fault-rig-secret'

export type RigDaemon = {
  url: string
  proxy: FaultProxy
  home: string
  bootId: string
  stop(): Promise<void>
}

export type HostProcess = {
  holderId: string
  kill(signal: 'SIGKILL' | 'SIGTERM'): void
  exited: Promise<number>
  logs(): string[]
}

export type ReadEvent = { seq: number; type: string; event: unknown }

export type HostKnobs = { ttlMs?: number; renewMs?: number; fenceMs?: number; inboxPollMs?: number }

export type FaultRig = {
  plane: ControlPlane
  dbProxy: FaultProxy
  newSession(args: { sessionId: string; text: string }): Promise<string>
  wake(sessionId: string): Promise<void>
  claim(args: { sessionId: string; holderId: string; timeoutMs?: number }): Promise<void>
  waitForSeq(args: {
    threadId: string
    want: (events: readonly ReadEvent[]) => boolean
    timeoutMs?: number
  }): Promise<ReadEvent[]>
  spawnDaemonFor(args: { sessionId: string }): Promise<RigDaemon>
  spawnHost(args: {
    holderId: string
    daemonUrl: string
    scripts: Record<string, ScriptedModelStep[]>
    knobs?: HostKnobs
  }): Promise<HostProcess>
  stop(): Promise<void>
}

const collectLines = (stream: ReadableStream<Uint8Array>, into: string[]): void => {
  void (async () => {
    const decoder = new TextDecoder()
    let rest = ''
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      rest += decoder.decode(chunk, { stream: true })
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) if (line !== '') into.push(line)
    }
  })()
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
  const bus: RedisBus = createRedisBus({ url: args.redisUrl })
  const closers: (() => Promise<void>)[] = []

  const proxyDatabaseUrl = (): string => {
    const url = new URL(args.databaseUrl)
    url.hostname = '127.0.0.1'
    url.port = String(dbProxy.port)
    return url.toString()
  }

  return {
    plane,
    dbProxy,

    async newSession({ sessionId, text }) {
      const mainThreadId = `thread-${sessionId}`
      await plane.createSession({
        sessionId,
        userId: 'user-1',
        projectId: 'proj-1',
        mainThreadId,
      })
      await plane.post({
        sessionId,
        kind: INBOX_KIND_MESSAGE,
        payload: JSON.stringify({ text }),
      })
      return mainThreadId
    },

    async wake(sessionId) {
      await bus.wake(sessionId)
    },

    async claim({ sessionId, holderId, timeoutMs }) {
      const deadline = Date.now() + (timeoutMs ?? 15_000)
      for (;;) {
        await bus.wake(sessionId).catch(() => undefined)
        const current = await plane.currentLease({ sessionId })
        if (current.live && current.lease.holderId === holderId) return
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${holderId} to hold ${sessionId}: ${JSON.stringify(current)}`,
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
      const home = mkdtempSync(join(tmpdir(), 'atlas-fault-rig-daemon-'))
      const sandboxName = sandboxNameOf(sessionId)
      const spawned = await spawnDaemon({
        entry: daemonEntry,
        env: {
          ...daemonTestEnv(home),
          DAEMON_TOKEN: daemonToken({ secret: RIG_SECRET, sandboxName }),
          ATLAS_SANDBOX_NAME: sandboxName,
          HOME: home,
        },
      })
      const proxy = await FaultProxy.start({
        target: { host: '127.0.0.1', port: spawned.port },
      })
      const daemon: RigDaemon = {
        url: `ws://127.0.0.1:${proxy.port}`,
        proxy,
        home,
        bootId: spawned.bootId,
        async stop() {
          spawned.child.kill('SIGKILL')
          await spawned.child.exited
          await proxy.stop()
          rmSync(home, { recursive: true, force: true })
        },
      }
      closers.push(daemon.stop)
      return daemon
    },

    async spawnHost({ holderId, daemonUrl, scripts, knobs }) {
      const dir = mkdtempSync(join(tmpdir(), `atlas-fault-rig-host-${holderId}-`))
      const workspace = join(dir, 'workspace')
      mkdirSync(workspace, { recursive: true })
      const scriptFile = join(dir, 'scripts.json')
      writeFileSync(scriptFile, JSON.stringify(scripts))
      const child = Bun.spawn({
        cmd: ['bun', hostEntry],
        env: {
          ...process.env,
          ATLAS_HOME: join(dir, 'atlas-home'),
          DATABASE_URL: proxyDatabaseUrl(),
          REDIS_URL: args.redisUrl,
          HOLDER_ID: holderId,
          DAEMON_URL: daemonUrl,
          DAEMON_SECRET: RIG_SECRET,
          SCRIPT_FILE: scriptFile,
          WORKSPACE_DIR: workspace,
          TTL_MS: String(knobs?.ttlMs ?? 3_000),
          RENEW_MS: String(knobs?.renewMs ?? 500),
          FENCE_MS: String(knobs?.fenceMs ?? 1_000),
          INBOX_POLL_MS: String(knobs?.inboxPollMs ?? 100),
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
        rmSync(dir, { recursive: true, force: true })
      })
      return {
        holderId,
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
      await bus.close()
      await pool.end()
      await dbProxy.stop()
    },
  }
}
