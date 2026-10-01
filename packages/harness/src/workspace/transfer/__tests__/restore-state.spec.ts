import { afterAll, describe, expect, it } from 'bun:test'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { plainReceiptPath, readPlainWorkspaceReceipt } from '../plain-receipt'
import { ETarEntryKind, tarEntries } from '../../../execution/image/tar'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import { archiveOf, cleanup, commitAll, fixture, git, refOf, scratch, status } from './restore-fixture'

afterAll(cleanup)

const cloudRestore = async ({ archivePath }: { archivePath: string }) => {
  const destination = join(await scratch(), 'cloud')
  const restored = await restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Cloud })
  return { destination, restored }
}

const withSubmodule = async () => {
  const made = await fixture()
  const upstream = join(await scratch(), 'upstream')
  await mkdir(upstream)
  await git({ args: ['init', '-b', 'main'], cwd: upstream })
  await writeFile(join(upstream, 'lib.txt'), 'lib\n')
  await commitAll(upstream, 'lib')
  await git({ args: ['-c', 'protocol.file.allow=always', 'submodule', 'add', upstream, 'vendor/lib'], cwd: made.main })
  await git({ args: ['commit', '-m', 'add submodule'], cwd: made.main })
  await writeFile(join(made.main, 'vendor', 'lib', 'dirty.txt'), 'dirty\n')
  return made
}

describe('submodules', () => {
  it('relocates the module admin and keeps the working pointer valid', async () => {
    const made = await withSubmodule()
    const { archivePath } = await archiveOf({ cwd: made.main })
    const { destination } = await cloudRestore({ archivePath })
    const sub = join(destination, 'vendor', 'lib')
    expect(await git({ args: ['submodule', 'status'], cwd: destination })).toContain('vendor/lib')
    expect(await status(sub)).toBe('?? dirty.txt')
  })

  it('remaps absolute module pointers and still verifies the whole tree', async () => {
    const made = await withSubmodule()
    const module = join(made.main, '.git', 'modules', 'vendor', 'lib')
    await writeFile(join(made.main, 'vendor', 'lib', '.git'), `gitdir: ${module}\n`)
    await git({ args: ['config', '--file', join(module, 'config'), 'core.worktree', join(made.main, 'vendor', 'lib')], cwd: made.main })
    const { archivePath } = await archiveOf({ cwd: made.main })
    const { destination } = await cloudRestore({ archivePath })
    const sub = join(destination, 'vendor', 'lib')
    const newModule = join(destination, '.git', 'modules', 'vendor', 'lib')

    expect(await readFile(join(sub, '.git'), 'utf8')).toBe(`gitdir: ${newModule}\n`)
    expect(await git({ args: ['config', '--file', join(newModule, 'config'), 'core.worktree'], cwd: destination })).toBe(sub)
    expect(await status(sub)).toBe('?? dirty.txt')
  })
})

describe('plain folders keep their provenance outside the tree', () => {
  it('writes a sibling receipt and reuses the original folder on the way back', async () => {
    const source = join(await scratch(), 'plain')
    await mkdir(source)
    await writeFile(join(source, 'a.txt'), 'a\n')
    const lifted = await archiveOf({ cwd: source })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: lifted.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })

    const receipt = await readPlainWorkspaceReceipt({ path: await plainReceiptPath({ root: cloud }) })
    expect(receipt).toMatchObject({ originPath: source, baseline: lifted.manifest.trees[0]?.fingerprint })
    expect(await readdir(cloud)).toEqual(['a.txt'])

    await writeFile(join(cloud, 'b.txt'), 'b\n')
    const back = await archiveOf({ cwd: cloud })
    expect(back.manifest.trees[0]?.baseline).toBe(lifted.manifest.trees[0]?.fingerprint)

    const restored = await restoreWorkspaceArchive({ archivePath: back.archivePath, destination: source, mode: EWorkspaceRestoreMode.Host, suffix: () => 'ee11' })
    expect(restored.cwd).toBe(source)
    expect(await readFile(join(source, 'b.txt'), 'utf8')).toBe('b\n')
    expect((await readPlainWorkspaceReceipt({ path: await plainReceiptPath({ root: source }) }))?.baseline).toBeTruthy()
  })

  it('sets a diverged original aside instead of overwriting it', async () => {
    const source = join(await scratch(), 'plain')
    await mkdir(source)
    await writeFile(join(source, 'a.txt'), 'a\n')
    const lifted = await archiveOf({ cwd: source })
    const cloud = join(await scratch(), 'cloud')
    await restoreWorkspaceArchive({ archivePath: lifted.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    await writeFile(join(cloud, 'b.txt'), 'b\n')
    const back = await archiveOf({ cwd: cloud })
    await writeFile(join(source, 'host.txt'), 'host\n')

    const restored = await restoreWorkspaceArchive({ archivePath: back.archivePath, destination: source, mode: EWorkspaceRestoreMode.Host, suffix: () => 'ee22' })
    expect(restored.cwd).toBe(`${source}-ee22`)
    expect((await readdir(source)).sort()).toEqual(['a.txt', 'host.txt'])
  })
})

