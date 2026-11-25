import { describe, expect, it } from 'bun:test'

import { ESetupPhase, type ProcessHandle, type SpawnCommand } from '@dltech/atlas-core'
import { systemTimers } from '@dltech/atlas-host'

import type { WorkspaceConfig } from '../../config/agent-host-config'
import { PrepareSteps } from '../prepare-steps'
import { prepareControllerOf, type PrepareController } from '../session-prepare'
import { ShellEnvCell } from '../shell-env'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

const LAUNCH_DIRECTORY = '/workspace/repo'
const STATE_DIR = '/workspace/.atlas-agent'
const BASES_PATH = `${STATE_DIR}/session-bases`
const MATERIALIZED_PATH = `${STATE_DIR}/workspace-materialized`
const SETUP_RAN_PATH = `${STATE_DIR}/setup-ran`
const BASES = JSON.stringify([{ repoPath: LAUNCH_DIRECTORY, base: 'main' }])

class FailingBasesFiles extends StubFileSystemPort {
  basesWritesBeforeSuccess = 1

  override writeFile(args: { path: string; content: string | Uint8Array }): Promise<void> {
    if (args.path === `${BASES_PATH}.partial` && this.basesWritesBeforeSuccess > 0) {
      this.basesWritesBeforeSuccess -= 1
      return Promise.reject(new Error('disk full'))
    }
    return super.writeFile(args)
  }
}

class BranchProcessPort extends RecordingProcessPort {
  override spawn(args: SpawnCommand): ProcessHandle {
    if (args.cmd[0] !== 'git') return super.spawn(args)
    this.spawned.push(args)
    const encoder = new TextEncoder()
    return {
      stdout: new ReadableStream<Uint8Array>({
        start: (sink) => {
          sink.enqueue(encoder.encode('main\n'))
          sink.close()
        },
      }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited: Promise.resolve(0),
      terminate: () => {},
    }
  }
}

const workspace: WorkspaceConfig = {
  remoteUrl: null,
  baseBranch: null,
  additionalRepos: [],
  setupScript: 'echo ready',
}

const controllerOf = (files: FailingBasesFiles): PrepareController =>
  prepareControllerOf({
    sessionId: 'prepare-bases-1',
    userId: 'user-1',
    launchDirectory: LAUNCH_DIRECTORY,
    sandboxName: 'sandbox-prepare-bases',
    workspace,
    paths: {
      home: '/home/atlas',
      sessionDir: '/home/atlas/sessions/prepare-bases-1',
      threadDir: '/home/atlas/sessions/prepare-bases-1/threads/thread-1',
      contextDir: '/home/atlas/sessions/prepare-bases-1/context',
      imagesDir: '/home/atlas/sessions/prepare-bases-1/images',
    },
    calls: {
      ready: async () => ({ bootId: 'boot-1', version: 'test' }),
      ackScope: async () => {},
      bootId: () => 'boot-1',
    },
    processes: new BranchProcessPort(),
    files,
    steps: new PrepareSteps(),
    shellEnv: new ShellEnvCell({
      identityOf: async () => ({ name: 'atlas', email: 'atlas@example.com' }),
    }),
    refreshSecrets: async () => {},
    projectFiles: undefined,
    projectId: null,
    github: { read: async () => null },
    signingKey: undefined,
    timers: { now: () => Date.now(), ...systemTimers },
    setupDeadlineMs: 30_000,
    log: undefined,
  })

describe('preparing a workspace whose bases cannot be persisted', () => {
  it('fails, then retries into a materialized workspace with its setup run', async () => {
    const files = new FailingBasesFiles()
    let finishSetup: () => void = () => {}
    const setupFinished = new Promise<void>((resolve) => {
      finishSetup = resolve
    })
    const controller = controllerOf(files)
    controller.subscribeSetup((lifecycle) => {
      if (lifecycle.phase === ESetupPhase.Finished) finishSetup()
    })

    const failed = await controller.prepare()
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.reason).toContain('the captured session bases were not persisted')
    }
    expect(files.contents.has(BASES_PATH)).toBe(false)
    expect(files.contents.has(MATERIALIZED_PATH)).toBe(false)
    expect(files.contents.has(SETUP_RAN_PATH)).toBe(false)

    const retried = await controller.prepare()
    expect(retried.ok).toBe(true)
    if (retried.ok) expect(retried.bases).toEqual([{ repoPath: LAUNCH_DIRECTORY, base: 'main' }])
    expect(files.contents.get(BASES_PATH)).toBe(BASES)
    expect(files.contents.has(MATERIALIZED_PATH)).toBe(true)

    await setupFinished
    expect(files.contents.has(SETUP_RAN_PATH)).toBe(true)
  })
})
