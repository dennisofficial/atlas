import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  MEMORY_DIRECTORY_NAME,
  MEMORY_PROJECTS_DIRECTORY_NAME,
  sanitiseRepoIdentity,
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
 * memory directory, `project/<encoded identity>/<name>` is that repo's project memory directory.
 * The identity segment is the repo's normalized origin (`github.com/org/repo`); an absolute path
 * instead means an older sandbox keyed it by the Mac-side checkout directory, and lands under the
 * legacy path key, which the next session's adoption folds into the identity one. The bare
 * `project/<name>` form carries no repo identity at all and is skipped rather than guessed.
 */
const targetFor = (args: { key: string; atlasHome: string }): string | null => {
  const parts = args.key.split('/')
  const name = parts.at(-1)
  if (name === undefined || name === '' || name === '.' || name === '..') return null

  if (parts.length === 2 && parts[0] === 'user') {
    return join(args.atlasHome, MEMORY_DIRECTORY_NAME, name)
  }

  if (parts.length === 3 && parts[0] === 'project') {
    const decoded = decodeURIComponent(parts[1] ?? '')
    const key = decoded.startsWith('/') ? sanitiseRepoPath(decoded) : sanitiseRepoIdentity(decoded)
    return join(args.atlasHome, MEMORY_PROJECTS_DIRECTORY_NAME, key, MEMORY_DIRECTORY_NAME, name)
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

type MemoryEntry = { key: string; write: (target: string) => Promise<void> }

const restoreEntries = async (args: {
  entries: readonly MemoryEntry[]
  atlasHome: string
}): Promise<MemoryDownload> => {
  let restored = 0
  let skipped = 0
  for (const entry of args.entries) {
    const target = targetFor({ key: entry.key, atlasHome: args.atlasHome })
    if (target === null) {
      skipped += 1
      continue
    }
    const wrote = await writeUnlessHeld({ target, write: () => entry.write(target) })
    if (wrote) restored += 1
    else skipped += 1
  }
  return { restored, skipped }
}

const restoreArchive = async (args: {
  archive: Uint8Array
  atlasHome: string
}): Promise<MemoryDownload> => {
  const extracted = await extractContextArchive({ archive: args.archive })
  try {
    return await restoreEntries({
      entries: extracted.entries.map((entry) => ({
        key: entry.key,
        write: (target) => cp(entry.path, target, { preserveTimestamps: true }),
      })),
      atlasHome: args.atlasHome,
    })
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
}): Promise<MemoryDownload> =>
  restoreEntries({
    entries: bundleEntries(args.bundle).map((entry) => ({
      key: entry.key,
      write: (target) => writeFile(target, entry.content, 'utf8'),
    })),
    atlasHome: args.atlasHome,
  })

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
