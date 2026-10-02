import { afterAll, describe, expect, it } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { workspaceReceiptSchema } from '../manifest'
import { fingerprintWorkspaceTree } from '../capture-fingerprint'
import { EWorkspaceRestoreMode, prepareWorkspaceRestoration, restoreWorkspaceArchive } from '../restore'
import { archiveOf, cleanup, commitAll, fixture, git, refOf, scratch, status, worktreePaths } from './restore-fixture'

afterAll(cleanup)

const hostRestore = async ({ archivePath, destination, hex }: { archivePath: string; destination: string; hex?: string }) =>
  restoreWorkspaceArchive({
    archivePath,
    destination,
    mode: EWorkspaceRestoreMode.Host,
    suffix: () => hex ?? 'abcd',
  })

const roundTrip = async () => {
  const made = await fixture()
  const { archivePath } = await archiveOf({ cwd: made.main })
  const cloud = join(await scratch(), 'cloud')
  await restoreWorkspaceArchive({ archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
  await writeFile(join(cloud, 'cloud-new.txt'), 'made in the cloud\n')
  await writeFile(join(cloud, 'README.md'), 'cloud edit\n')
  const back = await archiveOf({ cwd: cloud })
  return { made, cloud, back }
}

describe('restoreWorkspaceArchive in host mode', () => {
  it('restores into the unchanged original checkout without touching unrelated branches', async () => {
    const { made, back } = await roundTrip()
    await git({ args: ['branch', 'unrelated'], cwd: made.main })
    const unrelated = await refOf(made.main, 'refs/heads/unrelated')

    const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main })

    expect(restored.cwd).toBe(made.main)
    expect(restored.trees.every((tree) => tree.renamedFrom === null)).toBe(true)
    expect(await readFile(join(made.main, 'README.md'), 'utf8')).toBe('cloud edit\n')
    expect(await readFile(join(made.main, 'cloud-new.txt'), 'utf8')).toBe('made in the cloud\n')
    expect(await refOf(made.main, 'refs/heads/unrelated')).toBe(unrelated)
    expect(await git({ args: ['symbolic-ref', 'HEAD'], cwd: made.main })).toBe('refs/heads/main')
    expect(await worktreePaths(made.main)).toHaveLength(3)
    const receipt = workspaceReceiptSchema.parse(JSON.parse(await readFile(join(made.main, '.git', 'atlas-transfer.json'), 'utf8')))
    expect(receipt.repositoryOrigin).toBe(made.main)
    const main = receipt.trees.find((tree) => tree.path === made.main)
    expect(main?.baseline).toBe(await fingerprintWorkspaceTree({ cwd: made.main, excludedRoots: [made.nested, made.detached] }))
  })

  it('puts a diverged main checkout aside under a main-xxxx worktree and leaves it untouched', async () => {
    const { made, back } = await roundTrip()
    await writeFile(join(made.main, 'host-only.txt'), 'host\n')
    const before = await status(made.main)
    const hostHead = await refOf(made.main, 'HEAD')

    const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: 'beef' })
    const aside = join(made.main, '.atlas', 'worktrees', 'main-beef')

    const tree = restored.trees.find((item) => item.path === aside)
    expect(tree).toMatchObject({ renamedFrom: 'main', branch: 'main-beef' })
    expect(restored.cwd).toBe(aside)
    expect(await readFile(join(aside, 'cloud-new.txt'), 'utf8')).toBe('made in the cloud\n')
    expect(await status(made.main)).toBe(before)
    expect(await refOf(made.main, 'HEAD')).toBe(hostHead)
    expect(await readFile(join(made.main, 'README.md'), 'utf8')).toBe('hello, edited\n')
    expect(await git({ args: ['symbolic-ref', 'HEAD'], cwd: aside })).toBe('refs/heads/main-beef')
  })

  it('suffixes a linked worktree whose host copy diverged and keeps the host branch', async () => {
    const { made, back } = await roundTrip()
    await writeFile(join(made.nested, 'host-edit.txt'), 'host\n')
    const hostFeat = await refOf(made.main, 'refs/heads/feat')

    const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: 'cafe' })
    const aside = join(made.main, '.atlas', 'worktrees', 'feat-cafe')

    expect(restored.trees.find((item) => item.path === aside)).toMatchObject({ renamedFrom: 'feat', branch: 'feat-cafe' })
    expect(await readFile(join(made.nested, 'host-edit.txt'), 'utf8')).toBe('host\n')
    expect(await refOf(made.main, 'refs/heads/feat')).toBe(hostFeat)
    expect(await readFile(join(aside, 'feat.txt'), 'utf8')).toBe('feature\n')
    expect(await worktreePaths(made.main)).toContain(aside)
  })

  it('recreates a worktree that only exists in the cloud and keeps its side branches', async () => {
    const { made, cloud } = await roundTrip()
    const created = join(cloud, '.atlas', 'worktrees', 'cloud-made')
    await git({ args: ['worktree', 'add', created, '-b', 'cloud-branch'], cwd: cloud })
    await writeFile(join(created, 'only.txt'), 'cloud only\n')
    await git({ args: ['branch', 'cloud-side'], cwd: cloud })
    await git({ args: ['tag', 'cloud-tag'], cwd: cloud })
    const back = await archiveOf({ cwd: cloud })

    await hostRestore({ archivePath: back.archivePath, destination: made.main })
    const target = join(made.main, '.atlas', 'worktrees', 'cloud-made')

    expect(await readFile(join(target, 'only.txt'), 'utf8')).toBe('cloud only\n')
    expect(await git({ args: ['symbolic-ref', 'HEAD'], cwd: target })).toBe('refs/heads/cloud-branch')
    expect(await refOf(made.main, 'refs/heads/cloud-side')).not.toBe('')
    expect(await refOf(made.main, 'refs/tags/cloud-tag')).not.toBe('')
  })

  it('keeps host refs and imports a differing incoming ref under a suffixed name', async () => {
    const { made, cloud } = await roundTrip()
    await git({ args: ['branch', 'shared'], cwd: cloud })
    await commitAll(made.main, 'host commit')
    await git({ args: ['branch', 'shared'], cwd: made.main })
    const hostShared = await refOf(made.main, 'refs/heads/shared')
    const back = await archiveOf({ cwd: cloud })

    await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: 'f00d' })

    expect(await refOf(made.main, 'refs/heads/shared')).toBe(hostShared)
    expect(await refOf(made.main, 'refs/heads/shared-f00d')).toBe(await refOf(cloud, 'refs/heads/shared'))
  })

  it('draws a fresh suffix when the first one is taken', async () => {
    const { made, back } = await roundTrip()
    await writeFile(join(made.main, 'host-only.txt'), 'host\n')
    await git({ args: ['worktree', 'add', join(made.main, '.atlas', 'worktrees', 'main-aaaa'), '-b', 'main-aaaa'], cwd: made.main })
    const sequence = ['aaaa', 'bbbb']

    const restored = await restoreWorkspaceArchive({
      archivePath: back.archivePath,
      destination: made.main,
      mode: EWorkspaceRestoreMode.Host,
      suffix: () => sequence.shift() ?? 'zzzz',
    })

    expect(restored.cwd).toBe(join(made.main, '.atlas', 'worktrees', 'main-bbbb'))
  })

  it('does not overwrite a checkout held by another live session', async () => {
    const { made, back } = await roundTrip()
    const holder = Bun.spawn(['sleep', '30'], { stdout: 'ignore', stderr: 'ignore' })
    try {
      await git({ args: ['worktree', 'lock', '--reason', `atlas test (pid ${holder.pid})`, made.nested], cwd: made.main })
      const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: '1111' })
      expect(restored.trees.find((tree) => tree.renamedFrom === 'feat')?.path).toBe(join(made.main, '.atlas', 'worktrees', 'feat-1111'))
      expect(await readFile(join(made.nested, 'README.md'), 'utf8')).toBe('nested edit\n')
    } finally {
      holder.kill()
    }
  })

  it('rolls back everything when the caller rejects the restoration', async () => {
    const { made, back } = await roundTrip()
    const before = await status(made.main)
    const readme = await readFile(join(made.main, 'README.md'), 'utf8')

    const restoration = await prepareWorkspaceRestoration({ archivePath: back.archivePath, destination: made.main, mode: EWorkspaceRestoreMode.Host })
    expect(await readFile(join(made.main, 'README.md'), 'utf8')).toBe('cloud edit\n')
    await restoration.rollback()

    expect(await readFile(join(made.main, 'README.md'), 'utf8')).toBe(readme)
    expect(await status(made.main)).toBe(before)
  })

  it('reuses a previously restored generation instead of suffixing again', async () => {
    const { made, back } = await roundTrip()
    await writeFile(join(made.main, 'host-only.txt'), 'host\n')
    const first = await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: '2222' })
    const second = await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: '3333' })
    expect(second.cwd).toBe(first.cwd)
  })

  it('verifies content and the staged index of a renamed conflict copy', async () => {
    const { made, cloud } = await roundTrip()
    await writeFile(join(cloud, 'both.txt'), 'one\n')
    await git({ args: ['add', 'both.txt'], cwd: cloud })
    await writeFile(join(cloud, 'both.txt'), 'two\n')
    const back = await archiveOf({ cwd: cloud })
    await writeFile(join(made.main, 'host-only.txt'), 'host\n')

    const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: 'd00d' })
    const aside = join(made.main, '.atlas', 'worktrees', 'main-d00d')

    expect(restored.cwd).toBe(aside)
    expect(await git({ args: ['show', ':both.txt'], cwd: aside })).toBe('one')
    expect(await readFile(join(aside, 'both.txt'), 'utf8')).toBe('two\n')
    expect(await status(aside)).toBe(await status(cloud))
  })

  it('keeps cloud stash entries and merge state when the checkout is restored in place', async () => {
    const { made, cloud } = await roundTrip()
    await git({ args: ['stash', 'push', '-u', '-m', 'cloud stash'], cwd: cloud })
    const back = await archiveOf({ cwd: cloud })
    await hostRestore({ archivePath: back.archivePath, destination: made.main })
    expect(await git({ args: ['stash', 'list'], cwd: made.main })).toContain('cloud stash')
  })

  it('moves a created worktree back out and removes it again on rollback', async () => {
    const { made, cloud } = await roundTrip()
    const created = join(cloud, '.atlas', 'worktrees', 'cloud-made')
    await git({ args: ['worktree', 'add', created, '-b', 'cloud-branch'], cwd: cloud })
    await writeFile(join(created, 'only.txt'), 'cloud only\n')
    const back = await archiveOf({ cwd: cloud })
    const before = await worktreePaths(made.main)

    const restoration = await prepareWorkspaceRestoration({ archivePath: back.archivePath, destination: made.main, mode: EWorkspaceRestoreMode.Host })
    expect(await worktreePaths(made.main)).toContain(join(made.main, '.atlas', 'worktrees', 'cloud-made'))
    await restoration.rollback()

    expect(await worktreePaths(made.main)).toEqual(before)
    expect(await refOf(made.main, 'refs/heads/cloud-branch')).toBe('')
  })

  it('refuses to undo a restore after the user edited the restored checkout', async () => {
    const { made, back } = await roundTrip()
    const restoration = await prepareWorkspaceRestoration({ archivePath: back.archivePath, destination: made.main, mode: EWorkspaceRestoreMode.Host })
    await writeFile(join(made.main, 'README.md'), 'typed after the restore\n')

    await expect(restoration.rollback()).rejects.toThrow(/changed after it was restored/)
    expect(await readFile(join(made.main, 'README.md'), 'utf8')).toBe('typed after the restore\n')
  })

  it('keeps an unmerged index with all conflict stages', async () => {
    const { made, cloud } = await roundTrip()
    await git({ args: ['checkout', '-q', '-b', 'topic', 'HEAD'], cwd: cloud }).catch(() => undefined)
    await git({ args: ['stash', 'push', '-u'], cwd: cloud })
    await writeFile(join(cloud, 'conflict.txt'), 'base\n')
    await commitAll(cloud, 'base')
    await git({ args: ['checkout', '-q', '-b', 'side'], cwd: cloud })
    await writeFile(join(cloud, 'conflict.txt'), 'side\n')
    await commitAll(cloud, 'side')
    await git({ args: ['checkout', '-q', 'topic'], cwd: cloud })
    await writeFile(join(cloud, 'conflict.txt'), 'topic\n')
    await commitAll(cloud, 'topic')
    await git({ args: ['merge', 'side'], cwd: cloud }).catch(() => undefined)
    const back = await archiveOf({ cwd: cloud })
    const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: 'ab12' })
    expect(await git({ args: ['ls-files', '-u'], cwd: cloud })).not.toBe('')
    expect(await refOf(cloud, 'MERGE_HEAD')).not.toBe('')
    expect(await git({ args: ['ls-files', '-u'], cwd: restored.cwd })).toBe(await git({ args: ['ls-files', '-u'], cwd: cloud }))
    expect(await refOf(restored.cwd, 'MERGE_HEAD')).toBe(await refOf(cloud, 'MERGE_HEAD'))
  })
})
