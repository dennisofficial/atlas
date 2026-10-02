import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runGit } from '../../../workspace/run-git'
import { destroyLiftedWorktree, destroyPlanOf, EDestroySkip } from '../lift-destroy'
import { liftToCloud } from '../lift'
import { ELogSeverity, type LogEntry } from '@dltech/atlas-core'
import { useAtlasHome } from './descend-fixture'
import { CapturingLog } from './fake-log'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'
import { WORKSPACE_MANIFEST } from './workspace-fixture'

const scratches: string[] = []

const scratch = async (): Promise<string> => {
  const made = await realpath(await mkdtemp(join(tmpdir(), 'atlas-lift-destroy-')))
  scratches.push(made)
  return made
}

const cleanup = async (): Promise<void> => {
  await Promise.all(scratches.splice(0).map((path) => rm(path, { recursive: true, force: true })))
}

const git = async ({ cwd, args }: { cwd: string; args: readonly string[] }): Promise<string> => {
  const run = await runGit({ cwd, args })
  if (!run.ok) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`)
  return run.stdout.trim()
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

type ScratchRepo = { main: string; session: string }

const makeRepo = async (): Promise<ScratchRepo> => {
  const root = await scratch()
  const main = join(root, 'repo')
  await mkdir(main, { recursive: true })
  await git({ cwd: main, args: ['init', '-b', 'main'] })
  await writeFile(join(main, 'README.md'), 'hello\n')
  await git({ cwd: main, args: ['add', '.'] })
  await git({ cwd: main, args: ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'initial'] })
  const session = join(root, 'session')
  await git({ cwd: main, args: ['worktree', 'add', session, '-b', 'session'] })
  return { main, session }
}

const entriesWith = (logPort: CapturingLog, chunk: string): LogEntry[] =>
  logPort.entries.filter((entry) => entry.message.includes(chunk))

describe('a verified lift destroys the local session worktree', () => {
  it('removes a session worktree after the full swap is proven', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const test = harness({
      cwd: repo.session,
      bridge: fakeBridge(),
      captureWorkspaceArchive: async () => ({
        path: join(repo.main, 'workspace.tar.gz'),
        manifest: WORKSPACE_MANIFEST,
        release: async () => undefined,
      }),
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(repo.session)).toBe(false)
    expect(await exists(repo.main)).toBe(true)
    expect((await git({ cwd: repo.main, args: ['worktree', 'list', '--porcelain'] })).split('worktree ')).toHaveLength(2)
    expect(await exists(join(repo.session, 'README.md'))).toBe(false)
    expect((await git({ cwd: repo.main, args: ['branch', '--list', 'session'] })).trim()).toBe('session')
  })

  it('keeps the worktree when the lift fails before the placement commits', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const test = harness({
      cwd: repo.session,
      bridge: fakeBridge({ createFails: new Error('no sandbox for you') }),
      captureWorkspaceArchive: async () => ({
        path: join(repo.main, 'workspace.tar.gz'),
        manifest: WORKSPACE_MANIFEST,
        release: async () => undefined,
      }),
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    expect(await exists(join(repo.session, 'README.md'))).toBe(true)
    expect((await git({ cwd: repo.main, args: ['worktree', 'list', '--porcelain'] })).split('worktree ')).toHaveLength(3)
  })

  it('keeps a main-checkout session untouched and notes the skip', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const logPort = new CapturingLog()
    const test = harness({
      cwd: repo.main,
      logPort,
      bridge: fakeBridge(),
      captureWorkspaceArchive: async () => ({
        path: join(repo.main, 'workspace.tar.gz'),
        manifest: WORKSPACE_MANIFEST,
        release: async () => undefined,
      }),
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(repo.main)).toBe(true)
    expect(entriesWith(logPort, 'nothing is destroyed')).toHaveLength(1)
  })

  it('keeps a dirty session worktree and warns instead of forcing', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    await writeFile(join(repo.session, 'local-only.txt'), 'still dirty\n')
    const logPort = new CapturingLog()
    const test = harness({
      cwd: repo.session,
      logPort,
      bridge: fakeBridge(),
      captureWorkspaceArchive: async () => ({
        path: join(repo.main, 'workspace.tar.gz'),
        manifest: WORKSPACE_MANIFEST,
        release: async () => undefined,
      }),
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(join(repo.session, 'local-only.txt'))).toBe(true)
    expect(entriesWith(logPort, 'refused removal and stays on disk')).toHaveLength(1)
    expect(entriesWith(logPort, 'refused removal and stays on disk')[0]?.severity).toBe(ELogSeverity.Warn)
  })

  it('does not attempt destruction when no workspace archive traveled', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const logPort = new CapturingLog()
    const test = harness({ cwd: repo.session, logPort, bridge: fakeBridge() })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(join(repo.session, 'README.md'))).toBe(true)
    expect(entriesWith(logPort, 'worktree')).toHaveLength(0)
  })
})

describe('destroyLiftedWorktree', () => {
  it('removes from the main checkout when the session cwd sits deeper inside the worktree', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    await mkdir(join(repo.session, 'pkg', 'sub'), { recursive: true })
    const logPort = new CapturingLog()

    await destroyLiftedWorktree({ cwd: join(repo.session, 'pkg', 'sub'), logPort, threadId: CLOUD_THREAD })

    expect(await exists(repo.session)).toBe(false)
  })

  it('warns and keeps a clean main checkout when inspection works but the session has no worktree', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const outside = join(await scratch(), 'outside')
    await mkdir(outside, { recursive: true })
    const logPort = new CapturingLog()

    await destroyLiftedWorktree({ cwd: outside, logPort, threadId: CLOUD_THREAD })

    expect(await exists(outside)).toBe(true)
    expect(logPort.entries.filter((entry) => entry.severity === ELogSeverity.Warn)).toHaveLength(1)
  })
})

describe('destroyPlanOf', () => {
  const worktrees = [
    { path: '/repo', branch: 'refs/heads/main', head: 'sha', isMain: true, isBare: false, isLocked: false, lockedReason: undefined, isPrunable: false, prunableReason: undefined, isDetached: false },
    { path: '/repo/.atlas/worktrees/session', branch: 'refs/heads/session', head: 'sha', isMain: false, isBare: false, isLocked: false, lockedReason: undefined, isPrunable: false, prunableReason: undefined, isDetached: false },
  ] as const

  it('removes the linked worktree that contains the session cwd', () => {
    expect(destroyPlanOf({ worktrees, cwd: '/repo/.atlas/worktrees/session/src' })).toEqual({
      kind: 'remove',
      path: '/repo/.atlas/worktrees/session',
    })
  })

  it('skips a session that lives in the main checkout', () => {
    expect(destroyPlanOf({ worktrees, cwd: '/repo/src' })).toEqual({ kind: 'skip', reason: EDestroySkip.MainCheckout })
  })

  it('skips a cwd that belongs to no worktree', () => {
    expect(destroyPlanOf({ worktrees, cwd: '/elsewhere' })).toEqual({ kind: 'skip', reason: EDestroySkip.OutsideWorktrees })
  })
})
