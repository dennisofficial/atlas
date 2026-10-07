import { afterEach, describe, expect, it } from 'bun:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import type { RestoredFamily, WorkspaceFamilyCapture } from '../manifest'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import { cleanupScratches, createFamilyFixture, createScratch, git, MEMBERS, type FamilyFixture } from './family-fixture'

afterEach(cleanupScratches)

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const familyOf = ({ restored }: { restored: RestoredFamily }): WorkspaceFamilyCapture => ({
  rootId: restored.rootId,
  checkouts: restored.checkouts,
  threads: restored.threads.map((thread) => ({
    threadId: thread.threadId,
    home: thread.home,
    active: thread.active === null ? null : { ...thread.active, base: thread.active.base ?? undefined },
  })),
})

const archive = async ({ cwd, family }: { cwd: string; family: WorkspaceFamilyCapture }) => {
  const archivePath = join(await createScratch(), 'workspace.tar.gz')
  const manifest = await captureWorkspaceArchive({ cwd, destination: archivePath, family })
  return { archivePath, manifest }
}

const observe = async (cwd: string): Promise<Record<string, string>> => ({
  status: await git({ args: ['status', '--porcelain=v1', '-uall'], cwd }),
  diff: await git({ args: ['diff'], cwd }),
  cached: await git({ args: ['diff', '--cached'], cwd }),
  stage: await git({ args: ['ls-files', '--stage'], cwd }),
  head: await git({ args: ['rev-parse', 'HEAD'], cwd }),
  branch: await git({ args: ['symbolic-ref', '--short', 'HEAD'], cwd }),
  log: await git({ args: ['log', '--format=%H %s'], cwd }),
  bisect: await git({ args: ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/bisect', 'refs/worktree'], cwd }),
  readme: await readFile(join(cwd, 'README.md'), 'utf8'),
})

const everyTree = (made: FamilyFixture): string[] => [made.main, ...MEMBERS.map((member) => made.checkouts[member].path)]

const registered = async (cwd: string): Promise<string[]> =>
  (await git({ args: ['worktree', 'list', '--porcelain'], cwd }))
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))

describe('a six-checkout family round trip', () => {
  it('lifts to the cloud and descends back with exact trees, refs and mappings', async () => {
    const made = await createFamilyFixture()
    const before = await Promise.all(everyTree(made).map(observe))
    const unrelatedBefore = await observe(made.unrelated)
    const nestedBefore = await observe(made.nestedUnrelated)
    const lifted = await archive({ cwd: made.checkouts.a.path, family: made.family })
    const cloud = join(await createScratch(), 'cloud')

    const restored = await restoreWorkspaceArchive({ archivePath: lifted.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })

    const family = restored.family
    if (family === undefined) throw new Error('restore dropped the family')
    const cloudPathOf = (source: string): string => restored.trees.find((tree) => tree.sourcePath === source)?.path ?? 'missing'
    expect(restored.trees).toHaveLength(6)
    expect((await registered(cloud)).sort()).toEqual(restored.trees.map((tree) => tree.path).sort())
    expect(await git({ args: ['branch', '--list', 'unrelated-branch', 'nested-unrelated'], cwd: cloud })).toBe('')
    expect(family.rootId).toBe('root')
    expect(family.checkouts.map((entry) => entry.path).sort()).toEqual(MEMBERS.map((member) => cloudPathOf(made.checkouts[member].path)).sort())
    const thread = (id: string) => family.threads.find((entry) => entry.threadId === id)
    expect(thread('root')).toEqual({ threadId: 'root', home: cloud, active: null })
    expect(thread('t-d')).toEqual({ threadId: 't-d', home: cloud, active: null })
    expect(thread('t-c')).toEqual({
      threadId: 't-c',
      home: join(cloudPathOf(made.checkouts.c.path), 'pkg', 'sub'),
      active: { path: cloudPathOf(made.checkouts.c.path), branch: 'br-c', base: null, adopted: true },
    })
    expect(thread('t-e')?.active).toEqual({ path: cloudPathOf(made.checkouts.e.path), branch: 'br-e', base: 'main', adopted: false })
    expect(thread('t-a-again')?.home).toBe(cloudPathOf(made.checkouts.a.path))

    const cloudTrees = everyTree(made).map(cloudPathOf)
    for (const [index, path] of cloudTrees.entries()) expect(await observe(path)).toEqual(before[index] ?? {})
    for (const member of MEMBERS) {
      const path = cloudPathOf(made.checkouts[member].path)
      expect(await exists(join(path, `skip-${member}.env`))).toBe(false)
      expect(await exists(join(path, `keep-${member}.cache`))).toBe(made.checkouts[member].keepsCache)
    }
    await git({ args: ['fsck', '--no-dangling'], cwd: cloud })

    await writeFile(join(cloudPathOf(made.checkouts.b.path), 'from-cloud.txt'), 'cloud edit\n')
    const back = await archive({ cwd: cloud, family: familyOf({ restored: family }) })
    expect(back.manifest.family?.checkouts.map((entry) => entry.treeId).sort()).toEqual(lifted.manifest.family?.checkouts.map((entry) => entry.treeId).sort())
    expect(back.manifest.trees).toHaveLength(6)

    const descended = await restoreWorkspaceArchive({ archivePath: back.archivePath, destination: made.main, mode: EWorkspaceRestoreMode.Host })

    expect(descended.trees.map((tree) => tree.path).sort()).toEqual(everyTree(made).sort())
    expect(descended.family?.checkouts.map((entry) => entry.path).sort()).toEqual(MEMBERS.map((member) => made.checkouts[member].path).sort())
    expect(descended.family?.threads.find((entry) => entry.threadId === 't-c')?.home).toBe(join(made.checkouts.c.path, 'pkg', 'sub'))
    expect(await readFile(join(made.checkouts.b.path, 'from-cloud.txt'), 'utf8')).toBe('cloud edit\n')
    for (const [index, path] of everyTree(made).entries()) {
      const { status: _status, ...after } = await observe(path)
      const { status: _before, ...expected } = before[index] ?? {}
      expect(after).toEqual(expected)
    }
    expect(await observe(made.unrelated)).toEqual(unrelatedBefore)
    expect(await observe(made.nestedUnrelated)).toEqual(nestedBefore)
    expect(await readFile(join(made.unrelated, 'untracked-unrelated.txt'), 'utf8')).toBe('dirty\n')
    expect(await registered(made.main)).toContain(made.unrelated)
    await git({ args: ['fsck', '--no-dangling'], cwd: made.main })
  })
})
