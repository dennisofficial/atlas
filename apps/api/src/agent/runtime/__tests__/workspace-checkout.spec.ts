import { describe, expect, it } from 'bun:test'

import { ProcessPort, type ProcessHandle, type SpawnCommand } from '@dltech/atlas-core'

import type { WorkspaceConfig } from '../../config/agent-host-config'
import { captureCheckedOut } from '../workspace-checkout'
import { StubFileSystemPort } from './workspace-fakes'

const workspaceOf = (additional: readonly string[]): WorkspaceConfig => ({
  remoteUrl: 'https://github.com/acme/app.git',
  baseBranch: null,
  additionalRepos: additional.map((repo) => ({ repo })),
  setupScript: '',
})

class BranchProcesses extends ProcessPort {
  readonly spawned: SpawnCommand[] = []

  constructor(private readonly result: { branch: string; exitCode?: number }) {
    super()
  }

  override spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const encoder = new TextEncoder()
    return {
      stdout: new ReadableStream<Uint8Array>({
        start: (sink) => {
          sink.enqueue(encoder.encode(`${this.result.branch}\n`))
          sink.close()
        },
      }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited: Promise.resolve(this.result.exitCode ?? 0),
      terminate: () => {},
    }
  }

  override which(): string | null {
    return null
  }
}

const depsOf = (processes: ProcessPort) => ({
  processes,
  files: new StubFileSystemPort(),
})

describe('the prepared checkout branch', () => {
  it('reports the branch every freshly cloned repo is on', async () => {
    const processes = new BranchProcesses({ branch: 'main' })
    const reported: { path: string; branch: string }[] = []
    await captureCheckedOut({
      deps: depsOf(processes),
      workspace: workspaceOf(['acme/lib']),
      launchDirectory: '/workspace/app',
      onCheckedOut: (entry) => reported.push(entry),
    })

    expect(reported).toEqual([
      { path: '/workspace/app', branch: 'main' },
      { path: '/workspace/lib', branch: 'main' },
    ])
    expect(processes.spawned.map((args) => args.cwd)).toEqual(['/workspace/app', '/workspace/lib'])
  })

  it('reports nothing for a detached head', async () => {
    const processes = new BranchProcesses({ branch: '', exitCode: 1 })
    const reported: { path: string; branch: string }[] = []
    await captureCheckedOut({
      deps: depsOf(processes),
      workspace: workspaceOf([]),
      launchDirectory: '/workspace/app',
      onCheckedOut: (entry) => reported.push(entry),
    })

    expect(reported).toEqual([])
  })

  it('reads nothing when the caller keeps no checkout branches', async () => {
    const processes = new BranchProcesses({ branch: 'main' })
    await captureCheckedOut({
      deps: depsOf(processes),
      workspace: workspaceOf([]),
      launchDirectory: '/workspace/app',
      onCheckedOut: undefined,
    })

    expect(processes.spawned).toEqual([])
  })
})
