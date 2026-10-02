import { afterAll, describe, expect, it } from 'bun:test'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EWorkspaceRestoreMode, prepareWorkspaceRestoration, restoreWorkspaceArchive } from '../restore'
import { archiveOf, cleanup, commitAll, fixture, git, headOf, refOf, scratch, status, worktreePaths } from './restore-fixture'

afterAll(cleanup)

const hostRestore = async ({ archivePath, destination, hex }: { archivePath: string; destination: string; hex?: string }) =>
  restoreWorkspaceArchive({
    archivePath,
    destination,
    mode: EWorkspaceRestoreMode.Host,
    suffix: () => hex ?? 'abcd',
  })

const descendFixture = async () => {
  const made = await fixture()
  const session = join(made.main, '.atlas', 'worktrees', 'session')
  await git({ args: ['worktree', 'add', session, '-b', 'session'], cwd: made.main })
  const lifted = await archiveOf({ cwd: session })
  const cloud = join(await scratch(), 'cloud')
  await restoreWorkspaceArchive({ archivePath: lifted.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
  const cloudSession = join(cloud, '.atlas', 'worktrees', 'session')
  return { made, session, cloud, cloudSession }
}

const missing = async (path: string): Promise<boolean> => !(await stat(path).then(() => true, () => false))

describe('grafting a scoped descend archive onto the host', () => {
  it('fast-forwards the session branch its destroyed worktree left behind and recreates the worktree', async () => {
    const { made, session, cloudSession } = await descendFixture()
    await writeFile(join(cloudSession, 'cloud-new.txt'), 'made in the cloud\n')
    const cloudTip = await commitAll(cloudSession, 'cloud commit')
    await writeFile(join(cloudSession, 'staged-in-cloud.txt'), 'staged\n')
    await git({ args: ['add', 'staged-in-cloud.txt'], cwd: cloudSession })
    await git({ args: ['worktree', 'remove', '--force', session], cwd: made.main })
    const leftBehind = await refOf(made.main, 'refs/heads/session')
    expect(leftBehind).not.toBe(cloudTip)

    const back = await archiveOf({ cwd: cloudSession })
    const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main })

    expect(restored.cwd).toBe(session)
    expect(restored.trees.find((tree) => tree.path === session)).toMatchObject({ branch: 'session', renamedFrom: null })
    expect(await refOf(made.main, 'refs/heads/session')).toBe(cloudTip)
    expect(await refOf(made.main, 'refs/heads/session-abcd')).toBe('')
    await git({ args: ['cat-file', '-e', cloudTip], cwd: made.main })
    expect(await readFile(join(session, 'cloud-new.txt'), 'utf8')).toBe('made in the cloud\n')
    expect(await status(session)).toBe('A  staged-in-cloud.txt')
    expect(await worktreePaths(made.main)).toContain(session)
    expect(await readFile(join(made.nested, 'README.md'), 'utf8')).toBe('nested edit\n')
  })

  it('sets the descend aside when the local branch tip moved during the session', async () => {
    const { made, session, cloudSession } = await descendFixture()
    await writeFile(join(cloudSession, 'cloud-new.txt'), 'made in the cloud\n')
    const cloudTip = await commitAll(cloudSession, 'cloud commit')
    await writeFile(join(session, 'host-new.txt'), 'made on the host\n')
    const hostTip = await commitAll(session, 'host commit during absence')

    const back = await archiveOf({ cwd: cloudSession })
    const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main, hex: 'd00d' })
    const aside = join(made.main, '.atlas', 'worktrees', 'session-d00d')

    expect(restored.cwd).toBe(aside)
    expect(restored.trees.find((tree) => tree.path === aside)).toMatchObject({ branch: 'session-d00d', renamedFrom: 'session' })
    expect(await refOf(made.main, 'refs/heads/session')).toBe(hostTip)
    expect(await refOf(made.main, 'refs/heads/session-d00d')).toBe(cloudTip)
    expect(await status(session)).toBe('')
    expect(await readFile(join(session, 'README.md'), 'utf8')).toBe('hello\n')
  })
})

