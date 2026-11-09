import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { daemonTestEnv, spawnDaemon } from '@dltech/atlas-daemon/testing'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import type { VercelCredentials } from '../sandbox/constants'

import { SandboxProvider, sandboxNameOf, type DaemonEndpoint } from '../sandbox/sandbox-provider'

const daemonEntry = join(import.meta.dir, '../../../daemon/src/index.ts')

type Running = { child: Bun.Subprocess; home: string; port: number }

export class LocalSandboxProvider extends SandboxProvider {
  private readonly running = new Map<string, Running>()

  constructor(private readonly args: { daemonSecret: string }) {
    super()
  }

  async wake(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    const existing = this.running.get(args.sandboxSessionId)
    if (existing !== undefined)
      return this.endpointOf({ sandboxSessionId: args.sandboxSessionId, port: existing.port })
    const home = mkdtempSync(join(tmpdir(), 'atlas-agent-host-local-'))
    const sandboxName = sandboxNameOf(args.sandboxSessionId)
    const env = {
      ...daemonTestEnv(home),
      DAEMON_TOKEN: daemonToken({ secret: this.args.daemonSecret, sandboxName }),
      ATLAS_SANDBOX_NAME: sandboxName,
    }
    const spawned = await spawnDaemon({ entry: daemonEntry, env })
    this.running.set(args.sandboxSessionId, { child: spawned.child, home, port: spawned.port })
    return this.endpointOf({ sandboxSessionId: args.sandboxSessionId, port: spawned.port })
  }

  async stop(args: { sandboxSessionId: string; credentials: VercelCredentials }): Promise<void> {
    const running = this.running.get(args.sandboxSessionId)
    if (running === undefined) return
    this.running.delete(args.sandboxSessionId)
    running.child.kill('SIGKILL')
    await running.child.exited
    rmSync(running.home, { recursive: true, force: true })
  }

  async keepAlive(_args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void> {}

  async stopAll(): Promise<void> {
    for (const sandboxSessionId of [...this.running.keys()]) {
      await this.stop({ sandboxSessionId, credentials: { token: '', teamId: '', projectId: '' } })
    }
  }

  private endpointOf(args: { sandboxSessionId: string; port: number }): DaemonEndpoint {
    const sandboxName = sandboxNameOf(args.sandboxSessionId)
    return {
      url: `ws://127.0.0.1:${args.port}`,
      token: daemonToken({ secret: this.args.daemonSecret, sandboxName }),
      sandboxName,
    }
  }
}
