import { afterEach, describe, expect, it } from 'bun:test'
import { appendFile, chmod, mkdir, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { digestGitAdmin } from '../capture-admin'
import { reflogSeeds } from '../capture-reflog-seeds'
import { verifySourceCleanupProof } from '../cleanup-proof'
import { cleanupScratches, createScratch, git, quoted } from './capture-fixture'
import { addActive, createRepository, proofOf, SESSION } from './cleanup-proof-fixture'
import { createFamilyFixture } from './family-fixture'

afterEach(cleanupScratches)

const awayAndBack = async ({ cwd, branch }: { cwd: string; branch: string }): Promise<void> => {
  await git({ args: ['checkout', '-q', '--detach'], cwd })
  await git({ args: ['checkout', '-q', branch], cwd })
}

const lastLine = async (path: string): Promise<string> => (await Bun.file(path).text()).trimEnd().split('\n').at(-1) ?? ''

const coverage = (made: Awaited<ReturnType<typeof createFamilyFixture>>) => ({
  trees: [
    { sourcePath: made.main, branch: 'main' },
    { sourcePath: made.checkouts.a.path, branch: 'br-a' },
  ],
})

describe('reflogs in the administration digest', () => {
  it('notices main HEAD moving away and back with HEAD, index and tips unchanged', async () => {
    const made = await createFamilyFixture()
    const before = await digestGitAdmin(coverage(made))
    const head = await git({ args: ['rev-parse', 'HEAD'], cwd: made.main })

    await awayAndBack({ cwd: made.main, branch: 'main' })

    expect(await git({ args: ['rev-parse', 'HEAD'], cwd: made.main })).toBe(head)
    expect(await digestGitAdmin(coverage(made))).not.toBe(before)
  })

  it('notices a linked checkout private HEAD reflog changing', async () => {
    const made = await createFamilyFixture()
    const before = await digestGitAdmin(coverage(made))

    await awayAndBack({ cwd: made.checkouts.a.path, branch: 'br-a' })

    expect(await digestGitAdmin(coverage(made))).not.toBe(before)
  })

  it('notices a stash reflog changing while the stash tip stays put', async () => {
    const made = await createFamilyFixture()
    await writeFile(join(made.main, 'README.md'), 'stashed\n')
    await git({ args: ['stash', 'push', '-m', 'one'], cwd: made.main })
    const before = await digestGitAdmin(coverage(made))
    const log = join(made.main, '.git', 'logs', 'refs', 'stash')

    await appendFile(log, `${await lastLine(log)}\n`)

    expect(await digestGitAdmin(coverage(made))).not.toBe(before)
  })

  it('ignores an uncovered shared ref log and the volatile ai directory', async () => {
    const made = await createFamilyFixture()
    const before = await digestGitAdmin(coverage(made))
    const log = join(made.main, '.git', 'logs', 'refs', 'heads', 'unrelated-branch')

    await appendFile(log, `${await lastLine(log)}\n`)
    await mkdir(join(made.main, '.git', 'ai'), { recursive: true })
    await writeFile(join(made.main, '.git', 'ai', 'volatile'), 'x\n')
    await git({ args: ['branch', 'side-branch'], cwd: made.main })

    expect(await digestGitAdmin(coverage(made))).toBe(before)
  })
})

describe('reflogs in the source cleanup proof', () => {
  it('refuses cleanup after HEAD moved away and back', async () => {
    const repository = await createRepository()
    await addActive(repository)
    const proof = await proofOf({ cwd: repository.active })
    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(true)

    await awayAndBack({ cwd: repository.main, branch: 'main' })

    const verdict = await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })
    expect(verdict.safe).toBe(false)
    expect(verdict.reasons.join('\n')).toContain('administration-drift')
  })
})

describe('a preserved reflog changing while the archive is written', () => {
  it('rejects the capture and leaves no archive behind', async () => {
    const made = await createFamilyFixture()
    const bins = join(await createScratch(), 'bin')
    await mkdir(bins)
    const realTar = Bun.spawnSync(['which', 'tar'], { stdout: 'pipe' }).stdout.toString().trim()
    const command = `git -C ${quoted(made.main)} checkout -q --detach; git -C ${quoted(made.main)} checkout -q main`
    await writeFile(join(bins, 'tar'), `#!/bin/sh\nif [ "$1" = "--no-recursion" ]; then ${command}; fi\nexec ${quoted(realTar)} "$@"\n`)
    await chmod(join(bins, 'tar'), 0o755)
    const destination = join(await createScratch(), 'workspace.tar.gz')
    const path = process.env.PATH
    process.env.PATH = `${bins}:${path ?? ''}`
    try {
      await expect(captureWorkspaceArchive({ cwd: made.main, destination, family: made.family })).rejects.toThrow('changed while it was being captured')
    } finally {
      if (path === undefined) delete process.env.PATH
      else process.env.PATH = path
    }

    expect(await stat(destination).then(() => true, () => false)).toBe(false)
  })
})

describe('the reflog walk for seeds', () => {
  const seedsOf = async (linkedLogRoots: string[]): Promise<string[]> => {
    const made = await createFamilyFixture()
    return reflogSeeds({ cwd: made.main, commonLogFiles: [], linkedLogRoots })
  }

  it('treats a missing log directory as empty', async () => {
    expect(await seedsOf([join(await createScratch(), 'logs')])).toEqual([])
  })

  it('does not follow symbolic links out of the log directory', async () => {
    const made = await createFamilyFixture()
    const head = await git({ args: ['rev-parse', 'HEAD'], cwd: made.main })
    const outside = join(await createScratch(), 'outside-log')
    await writeFile(outside, `${'0'.repeat(40)} ${head} x <x@x> 1 +0000\tcommit: outside\n`)
    const outsideDirectory = await createScratch()
    await writeFile(join(outsideDirectory, 'HEAD'), `${'0'.repeat(40)} ${head} x <x@x> 1 +0000\tcommit: outside\n`)
    const logs = join(await createScratch(), 'logs')
    await mkdir(logs)
    await symlink(outside, join(logs, 'linked-file'))
    await symlink(outsideDirectory, join(logs, 'linked-directory'))

    expect(await reflogSeeds({ cwd: made.main, commonLogFiles: [], linkedLogRoots: [logs] })).toEqual([])
  })

  it('refuses a log root that is not a real directory', async () => {
    const root = join(await createScratch(), 'logs')
    await writeFile(root, 'not a directory\n')

    await expect(seedsOf([root])).rejects.toThrow()
  })

  it.skipIf(process.getuid?.() === 0)('refuses an unreadable log directory', async () => {
    const logs = join(await createScratch(), 'logs')
    await mkdir(logs)
    await chmod(logs, 0o000)
    try {
      await expect(seedsOf([logs])).rejects.toThrow()
    } finally {
      await chmod(logs, 0o755)
    }
  })
})