describe('archive paths on case-insensitive volumes', () => {
  it('rejects names that differ only by case when the destination folds them', async () => {
    const parent = await scratch()
    const manifest = new TextEncoder().encode(JSON.stringify({
      version: 1, repository: null, activeId: 'main', activeRelativePath: '',
      trees: [{ id: 'main', name: 'main', sourcePath: '/x', originPath: '/x', branch: null, head: null, baseline: null, fingerprint: 'f', isMain: true }],
    }))
    const archivePath = join(parent, 'folded.tar')
    await writeFile(archivePath, tarEntries({ entries: [
      { name: 'manifest.json', body: manifest },
      { name: 'trees/main/files/Readme.md', body: new Uint8Array(1) },
      { name: 'trees/main/files/README.md', kind: ETarEntryKind.File, body: new Uint8Array(1) },
    ] }))
    const folded = (await import('../restore-archive')).scanWorkspaceArchive({ archivePath, caseInsensitive: true })
    await expect(folded).rejects.toThrow(/case-insensitive/)
    await expect((await import('../restore-archive')).scanWorkspaceArchive({ archivePath, caseInsensitive: false })).resolves.toBeDefined()
  })
})

const hostRestore = (args: { archivePath: string; destination: string; hex?: string }) =>
  restoreWorkspaceArchive({ archivePath: args.archivePath, destination: args.destination, mode: EWorkspaceRestoreMode.Host, suffix: () => args.hex ?? 'abcd' })

describe('git state that must survive the move', () => {
  it('restores a rebase paused on a conflict with its unmerged index', async () => {
    const made = await fixture()
    const repo = made.main
    await git({ args: ['stash', 'push', '-u'], cwd: repo })
    await writeFile(join(repo, 'c.txt'), 'base\n')
    await commitAll(repo, 'base')
    await git({ args: ['checkout', '-q', '-b', 'topic'], cwd: repo })
    await writeFile(join(repo, 'c.txt'), 'topic\n')
    await commitAll(repo, 'topic')
    await git({ args: ['checkout', '-q', 'main'], cwd: repo })
    await writeFile(join(repo, 'c.txt'), 'main\n')
    await commitAll(repo, 'main change')
    await git({ args: ['checkout', '-q', 'topic'], cwd: repo })
    await git({ args: ['rebase', 'main'], cwd: repo }).catch(() => undefined)
    expect(await git({ args: ['ls-files', '-u'], cwd: repo })).not.toBe('')

    const { archivePath } = await archiveOf({ cwd: repo })
    const { destination } = await cloudRestore({ archivePath })

    expect(await git({ args: ['ls-files', '-u'], cwd: destination })).toBe(await git({ args: ['ls-files', '-u'], cwd: repo }))
    expect(await readFile(join(destination, 'c.txt'), 'utf8')).toBe(await readFile(join(repo, 'c.txt'), 'utf8'))
    const stateDir = (await git({ args: ['rev-parse', '--git-path', 'rebase-merge'], cwd: destination }))
    expect((await readdir(join(destination, stateDir))).length).toBeGreaterThan(0)
    expect(await readFile(join(destination, stateDir, 'head-name'), 'utf8')).toBe('refs/heads/topic\n')
  })

  it('carries per-worktree config and flags the shared config for it', async () => {
    const made = await fixture()
    await git({ args: ['config', 'extensions.worktreeConfig', 'true'], cwd: made.main })
    await git({ args: ['config', '--worktree', 'user.signingkey', 'ABC123'], cwd: made.nested })
    const { archivePath } = await archiveOf({ cwd: made.main })
    const { destination } = await cloudRestore({ archivePath })
    const nested = join(destination, '.atlas', 'worktrees', 'feat')

    expect(await git({ args: ['config', '--worktree', 'user.signingkey'], cwd: nested })).toBe('ABC123')
    expect(await git({ args: ['config', 'extensions.worktreeConfig'], cwd: destination })).toBe('true')
  })

  it('suffixes a divergent stash and keeps both reflogs', async () => {
    const made = await fixture()
    const cloud = join(await scratch(), 'cloud')
    const first = await archiveOf({ cwd: made.main })
    await restoreWorkspaceArchive({ archivePath: first.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
    await git({ args: ['stash', 'push', '-u', '-m', 'host stash'], cwd: made.main })
    await git({ args: ['stash', 'push', '-u', '-m', 'cloud stash'], cwd: cloud })
    const back = await archiveOf({ cwd: cloud })
    const host = join(await scratch(), 'host')
    await restoreWorkspaceArchive({ archivePath: first.archivePath, destination: host, mode: EWorkspaceRestoreMode.Cloud })
    await git({ args: ['stash', 'push', '-u', '-m', 'host only'], cwd: host })

    await hostRestore({ archivePath: back.archivePath, destination: host, hex: 'c0de' })

    expect(await git({ args: ['stash', 'list'], cwd: host })).toContain('host only')
    expect(await refOf(host, 'refs/stash-c0de')).toBe(await refOf(cloud, 'refs/stash'))
    expect(await readFile(join(host, '.git', 'logs', 'refs', 'stash-c0de'), 'utf8')).toContain('cloud stash')
  })
})

