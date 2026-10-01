import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import type { WorkspaceManifest } from '../manifest'

const scratchRoots: string[] = []

const GIT_IDENTITY = [
  '-c', 'user.name=Fixture',
  '-c', 'user.email=fixture@example.com',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.fsmonitor=false',
] as const

const cleanEnvironment = (): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value
  }
  env['GIT_CONFIG_GLOBAL'] = '/dev/null'
  env['GIT_CONFIG_NOSYSTEM'] = '1'
  return env
}

export async function git({ args, cwd }: { args: readonly string[]; cwd: string }): Promise<string> {
  const proc = Bun.spawn(['git', ...GIT_IDENTITY, ...args], {
    cwd,
    env: cleanEnvironment(),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr}`)
  return stdout.trim()
}

export type Fixture = {
  scratch: string
  main: string
  nested: string
  detached: string
  cleanup: () => Promise<void>
}

export const BINARY_BYTES = new Uint8Array([0, 255, 1, 254, 2, 0, 0, 128, 10, 13])

export async function createScratch(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), 'atlas-capture-')))
  scratchRoots.push(made)
  return made
}

export const cleanupScratches = async (): Promise<void> => {
  await Promise.all(scratchRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
}

export async function untar(archive: string): Promise<string> {
  const target = await createScratch()
  const proc = Bun.spawn(['tar', '-xpzf', archive, '-C', target], { stdout: 'ignore', stderr: 'pipe' })
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text())
  return target
}

export async function capture({
  cwd,
}: {
  cwd: string
}): Promise<{ manifest: WorkspaceManifest; destination: string; extracted: string }> {
  const out = await createScratch()
  const destination = join(out, 'workspace.tar.gz')
  const manifest = await captureWorkspaceArchive({ cwd, destination })
  return { manifest, destination, extracted: await untar(destination) }
}

export async function walk(root: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      found.push(relative(root, full))
      if (entry.isDirectory()) await visit(full)
    }
  }
  await visit(root)
  return found.sort()
}

export async function digestTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  for (const path of await walk(root)) {
    const info = await lstat(join(root, path))
    hash.update(`${path}\0${info.mode}\0`)
    if (info.isFile()) hash.update(await readFile(join(root, path)))
    if (info.isSymbolicLink()) hash.update(await readlink(join(root, path)))
  }
  return hash.digest('hex')
}

export async function createFixture(): Promise<Fixture> {
  const scratch = await createScratch()
  const main = join(scratch, 'repo')
  await mkdir(join(main, 'src'), { recursive: true })
  await mkdir(join(main, 'bin'), { recursive: true })
  await git({ args: ['init', '-b', 'main'], cwd: main })
  await writeFile(join(main, '.gitignore'), 'node_modules/\n*.log\n.atlas/\n')
  await writeFile(join(main, 'README.md'), 'hello\n')
  await writeFile(join(main, 'src', 'app.ts'), 'export const app = 1\n')
  await writeFile(join(main, 'bin', 'run.sh'), '#!/bin/sh\necho run\n')
  await chmod(join(main, 'bin', 'run.sh'), 0o755)
  await writeFile(join(main, 'data.bin'), BINARY_BYTES)
  await symlink('src/app.ts', join(main, 'link-to-app'))
  await writeFile(join(main, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')
  await chmod(join(main, '.git', 'hooks', 'pre-commit'), 0o755)
  await git({ args: ['add', '.'], cwd: main })
  await git({ args: ['commit', '-m', 'initial'], cwd: main })

  const nested = join(main, '.atlas', 'worktrees', 'feat')
  await mkdir(join(main, '.atlas', 'worktrees'), { recursive: true })
  await writeFile(join(main, '.atlas', 'worktrees', '.gitignore'), '*\n')
  await git({ args: ['worktree', 'add', nested, '-b', 'feat'], cwd: main })
  const detached = join(scratch, 'detached')
  await git({ args: ['worktree', 'add', '--detach', detached, 'HEAD'], cwd: main })

  await writeFile(join(main, 'README.md'), 'hello, edited\n')
  await writeFile(join(main, 'staged.txt'), 'staged\n')
  await git({ args: ['add', 'staged.txt'], cwd: main })
  await git({ args: ['update-index', '--split-index'], cwd: main })
  await writeFile(join(main, 'untracked.txt'), 'untracked\n')
  await mkdir(join(main, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(main, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')
  await writeFile(join(main, 'debug.log'), 'ignored\n')
  await symlink('does-not-exist', join(main, 'dangling'))
  await mkdir(join(main, 'empty-dir'))

  await mkdir(join(nested, 'pkg', 'sub'), { recursive: true })
  await writeFile(join(nested, 'feat.txt'), 'feature\n')
  await writeFile(join(nested, 'pkg', 'sub', 'deep.txt'), 'deep\n')
  await git({ args: ['add', 'feat.txt'], cwd: nested })
  await git({ args: ['update-index', '--split-index'], cwd: nested })
  await writeFile(join(nested, 'README.md'), 'nested edit\n')

  await writeFile(join(detached, 'detached-only.txt'), 'only here\n')

  return {
    scratch,
    main,
    nested,
    detached,
    cleanup: () => rm(scratch, { recursive: true, force: true }),
  }
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

export async function captureWhileTarRuns({
  cwd,
  command,
}: {
  cwd: string
  command: string
}): Promise<{ manifest: WorkspaceManifest; extracted: string }> {
  const bins = join(await createScratch(), 'bin')
  await mkdir(bins)
  const found = Bun.spawnSync(['which', 'tar'], { stdout: 'pipe', stderr: 'pipe' })
  const realTar = found.stdout.toString().trim()
  if (found.exitCode !== 0 || realTar.length === 0) throw new Error('tar is required for this test')
  const wrapper = join(bins, 'tar')
  await writeFile(wrapper, `#!/bin/sh\nif [ "$1" = "--no-recursion" ]; then ${command}; fi\nexec ${shellQuote(realTar)} "$@"\n`)
  await chmod(wrapper, 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bins}:${path ?? ''}`
  try {
    const out = await createScratch()
    const destination = join(out, 'workspace.tar.gz')
    const manifest = await captureWorkspaceArchive({ cwd, destination })
    return { manifest, extracted: await untar(destination) }
  } finally {
    if (path === undefined) delete process.env.PATH
    else process.env.PATH = path
  }
}

export const quoted = shellQuote