describe('restores prune operation state the archive does not carry', () => {
  const seedStaleState = async (main: string): Promise<void> => {
    const marker = await headOf(main)
    await writeFile(join(main, '.git', 'MERGE_HEAD'), `${marker}\n`)
    await writeFile(join(main, '.git', 'MERGE_MSG'), 'stale merge\n')
    await writeFile(join(main, '.git', 'AUTO_MERGE'), `${marker}\n`)
    await mkdir(join(main, '.git', 'rebase-merge'), { recursive: true })
    await writeFile(join(main, '.git', 'rebase-merge', 'head-name'), 'refs/heads/stale\n')
    await mkdir(join(main, '.git', 'sequencer'), { recursive: true })
    await writeFile(join(main, '.git', 'sequencer', 'todo'), 'pick abc stale\n')
  }

  const staleRoots = ['MERGE_HEAD', 'MERGE_MSG', 'AUTO_MERGE', 'rebase-merge', 'sequencer']

  const staleRoundTrip = async () => {
    const made = await fixture()
    const lifted = await archiveOf({ cwd: made.main })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: lifted.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    await writeFile(join(cloud, 'cloud-new.txt'), 'made in the cloud\n')
    const back = await archiveOf({ cwd: cloud })
    return { made, back }
  }

  it('clears stale merge, rebase and sequencer state on an in-place host restore', async () => {
    const { made, back } = await staleRoundTrip()
    await seedStaleState(made.main)
    expect(await refOf(made.main, 'MERGE_HEAD')).not.toBe('')

    await hostRestore({ archivePath: back.archivePath, destination: made.main })

    expect(await refOf(made.main, 'MERGE_HEAD')).toBe('')
    for (const root of staleRoots) expect(await missing(join(made.main, '.git', root))).toBe(true)
  })

  it('clears stale per-worktree merge state on an in-place descend', async () => {
    const { made, session, cloudSession } = await descendFixture()
    const admin = await git({ args: ['rev-parse', '--path-format=absolute', '--absolute-git-dir'], cwd: session })
    await writeFile(join(admin, 'MERGE_HEAD'), `${await headOf(session)}\n`)
    const back = await archiveOf({ cwd: cloudSession })

    const restored = await hostRestore({ archivePath: back.archivePath, destination: made.main })

    expect(restored.cwd).toBe(session)
    expect(await missing(join(admin, 'MERGE_HEAD'))).toBe(true)
  })

  it('keeps merge state that the archive itself carries', async () => {
    const made = await fixture()
    const lifted = await archiveOf({ cwd: made.main })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: lifted.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    const marker = await headOf(cloud)
    await writeFile(join(cloud, '.git', 'MERGE_HEAD'), `${marker}\n`)
    const back = await archiveOf({ cwd: cloud })

    await hostRestore({ archivePath: back.archivePath, destination: made.main })

    expect(await refOf(made.main, 'MERGE_HEAD')).toBe(marker)
  })

  it('returns pruned state files when the caller rejects the restoration', async () => {
    const { made, back } = await staleRoundTrip()
    await seedStaleState(made.main)
    const original = await readFile(join(made.main, '.git', 'MERGE_HEAD'), 'utf8')

    const restoration = await prepareWorkspaceRestoration({
      archivePath: back.archivePath,
      destination: made.main,
      mode: EWorkspaceRestoreMode.Host,
    })
    expect(await missing(join(made.main, '.git', 'MERGE_HEAD'))).toBe(true)
    await restoration.rollback()

    expect(await readFile(join(made.main, '.git', 'MERGE_HEAD'), 'utf8')).toBe(original)
    expect(await readFile(join(made.main, '.git', 'sequencer', 'todo'), 'utf8')).toBe('pick abc stale\n')
  })
})
