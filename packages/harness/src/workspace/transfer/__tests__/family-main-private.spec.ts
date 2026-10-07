import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import { cleanupScratches, createFamilyFixture, createScratch, git, MEMBERS } from './family-fixture'

afterEach(cleanupScratches)

const PRIVATE = 'refs/worktree/main-private'

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const sourceRepository = async () => {
  const main = join(await createScratch(), 'repo')
  await mkdir(main)
  await git({ args: ['init', '-b', 'main'], cwd: main })
  await writeFile(join(main, 'README.md'), 'hello\n')
  await git({ args: ['add', '.'], cwd: main })
  await git({ args: ['commit', '-m', 'initial'], cwd: main })
  await git({ args: ['checkout', '-q', '--detach'], cwd: main })
  await writeFile(join(main, 'visit.txt'), 'visit\n')
  await git({ args: ['add', '.'], cwd: main })
  await git({ args: ['commit', '-m', 'visit'], cwd: main })
  await git({ args: ['checkout', '-q', 'main'], cwd: main })
  const note = await git({ args: ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'private note'], cwd: main })
  await git({ args: ['update-ref', '--create-reflog', PRIVATE, note], cwd: main })
  await writeFile(join(main, 'README.md'), 'edited\n')
  await writeFile(join(main, 'staged.txt'), 'staged\n')
  await git({ args: ['add', 'staged.txt'], cwd: main })
  await writeFile(join(main, 'untracked.txt'), 'untracked\n')
  return { main, note }
}

const archiveOf = async (cwd: string): Promise<string> => {
  const archivePath = join(await createScratch(), 'workspace.tar.gz')
  await captureWorkspaceArchive({ cwd, destination: archivePath })
  return archivePath
}

const headLog = (cwd: string): Promise<string> => git({ args: ['reflog', 'show', '--format=%H %gs', 'HEAD'], cwd })

describe('main private refs when the incoming main is placed as a linked checkout', () => {
  it('installs them in the linked checkout and leaves the diverged host original untouched', async () => {
    const { main, note } = await sourceRepository()
    const archivePath = await archiveOf(main)
    const captured = await headLog(main)
    const status = await git({ args: ['status', '--porcelain=v1', '-uall'], cwd: main })
    const hostNote = await git({ args: ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'host private'], cwd: main })
    await git({ args: ['update-ref', PRIVATE, hostNote], cwd: main })
    await writeFile(join(main, 'host-edit.txt'), 'diverged\n')
    const hostRefs = await git({ args: ['for-each-ref', '--format=%(refname) %(objectname)'], cwd: main })
    const hostLog = await headLog(main)

    const restored = await restoreWorkspaceArchive({ archivePath, destination: main, mode: EWorkspaceRestoreMode.Host, suffix: () => 'beef' })

    const incoming = join(main, '.atlas', 'worktrees', 'main-beef')
    expect(restored.cwd).toBe(incoming)
    expect(await git({ args: ['rev-parse', PRIVATE], cwd: incoming })).toBe(note)
    expect(await git({ args: ['reflog', 'show', '--format=%H', PRIVATE], cwd: incoming })).toBe(note)
    expect(await git({ args: ['status', '--porcelain=v1', '-uall'], cwd: incoming })).toBe(status)
    expect(await readFile(join(incoming, 'README.md'), 'utf8')).toBe('edited\n')
    expect((await headLog(incoming)).split('\n')).toEqual(expect.arrayContaining(captured.split('\n')))
    expect(await git({ args: ['rev-parse', PRIVATE], cwd: main })).toBe(hostNote)
    expect(await git({ args: ['for-each-ref', '--format=%(refname) %(objectname)'], cwd: main })).toContain(hostRefs.split('\n').filter((line) => line.startsWith('refs/worktree')).join('\n'))
    expect(await git({ args: ['for-each-ref', '--format=%(refname)', 'refs/worktree'], cwd: main })).toBe(PRIVATE)
    expect(await headLog(main)).toBe(hostLog)
    expect(await exists(join(main, 'host-edit.txt'))).toBe(true)
    await git({ args: ['fsck', '--no-dangling'], cwd: main })
  })

  it('keeps main private refs in the common admin when main stays at the anchor, with no duplicate tree state', async () => {
    const { main, note } = await sourceRepository()
    const archivePath = await archiveOf(main)
    await git({ args: ['update-ref', '-d', PRIVATE], cwd: main })

    await restoreWorkspaceArchive({ archivePath, destination: main, mode: EWorkspaceRestoreMode.Host, suffix: () => 'beef' })

    expect(await git({ args: ['rev-parse', PRIVATE], cwd: main })).toBe(note)
    expect(await git({ args: ['for-each-ref', '--format=%(refname)', 'refs/worktree'], cwd: main })).toBe(PRIVATE)
    expect(await git({ args: ['worktree', 'list', '--porcelain'], cwd: main })).not.toContain('main-beef')
    expect(await exists(join(main, '.git', 'worktrees'))).toBe(false)
    await git({ args: ['fsck', '--no-dangling'], cwd: main })
  })

  it('keeps main private refs at the anchor of a cloud restore', async () => {
    const { main, note } = await sourceRepository()
    const archivePath = await archiveOf(main)

    const destination = join(await createScratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Cloud })

    expect(await git({ args: ['rev-parse', PRIVATE], cwd: destination })).toBe(note)
    expect(await exists(join(destination, '.git', 'worktrees'))).toBe(false)
    await git({ args: ['fsck', '--no-dangling'], cwd: destination })
  })

  it('rolls back the linked main and its private ref when a later tree fails', async () => {
    const made = await createFamilyFixture()
    const lifted = join(await createScratch(), 'lift.tar.gz')
    await captureWorkspaceArchive({ cwd: made.main, destination: lifted, family: made.family })
    const noteBefore = await git({ args: ['rev-parse', 'refs/bisect/main-bad'], cwd: made.main })
    await writeFile(join(made.main, 'host-edit.txt'), 'diverged\n')
    const worktreesBefore = await git({ args: ['worktree', 'list', '--porcelain'], cwd: made.main })
    const refsBefore = await git({ args: ['for-each-ref', '--format=%(refname) %(objectname)'], cwd: made.main })
    let sweeps = 0

    await expect(
      restoreWorkspaceArchive({
        archivePath: lifted,
        destination: made.main,
        mode: EWorkspaceRestoreMode.Host,
        suffix: () => 'beef',
        beforeSweep: async () => {
          sweeps += 1
          throw new Error('boom')
        },
      }),
    ).rejects.toThrow('boom')

    expect(sweeps).toBeGreaterThan(0)
    expect(await exists(join(made.main, '.atlas', 'worktrees', 'main-beef'))).toBe(false)
    expect(await git({ args: ['worktree', 'list', '--porcelain'], cwd: made.main })).toBe(worktreesBefore)
    expect(await git({ args: ['for-each-ref', '--format=%(refname) %(objectname)'], cwd: made.main })).toBe(refsBefore)
    expect(await git({ args: ['rev-parse', 'refs/bisect/main-bad'], cwd: made.main })).toBe(noteBefore)
    expect(MEMBERS).toHaveLength(5)
  })
})
