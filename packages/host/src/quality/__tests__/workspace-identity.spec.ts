import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  toThreadId,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
} from '@dltech/atlas-core'
import { WorkspaceIdentityDeadlineError } from '@dltech/atlas-quality'

import { DaemonWorkspaceIdentity } from '../workspace-identity'
import { EProbeScope, EProbeSection } from '../workspace-identity-probe'

const threadId = toThreadId('thread-identity')

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

type GitAnswer = { exit: number; stdout?: string }

type Repo = Record<EProbeSection, GitAnswer>

const LAYOUT_SECTIONS = [
  EProbeSection.Paths,
  EProbeSection.Worktrees,
  EProbeSection.WorktreeConfig,
  EProbeSection.Roots,
] as const

const REF_SECTIONS = [EProbeSection.Origin, EProbeSection.Branch] as const

const probeOutputOf = (args: { repo: Repo; scope: string | undefined }): string => {
  const names =
    args.scope === EProbeScope.Layout ? [...LAYOUT_SECTIONS, ...REF_SECTIONS] : REF_SECTIONS
  return names
    .map((name) => `\x1e${name}\n${args.repo[name].stdout ?? ''}\x1f${args.repo[name].exit}\n`)
    .join('')
}

class ScriptedProcess implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly terminated: number[] = []

  constructor(
    private readonly repo: Repo | 'hang',
    private readonly latencyMs = 0,
  ) {}

  which(): string | null {
    return null
  }

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const terminate = (): void => void this.terminated.push(this.spawned.length)
    if (this.repo === 'hang') {
      return {
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
        exited: new Promise<number>(() => undefined),
        terminate,
      }
    }
    const output = probeOutputOf({ repo: this.repo, scope: args.cmd[4] })
    const arrived = Bun.sleep(this.latencyMs)
    return {
      stdout: new ReadableStream({
        async start(controller) {
          await arrived
          controller.enqueue(new TextEncoder().encode(output))
          controller.close()
        },
      }),
      stderr: streamOf(''),
      exited: arrived.then(() => 0),
      terminate,
    }
  }
}

class LocalProcess implements ProcessPort {
  which(): string | null {
    return null
  }

  spawn(args: SpawnCommand): ProcessHandle {
    const child = Bun.spawn([...args.cmd], { cwd: args.cwd, stdout: 'pipe', stderr: 'pipe' })
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited,
      terminate: () => child.kill(),
    }
  }
}

const plainRepo: Repo = {
  [EProbeSection.Paths]: { exit: 0, stdout: '/repo\n/repo/.git\nfalse\n' },
  [EProbeSection.Worktrees]: {
    exit: 0,
    stdout: 'worktree /repo\0HEAD abc\0branch refs/heads/main\0\0',
  },
  [EProbeSection.WorktreeConfig]: { exit: 1 },
  [EProbeSection.Roots]: { exit: 0, stdout: 'abc\n' },
  [EProbeSection.Origin]: { exit: 0, stdout: 'git@github.com:org/repo.git\n' },
  [EProbeSection.Branch]: { exit: 0, stdout: 'main\n' },
}

const identifyOver = (process: ProcessPort, timeoutMs?: number) =>
  new DaemonWorkspaceIdentity({ process, ...(timeoutMs === undefined ? {} : { timeoutMs }) })

const identify = (identity: DaemonWorkspaceIdentity, projectDirectory = '/repo') =>
  identity.identify({ projectDirectory, threadId })

