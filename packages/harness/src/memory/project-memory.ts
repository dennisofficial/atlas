import { cp, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  MEMORY_DIRECTORY_NAME,
  MEMORY_INDEX_NAME,
  MEMORY_PROJECTS_DIRECTORY_NAME,
  normalizeRepoOrigin,
  sanitiseRepoPath,
} from '@dltech/atlas-core'

import { runGit } from '../workspace/run-git'
import { parseWorktreePorcelain } from '../workspace/worktrees-parse'

import { memoryDirectoriesFor, type MemoryDirectories } from './read-memory'

export type ProjectMemoryResolution = {
  directories: MemoryDirectories
  identity: string | null
  legacyPaths: readonly string[]
}

const readOriginUrl = async (repoRoot: string): Promise<string | null> => {
  const run = await runGit({ args: ['remote', 'get-url', 'origin'], cwd: repoRoot })
  if (!run.ok) return null
  const url = run.stdout.trim()
  return url === '' ? null : url
}

const canonical = async (path: string): Promise<string> =>
  await realpath(path).catch(() => path)

const worktreePathsOf = async (repoRoot: string): Promise<readonly string[]> => {
  const run = await runGit({ args: ['worktree', 'list', '--porcelain'], cwd: repoRoot })
  if (!run.ok) return [await canonical(repoRoot)]
  const paths = parseWorktreePorcelain({ output: run.stdout }).map((worktree) => worktree.path)
  if (paths.length === 0) return [await canonical(repoRoot)]
  return Promise.all(paths.map(canonical))
}

const isDirectory = async (path: string): Promise<boolean> =>
  (await stat(path).catch(() => null))?.isDirectory() ?? false

const exists = async (path: string): Promise<boolean> => (await stat(path).catch(() => null)) !== null

const mergeIndex = async (args: { target: string; source: string }): Promise<void> => {
  const [held, incoming] = await Promise.all([
    readFile(args.target, 'utf8').catch(() => ''),
    readFile(args.source, 'utf8').catch(() => ''),
  ])
  const lines = held.split('\n')
  const seen = new Set(lines)
  const additions = incoming
    .split('\n')
    .filter((line) => line.trim() !== '' && !seen.has(line))
  if (additions.length === 0) return

  const base = held === '' || held.endsWith('\n') ? held : `${held}\n`
  await writeFile(args.target, `${base}${additions.join('\n')}\n`, 'utf8')
}

const adoptInto = async (args: { source: string; target: string }): Promise<void> => {
  let entries
  try {
    entries = await readdir(args.source, { withFileTypes: true })
  } catch {
    return
  }

  await mkdir(args.target, { recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const from = join(args.source, entry.name)
    const to = join(args.target, entry.name)
    if (entry.name === MEMORY_INDEX_NAME && (await exists(to))) {
      await mergeIndex({ target: to, source: from })
      continue
    }
    if (await exists(to)) continue
    await cp(from, to, { preserveTimestamps: true })
  }
}

/**
 * Where this repo's project memory lives, keyed by its normalized origin identity so every
 * checkout, worktree and sandbox of the repo shares one directory. The first identity-keyed
 * resolution adopts whatever the path-keyed era left behind: a single legacy directory moves
 * wholesale, several merge fill-only with a line-union index (nothing forked, nothing dropped).
 * A repo with no host-named remote keeps the legacy path key — it identifies no shared project.
 */
export async function resolveProjectMemory(args: {
  atlasHome: string
  repoRoot: string
}): Promise<ProjectMemoryResolution> {
  const originUrl = await readOriginUrl(args.repoRoot)
  const identity = originUrl === null ? null : normalizeRepoOrigin(originUrl)
  if (identity === null) {
    return { directories: memoryDirectoriesFor(args), identity: null, legacyPaths: [args.repoRoot] }
  }

  const directories = memoryDirectoriesFor({ ...args, identity })
  const projectHome = dirname(directories.project)
  const projectsRoot = join(args.atlasHome, MEMORY_PROJECTS_DIRECTORY_NAME)

  const paths = [...(await worktreePathsOf(args.repoRoot)), args.repoRoot]
  const candidates: string[] = []
  for (const path of paths) {
    for (const spelling of new Set([path, await canonical(path)])) {
      const legacy = join(projectsRoot, sanitiseRepoPath(spelling))
      if (legacy === projectHome || candidates.includes(legacy)) continue
      if (await isDirectory(legacy)) candidates.push(legacy)
    }
  }

  if (candidates.length === 1 && !(await isDirectory(projectHome))) {
    const only = candidates[0]
    if (only !== undefined) {
      await mkdir(dirname(projectHome), { recursive: true })
      await rename(only, projectHome)
    }
    return { directories, identity, legacyPaths: paths }
  }

  for (const candidate of candidates) {
    await adoptInto({ source: join(candidate, MEMORY_DIRECTORY_NAME), target: directories.project })
    await rm(candidate, { recursive: true, force: true })
  }

  return { directories, identity, legacyPaths: paths }
}
