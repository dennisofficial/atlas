import { afterAll, describe, expect, it } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EWorkspaceRestoreMode, prepareWorkspaceRestoration, restoreWorkspaceArchive } from '../restore'
import { archiveOf, cleanup, fixture, git, scratch, status } from './restore-fixture'

afterAll(cleanup)

const unbornRepo = async () => {
  const repo = join(await scratch(), 'unborn')
  await mkdir(repo)
  await git({ args: ['init', '-b', 'trunk'], cwd: repo })
  await writeFile(join(repo, 'staged.txt'), 'one\n')
  await git({ args: ['add', 'staged.txt'], cwd: repo })
  await writeFile(join(repo, 'staged.txt'), 'two\n')
  await writeFile(join(repo, 'untracked.txt'), 'loose\n')
  return repo
}

const hostRestore = (args: { archivePath: string; destination: string; hex?: string }) =>
  restoreWorkspaceArchive({
    archivePath: args.archivePath,
    destination: args.destination,
    mode: EWorkspaceRestoreMode.Host,
    suffix: () => args.hex ?? 'abcd',
  })

const noCommits = async (cwd: string): Promise<void> => {
  await expect(git({ args: ['rev-parse', '--verify', '-q', 'HEAD'], cwd })).rejects.toThrow()
  expect(await git({ args: ['symbolic-ref', 'HEAD'], cwd })).toBe('refs/heads/trunk')
}

describe('a repository with no commits yet', () => {
  it('restores staged, unstaged and untracked state in the cloud without inventing a commit', async () => {
    const repo = await unbornRepo()
    const { archivePath } = await archiveOf({ cwd: repo })
    const destination = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Cloud })

    expect(await status(destination)).toBe(await status(repo))
    expect(await git({ args: ['show', ':staged.txt'], cwd: destination })).toBe('one')
    expect(await readFile(join(destination, 'staged.txt'), 'utf8')).toBe('two\n')
    await noCommits(destination)
  })

  it('restores back into the unchanged unborn original', async () => {
    const repo = await unbornRepo()
    const first = await archiveOf({ cwd: repo })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: first.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    await writeFile(join(cloud, 'cloud-only.txt'), 'from cloud\n')
    await git({ args: ['add', 'cloud-only.txt'], cwd: cloud })
    const back = await archiveOf({ cwd: cloud })

    const restored = await hostRestore({ archivePath: back.archivePath, destination: repo })

    expect(restored.cwd).toBe(repo)
    expect(await status(repo)).toBe(await status(cloud))
    await noCommits(repo)
  })

  it('clears a stale destination index when the incoming snapshot has none', async () => {
    const repo = join(await scratch(), 'stale')
    await mkdir(repo)
    await git({ args: ['init', '-b', 'trunk'], cwd: repo })
    await writeFile(join(repo, 'a.txt'), 'a\n')
    await git({ args: ['add', 'a.txt'], cwd: repo })
    const lifted = await archiveOf({ cwd: repo })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: lifted.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    await git({ args: ['reset', '-q'], cwd: cloud })
    await rm(join(cloud, '.git', 'index'), { force: true })
    await writeFile(join(cloud, 'b.txt'), 'b\n')
    const back = await archiveOf({ cwd: cloud })
    expect(await status(repo)).toBe('A  a.txt')

    await hostRestore({ archivePath: back.archivePath, destination: repo })

    expect(await status(repo)).toBe(await status(cloud))
    expect(await status(repo)).toBe('?? a.txt\n?? b.txt')
  })

  it('brings a cleared index back when the restore is rolled back', async () => {
    const repo = join(await scratch(), 'rolled')
    await mkdir(repo)
    await git({ args: ['init', '-b', 'trunk'], cwd: repo })
    await writeFile(join(repo, 'a.txt'), 'a\n')
    await git({ args: ['add', 'a.txt'], cwd: repo })
    const lifted = await archiveOf({ cwd: repo })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: lifted.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    await git({ args: ['reset', '-q'], cwd: cloud })
    await rm(join(cloud, '.git', 'index'), { force: true })
    const back = await archiveOf({ cwd: cloud })

    const prepared = await prepareWorkspaceRestoration({ archivePath: back.archivePath, destination: repo, mode: EWorkspaceRestoreMode.Host })
    expect(await status(repo)).toBe('?? a.txt')
    await prepared.rollback()

    expect(await status(repo)).toBe('A  a.txt')
  })

  it('sets an unborn original aside when it has diverged', async () => {
    const repo = await unbornRepo()
    const first = await archiveOf({ cwd: repo })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: first.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    await writeFile(join(cloud, 'cloud-only.txt'), 'from cloud\n')
    const back = await archiveOf({ cwd: cloud })
    await writeFile(join(repo, 'host-only.txt'), 'host\n')
    const before = await status(repo)

    const restored = await hostRestore({ archivePath: back.archivePath, destination: repo, hex: 'bead' })

    const aside = join(repo, '.atlas', 'worktrees', 'main-bead')
    expect(restored.cwd).toBe(aside)
    expect(await readFile(join(aside, 'cloud-only.txt'), 'utf8')).toBe('from cloud\n')
    expect(await status(repo)).toContain('host-only.txt')
    expect(before).toContain('host-only.txt')
    await expect(git({ args: ['rev-parse', '--verify', '-q', 'HEAD'], cwd: aside })).rejects.toThrow()
  })
})

describe('host configuration when worktree config is enabled', () => {
  it('leaves unrelated keys alone and restores the config byte for byte on rollback', async () => {
    const made = await fixture()
    await git({ args: ['config', 'extensions.worktreeConfig', 'true'], cwd: made.main })
    await git({ args: ['config', '--worktree', 'user.signingkey', 'KEY1'], cwd: made.nested })
    const { archivePath } = await archiveOf({ cwd: made.main })

    const host = join(await scratch(), 'host')
    await mkdir(host)
    await git({ args: ['init', '-b', 'hostbranch'], cwd: host })
    await git({ args: ['config', 'user.name', 'Host Person'], cwd: host })
    await git({ args: ['config', 'custom.key', 'kept'], cwd: host })
    await git({ args: ['config', 'core.hooksPath', '.myhooks'], cwd: host })
    const before = await readFile(join(host, '.git', 'config'), 'utf8')

    const prepared = await prepareWorkspaceRestoration({ archivePath, destination: host, mode: EWorkspaceRestoreMode.Host, suffix: () => 'face' })
    expect(await git({ args: ['config', '--file', join(host, '.git', 'config'), 'user.name'], cwd: host })).toBe('Host Person')
    expect(await git({ args: ['config', '--file', join(host, '.git', 'config'), 'custom.key'], cwd: host })).toBe('kept')
    expect(await git({ args: ['config', '--file', join(host, '.git', 'config'), 'core.hooksPath'], cwd: host })).toBe('.myhooks')
    await prepared.rollback()

    expect(await readFile(join(host, '.git', 'config'), 'utf8')).toBe(before)
  })
})
