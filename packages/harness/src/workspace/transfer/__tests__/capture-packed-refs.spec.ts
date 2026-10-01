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

const refsOf = async (cwd: string): Promise<string> =>
  git({ args: ['for-each-ref', '--format=%(refname) %(objectname) %(symref)'], cwd })

const archivedRefs = async ({ extracted, cwd }: { extracted: string; cwd: string }): Promise<string> => {
  const admin = join(extracted, 'git')
  const head = await readFile(join(extracted, 'trees', 'main', 'git-state', 'HEAD'), 'utf8')
  const probe = await createScratch()
  const gitDir = join(probe, 'admin')
  await Bun.spawn(['cp', '-R', admin, gitDir]).exited
  await Bun.write(join(gitDir, 'HEAD'), head)
  return git({ args: ['--git-dir', gitDir, 'for-each-ref', '--format=%(refname) %(objectname) %(symref)'], cwd })
}

describe('the admin digest and refs', () => {
  it('does not change when refs are packed, because the logical refs are the same', async () => {
    const made = await fixture()
    const roots = [made.main, made.nested, made.detached]
    const before = await digestGitAdmin({ cwds: roots })
    await git({ args: ['pack-refs', '--all', '--prune'], cwd: made.main })
    expect(await digestGitAdmin({ cwds: roots })).toBe(before)
  })

  it('still notices a changed ref value and a new tag', async () => {
    const made = await fixture()
    const roots = [made.main, made.nested, made.detached]
    const before = await digestGitAdmin({ cwds: roots })
    await git({ args: ['commit', '--allow-empty', '-m', 'move'], cwd: made.nested })
    const moved = await digestGitAdmin({ cwds: roots })
    expect(moved).not.toBe(before)
    await git({ args: ['tag', 'v3'], cwd: made.main })
    expect(await digestGitAdmin({ cwds: roots })).not.toBe(moved)
  })
})

describe('capturing while refs are packed or changed', () => {
  it('succeeds when pack-refs runs during packing and archives exactly the logical refs', async () => {
    const made = await fixture()
    const expected = await refsOf(made.main)
    const { extracted } = await captureWhileTarRuns({
      cwd: made.main,
      command: `git -C ${quoted(made.main)} pack-refs --all --prune`,
    })
    expect(await archivedRefs({ extracted, cwd: made.main })).toBe(expected)
    expect(await refsOf(made.main)).toBe(expected)
  })

  it('archives packed source refs from a canonical snapshot, not the raw packed-refs file', async () => {
    const made = await fixture()
    await git({ args: ['pack-refs', '--all'], cwd: made.main })
    await git({ args: ['branch', 'loose-after-pack'], cwd: made.main })
    const expected = await refsOf(made.main)
    const { extracted } = await captureWhileTarRuns({ cwd: made.main, command: 'true' })
    expect(await archivedRefs({ extracted, cwd: made.main })).toBe(expected)
    expect((await readdir(join(extracted, 'git', 'refs', 'heads'))).sort()).toEqual([])
    expect(await readFile(join(extracted, 'git', 'packed-refs'), 'utf8')).toContain('refs/heads/loose-after-pack')
  })

  it('preserves symbolic refs', async () => {
    const made = await fixture()
    await git({ args: ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], cwd: made.main }).catch(() => '')
    await git({ args: ['update-ref', 'refs/remotes/origin/main', 'HEAD'], cwd: made.main })
    await git({ args: ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], cwd: made.main })
    const expected = await refsOf(made.main)
    expect(expected).toContain('refs/remotes/origin/HEAD')
    const { extracted } = await captureWhileTarRuns({ cwd: made.main, command: 'true' })
    expect(await archivedRefs({ extracted, cwd: made.main })).toBe(expected)
  })

  it('refuses when an existing branch moves during packing', async () => {
    const made = await fixture()
    const other = await git({ args: ['commit-tree', '-m', 'elsewhere', 'HEAD^{tree}'], cwd: made.main })
    await expect(
      captureWhileTarRuns({
        cwd: made.main,
        command: `git -C ${quoted(made.main)} update-ref refs/heads/side ${other}`,
      }),
    ).rejects.toThrow('changed while it was being captured')
  })

  it('refuses when a tag is created during packing', async () => {
    const made = await fixture()
    await expect(
      captureWhileTarRuns({
        cwd: made.main,
        command: `git -C ${quoted(made.main)} update-ref refs/tags/created-during-capture HEAD`,
      }),
    ).rejects.toThrow('changed while it was being captured')
  })

  it('does not leave a raw refs directory mount or write to the source refs', async () => {
    const made = await fixture()
    const before = await refsOf(made.main)
    const out = await createScratch()
    await captureWorkspaceArchive({ cwd: made.main, destination: join(out, 'a.tar.gz') })
    expect(await refsOf(made.main)).toBe(before)
  })
})
