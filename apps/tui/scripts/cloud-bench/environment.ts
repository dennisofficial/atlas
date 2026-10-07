import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { runGit } from '@dltech/atlas-harness'

const canonicalPath = async (path: string): Promise<string> => {
  try {
    return await realpath(path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(await canonicalPath(parent), basename(path))
  }
}

export const assertBenchmarkOutput = async (args: {
  output: string
  protectedRoots: readonly string[]
}): Promise<void> => {
  const output = await canonicalPath(resolve(args.output))
  for (const root of args.protectedRoots) {
    const protectedRoot = await realpath(root)
    const tail = relative(protectedRoot, output)
    if (tail === '' || (tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail)))
      throw new Error(`benchmark output is inside protected source ${protectedRoot}`)
  }
}

export const makeBenchmarkDirectory = async (parent: string): Promise<string> => {
  await mkdir(parent, { recursive: true, mode: 0o700 })
  return mkdtemp(join(resolve(parent), 'cloud-bench-'))
}

const SEED_FILES = ['key', 'auth.json', 'secrets.json', 'settings.json', 'mcp.json', 'ATLAS.md']

export const seedBenchmarkHome = async (args: {
  sourceHome: string
  directory: string
}): Promise<string> => {
  const home = join(args.directory, 'home')
  await mkdir(home, { mode: 0o700 })
  for (const name of SEED_FILES) {
    const source = join(args.sourceHome, name)
    const destination = join(home, name)
    try {
      await copyFile(source, destination, 1)
      await chmod(destination, 0o600)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  await readFile(join(home, 'key'), 'utf8')
  return home
}

export const checkedGit = async (args: {
  cwd: string
  argv: readonly string[]
}): Promise<string> => {
  const result = await runGit({ cwd: args.cwd, args: args.argv })
  if (!result.ok) throw new Error(`benchmark git ${args.argv[0]} failed: ${result.stderr}`)
  return result.stdout.trim()
}

export const prepareBenchmarkWorkspace = async (args: {
  sourceRepository: string
  directory: string
}): Promise<{ repository: string; cwd: string; commit: string }> => {
  const repository = join(args.directory, 'atlas')
  await checkedGit({
    cwd: args.directory,
    argv: [
      'clone',
      '--no-hardlinks',
      '--single-branch',
      '--branch',
      'main',
      args.sourceRepository,
      repository,
    ],
  })
  const remote = await checkedGit({
    cwd: args.sourceRepository,
    argv: ['remote', 'get-url', 'origin'],
  })
  if (/@/.test(remote.replace(/^[^:]+@/, '').split('/')[0] ?? '')) {
    throw new Error(
      'the source repository remote carries credentials in its URL; refusing to copy it into benchmark artifacts',
    )
  }
  await checkedGit({
    cwd: repository,
    argv: ['remote', 'set-url', 'origin', remote],
  })
  const worktrees = join(repository, '.atlas', 'worktrees')
  await mkdir(worktrees, { recursive: true })
  await writeFile(join(worktrees, '.gitignore'), '*\n', { flag: 'wx' })
  const cwd = join(worktrees, 'cloud-bench')
  await checkedGit({
    cwd: repository,
    argv: ['worktree', 'add', cwd, '-b', 'bench/cloud-lift', 'main'],
  })
  const readme = join(cwd, 'README.md')
  const original = await readFile(readme, 'utf8')
  await writeFile(readme, `${original}\nBenchmark staged sentinel.\n`)
  await checkedGit({ cwd, argv: ['add', 'README.md'] })
  await writeFile(readme, `${original}\nBenchmark staged sentinel.\nBenchmark unstaged sentinel.\n`)
  await writeFile(join(cwd, 'cloud-bench-untracked.txt'), 'Benchmark untracked sentinel.\n', {
    flag: 'wx',
  })
  return {
    repository,
    cwd,
    commit: await checkedGit({ cwd, argv: ['rev-parse', 'HEAD'] }),
  }
}

export const defaultSourceHome = (): string => process.env.ATLAS_HOME ?? join(homedir(), '.atlas')
