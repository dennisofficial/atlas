import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FrameQueue,
  type DaemonSession,
  type DaemonSpawnedHandle,
  describeDaemonConformance,
  sessionOverQueue,
} from '@dltech/atlas-protocol/testing'
import type { DaemonFrame, HostFrame } from '@dltech/atlas-protocol'

import { daemonToken } from './auth'

const SANDBOX = 'atlas-v2-conformance'
const SECRET = 'conformance-secret'

export const CONFORMANCE_ENV = {
  V2_DAEMON_SECRET: SECRET,
  ATLAS_SANDBOX_NAME: SANDBOX,
}

export const conformanceToken = (): string => daemonToken({ secret: SECRET, sandboxName: SANDBOX })

export type DaemonProcess = {
  port: number
  child: Bun.Subprocess
  home: string
  bootId: string
}

export const spawnCountFileOf = (home: string): string => `${home}/spawn-count`

export const startDaemonProcess = async (args?: {
  entry?: string | undefined
}): Promise<DaemonProcess> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-daemon-test-'))
  const entry = args?.entry ?? join(import.meta.dir, 'index.ts')
  const child = Bun.spawn(['bun', entry], {
    env: {
      ...process.env,
      ...CONFORMANCE_ENV,
      ATLAS_DAEMON_HOME: home,
      PORT: '0',
      ATLAS_DAEMON_SPAWN_COUNT_FILE: spawnCountFileOf(home),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const listening = await waitForPort(child)
  return { port: listening.port, child, home, bootId: listening.bootId }
}

const waitForPort = (child: Bun.Subprocess): Promise<{ port: number; bootId: string }> =>
  new Promise<{ port: number; bootId: string }>((resolve, reject) => {
    const deadline = Date.now() + 10_000
    const stdout = child.stdout
    if (stdout === undefined || typeof stdout === 'number') {
      reject(new Error('daemon stdout not piped'))
      return
    }
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    const pump = async (): Promise<void> => {
      for (;;) {
        if (Date.now() > deadline) {
          reject(new Error('daemon did not print its port'))
          return
        }
        const { done, value } = await reader.read()
        if (done) {
          reject(new Error('daemon exited before listening'))
          return
        }
        const text = decoder.decode(value)
        const match = /listening on (\d+) bootId=(\S+)/.exec(text)
        if (match?.[1] !== undefined && match[2] !== undefined) {
          resolve({ port: Number(match[1]), bootId: match[2] })
          return
        }
      }
    }
    void pump()
  })

export class RealHandle implements DaemonSpawnedHandle {
  readonly token = conformanceToken()

  constructor(readonly proc: DaemonProcess) {}

  pid(): number {
    return this.proc.child.pid
  }

  async spawnCount(): Promise<number> {
    try {
      const text = await Bun.file(spawnCountFileOf(this.proc.home)).text()
      return Number(text.trim())
    } catch {
      return 0
    }
  }

  bootId(): Promise<string> {
    return Promise.resolve(this.proc.bootId)
  }

  writableCgroups(): Promise<boolean> {
    const probe = Bun.spawnSync(['/bin/sh', '-c', 'test -w /sys/fs/cgroup'])
    return Promise.resolve(probe.exitCode === 0)
  }

  kill(): Promise<void> {
    this.proc.child.kill()
    return this.proc.child.exited.then(() => undefined)
  }
}

export const connectWebSocket = async (args: { port: number }): Promise<DaemonSession> => {
  const queue = new FrameQueue()
  let resolveClosed: (value: { code: number; reason: string }) => void = () => {}
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    resolveClosed = resolve
  })
  const socket = new WebSocket(`ws://127.0.0.1:${args.port}`)
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    queue.push(JSON.parse(event.data) as DaemonFrame)
  })
  socket.addEventListener('close', (event) => {
    resolveClosed({ code: event.code, reason: event.reason })
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('websocket failed')), { once: true })
  })
  return sessionOverQueue({
    queue,
    send: (frame: HostFrame) => socket.send(JSON.stringify(frame)),
    close: () => socket.close(),
    closed,
  })
}

export const realDaemonTarget = (args?: { entry?: string | undefined }) => ({
  name: args?.entry === undefined ? 'real-source' : 'real-bundle',
  setup: async (): Promise<RealHandle> => {
    const proc = await startDaemonProcess({ entry: args?.entry ?? undefined })
    return new RealHandle(proc)
  },
  connect: (handle: DaemonSpawnedHandle): Promise<DaemonSession> =>
    connectWebSocket({ port: (handle as RealHandle).proc.port }),
  teardown: (handle: DaemonSpawnedHandle): Promise<void> => (handle as RealHandle).kill(),
})

export const describeRealDaemonConformance = (args?: { entry?: string | undefined }): void => {
  describeDaemonConformance(realDaemonTarget(args))
}