describe('DaemonWorkspaceIdentity over a scripted process port', () => {
  it('names a plain repository by its normalized origin and main worktree in one exec', async () => {
    const process = new ScriptedProcess(plainRepo)

    const identity = await identify(identifyOver(process))

    expect(identity).toEqual({ remote: 'github.com/org/repo', worktreePath: 'main:.' })
    expect(process.spawned).toHaveLength(1)
    expect(process.spawned[0]?.cwd).toBe('/repo')
    expect(process.spawned[0]?.cmd[0]).toBe('sh')
    expect(process.spawned[0]?.threadId).toBe(threadId)
  })

  it('separates a linked worktree by branch and repo-relative path', async () => {
    const linkedRepo: Repo = {
      ...plainRepo,
      [EProbeSection.Paths]: {
        exit: 0,
        stdout: '/repo/.atlas/worktrees/alpha\n/repo/.git\nfalse\n',
      },
      [EProbeSection.Worktrees]: {
        exit: 0,
        stdout:
          'worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /repo/.atlas/worktrees/alpha\0HEAD def\0branch refs/heads/feat-alpha\0\0',
      },
      [EProbeSection.Origin]: { exit: 0, stdout: 'https://github.com/org/repo.git\n' },
      [EProbeSection.Branch]: { exit: 0, stdout: 'feat-alpha\n' },
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
    const detached: Repo = { ...plainRepo, [EProbeSection.Branch]: { exit: 1 } }

    const identity = await identify(identifyOver(new ScriptedProcess(detached)))

    expect(identity.worktreePath).toBe('HEAD:.')
  })

  it('falls back to the root commit when there is no origin and the clone is not shallow', async () => {
    const noOrigin: Repo = { ...plainRepo, [EProbeSection.Origin]: { exit: 1 } }

    const identity = await identify(identifyOver(new ScriptedProcess(noOrigin)))

    expect(identity).toEqual({ remote: 'local:abc', worktreePath: 'main:.' })
  })

  it('reports no identity for a shallow clone that has no usable origin', async () => {
    const shallow: Repo = {
      ...plainRepo,
      [EProbeSection.Origin]: { exit: 1 },
      [EProbeSection.Paths]: { exit: 0, stdout: '/repo\n/repo/.git\ntrue\n' },
    }

    const identity = await identify(identifyOver(new ScriptedProcess(shallow)))

    expect(identity).toEqual({ remote: null, worktreePath: null })
  })

  it('rejects with the deadline error and terminates the probe when git never exits', async () => {
    const process = new ScriptedProcess('hang')

    const failure = await identify(identifyOver(process, 20)).then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(WorkspaceIdentityDeadlineError)
    expect(process.terminated).toHaveLength(1)
  })

  it('reads the layout once per thread and directory, then only the branch and origin', async () => {
    const process = new ScriptedProcess(plainRepo)
    const identity = identifyOver(process)

    await identify(identity)
    const second = await identify(identity)

    expect(second).toEqual({ remote: 'github.com/org/repo', worktreePath: 'main:.' })
    expect(process.spawned.map((spawn) => spawn.cmd[4])).toEqual([
      EProbeScope.Layout,
      EProbeScope.Refs,
    ])
  })

  it('identifies a cold workspace well inside the deadline when every exec costs a slow round trip', async () => {
    const roundTripMs = 200
    const process = new ScriptedProcess(plainRepo, roundTripMs)
    const started = performance.now()

    const identity = await identify(identifyOver(process))

    expect(identity).toEqual({ remote: 'github.com/org/repo', worktreePath: 'main:.' })
    expect(performance.now() - started).toBeLessThan(roundTripMs * 2)
  })
})

describe('DaemonWorkspaceIdentity over a real git repository', () => {
  const git = (cwd: string, ...args: string[]): void => {
    const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'ignore', stderr: 'pipe' })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }

  it('runs the probe script and reads origin, branch and layout from its sections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'identity-probe-'))
    try {
      git(root, 'init', '-q', '-b', 'trunk')
      git(
        root,
        '-c',
        'user.email=a@b.c',
        '-c',
        'user.name=a',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'root',
      )
      git(root, 'remote', 'add', 'origin', 'git@github.com:org/real.git')
      const identity = identifyOver(new LocalProcess())

      const cold = await identify(identity, root)
      const warm = await identify(identity, root)

      expect(cold).toEqual({ remote: 'github.com/org/real', worktreePath: 'trunk:.' })
      expect(warm).toEqual(cold)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
