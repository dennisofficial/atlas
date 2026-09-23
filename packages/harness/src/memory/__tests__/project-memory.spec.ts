import { describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sanitiseRepoPath } from '@dltech/atlas-core'

import { runGit } from '../../workspace/run-git'
import { resolveProjectMemory } from '../project-memory'

const freshDirectory = async (prefix: string): Promise<string> =>
  realpath(await mkdtemp(join(tmpdir(), prefix)))

const initRepoWithOrigin = async (args: { origin: string }): Promise<string> => {
  const repo = await freshDirectory('atlas-memory-repo-')
  await runGit({ args: ['init', '--initial-branch=main'], cwd: repo })
  await runGit({ args: ['remote', 'add', 'origin', args.origin], cwd: repo })
  return repo
}

const writeLegacy = async (args: {
  atlasHome: string
  repoPath: string
  name: string
  content: string
}): Promise<string> => {
  const directory = join(
    args.atlasHome,
    'projects',
    sanitiseRepoPath(args.repoPath),
    'memory',
  )
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, args.name), args.content, 'utf8')
  return directory
}

describe('resolveProjectMemory', () => {
  it('keeps the path key for a directory that is no git repo', async () => {
    const atlasHome = await freshDirectory('atlas-memory-home-')
    const repoRoot = await freshDirectory('atlas-memory-plain-')

    const resolved = await resolveProjectMemory({ atlasHome, repoRoot })

    expect(resolved.identity).toBeNull()
    expect(resolved.directories.project).toBe(
      join(atlasHome, 'projects', sanitiseRepoPath(repoRoot), 'memory'),
    )
  })

  it('keys by the normalized origin identity for a repo with a remote', async () => {
    const atlasHome = await freshDirectory('atlas-memory-home-')
    const repoRoot = await initRepoWithOrigin({ origin: 'git@github.com:dennisofficial/atlas.git' })

    const resolved = await resolveProjectMemory({ atlasHome, repoRoot })

    expect(resolved.identity).toBe('github.com/dennisofficial/atlas')
    expect(resolved.directories.project).toBe(
      join(atlasHome, 'projects', 'github.com', 'dennisofficial', 'atlas', 'memory'),
    )
  })

  it('adopts a single legacy path-keyed directory by moving it', async () => {
    const atlasHome = await freshDirectory('atlas-memory-home-')
    const repoRoot = await initRepoWithOrigin({ origin: 'https://github.com/org/atlas.git' })
    await writeLegacy({ atlasHome, repoPath: repoRoot, name: 'notes.md', content: '# kept' })

    const resolved = await resolveProjectMemory({ atlasHome, repoRoot })

    expect(await readFile(join(resolved.directories.project, 'notes.md'), 'utf8')).toBe('# kept')
    expect(
      (await runGit({ args: ['status'], cwd: repoRoot })).ok,
    ).toBe(true)
    const legacyGone = await readFile(
      join(atlasHome, 'projects', sanitiseRepoPath(repoRoot), 'memory', 'notes.md'),
      'utf8',
    ).catch(() => null)
    expect(legacyGone).toBeNull()
  })

  it('adopts the main checkout’s legacy directory when resolving from a worktree', async () => {
    const atlasHome = await freshDirectory('atlas-memory-home-')
    const repoRoot = await initRepoWithOrigin({ origin: 'https://github.com/org/atlas.git' })
    await writeFile(join(repoRoot, 'README.md'), 'hi', 'utf8')
    await runGit({ args: ['add', 'README.md'], cwd: repoRoot })
    await runGit({
      args: ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-m', 'init'],
      cwd: repoRoot,
    })
    const worktree = join(await freshDirectory('atlas-memory-wt-parent-'), 'wt')
    await runGit({ args: ['worktree', 'add', worktree], cwd: repoRoot })

    await writeLegacy({ atlasHome, repoPath: repoRoot, name: 'main.md', content: '# from main' })

    const resolved = await resolveProjectMemory({ atlasHome, repoRoot: worktree })

    expect(resolved.identity).toBe('github.com/org/atlas')
    expect(await readFile(join(resolved.directories.project, 'main.md'), 'utf8')).toBe(
      '# from main',
    )
  })

  it('merges several legacy directories fill-only with a line-union index', async () => {
    const atlasHome = await freshDirectory('atlas-memory-home-')
    const repoRoot = await initRepoWithOrigin({ origin: 'https://github.com/org/atlas.git' })
    await writeFile(join(repoRoot, 'README.md'), 'hi', 'utf8')
    await runGit({ args: ['add', 'README.md'], cwd: repoRoot })
    await runGit({
      args: ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-m', 'init'],
      cwd: repoRoot,
    })
    const worktree = join(await freshDirectory('atlas-memory-wt-parent-'), 'wt')
    await runGit({ args: ['worktree', 'add', worktree], cwd: repoRoot })

    await writeLegacy({ atlasHome, repoPath: repoRoot, name: 'MEMORY.md', content: '- one\n- two\n' })
    await writeLegacy({ atlasHome, repoPath: repoRoot, name: 'shared.md', content: 'main version' })
    await writeLegacy({ atlasHome, repoPath: worktree, name: 'MEMORY.md', content: '- two\n- three\n' })
    await writeLegacy({ atlasHome, repoPath: worktree, name: 'shared.md', content: 'worktree version' })
    await writeLegacy({ atlasHome, repoPath: worktree, name: 'only-wt.md', content: 'worktree only' })

    const resolved = await resolveProjectMemory({ atlasHome, repoRoot: worktree })

    expect(await readFile(join(resolved.directories.project, 'shared.md'), 'utf8')).toBe(
      'main version',
    )
    expect(await readFile(join(resolved.directories.project, 'only-wt.md'), 'utf8')).toBe(
      'worktree only',
    )
    const index = await readFile(join(resolved.directories.project, 'MEMORY.md'), 'utf8')
    expect(index).toContain('- one')
    expect(index).toContain('- two')
    expect(index).toContain('- three')
    expect(index.split('\n').filter((line) => line === '- two')).toHaveLength(1)

    const legacyWt = await readFile(
      join(atlasHome, 'projects', sanitiseRepoPath(worktree), 'memory', 'only-wt.md'),
      'utf8',
    ).catch(() => null)
    expect(legacyWt).toBeNull()
  })
})
