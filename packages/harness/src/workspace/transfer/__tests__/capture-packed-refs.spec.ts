import { afterAll, describe, expect, it } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { digestGitAdmin } from '../capture-admin'
import {
  captureWhileTarRuns,
  cleanupScratches,
  createFixture,
  createScratch,
  git,
  quoted,
  type Fixture,
} from './capture-fixture'

const fixtures: Fixture[] = []

const fixture = async (): Promise<Fixture> => {
  const made = await createFixture()
  fixtures.push(made)
  await git({ args: ['tag', 'v1'], cwd: made.main })
  await git({ args: ['tag', '-a', 'v2', '-m', 'annotated'], cwd: made.main })
  await git({ args: ['branch', 'side'], cwd: made.main })
  return made
}

afterAll(async () => {
  await Promise.all(fixtures.map((made) => made.cleanup()))
  await cleanupScratches()
})

const coverage = (made: Fixture) => ({
  trees: [
    { sourcePath: made.main, branch: 'main' },
    { sourcePath: made.nested, branch: 'feat' },
  ],
})

const refsOf = async (cwd: string): Promise<string> =>
  git({ args: ['for-each-ref', '--format=%(refname) %(objectname) %(symref)'], cwd })

const coveredRefsOf = async (cwd: string): Promise<string[]> =>
  (await refsOf(cwd))
    .split('\n')
    .filter((line) => line.startsWith('refs/heads/main'))
    .map((line) => line.trimEnd())

const archivedRefs = async ({ extracted, cwd }: { extracted: string; cwd: string }): Promise<string[]> => {
  const admin = join(extracted, 'git')
  const head = await readFile(join(extracted, 'trees', 'main', 'git-state', 'HEAD'), 'utf8')
  const probe = await createScratch()
  const gitDir = join(probe, 'admin')
  await Bun.spawn(['cp', '-R', admin, gitDir]).exited
  await Bun.write(join(gitDir, 'HEAD'), head)
  return (await git({ args: ['--git-dir', gitDir, 'for-each-ref', '--format=%(refname) %(objectname) %(symref)'], cwd }))
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.trimEnd())
}

describe('the admin digest and refs', () => {
  it('does not change when refs are packed, because the covered logical refs are the same', async () => {
    const made = await fixture()
    const before = await digestGitAdmin(coverage(made))
    await git({ args: ['pack-refs', '--all', '--prune'], cwd: made.main })
    expect(await digestGitAdmin(coverage(made))).toBe(before)
  })

  it('notices a covered branch move but ignores a new tag or side branch', async () => {
    const made = await fixture()
    const before = await digestGitAdmin(coverage(made))
    await git({ args: ['commit', '--allow-empty', '-m', 'move'], cwd: made.nested })
    const moved = await digestGitAdmin(coverage(made))
    expect(moved).not.toBe(before)
    await git({ args: ['tag', 'v3'], cwd: made.main })
    expect(await digestGitAdmin(coverage(made))).toBe(moved)
    await git({ args: ['branch', 'another-side'], cwd: made.main })
    expect(await digestGitAdmin(coverage(made))).toBe(moved)
  })
})

describe('capturing while refs are packed or changed', () => {
  it('succeeds when pack-refs runs during packing and archives exactly the covered refs', async () => {
    const made = await fixture()
    const expected = await coveredRefsOf(made.main)
    const { extracted } = await captureWhileTarRuns({
      cwd: made.main,
      command: `git -C ${quoted(made.main)} pack-refs --all --prune`,
    })
    expect(await archivedRefs({ extracted, cwd: made.main })).toEqual(expected)
    expect(await refsOf(made.main)).toBe((await refsOf(made.main)).trim())
  })

  it('archives packed source refs from a canonical snapshot, not the raw packed-refs file', async () => {
    const made = await fixture()
    await git({ args: ['pack-refs', '--all'], cwd: made.main })
    await git({ args: ['branch', 'loose-after-pack'], cwd: made.main })
    const { extracted } = await captureWhileTarRuns({ cwd: made.main, command: 'true' })
    const archived = await archivedRefs({ extracted, cwd: made.main })
    expect(archived).toEqual(await coveredRefsOf(made.main))
    expect(archived.join('\n')).not.toContain('loose-after-pack')
    expect((await readdir(join(extracted, 'git', 'refs', 'heads'))).sort()).toEqual([])
    expect(await readFile(join(extracted, 'git', 'packed-refs'), 'utf8')).toContain('refs/heads/main')
  })

  it('excludes tags, remote refs and symbolic refs that the covered trees do not need', async () => {
    const made = await fixture()
    await git({ args: ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], cwd: made.main }).catch(() => '')
    await git({ args: ['update-ref', 'refs/remotes/origin/main', 'HEAD'], cwd: made.main })
    const { extracted } = await captureWhileTarRuns({ cwd: made.main, command: 'true' })
    const archived = await archivedRefs({ extracted, cwd: made.main })
    expect(archived).toEqual([`refs/heads/main ${await git({ args: ['rev-parse', 'refs/heads/main'], cwd: made.main })}`])
    expect(archived.join('\n')).not.toContain('refs/tags/')
    expect(archived.join('\n')).not.toContain('refs/remotes/')
    expect(archived.join('\n')).not.toContain('refs/heads/side')
  })

  it('refuses when a covered branch moves during packing', async () => {
    const made = await fixture()
    const other = await git({ args: ['commit-tree', '-m', 'elsewhere', 'HEAD^{tree}'], cwd: made.main })
    await expect(
      captureWhileTarRuns({
        cwd: made.main,
        command: `git -C ${quoted(made.main)} update-ref refs/heads/main ${other}`,
      }),
    ).rejects.toThrow('changed while it was being captured')
  })

  it('does not refuse when an uncovered tag appears during packing, and leaves it out', async () => {
    const made = await fixture()
    const { extracted } = await captureWhileTarRuns({
      cwd: made.main,
      command: `git -C ${quoted(made.main)} update-ref refs/tags/created-during-capture HEAD`,
    })
    expect((await archivedRefs({ extracted, cwd: made.main })).join('\n')).not.toContain('created-during-capture')
  })

  it('does not leave a raw refs directory mount or write to the source refs', async () => {
    const made = await fixture()
    const before = await refsOf(made.main)
    const out = await createScratch()
    await captureWorkspaceArchive({ cwd: made.main, destination: join(out, 'a.tar.gz') })
    expect(await refsOf(made.main)).toBe(before)
  })
})
