import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ELogSeverity, type LogEntry } from '@dltech/atlas-core'

import { fingerprintWorkspaceTree } from '../../../workspace/transfer/capture-fingerprint'
import type { WorkspaceManifest } from '../../../workspace/transfer/manifest'
import { runGit } from '../../../workspace/run-git'
import { destroyLiftedWorktree, destroyPlanOf, EDestroySkip } from '../lift-destroy'
import { liftToCloud } from '../lift'
import { useAtlasHome } from './descend-fixture'
import { CapturingLog } from './fake-log'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

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

const manifestOf = async ({ main, session }: ScratchRepo): Promise<WorkspaceManifest> => ({
  version: 1,
  repository: { sourcePath: main, originPath: main },
  activeId: 'session',
  activeRelativePath: '',
  trees: [
    {
      id: 'main',
      name: 'main',
      sourcePath: main,
      originPath: main,
      branch: 'main',
      head: await git({ cwd: main, args: ['rev-parse', 'HEAD'] }),
      baseline: null,
      fingerprint: await fingerprintWorkspaceTree({ cwd: main }),
      isMain: true,
    },
    {
      id: 'session',
      name: 'session',
      sourcePath: session,
      originPath: session,
      branch: 'session',
      head: await git({ cwd: session, args: ['rev-parse', 'HEAD'] }),
      baseline: null,
      fingerprint: await fingerprintWorkspaceTree({ cwd: session }),
      isMain: false,
    },
  ],
})

const archiveOf = async ({ repo, destination }: { repo: ScratchRepo; destination: string }) => ({
  path: join(repo.main, destination),
  manifest: await manifestOf(repo),
  release: async () => undefined,
})

const entriesWith = (logPort: CapturingLog, chunk: string): LogEntry[] =>
  logPort.entries.filter((entry) => entry.message.includes(chunk))

describe('a verified lift destroys the local session worktree', () => {
  it('removes a clean session worktree after the full swap is proven', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const test = harness({
      cwd: repo.session,
      bridge: fakeBridge(),
      captureWorkspaceArchive: async () => archiveOf({ repo, destination: 'workspace.tar.gz' }),
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(repo.session)).toBe(false)
    expect(await exists(join(repo.main, 'README.md'))).toBe(true)
    expect((await git({ cwd: repo.main, args: ['worktree', 'list', '--porcelain'] })).split('worktree ')).toHaveLength(2)
    expect((await git({ cwd: repo.main, args: ['branch', '--list', 'session'] })).trim()).toBe('session')
  })

  it('removes a dirty session worktree whose state matches the lifted archive', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    await writeFile(join(repo.session, 'local-only.txt'), 'dirty but captive\n')
    await writeFile(join(repo.session, 'README.md'), 'edited and unstaged\n')
    const test = harness({
      cwd: repo.session,
      bridge: fakeBridge(),
      captureWorkspaceArchive: async () => archiveOf({ repo, destination: 'workspace.tar.gz' }),
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(repo.session)).toBe(false)
  })

  it('removes the session worktree Atlas locked for the session itself', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const test = harness({
      cwd: repo.session,
      bridge: fakeBridge(),
      captureWorkspaceArchive: async () => archiveOf({ repo, destination: 'workspace.tar.gz' }),
    })
    await git({ cwd: repo.main, args: ['worktree', 'lock', '--reason', 'bench-lock', repo.session] })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(repo.session)).toBe(false)
  })

  it('keeps a session worktree whose local state drifted after the capture', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const logPort = new CapturingLog()
    const test = harness({
      cwd: repo.session,
      logPort,
      bridge: fakeBridge(),
      captureWorkspaceArchive: async () => {
        const archive = await archiveOf({ repo, destination: 'workspace.tar.gz' })
        await writeFile(join(repo.session, 'after-capture.txt'), 'typed after the archive was taken\n')
        return archive
      },
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(join(repo.session, 'after-capture.txt'))).toBe(true)
    expect(entriesWith(logPort, 'changed after it was captured; it stays on disk')).toHaveLength(1)
  })

  it('keeps the worktree when the lift fails before the placement commits', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const test = harness({
      cwd: repo.session,
      bridge: fakeBridge({ createFails: new Error('no sandbox for you') }),
      captureWorkspaceArchive: async () => archiveOf({ repo, destination: 'workspace.tar.gz' }),
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
      captureWorkspaceArchive: async () => archiveOf({ repo, destination: 'workspace.tar.gz' }),
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(await exists(repo.main)).toBe(true)
    expect(entriesWith(logPort, 'nothing is destroyed')).toHaveLength(1)
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
  it('removes the containing worktree when the session cwd sits deeper inside it', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    await mkdir(join(repo.session, 'pkg', 'sub'), { recursive: true })
    const logPort = new CapturingLog()
    const expected = await fingerprintWorkspaceTree({ cwd: repo.session })

    await destroyLiftedWorktree({ cwd: join(repo.session, 'pkg', 'sub'), expected, logPort, threadId: CLOUD_THREAD })

    expect(await exists(repo.session)).toBe(false)
  })

  it('keeps a clean-but-unexpected tree when the fingerprint is not the captured one', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const logPort = new CapturingLog()

    await destroyLiftedWorktree({ cwd: repo.session, expected: 'not-the-captured-fingerprint', logPort, threadId: CLOUD_THREAD })

    expect(await exists(join(repo.session, 'README.md'))).toBe(true)
    expect(entriesWith(logPort, 'changed after it was captured; it stays on disk')).toHaveLength(1)
  })

  it('warns and keeps a tree whose cwd belongs to no worktree', async () => {
    useAtlasHome()
    const repo = await makeRepo()
    const outside = join(await scratch(), 'outside')
    await mkdir(outside, { recursive: true })
    const logPort = new CapturingLog()

    await destroyLiftedWorktree({ cwd: outside, expected: 'x', logPort, threadId: CLOUD_THREAD })

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
