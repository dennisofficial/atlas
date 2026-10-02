import { afterAll, describe, expect, it } from 'bun:test'
import { link, mkdir, readdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ETarEntryKind, tarEntries, type TarEntry } from '../../../execution/image/tar'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import { archiveOf, cleanup, fixture, scratch } from './restore-fixture'

afterAll(cleanup)

const manifestEntry = (): TarEntry => ({
  name: 'manifest.json',
  body: new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      repository: null,
      activeId: 'main',
      activeRelativePath: '',
      trees: [{ id: 'main', name: 'x', sourcePath: '/x', originPath: '/x', branch: null, head: null, baseline: null, fingerprint: 'f', isMain: true }],
    }),
  ),
})

const forged = async (entries: readonly TarEntry[]): Promise<{ archivePath: string; destination: string; parent: string }> => {
  const parent = await scratch()
  const archivePath = join(parent, 'forged.tar')
  await writeFile(archivePath, tarEntries({ entries: [manifestEntry(), ...entries] }))
  return { archivePath, destination: join(parent, 'dest'), parent }
}

const restoreForged = async (entries: readonly TarEntry[]) => {
  const { archivePath, destination, parent } = await forged(entries)
  const attempt = restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Cloud })
  return { attempt, parent }
}

describe('archive validation', () => {
  it('rejects path traversal before anything is extracted', async () => {
    const { attempt, parent } = await restoreForged([{ name: 'trees/main/files/../../../../escape.txt', body: new Uint8Array(1) }])
    await expect(attempt).rejects.toThrow(/unsafe path/)
    expect((await readdir(parent)).sort()).toEqual(['forged.tar'])
  })

  it('rejects entries outside the archive layout and absolute paths', async () => {
    await expect((await restoreForged([{ name: 'etc/passwd', body: new Uint8Array(1) }])).attempt).rejects.toThrow(/outside the workspace layout/)
    await expect((await restoreForged([{ name: '/trees/main/files/a', body: new Uint8Array(1) }])).attempt).rejects.toThrow(/unsafe path/)
  })

  it('rejects an entry that is reached through a symbolic link', async () => {
    const { attempt } = await restoreForged([
      { name: 'trees/main/files/out', kind: ETarEntryKind.Symlink, linkname: '/tmp' },
      { name: 'trees/main/files/out/pwned.txt', body: new Uint8Array(1) },
    ])
    await expect(attempt).rejects.toThrow(/non-directory/)
  })

  it('rejects a symbolic link that replaces a directory holding entries', async () => {
    const { attempt } = await restoreForged([
      { name: 'trees/main/files/dir/file.txt', body: new Uint8Array(1) },
      { name: 'trees/main/files/dir', kind: ETarEntryKind.Symlink, linkname: '/tmp' },
    ])
    await expect(attempt).rejects.toThrow(/replaces a directory/)
  })

  it('rejects registrations, alternates and a nested root .git', async () => {
    for (const name of ['git/worktrees/x/gitdir', 'git/objects/info/alternates', 'trees/main/files/.git/config']) {
      await expect((await restoreForged([{ name, body: new Uint8Array(1) }])).attempt).rejects.toThrow(/layout/)
    }
  })

  it('rejects hard links that point outside their own tree or at nothing', async () => {
    await expect(
      (await restoreForged([{ name: 'trees/main/files/a', body: new Uint8Array(1) }, { name: 'trees/main/files/b', kind: '1' as ETarEntryKind, linkname: '../../../x' }])).attempt,
    ).rejects.toThrow(/unsafe path|hard link/)
    await expect(
      (await restoreForged([{ name: 'trees/main/files/b', kind: '1' as ETarEntryKind, linkname: 'trees/main/files/missing' }])).attempt,
    ).rejects.toThrow(/hard link/)
  })

  it('keeps symbolic links as data, including ones that point outside', async () => {
    const source = join(await scratch(), 'plain')
    await mkdir(source)
    await symlink('../../../../etc', join(source, 'link'))
    await writeFile(join(source, 'ok.txt'), 'ok')
    const { archivePath } = await archiveOf({ cwd: source })
    const destination = join(await scratch(), 'dest')
    await restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Cloud })
    expect(await readlink(join(destination, 'link'))).toBe('../../../../etc')
    expect(await readFile(join(destination, 'ok.txt'), 'utf8')).toBe('ok')
  })

  it('reports a truncated archive and leaves no staging directory behind', async () => {
    const { archivePath, destination, parent } = await forged([{ name: 'trees/main/files/a', body: new Uint8Array(4000) }])
    await writeFile(archivePath, (await readFile(archivePath)).subarray(0, 900))
    await expect(restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Cloud })).rejects.toThrow()
    expect((await readdir(parent)).sort()).toEqual(['forged.tar'])
  })
})

describe('plain folders and physical files', () => {
  it('restores a folder that is not a repository and picks an alternate name on collision', async () => {
    const source = join(await scratch(), 'plain')
    await mkdir(join(source, 'sub'), { recursive: true })
    await writeFile(join(source, 'sub', 'a.txt'), 'a\n')
    const { archivePath } = await archiveOf({ cwd: join(source, 'sub') })
    const base = await scratch()
    const taken = join(base, 'taken')
    await mkdir(taken)
    await writeFile(join(taken, 'mine.txt'), 'mine\n')

    const restored = await restoreWorkspaceArchive({
      archivePath,
      destination: taken,
      mode: EWorkspaceRestoreMode.Host,
      suffix: () => 'a1b2',
    })

    expect(restored.repository).toBeNull()
    expect(restored.cwd).toBe(`${taken}-a1b2`)
    expect(await readFile(join(taken, 'mine.txt'), 'utf8')).toBe('mine\n')
    expect(await readFile(join(`${taken}-a1b2`, 'a.txt'), 'utf8')).toBe('a\n')
  })

  it('restores physically hard-linked source files with exact bytes', async () => {
    const made = await fixture()
    await link(join(made.main, 'README.md'), join(made.main, 'README-copy.md'))
    const { archivePath } = await archiveOf({ cwd: made.main })
    const destination = join(await scratch(), 'out')
    await restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Cloud })
    expect(await readFile(join(destination, 'README-copy.md'), 'utf8')).toBe('hello, edited\n')
    expect(await readFile(join(destination, 'README.md'), 'utf8')).toBe('hello, edited\n')
  })
})
