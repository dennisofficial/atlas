import { afterEach, describe, expect, it } from 'bun:test'
import { copyFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { cleanupScratches, createFamilyFixture, createScratch, git, MEMBERS, type FamilyFixture } from './family-fixture'
import { untar } from './capture-fixture'

afterEach(cleanupScratches)

const captureFamily = async ({ made, cwd = made.main }: { made: FamilyFixture; cwd?: string }) => {
  const destination = join(await createScratch(), 'workspace.tar.gz')
  const manifest = await captureWorkspaceArchive({ cwd, destination, family: made.family })
  return { manifest, destination, extracted: await untar(destination) }
}

const inArchive = async ({ extracted, args }: { extracted: string; args: readonly string[] }): Promise<string> => {
  const gitDir = join(extracted, 'git')
  if (!(await exists(join(gitDir, 'HEAD')))) await copyFile(join(extracted, 'trees', 'main', 'git-state', 'HEAD'), join(gitDir, 'HEAD'))
  return git({ args: ['--git-dir', gitDir, ...args], cwd: extracted })
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

describe('capturing a session family', () => {
  it('selects main plus every owned checkout once and leaves unrelated registered checkouts out', async () => {
    const made = await createFamilyFixture()

    const { manifest, extracted } = await captureFamily({ made })

    const paths = manifest.trees.map((tree) => tree.sourcePath).sort()
    expect(paths).toEqual([made.main, ...MEMBERS.map((member) => made.checkouts[member].path)].sort())
    expect(manifest.trees.filter((tree) => tree.isMain)).toHaveLength(1)
    expect(paths).not.toContain(made.unrelated)
    expect(paths).not.toContain(made.nestedUnrelated)
    expect((await readdir(join(extracted, 'trees'))).sort()).toEqual(manifest.trees.map((tree) => tree.id).sort())
    const packedRefs = await inArchive({ extracted, args: ['for-each-ref', '--format=%(refname)'] })
    expect(packedRefs).not.toContain('unrelated-branch')
    expect(packedRefs).not.toContain('nested-unrelated')
    expect(packedRefs).toContain('refs/heads/br-e')
  })

  it('carries per-thread home, active and retained ownership by tree id', async () => {
    const made = await createFamilyFixture()

    const { manifest } = await captureFamily({ made })

    const idOf = (path: string): string => manifest.trees.find((tree) => tree.sourcePath === path)?.id ?? 'missing'
    expect(manifest.family?.rootId).toBe('root')
    expect(manifest.family?.checkouts).toHaveLength(5)
    expect(manifest.family?.checkouts.find((entry) => entry.id === 'chk-b')).toEqual({
      id: 'chk-b',
      treeId: idOf(made.checkouts.b.path),
      claimedBy: 't-b',
    })
    const threads = new Map((manifest.family?.threads ?? []).map((thread) => [thread.threadId, thread]))
    expect(threads.get('root')).toEqual({ threadId: 'root', home: { treeId: 'main', relativePath: '' }, active: null })
    expect(threads.get('t-c')).toEqual({
      threadId: 't-c',
      home: { treeId: idOf(made.checkouts.c.path), relativePath: 'pkg/sub' },
      active: { treeId: idOf(made.checkouts.c.path), base: null, adopted: true },
    })
    expect(threads.get('t-b')?.active).toEqual({ treeId: idOf(made.checkouts.b.path), base: 'main', adopted: false })
    expect(threads.get('t-d')).toEqual({ threadId: 't-d', home: { treeId: 'main', relativePath: '' }, active: null })
    expect(threads.get('t-a-again')?.home.treeId).toBe(idOf(made.checkouts.a.path))
    expect(manifest.family?.threads).toHaveLength(MEMBERS.length + 2)
  })

  it('applies each checkout\'s own ignore and cloudinclude rules', async () => {
    const made = await createFamilyFixture()

    const { manifest, extracted } = await captureFamily({ made })

    for (const member of MEMBERS) {
      const checkout = made.checkouts[member]
      const id = manifest.trees.find((tree) => tree.sourcePath === checkout.path)?.id ?? ''
      const files = join(extracted, 'trees', id, 'files')
      expect(await exists(join(files, `new-${member}.txt`))).toBe(true)
      expect(await exists(join(files, `skip-${member}.env`))).toBe(false)
      expect(await exists(join(files, `keep-${member}.cache`))).toBe(checkout.keepsCache)
    }
    const mainFiles = join(extracted, 'trees', 'main', 'files')
    expect(await exists(join(mainFiles, 'ignored-main.log'))).toBe(false)
    expect(await exists(join(mainFiles, '.atlas', 'worktrees'))).toBe(false)
  })

  it('keeps each checkout\'s private refs distinct and out of the shared admin', async () => {
    const made = await createFamilyFixture()

    const { manifest, extracted } = await captureFamily({ made })

    const idOf = (path: string): string => manifest.trees.find((tree) => tree.sourcePath === path)?.id ?? ''
    const refOf = async (path: string): Promise<string> =>
      (await Bun.file(join(extracted, 'trees', idOf(path), 'git-state', 'refs', 'bisect', 'bad')).text()).trim()
    const b = await refOf(made.checkouts.b.path)
    const c = await refOf(made.checkouts.c.path)
    expect(b).toBe(await git({ args: ['rev-parse', 'refs/bisect/bad'], cwd: made.checkouts.b.path }))
    expect(c).toBe(await git({ args: ['rev-parse', 'refs/bisect/bad'], cwd: made.checkouts.c.path }))
    expect(b).not.toBe(c)
    expect(await exists(join(extracted, 'git', 'refs', 'bisect', 'bad'))).toBe(false)
    expect(await exists(join(extracted, 'git', 'refs', 'bisect', 'main-bad'))).toBe(true)
    const packed = await inArchive({ extracted, args: ['cat-file', '-t', b] })
    expect(packed).toBe('commit')
    expect(await inArchive({ extracted, args: ['cat-file', '-t', c] })).toBe('commit')
  })

  it('packs every checkout\'s staged blobs into one shared pack', async () => {
    const made = await createFamilyFixture()

    const { extracted } = await captureFamily({ made })

    const packs = (await readdir(join(extracted, 'git', 'objects', 'pack'))).filter((name) => name.endsWith('.pack'))
    expect(packs).toHaveLength(1)
    for (const member of MEMBERS) {
      const blob = await git({ args: ['rev-parse', `:staged-${member}.txt`], cwd: made.checkouts[member].path })
      expect(await inArchive({ extracted, args: ['cat-file', '-t', blob] })).toBe('blob')
    }
  })

  it('leaves the legacy main-plus-active capture unchanged without a family', async () => {
    const made = await createFamilyFixture()
    const destination = join(await createScratch(), 'workspace.tar.gz')

    const manifest = await captureWorkspaceArchive({ cwd: made.checkouts.a.path, destination })

    expect(manifest.family).toBeUndefined()
    expect(manifest.trees.map((tree) => tree.sourcePath).sort()).toEqual([made.main, made.checkouts.a.path].sort())
  })
})
