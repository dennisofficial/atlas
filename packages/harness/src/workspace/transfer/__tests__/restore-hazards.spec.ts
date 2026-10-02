import { afterAll, describe, expect, it } from 'bun:test'
import { chmod, readdir, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ETarEntryKind, tarEntries, type TarEntry } from '../../../execution/image/tar'
import { fingerprintWorkspaceTree } from '../capture-fingerprint'
import { assertStillReplaceable, DestinationMovedError } from '../restore-destination'
import { scanWorkspaceArchive } from '../restore-archive'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import { archiveOf, cleanup, commitAll, fixture, git, refOf, scratch } from './restore-fixture'

afterAll(cleanup)

const scanOf = async ({ entries, caseInsensitive }: { entries: readonly TarEntry[]; caseInsensitive: boolean }) => {
  const archivePath = join(await scratch(), 'crafted.tar')
  await writeFile(archivePath, tarEntries({ entries }))
  return scanWorkspaceArchive({ archivePath, caseInsensitive })
}

describe('case-folded ancestry in the scanner', () => {
  const entries: TarEntry[] = [
    { name: 'manifest.json', body: new Uint8Array(1) },
    { name: 'trees/main/files/x', kind: ETarEntryKind.Symlink, linkname: '/tmp' },
    { name: 'trees/main/files/X/child.txt', body: new Uint8Array(1) },
  ]

  it('rejects a child that reaches a symbolic link through a differently cased name', async () => {
    await expect(scanOf({ entries, caseInsensitive: true })).rejects.toThrow(/non-directory/)
  })

  it('accepts the same entries where names are case sensitive', async () => {
    await expect(scanOf({ entries, caseInsensitive: false })).resolves.toBeDefined()
  })
})

describe('object import', () => {
  const packsOf = async (repo: string): Promise<string[]> =>
    (await readdir(join(repo, '.git', 'objects', 'pack'))).filter((name) => name.endsWith('.pack'))

  it('repairs a truncated pack left by an interrupted import without losing refs', async () => {
    const made = await fixture()
    await git({ args: ['gc', '-q'], cwd: made.main })
    const first = await archiveOf({ cwd: made.main })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: first.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    await writeFile(join(cloud, 'more.txt'), 'more\n')
    await commitAll(cloud, 'more')
    await git({ args: ['gc', '-q'], cwd: cloud })
    const back = await archiveOf({ cwd: cloud })
    const hostRefBefore = await refOf(made.main, 'refs/heads/feat')
    const ownPacks = new Set(await packsOf(made.main))

    await restoreWorkspaceArchive({ archivePath: back.archivePath, destination: made.main, mode: EWorkspaceRestoreMode.Host, suffix: () => 'a1a1' })
    const imported = (await packsOf(made.main)).filter((pack) => !ownPacks.has(pack))
    expect(imported.length).toBeGreaterThan(0)
    for (const pack of imported) {
      const path = join(made.main, '.git', 'objects', 'pack', pack)
      await chmod(path, 0o644)
      await truncate(path, 10)
    }
    await restoreWorkspaceArchive({ archivePath: back.archivePath, destination: made.main, mode: EWorkspaceRestoreMode.Host, suffix: () => 'b2b2' })

    expect(await refOf(made.main, 'refs/heads/feat')).toBe(hostRefBefore)
    await git({ args: ['fsck', '--no-dangling'], cwd: made.main })
    expect((await readdir(join(made.main, '.git', 'objects', 'pack'))).some((name) => name.includes('.corrupt-'))).toBe(true)
  })
})

describe('destination changed before the originals are touched', () => {
  it('reports the destination as moved when the checkout no longer matches the plan', async () => {
    const made = await fixture()
    const { manifest } = await archiveOf({ cwd: made.main })
    const tree = manifest.trees.find((item) => item.isMain)
    if (tree === undefined) throw new Error('no main tree')
    const baseline = await fingerprintWorkspaceTree({ cwd: made.main, excludedRoots: [made.nested, made.detached] })
    const current = { ...tree, baseline, fingerprint: baseline }

    await assertStillReplaceable({ path: made.main, tree: current, repoCwd: made.main })
    await writeFile(join(made.main, 'typed-meanwhile.txt'), 'new\n')
    await expect(assertStillReplaceable({ path: made.main, tree: current, repoCwd: made.main })).rejects.toBeInstanceOf(DestinationMovedError)
  })
})
