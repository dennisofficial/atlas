import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  MEMORY_DIRECTORY_NAME,
  MEMORY_PROJECTS_DIRECTORY_NAME,
  sanitiseRepoPath,
} from '@dltech/atlas-core'

import { extractContextArchive } from './context-archive'
import type { UserContextClient } from './user-context-client'

export type MemoryDownload = {
  restored: number
  skipped: number
}

/**
 * Maps an archive key back onto the directory it was tarred from: `user/<name>` is the shared
 * memory directory, `project/<encoded repoRoot>/<name>` is that repo's project memory directory.
 * The bare `project/<name>` form carries no repo identity (a control plane too old to know the
 * workspace's projectDirectory produced it), and a merge that cannot verify one skips the entry
 * rather than guessing — same rule as the descend-side merge.
 */
const targetFor = (args: { key: string; atlasHome: string }): string | null => {
  const parts = args.key.split('/')
  const name = parts.at(-1)
  if (name === undefined || name === '' || name === '.' || name === '..') return null

  if (parts.length === 2 && parts[0] === 'user') {
    return join(args.atlasHome, MEMORY_DIRECTORY_NAME, name)
  }

  if (parts.length === 3 && parts[0] === 'project') {
    const repoRoot = decodeURIComponent(parts[1] ?? '')
    return join(
      args.atlasHome,
      MEMORY_PROJECTS_DIRECTORY_NAME,
      sanitiseRepoPath(repoRoot),
      MEMORY_DIRECTORY_NAME,
      name,
    )
  }

  return null
}

const isHeld = async (path: string): Promise<boolean> =>
  (await stat(path).catch(() => null)) !== null

const writeUnlessHeld = async (args: {
  target: string
  write: () => Promise<void>
}): Promise<boolean> => {
  if (await isHeld(args.target)) return false
  await mkdir(dirname(args.target), { recursive: true })
  await args.write()
  return true
}

const restoreArchive = async (args: {
  archive: Uint8Array
  atlasHome: string
}): Promise<MemoryDownload> => {
  const extracted = await extractContextArchive({ archive: args.archive })
  try {
    let restored = 0
    let skipped = 0
    for (const entry of extracted.entries) {
      const target = targetFor({ key: entry.key, atlasHome: args.atlasHome })
      if (target === null) {
        skipped += 1
        continue
      }
      const wrote = await writeUnlessHeld({
        target,
        write: () => cp(entry.path, target, { preserveTimestamps: true }),
      })
      if (wrote) restored += 1
      else skipped += 1
    }
    return { restored, skipped }
  } finally {
    await extracted.cleanup()
  }
}

const bundleEntries = (bundle: string): readonly { key: string; content: string }[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(bundle)
  } catch {
    throw new Error('the memory bundle stored in the cloud is not readable JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('the memory bundle stored in the cloud is not a key-to-content map')
  }
  return Object.entries(parsed).flatMap(([key, content]) =>
    typeof content === 'string' ? [{ key, content }] : [],
  )
}

const restoreBundle = async (args: {
  bundle: string
  atlasHome: string
}): Promise<MemoryDownload> => {
  let restored = 0
  let skipped = 0
  for (const entry of bundleEntries(args.bundle)) {
    const target = targetFor({ key: entry.key, atlasHome: args.atlasHome })
    if (target === null) {
      skipped += 1
      continue
    }
    const wrote = await writeUnlessHeld({
      target,
      write: () => writeFile(target, entry.content, 'utf8'),
    })
    if (wrote) restored += 1
    else skipped += 1
  }
  return { restored, skipped }
}

/**
 * Pulls the cloud-held memory down into the local memory directories. A local file always wins
 * over the archived copy — the purge deletes the remote afterwards, and overwriting something the
 * operator has locally would defeat the point. Falls back to the legacy JSON bundle when no
 * archive was ever synced.
 */
export async function downloadMemoryArchive(args: {
  context: Pick<UserContextClient, 'readMemoryArchive' | 'readMemoryBundle'>
  atlasHome: string
}): Promise<MemoryDownload> {
  const archive = await args.context.readMemoryArchive()
  if (archive !== null) return restoreArchive({ archive, atlasHome: args.atlasHome })

  const bundle = await args.context.readMemoryBundle()
  if (bundle === null) return { restored: 0, skipped: 0 }
  return restoreBundle({ bundle, atlasHome: args.atlasHome })
}
