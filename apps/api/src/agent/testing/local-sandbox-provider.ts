import type { PodShape } from '@dltech/atlas-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { daemonTestEnv, spawnDaemon } from '@dltech/atlas-daemon/testing'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import {
  SandboxProvider,
  type DaemonEndpoint,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
  type PodResizeOutcome,
} from '../sandbox/sandbox-provider'
import { sandboxNameOf } from '../sandbox/vercel-names'

const daemonEntry = join(import.meta.dir, '../../../../daemon/src/index.ts')

type Running = { child: Bun.Subprocess; home: string; port: number; createdAt: number }

const localCredentials = {
  provider: ESandboxProvider.Vercel,
  token: '',
  teamId: '',
  projectId: '',
} as const

export class LocalSandboxProvider extends SandboxProvider {
  private readonly running = new Map<string, Running>()

  constructor(private readonly args: { daemonSecret: string }) {
    super()
  }

  async wake(args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    const sandboxSessionId = args.target.sandboxSessionId
    const existing = this.running.get(sandboxSessionId)
    if (existing !== undefined) return this.endpointOf({ sandboxSessionId, port: existing.port })
    const home = mkdtempSync(join(tmpdir(), 'atlas-api-agent-local-'))
    const sandboxName = sandboxNameOf(sandboxSessionId)
    const env = {
      ...daemonTestEnv(home),
      DAEMON_TOKEN: daemonToken({ secret: this.args.daemonSecret, sandboxName }),
      ATLAS_SANDBOX_NAME: sandboxName,
    }
    const spawned = await spawnDaemon({ entry: daemonEntry, env })
    this.running.set(sandboxSessionId, {
      child: spawned.child,
      home,
      port: spawned.port,
      createdAt: Date.now(),
    })
    return this.endpointOf({ sandboxSessionId, port: spawned.port })
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    const sandboxSessionId = args.target.sandboxSessionId
    const running = this.running.get(sandboxSessionId)
    if (running === undefined) return
    this.running.delete(sandboxSessionId)
    running.child.kill('SIGKILL')
    await running.child.exited
    rmSync(running.home, { recursive: true, force: true })
  }

  async keepAlive(_args: { target: SandboxTarget; until: number }): Promise<void> {}

  async resize(_args: { target: SandboxTarget; shape: PodShape }): Promise<PodResizeOutcome> {
    return 'restarted'
  }

  async delete(args: { target: SandboxTarget }): Promise<void> {
    await this.stop(args)
  }

  async list(_args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    return [...this.running].map(([sandboxSessionId, running]) => ({
      sandboxSessionId,
      running: true,
      createdAt: running.createdAt,
    }))
  }

  async stopAll(): Promise<void> {
    for (const sandboxSessionId of [...this.running.keys()]) {
      await this.stop({ target: { sandboxSessionId, credentials: localCredentials } })
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
