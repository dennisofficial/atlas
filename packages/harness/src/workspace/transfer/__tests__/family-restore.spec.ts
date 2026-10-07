import { afterEach, describe, expect, it } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { digestGitAdmin } from '../capture-admin'
import type { RestoredFamily, WorkspaceFamilyCapture } from '../manifest'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import { cleanupScratches, createFamilyFixture, createScratch, git, MEMBERS, type FamilyFixture } from './family-fixture'

afterEach(cleanupScratches)

const familyOf = (restored: RestoredFamily): WorkspaceFamilyCapture => ({
  rootId: restored.rootId,
  checkouts: restored.checkouts,
  threads: restored.threads.map((thread) => ({
    threadId: thread.threadId,
    home: thread.home,
    active: thread.active === null ? null : { ...thread.active, base: thread.active.base ?? undefined },
  })),
})

const cloudCycle = async (made: FamilyFixture) => {
  const first = join(await createScratch(), 'lift.tar.gz')
  await captureWorkspaceArchive({ cwd: made.main, destination: first, family: made.family })
  const cloud = join(await createScratch(), 'cloud')
  const restored = await restoreWorkspaceArchive({ archivePath: first, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
  if (restored.family === undefined) throw new Error('family dropped')
  const pathOf = (source: string): string => restored.trees.find((tree) => tree.sourcePath === source)?.path ?? 'missing'
  return { cloud, restored, family: restored.family, pathOf }
}

const descendArchive = async ({ cloud, family }: { cloud: string; family: RestoredFamily }): Promise<string> => {
  const archivePath = join(await createScratch(), 'descend.tar.gz')
  await captureWorkspaceArchive({ cwd: cloud, destination: archivePath, family: familyOf(family) })
  return archivePath
}

const heads = async (cwd: string): Promise<string> =>
  git({ args: ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'], cwd })

describe('host restore of a family', () => {
  it('renames a collided checkout and maps its thread to the actual suffixed path and branch', async () => {
    const made = await createFamilyFixture()
    const { cloud, family, pathOf } = await cloudCycle(made)
    await writeFile(join(pathOf(made.checkouts.b.path), 'cloud.txt'), 'x\n')
    const archivePath = await descendArchive({ cloud, family })
    await writeFile(join(made.checkouts.b.path, 'host-typed.txt'), 'precious\n')

    const restored = await restoreWorkspaceArchive({ archivePath, destination: made.main, mode: EWorkspaceRestoreMode.Host, suffix: () => 'c0de' })

    const moved = restored.trees.find((tree) => tree.sourcePath === pathOf(made.checkouts.b.path))
    expect(moved?.path).toBe(join(made.main, '.atlas', 'worktrees', 'wt-b-c0de'))
    expect(moved?.branch).toBe('br-b-c0de')
    expect(moved?.renamedFrom).toBe('wt-b')
    const thread = restored.family?.threads.find((entry) => entry.threadId === 't-b')
    expect(thread?.active).toEqual({ path: moved?.path ?? '', branch: 'br-b-c0de', base: 'main', adopted: false })
    expect(thread?.home).toBe(moved?.path ?? '')
    expect(restored.family?.checkouts.find((entry) => entry.id === 'chk-b')?.path).toBe(moved?.path ?? '')
    expect(await git({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: moved?.path ?? '' })).toBe('br-b-c0de')
    expect(await Bun.file(join(made.checkouts.b.path, 'host-typed.txt')).text()).toBe('precious\n')
    expect(await git({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: made.checkouts.b.path })).toBe('br-b')
    expect(await Bun.file(join(moved?.path ?? '', 'cloud.txt')).text()).toBe('x\n')
  })

  it('does not move a branch another registered checkout also holds', async () => {
    const made = await createFamilyFixture()
    const { cloud, family, pathOf } = await cloudCycle(made)
    await writeFile(join(pathOf(made.checkouts.a.path), 'cloud.txt'), 'x\n')
    await git({ args: ['add', 'cloud.txt'], cwd: pathOf(made.checkouts.a.path) })
    await git({ args: ['commit', '-m', 'cloud commit'], cwd: pathOf(made.checkouts.a.path) })
    const archivePath = await descendArchive({ cloud, family })
    const holder = join(made.scratch, 'holder')
    await git({ args: ['worktree', 'add', '-f', holder, 'br-a'], cwd: made.main })
    const headBefore = await git({ args: ['rev-parse', 'HEAD'], cwd: holder })
    const branchBefore = await git({ args: ['rev-parse', 'br-a'], cwd: made.main })

    const restored = await restoreWorkspaceArchive({ archivePath, destination: made.main, mode: EWorkspaceRestoreMode.Host, suffix: () => 'beef' })

    expect(await git({ args: ['rev-parse', 'br-a'], cwd: made.main })).toBe(branchBefore)
    expect(await git({ args: ['rev-parse', 'HEAD'], cwd: holder })).toBe(headBefore)
    expect(await git({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: holder })).toBe('br-a')
    const thread = restored.family?.threads.find((entry) => entry.threadId === 't-a')
    expect(thread?.active?.branch).toBe('br-a-beef')
    expect(await git({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: made.checkouts.a.path })).toBe('br-a-beef')
    expect(await git({ args: ['log', '-1', '--format=%s', 'br-a-beef'], cwd: made.main })).toBe('cloud commit')
  })

  it('rolls every tree and ref back when a later tree fails to restore', async () => {
    const made = await createFamilyFixture()
    const { cloud, family, pathOf } = await cloudCycle(made)
    for (const member of MEMBERS) {
      const path = pathOf(made.checkouts[member].path)
      await writeFile(join(path, 'cloud.txt'), `${member}\n`)
      await git({ args: ['add', 'cloud.txt'], cwd: path })
      await git({ args: ['commit', '-m', `cloud ${member}`], cwd: path })
    }
    const archivePath = await descendArchive({ cloud, family })
    const trees = [made.main, ...MEMBERS.map((member) => made.checkouts[member].path)]
    const before = await Promise.all(trees.map((path) => git({ args: ['status', '--porcelain=v1', '-uall'], cwd: path })))
    const refsBefore = await heads(made.main)
    const worktreesBefore = await git({ args: ['worktree', 'list', '--porcelain'], cwd: made.main })
    let sweeps = 0

    await expect(
      restoreWorkspaceArchive({
        archivePath,
        destination: made.main,
        mode: EWorkspaceRestoreMode.Host,
        beforeSweep: async () => {
          sweeps += 1
          if (sweeps === 4) throw new Error('boom')
        },
      }),
    ).rejects.toThrow('boom')

    expect(sweeps).toBe(4)
    expect(await heads(made.main)).toBe(refsBefore)
    expect(await git({ args: ['worktree', 'list', '--porcelain'], cwd: made.main })).toBe(worktreesBefore)
    expect(await Promise.all(trees.map((path) => git({ args: ['status', '--porcelain=v1', '-uall'], cwd: path })))).toEqual(before)
    expect(await Bun.file(join(made.main, 'cloud.txt')).exists()).toBe(false)
  })
})

describe('private refs in the capture digest', () => {
  it('notices a main private ref and a linked private ref changing', async () => {
    const made = await createFamilyFixture()
    const trees = [
      { sourcePath: made.main, branch: 'main' },
      { sourcePath: made.checkouts.a.path, branch: 'br-a' },
    ]
    const base = await digestGitAdmin({ trees })

    await git({ args: ['update-ref', 'refs/bisect/main-bad', await git({ args: ['rev-parse', 'HEAD'], cwd: made.main })], cwd: made.main })
    const mainMoved = await digestGitAdmin({ trees })
    expect(mainMoved).not.toBe(base)

    await git({ args: ['update-ref', 'refs/worktree/note', await git({ args: ['rev-parse', 'HEAD'], cwd: made.checkouts.a.path })], cwd: made.checkouts.a.path })
    expect(await digestGitAdmin({ trees })).not.toBe(mainMoved)
  })
})
