import { describe, expect, it } from 'bun:test'

import {
  toThreadId,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'

import { GitWorkspaceIdentity, WorkspaceIdentityDeadlineError } from '../git-workspace-identity'

const threadId = toThreadId('thread-routed')
const SECRET_ORIGIN = 'https://user:topsecret@example.com/org/repo.git'

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

class ScriptedProcess implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly terminated: string[] = []

  constructor(private readonly respond: (cmd: readonly string[]) => ProcessHandle | 'hang' | { exit: number; stdout?: string; stderr?: string }) {}

  which(_args: { command: string; threadId?: ThreadId | undefined }): string | null {
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
    if ('exited' in answer) return answer
    return {
      stdout: streamOf(answer.stdout ?? ''),
      stderr: streamOf(answer.stderr ?? ''),
      exited: Promise.resolve(answer.exit),
      terminate: () => void this.terminated.push(label),
    }
  }
}

const healthyRepository = (cmd: readonly string[]) => {
  if (cmd[1] === 'rev-parse') return { exit: 0, stdout: '/repo\n/repo/.git\nfalse\n' }
  if (cmd[1] === 'worktree') return { exit: 0, stdout: 'worktree /repo\0HEAD abc123\0branch refs/heads/main\0\0' }
  if (cmd[1] === 'rev-list') return { exit: 0, stdout: 'abc123\n' }
  if (cmd[1] === 'config') return { exit: 0, stdout: 'git@github.com:org/repo.git\n' }
  return { exit: 0, stdout: 'main\n' }
}

describe('GitWorkspaceIdentity through the process port', () => {
  it('carries the thread id and the project directory on every spawn', async () => {
    const process = new ScriptedProcess(healthyRepository)
    const adapter = new GitWorkspaceIdentity({ process })

    const identity = await adapter.identify({ projectDirectory: '/repo', threadId })
    await adapter.identify({ projectDirectory: '/repo', threadId })

    expect(identity).toEqual({ remote: 'github.com/org/repo', worktreePath: 'main:.' })
    expect(process.spawned.length).toBe(7)
    expect(process.spawned.every((spawn) => spawn.threadId === threadId)).toBe(true)
    expect(process.spawned.every((spawn) => spawn.cwd === '/repo' && spawn.cmd[0] === 'git')).toBe(true)
  })

  it('terminates a probe that ignores exit and rejects within the bounded timeout', async () => {
    const process = new ScriptedProcess(() => 'hang')
    const adapter = new GitWorkspaceIdentity({ process, timeoutMs: 5_000 })

    const started = performance.now()
    const failure = await adapter
      .identify({ projectDirectory: '/repo', threadId })
      .then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(WorkspaceIdentityDeadlineError)
    expect(String(failure)).toMatch(/exceeded 1000ms/)

    expect(performance.now() - started).toBeLessThan(1_500)
    expect(process.terminated).toHaveLength(1)
  })

  it('does not cache a failed probe', async () => {
    let healthy = false
    const process = new ScriptedProcess((cmd) => (healthy ? healthyRepository(cmd) : 'hang'))
    const adapter = new GitWorkspaceIdentity({ process, timeoutMs: 40 })

    await expect(adapter.identify({ projectDirectory: '/repo', threadId })).rejects.toThrow()
    healthy = true

    expect((await adapter.identify({ projectDirectory: '/repo', threadId })).remote).toBe(
      'github.com/org/repo',
    )
  })

  it('keeps credential-bearing stderr and origin out of the failure it raises', async () => {
    const process = new ScriptedProcess(() => ({
      exit: 128,
      stderr: `fatal: unable to access '${SECRET_ORIGIN}'`,
      stdout: SECRET_ORIGIN,
    }))
    const adapter = new GitWorkspaceIdentity({ process })

    const failure = await adapter
      .identify({ projectDirectory: '/repo', threadId })
      .then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toContain('topsecret')
  })

  it('stops probing after the layout probe fails', async () => {
    const process = new ScriptedProcess((cmd) => (cmd[1] === 'rev-parse' ? { exit: 128 } : 'hang'))
    const adapter = new GitWorkspaceIdentity({ process })

    await expect(adapter.identify({ projectDirectory: '/repo', threadId })).rejects.toThrow()

    expect(process.spawned).toHaveLength(1)
  })
})
