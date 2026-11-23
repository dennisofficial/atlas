import { describe, expect, it } from 'bun:test'

import {
  toThreadId,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
} from '@dltech/atlas-core'
import { WorkspaceIdentityDeadlineError } from '@dltech/atlas-quality'

import { DaemonWorkspaceIdentity } from '../workspace-identity'

const threadId = toThreadId('thread-identity')

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

type Answer = 'hang' | { exit: number; stdout?: string }

class ScriptedProcess implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly terminated: string[] = []

  constructor(private readonly respond: (cmd: readonly string[]) => Answer) {}

  which(): string | null {
    return null
  }

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const answer = this.respond(args.cmd)
    const label = args.cmd.slice(1, 3).join(' ')
    if (answer === 'hang') {
      return {
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
        exited: new Promise<number>(() => undefined),
        terminate: () => void this.terminated.push(label),
      }
    }
    return {
      stdout: streamOf(answer.stdout ?? ''),
      stderr: streamOf(''),
      exited: Promise.resolve(answer.exit),
      terminate: () => void this.terminated.push(label),
    }
  }
}

const plainRepo = (cmd: readonly string[]): Answer => {
  if (cmd[1] === 'rev-parse') return { exit: 0, stdout: '/repo\n/repo/.git\nfalse\n' }
  if (cmd[1] === 'worktree')
    return { exit: 0, stdout: 'worktree /repo\0HEAD abc\0branch refs/heads/main\0\0' }
  if (cmd[1] === 'rev-list') return { exit: 0, stdout: 'abc\n' }
  if (cmd[1] === 'config') {
    if (cmd.includes('remote.origin.url'))
      return { exit: 0, stdout: 'git@github.com:org/repo.git\n' }
    return { exit: 1 }
  }
  return { exit: 0, stdout: 'main\n' }
}

const identifyOver = (process: ProcessPort, timeoutMs?: number) =>
  new DaemonWorkspaceIdentity({ process, ...(timeoutMs === undefined ? {} : { timeoutMs }) })

const identify = (identity: DaemonWorkspaceIdentity, projectDirectory = '/repo') =>
  identity.identify({ projectDirectory, threadId })

describe('DaemonWorkspaceIdentity over a scripted process port', () => {
  it('names a plain repository by its normalized origin and main worktree', async () => {
    const process = new ScriptedProcess(plainRepo)

    const identity = await identify(identifyOver(process))

    expect(identity).toEqual({ remote: 'github.com/org/repo', worktreePath: 'main:.' })
    expect(process.spawned.every((spawn) => spawn.cwd === '/repo')).toBe(true)
    expect(process.spawned.every((spawn) => spawn.cmd[0] === 'git')).toBe(true)
    expect(process.spawned.every((spawn) => spawn.threadId === threadId)).toBe(true)
  })

  it('separates a linked worktree by branch and repo-relative path', async () => {
    const linkedRepo = (cmd: readonly string[]): Answer => {
      if (cmd[1] === 'rev-parse')
        return { exit: 0, stdout: '/repo/.atlas/worktrees/alpha\n/repo/.git\nfalse\n' }
      if (cmd[1] === 'worktree')
        return {
          exit: 0,
          stdout:
            'worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /repo/.atlas/worktrees/alpha\0HEAD def\0branch refs/heads/feat-alpha\0\0',
        }
      if (cmd[1] === 'rev-list') return { exit: 0, stdout: 'abc\n' }
      if (cmd[1] === 'config') {
        if (cmd.includes('remote.origin.url'))
          return { exit: 0, stdout: 'https://github.com/org/repo.git\n' }
        return { exit: 1 }
      }
      return { exit: 0, stdout: 'feat-alpha\n' }
    }

    const identity = await identify(
      identifyOver(new ScriptedProcess(linkedRepo)),
      '/repo/.atlas/worktrees/alpha',
    )

    expect(identity).toEqual({
      remote: 'github.com/org/repo',
      worktreePath: 'feat-alpha:.atlas/worktrees/alpha',
    })
  })

  it('names a detached HEAD as HEAD', async () => {
    const detached = (cmd: readonly string[]): Answer =>
      cmd[1] === 'symbolic-ref' ? { exit: 1 } : plainRepo(cmd)

    const identity = await identify(identifyOver(new ScriptedProcess(detached)))

    expect(identity.worktreePath).toBe('HEAD:.')
  })

  it('falls back to the root commit when there is no origin and the clone is not shallow', async () => {
    const noOrigin = (cmd: readonly string[]): Answer =>
      cmd[1] === 'config' ? { exit: 1 } : plainRepo(cmd)

    const identity = await identify(identifyOver(new ScriptedProcess(noOrigin)))

    expect(identity).toEqual({ remote: 'local:abc', worktreePath: 'main:.' })
  })

  it('reports no identity for a shallow clone that has no usable origin', async () => {
    const shallow = (cmd: readonly string[]): Answer => {
      if (cmd[1] === 'config') return { exit: 1 }
      if (cmd[1] === 'rev-parse') return { exit: 0, stdout: '/repo\n/repo/.git\ntrue\n' }
      return plainRepo(cmd)
    }

    const identity = await identify(identifyOver(new ScriptedProcess(shallow)))

    expect(identity).toEqual({ remote: null, worktreePath: null })
  })

  it('rejects with the deadline error and terminates the probe when git never exits', async () => {
    const process = new ScriptedProcess(() => 'hang')

    const failure = await identify(identifyOver(process, 20)).then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(WorkspaceIdentityDeadlineError)
    expect(process.terminated).toHaveLength(1)
  })

  it('reads the repository layout again on every identify, keeping no cache', async () => {
    const process = new ScriptedProcess(plainRepo)
    const identity = identifyOver(process)

    await identify(identity)
    const afterFirst = process.spawned.length
    await identify(identity)

    expect(afterFirst).toBe(5)
    expect(process.spawned.length - afterFirst).toBe(5)
  })
})
