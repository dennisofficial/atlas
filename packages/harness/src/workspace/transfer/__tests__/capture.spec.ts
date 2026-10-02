import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:net'
import { chmod, lstat, mkdir, readdir, readFile, readlink, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { workspaceManifestSchema, type WorkspaceManifest } from '../manifest'
import {
  BINARY_BYTES,
  capture,
  cleanupScratches,
  createFixture,
  createScratch,
  git,
  walk,
  type Fixture,
} from './capture-fixture'

const fixtures: Fixture[] = []
const servers: Server[] = []

const fixture = async (): Promise<Fixture> => {
  const made = await createFixture()
  fixtures.push(made)
  return made
}

const scratch = createScratch

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))))
})

afterAll(async () => {
  await Promise.all(fixtures.map((made) => made.cleanup()))
  await cleanupScratches()
})

const treeNamed = ({ manifest, name }: { manifest: WorkspaceManifest; name: string }) => {
  const tree = manifest.trees.find((candidate) => candidate.name === name)
  if (tree === undefined) throw new Error(`no tree named ${name}`)
  return tree
}

describe('captureWorkspaceArchive', () => {
  it('captures every worktree with complete physical files', async () => {
    const made = await fixture()
    const { manifest, extracted } = await capture({ cwd: made.main })

    expect(workspaceManifestSchema.parse(manifest)).toEqual(manifest)
    expect(manifest.version).toBe(1)
    expect(manifest.repository).toEqual({ sourcePath: made.main, originPath: made.main })
    expect(manifest.trees).toHaveLength(3)

    const main = treeNamed({ manifest, name: 'main' })
    const nested = treeNamed({ manifest, name: 'feat' })
    const detached = treeNamed({ manifest, name: 'detached' })
    expect(main).toMatchObject({ id: 'main', isMain: true, branch: 'main', sourcePath: made.main })
    expect(nested).toMatchObject({ isMain: false, branch: 'feat', sourcePath: made.nested })
    expect(detached).toMatchObject({ isMain: false, branch: null })
    expect(detached.head).toBe(await git({ args: ['rev-parse', 'HEAD'], cwd: made.detached }))
    expect(new Set(manifest.trees.map((tree) => tree.id)).size).toBe(3)
    expect(manifest.activeId).toBe('main')
    expect(manifest.activeRelativePath).toBe('')
    expect(manifest.trees.every((tree) => tree.baseline === null)).toBe(true)

    const files = join(extracted, 'trees', main.id, 'files')
    expect(await readFile(join(files, 'README.md'), 'utf8')).toBe('hello, edited\n')
    expect(await readFile(join(files, 'staged.txt'), 'utf8')).toBe('staged\n')
    expect(await readFile(join(files, 'untracked.txt'), 'utf8')).toBe('untracked\n')
    expect(await readFile(join(files, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(await readFile(join(files, 'debug.log'), 'utf8')).toBe('ignored\n')
    expect(new Uint8Array(await readFile(join(files, 'data.bin')))).toEqual(BINARY_BYTES)
    expect((await stat(join(files, 'bin', 'run.sh'))).mode & 0o111).not.toBe(0)
    expect(await readlink(join(files, 'link-to-app'))).toBe('src/app.ts')
    expect(await readlink(join(files, 'dangling'))).toBe('does-not-exist')
    expect((await lstat(join(files, 'empty-dir'))).isDirectory()).toBe(true)

    const mainPaths = await walk(files)
    expect(mainPaths.filter((path) => path === '.git' || path.startsWith('.git/'))).toEqual([])
    expect(mainPaths.filter((path) => path.startsWith('.atlas/worktrees/feat'))).toEqual([])
    expect(mainPaths).toContain('.atlas/worktrees/.gitignore')

    const nestedFiles = join(extracted, 'trees', nested.id, 'files')
    expect(await readFile(join(nestedFiles, 'pkg', 'sub', 'deep.txt'), 'utf8')).toBe('deep\n')
    expect(await readFile(join(nestedFiles, 'README.md'), 'utf8')).toBe('nested edit\n')
    expect((await walk(nestedFiles)).filter((path) => path === '.git')).toEqual([])
    expect(await readFile(join(extracted, 'trees', detached.id, 'files', 'detached-only.txt'), 'utf8')).toBe('only here\n')
  })

  it('archives common git admin and per-tree indexes without registrations or locks', async () => {
    const made = await fixture()
    await writeFile(join(made.main, '.git', 'index.lock'), '')
    await writeFile(join(made.main, '.git', 'atlas-transfer.json'), JSON.stringify({ version: 1, repositoryOrigin: '/x', trees: [] }))
    const { manifest, extracted } = await capture({ cwd: made.main })

    const gitRoot = join(extracted, 'git')
    const adminPaths = await walk(gitRoot)
    expect(adminPaths).toContain('objects')
    expect(adminPaths).toContain('refs/heads')
    expect(await readFile(join(gitRoot, 'packed-refs'), 'utf8')).toContain('refs/heads/feat')
    expect(adminPaths).toContain('config')
    expect(adminPaths).toContain('logs/HEAD')
    expect(adminPaths.some((path) => path.startsWith('worktrees'))).toBe(false)
    expect(adminPaths.some((path) => path.endsWith('.lock'))).toBe(false)
    expect(adminPaths).not.toContain('atlas-transfer.json')
    expect((await stat(join(gitRoot, 'hooks', 'pre-commit'))).mode & 0o111).not.toBe(0)
    expect(adminPaths.some((path) => path.startsWith('sharedindex.'))).toBe(true)

    for (const tree of manifest.trees) {
      const sourceGitDir = await git({ args: ['rev-parse', '--absolute-git-dir'], cwd: tree.sourcePath })
      const archived = new Uint8Array(await readFile(join(extracted, 'trees', tree.id, 'index')))
      expect(archived).toEqual(new Uint8Array(await readFile(join(sourceGitDir, 'index'))))
    }
    const nested = treeNamed({ manifest, name: 'feat' })
    const nestedAdmin = await walk(join(extracted, 'trees', nested.id, 'git-state'))
    expect(nestedAdmin.some((path) => path.startsWith('sharedindex.'))).toBe(true)
    expect(nestedAdmin).toContain('HEAD')
    expect(nestedAdmin).not.toContain('commondir')
    expect(nestedAdmin).not.toContain('gitdir')
    expect(nestedAdmin).not.toContain('index')
  })

  it('records the active tree and relative path from the requested cwd', async () => {
    const made = await fixture()
    const { manifest } = await capture({ cwd: join(made.nested, 'pkg', 'sub') })
    expect(manifest.activeId).toBe(treeNamed({ manifest, name: 'feat' }).id)
    expect(manifest.activeRelativePath).toBe('pkg/sub')
  })

  it('takes ids, origin paths and baselines from an existing receipt without fingerprinting it', async () => {
    const made = await fixture()
    const receiptPath = join(made.main, '.git', 'atlas-transfer.json')
    const receipt = {
      version: 1,
      repositoryOrigin: '/host/repo',
      trees: [
        { id: 'tree_main', path: made.main, originPath: '/host/repo', baseline: 'base-main' },
        { id: 'tree_feat', path: made.nested, originPath: '/host/repo/.atlas/worktrees/feat', baseline: 'base-feat' },
      ],
    }
    await writeFile(receiptPath, JSON.stringify(receipt))
    const first = await capture({ cwd: made.main })
    expect(first.manifest.repository).toEqual({ sourcePath: made.main, originPath: '/host/repo' })
    expect(treeNamed({ manifest: first.manifest, name: 'main' })).toMatchObject({ id: 'tree_main', originPath: '/host/repo', baseline: 'base-main', isMain: true })
    expect(treeNamed({ manifest: first.manifest, name: 'feat' })).toMatchObject({ id: 'tree_feat', originPath: '/host/repo/.atlas/worktrees/feat', baseline: 'base-feat' })
    expect(treeNamed({ manifest: first.manifest, name: 'detached' })).toMatchObject({ baseline: null, originPath: made.detached })

    await writeFile(receiptPath, JSON.stringify({ ...receipt, repositoryOrigin: '/elsewhere' }))
    const second = await capture({ cwd: made.main })
    expect(treeNamed({ manifest: second.manifest, name: 'main' }).fingerprint).toBe(treeNamed({ manifest: first.manifest, name: 'main' }).fingerprint)
  })

  it('assigns fresh ids that stay stable across captures', async () => {
    const made = await fixture()
    const first = await capture({ cwd: made.main })
    const second = await capture({ cwd: made.detached })
    expect(second.manifest.trees.map((tree) => tree.id).sort()).toEqual(first.manifest.trees.map((tree) => tree.id).sort())
    expect(second.manifest.activeId).toBe(treeNamed({ manifest: second.manifest, name: 'detached' }).id)
  })

  it('refuses sockets loudly and leaves no archive behind', async () => {
    const made = await fixture()
    const socketPath = join(made.main, 'a.sock')
    const server = createServer()
    servers.push(server)
    await new Promise<void>((ready) => server.listen(socketPath, ready))
    const out = await scratch()
    const destination = join(out, 'workspace.tar.gz')

    await expect(captureWorkspaceArchive({ cwd: made.main, destination })).rejects.toThrow(/a\.sock/)
    expect(await readdir(out)).toEqual([])
  })

  it('preserves directory and file permission bits', async () => {
    const made = await fixture()
    await chmod(join(made.main, 'empty-dir'), 0o750)
    await chmod(join(made.main, 'README.md'), 0o640)
    const { extracted } = await capture({ cwd: made.main })
    const files = join(extracted, 'trees', 'main', 'files')
    expect((await stat(join(files, 'empty-dir'))).mode & 0o777).toBe(0o750)
    expect((await stat(join(files, 'README.md'))).mode & 0o777).toBe(0o640)
  })

  it('archives a completely empty directory as a real directory entry', async () => {
    const dir = await scratch()
    const { extracted } = await capture({ cwd: dir })
    const files = join(extracted, 'trees', 'main', 'files')
    expect((await lstat(files)).isDirectory()).toBe(true)
    expect(await readdir(files)).toEqual([])
  })

  it('captures nested repositories and submodule git files as ordinary data', async () => {
    const made = await fixture()
    await mkdir(join(made.main, 'vendor', 'lib'), { recursive: true })
    await git({ args: ['init', '-b', 'main'], cwd: join(made.main, 'vendor', 'lib') })
    await writeFile(join(made.main, 'vendor', 'lib', 'x.txt'), 'x\n')
    const { extracted } = await capture({ cwd: made.main })
    const nested = join(extracted, 'trees', 'main', 'files', 'vendor', 'lib')
    expect((await stat(join(nested, '.git', 'HEAD'))).isFile()).toBe(true)
    expect(await readFile(join(nested, 'x.txt'), 'utf8')).toBe('x\n')
  })

  it('refuses a destination inside a captured tree', async () => {
    const made = await fixture()
    await expect(captureWorkspaceArchive({ cwd: made.main, destination: join(made.main, 'out.tar.gz') })).rejects.toThrow(/inside/)
  })

  it('captures a directory that is not a git repository as one tree', async () => {
    const dir = await scratch()
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'x.txt'), 'x\n')
    await chmod(join(dir, 'sub', 'x.txt'), 0o755)
    const { manifest, extracted } = await capture({ cwd: join(dir, 'sub') })

    expect(manifest.repository).toBeNull()
    expect(manifest.trees).toHaveLength(1)
    expect(manifest.trees[0]).toMatchObject({ id: 'main', name: 'main', isMain: true, branch: null, head: null, sourcePath: join(dir, 'sub') })
    expect(manifest.activeId).toBe('main')
    expect(manifest.activeRelativePath).toBe('')
    expect((await readdir(extracted)).sort()).toEqual(['manifest.json', 'trees'])
    expect(await readFile(join(extracted, 'trees', 'main', 'files', 'x.txt'), 'utf8')).toBe('x\n')
  })
})
