import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { daemonToken } from '@dltech/atlas-protocol/engine'
import {
  FrameQueue,
  type DaemonConformanceTarget,
  type DaemonHandle,
  type DaemonSession,
  describeDaemonConformance,
  sessionOverQueue,
} from '@dltech/atlas-protocol/testing'
import { rgPath } from '@vscode/ripgrep'

const SANDBOX = 'atlas-v2-conformance'
const SECRET = 'conformance-secret'
const LISTENING = /listening on (\d+) bootId=(\S+)/

type Running = { child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>; port: number; bootId: string }

const fakeCgroupRoot = (base: string): string => {
  const root = join(base, 'cgroup')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'cgroup.procs'), '')
  writeFileSync(join(root, 'cgroup.subtree_control'), '')
  return root
}

const waitForListening = async (
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
): Promise<{ port: number; bootId: string }> => {
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let seen = ''
  const deadline = setTimeout(() => void reader.cancel(), 10_000)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      seen += decoder.decode(value, { stream: true })
      const match = LISTENING.exec(seen)
      if (match?.[1] !== undefined && match[2] !== undefined) {
        return { port: Number(match[1]), bootId: match[2] }
      }
    }
  } finally {
    clearTimeout(deadline)
    reader.releaseLock()
  }
  const stderr = await new Response(child.stderr).text()
  throw new Error(`daemon did not start: ${seen}${stderr}`)
}

export const spawnDaemon = async (args: {
  entry: string
  env: Record<string, string | undefined>
}): Promise<Running> => {
  const child = Bun.spawn({
    cmd: ['bun', args.entry],
    env: args.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const listening = await waitForListening(child)
  return { child, ...listening }
}

export const daemonTestToken = (): string => daemonToken({ secret: SECRET, sandboxName: SANDBOX })

export const daemonTestEnv = (
  home: string,
  options?: { realCgroups?: boolean | undefined },
): Record<string, string | undefined> => ({
  PATH: process.env.PATH,
  HOME: home,
  DAEMON_TOKEN: daemonTestToken(),
  ATLAS_SANDBOX_NAME: SANDBOX,
  ATLAS_DAEMON_HOME: join(home, 'daemon'),
  ...(options?.realCgroups === true ? {} : { ATLAS_DAEMON_CGROUP_ROOT: fakeCgroupRoot(home) }),
  ATLAS_RG_PATH: rgPath,
  PORT: '0',
})

export const connectWebSocket = async (port: number): Promise<DaemonSession> => {
  const queue = new FrameQueue()
  const socket = new WebSocket(`ws://127.0.0.1:${port}`)
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }))
  })
  socket.addEventListener('message', (event) => {
    queue.pushText(typeof event.data === 'string' ? event.data : String(event.data))
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('websocket failed')), { once: true })
  })
  return sessionOverQueue({
    queue,
    sendText: (text) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(text)
    },
    close: () => socket.close(),
    closed,
  })
}

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const realDaemonTarget = (args: {
  name: string
  entry: string
  realCgroups?: boolean | undefined
}): DaemonConformanceTarget => ({
  name: args.name,
  start: async (): Promise<DaemonHandle> => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-daemon-test-'))
    const env = daemonTestEnv(home, { realCgroups: args.realCgroups })
    const sessions = new Set<DaemonSession>()
    let running = await spawnDaemon({ entry: args.entry, env })
    const kill = async (): Promise<void> => {
      for (const session of sessions) session.close()
      sessions.clear()
      running.child.kill('SIGKILL')
      await running.child.exited
    }
    return {
      token: daemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      foreignToken: ({ sandboxName, secret } = {}) =>
        daemonToken({ secret: secret ?? SECRET, sandboxName: sandboxName ?? SANDBOX }),
      bootId: () => running.bootId,
      connect: async () => {
        const session = await connectWebSocket(running.port)
        sessions.add(session)
        return session
      },
      restart: async () => {
        await kill()
        running = await spawnDaemon({ entry: args.entry, env })
      },
      stop: async () => {
        await kill()
        rmSync(home, { recursive: true, force: true })
      },
      realProcesses: true,
      processAlive,
    }
  },
})

export const describeRealDaemonConformance = (args: { name: string; entry: string }): void => {
  describeDaemonConformance(realDaemonTarget(args))
}
