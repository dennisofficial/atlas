import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { daemonTestEnv, spawnDaemon } from '@dltech/atlas-daemon/testing'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import type { VercelCredentials } from '@dltech/atlas-wire'

import { SandboxProvider, sandboxNameOf, type DaemonEndpoint } from '../sandbox/sandbox-provider'

const daemonEntry = join(import.meta.dir, '../../../daemon/src/index.ts')

type Running = { child: Bun.Subprocess; home: string; port: number }

export class LocalSandboxProvider extends SandboxProvider {
  private readonly running = new Map<string, Running>()

  constructor(private readonly args: { daemonSecret: string }) {
    super()
  }

  async wake(args: {
    sessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    const existing = this.running.get(args.sessionId)
    if (existing !== undefined)
      return this.endpointOf({ sessionId: args.sessionId, port: existing.port })
    const home = mkdtempSync(join(tmpdir(), 'atlas-agent-host-local-'))
    const env = daemonTestEnv(home)
    const spawned = await spawnDaemon({ entry: daemonEntry, env })
    this.running.set(args.sessionId, { child: spawned.child, home, port: spawned.port })
    return this.endpointOf({ sessionId: args.sessionId, port: spawned.port })
  }

  async stop(args: { sessionId: string; credentials: VercelCredentials }): Promise<void> {
    const running = this.running.get(args.sessionId)
    if (running === undefined) return
    this.running.delete(args.sessionId)
    running.child.kill('SIGKILL')
    await running.child.exited
    rmSync(running.home, { recursive: true, force: true })
  }

  async keepAlive(_args: {
    sessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void> {}

  async stopAll(): Promise<void> {
    for (const sessionId of [...this.running.keys()]) {
      await this.stop({ sessionId, credentials: { token: '', teamId: '', projectId: '' } })
    }
  }

  private endpointOf(args: { sessionId: string; port: number }): DaemonEndpoint {
    const sandboxName = sandboxNameOf(args.sessionId)
    return {
      url: `ws://127.0.0.1:${args.port}`,
      token: daemonToken({ secret: this.args.daemonSecret, sandboxName }),
      sandboxName,
    }
  }
}
