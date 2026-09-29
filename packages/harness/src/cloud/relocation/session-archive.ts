import { cp, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  MEMORY_DIRECTORY_NAME,
  MEMORY_PROJECTS_DIRECTORY_NAME,
  normalizeRepoOrigin,
  sanitiseRepoIdentity,
  sanitiseRepoPath,
} from '@dltech/atlas-core'

import { safeRelativeSegment } from '../../files/safe-relative-path'
import { runGit } from '../../workspace/run-git'
import { extractContextArchive } from '../context-archive'

const USER_MEMORY_KEY_PREFIX = `.atlas/${MEMORY_DIRECTORY_NAME}/`
const PROJECT_MEMORY_KEY_PREFIX = 'project-memory/'

export type MemoryArchiveMerge = { merged: number; kept: number }

const mtimeOf = async (path: string): Promise<number | null> => {
  const stats = await stat(path).catch(() => null)
  return stats === null ? null : stats.mtimeMs
}

const projectMemoryKeyOf = async (repoRoot: string): Promise<string> => {
  const origin = await runGit({ args: ['remote', 'get-url', 'origin'], cwd: repoRoot })
  const url = origin.ok ? origin.stdout.trim() : ''
  if (url === '') return sanitiseRepoPath(repoRoot)
  const identity = normalizeRepoOrigin(url)
  if (identity === null) return sanitiseRepoPath(repoRoot)
  return sanitiseRepoIdentity(identity)
}

const targetOf = (args: {
  key: string
  atlasHome: string
  projectMemoryRoot: string
}): string | null => {
  if (args.key.startsWith(USER_MEMORY_KEY_PREFIX)) {
    const name = safeRelativeSegment(args.key.slice(USER_MEMORY_KEY_PREFIX.length))
    return name === null ? null : join(args.atlasHome, MEMORY_DIRECTORY_NAME, name)
  }
  if (args.key.startsWith(PROJECT_MEMORY_KEY_PREFIX)) {
    const name = safeRelativeSegment(args.key.slice(PROJECT_MEMORY_KEY_PREFIX.length))
    return name === null ? null : join(args.projectMemoryRoot, name)
  }
  return null
}

/**
 * The sandbox's memory lands back into a home other machines also write to, so the merge is
 * per-file last-writer-wins on mtime (which the tar carried through the round trip), never the
 * session archive's wipe-and-replace: a host file the archive lacks is another machine's memory
 * and survives untouched. Keys map back onto the same layout the lift packed them from —
 * `.atlas/memory/…` onto the atlas home, `project-memory/…` onto the repo's identity-keyed
 * project memory root. A key escaping its root is skipped rather than trusted.
 */
export async function mergeMemoryArchive(args: {
  archive: Uint8Array
  atlasHome: string
  repoRoot: string
  tarCommand?: string | undefined
}): Promise<MemoryArchiveMerge> {
  const extracted = await extractContextArchive({
    archive: args.archive,
    ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
  })
  try {
    const projectMemoryRoot = join(
      args.atlasHome,
      MEMORY_PROJECTS_DIRECTORY_NAME,
      await projectMemoryKeyOf(args.repoRoot),
      MEMORY_DIRECTORY_NAME,
    )
    let merged = 0
    let kept = 0
    for (const entry of extracted.entries) {
      const target = targetOf({
        key: entry.key,
        atlasHome: args.atlasHome,
        projectMemoryRoot,
      })
      if (target === null) continue
      const held = await mtimeOf(target)
      if (held !== null && held >= entry.mtimeMs) {
        kept += 1
        continue
      }
      await mkdir(join(target, '..'), { recursive: true })
      await cp(entry.path, target, { preserveTimestamps: true })
      merged += 1
    }
    return { merged, kept }
  } finally {
    await extracted.cleanup()
  }
}
