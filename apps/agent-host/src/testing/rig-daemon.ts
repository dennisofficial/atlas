import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { daemonTestEnv } from '@dltech/atlas-daemon/testing'
import { FaultProxy } from '@dltech/atlas-host/testing'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import { sandboxNameOf } from '../sandbox/sandbox-provider'

const daemonEntry = join(import.meta.dir, '../../../daemon/src/index.ts')

export type RigDaemon = {
  readonly url: string
  proxy: FaultProxy
  home: string
  readonly bootId: string
  restart(args: { keepHome: true }): Promise<void>
  relocate(args: { keepHome: true }): Promise<void>
  stop(): Promise<void>
}

type DaemonChild = Bun.Subprocess<'ignore', 'pipe', 'pipe'>

const LISTENING = /listening on (\d+) bootId=(\S+)/

const waitForListening = async (child: DaemonChild): Promise<{ port: number; bootId: string }> => {
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

const killOrphans = (home: string): void => {
  spawnSync('pkill', ['-9', '-f', home])
}

const killChild = async (child: DaemonChild, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> => {
  if (signal === 'SIGKILL') {
    child.kill('SIGKILL')
  } else {
    child.kill('SIGTERM')
    const exited = await Promise.race([
      child.exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ])
    if (!exited) child.kill('SIGKILL')
  }
  await child.exited.catch(() => undefined)
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // the process group is already gone
  }
}

export const startDaemon = async (args: {
  sessionId: string
  secret: string
}): Promise<RigDaemon> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-fault-rig-daemon-'))
  const sandboxName = sandboxNameOf(args.sessionId)
  const env = {
    ...daemonTestEnv(home),
    DAEMON_TOKEN: daemonToken({ secret: args.secret, sandboxName }),
    ATLAS_SANDBOX_NAME: sandboxName,
    HOME: home,
  }

  let child: DaemonChild | undefined
  let proxy: FaultProxy | undefined
  let currentBootId = ''
  let stopped = false

  const spawn = async (): Promise<void> => {
    const next: DaemonChild = Bun.spawn({
      cmd: ['setsid', 'bun', daemonEntry],
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    child = next
    let listening: { port: number; bootId: string }
    try {
      listening = await waitForListening(next)
    } catch (error) {
      if (child === next) child = undefined
      await killChild(next, 'SIGKILL')
      throw error
    }
    if (stopped) {
      if (child === next) child = undefined
      await killChild(next, 'SIGKILL')
      return
    }
    currentBootId = listening.bootId
    if (proxy === undefined) {
      proxy = await FaultProxy.start({ target: { host: '127.0.0.1', port: listening.port } })
      return
    }
    proxy.retarget({ host: '127.0.0.1', port: listening.port })
  }

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    const current = child
    child = undefined
    if (current !== undefined) await killChild(current, 'SIGTERM')
    killOrphans(home)
    await proxy?.stop()
    rmSync(home, { recursive: true, force: true })
  }

  await spawn()
  const urlOf = (): string => {
    if (proxy === undefined) throw new Error('daemon proxy is stopped')
    return `ws://127.0.0.1:${proxy.port}`
  }
  urlOf()

  return {
    get url() {
      return urlOf()
    },
    get proxy() {
      if (proxy === undefined) throw new Error('daemon proxy is stopped')
      return proxy
    },
    home,
    get bootId() {
      return currentBootId
    },
    async restart({ keepHome }) {
      if (stopped) throw new Error('cannot restart a stopped daemon')
      if (!keepHome) throw new Error('restart requires keepHome: true')
      const current = child
      child = undefined
      if (current !== undefined) await killChild(current, 'SIGKILL')
      killOrphans(home)
      await spawn()
    },
    async relocate({ keepHome }) {
      if (stopped) throw new Error('cannot relocate a stopped daemon')
      if (!keepHome) throw new Error('relocate requires keepHome: true')
      const current = child
      child = undefined
      if (current !== undefined) await killChild(current, 'SIGKILL')
      killOrphans(home)
      const previous = proxy
      proxy = undefined
      await previous?.stop()
      await spawn()
    },
    stop,
  }
}
