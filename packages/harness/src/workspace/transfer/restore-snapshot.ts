import { join, relative, resolve, sep } from 'node:path'

import { EEntryKind, hashFile, walkTree } from './capture-files'
import { DestinationMovedError } from './restore-destination'
import { isDirectory, stashTreeFiles, type Journal } from './restore-files'

const ROOT_GIT = '.git'
const BATCH = 64
const DIRECTORY = 'dir'

export type PhysicalSnapshot = { entries: Map<string, string>; unportable: number }

export async function snapshotPhysical({
  root,
  excluded,
}: {
  root: string
  excluded: readonly string[]
}): Promise<PhysicalSnapshot> {
  const entries = new Map<string, string>()
  if (!(await isDirectory(root))) return { entries, unportable: 0 }
  const skipped = new Set(excluded.map((path) => resolve(path)))
  const walk = await walkTree({
    root,
    isSkipped: ({ path, absolute }) => path === ROOT_GIT || skipped.has(absolute),
  })
  for (let start = 0; start < walk.entries.length; start += BATCH) {
    const batch = walk.entries.slice(start, start + BATCH)
    const described = await Promise.all(
      batch.map(async (entry) => {
        if (entry.kind === EEntryKind.Directory) return `${DIRECTORY}\0${entry.mode}`
        if (entry.kind === EEntryKind.Symlink) return `link\0${entry.target ?? ''}`
        return `file\0${entry.mode}\0${await hashFile(join(root, entry.path))}`
      }),
    )
    batch.forEach((entry, index) => entries.set(entry.path, described[index] ?? ''))
  }
  return { entries, unportable: walk.unportable.length }
}

function structuralDirectories({ root, excluded }: { root: string; excluded: readonly string[] }): Set<string> {
  const found = new Set<string>()
  for (const path of excluded) {
    const tail = relative(root, path)
    if (tail === '' || tail === '..' || tail.startsWith(`..${sep}`)) continue
    const segments = tail.split(sep)
    for (let length = 1; length < segments.length; length += 1) found.add(segments.slice(0, length).join('/'))
  }
  return found
}

const isDirectoryDescriptor = (descriptor: string | undefined): boolean =>
  descriptor === undefined || descriptor.startsWith(`${DIRECTORY}\0`)

function physicalDifferences({
  before,
  after,
  structural,
}: {
  before: PhysicalSnapshot
  after: PhysicalSnapshot
  structural: ReadonlySet<string>
}): string[] {
  const differing: string[] = []
  for (const name of new Set([...before.entries.keys(), ...after.entries.keys()])) {
    const was = before.entries.get(name)
    const now = after.entries.get(name)
    if (was === now) continue
    if (structural.has(name) && isDirectoryDescriptor(was) && isDirectoryDescriptor(now)) continue
    differing.push(name)
  }
  return differing.sort()
}

export async function sweepOriginals({
  root,
  excluded,
  key,
  journal,
  beforeSweep,
}: {
  root: string
  excluded: readonly string[]
  key: string
  journal: Journal
  beforeSweep: ((path: string) => Promise<void>) | undefined
}): Promise<void> {
  const before = await snapshotPhysical({ root, excluded })
  await beforeSweep?.(root)
  await stashTreeFiles({ root, excluded, key, journal })
  const backup = await snapshotPhysical({ root: join(journal.backupRoot, key), excluded: [] })
  const residue = await snapshotPhysical({ root, excluded })
  const leftover = [...residue.entries].filter(([, descriptor]) => !isDirectoryDescriptor(descriptor)).map(([name]) => name)
  const changed = [...physicalDifferences({ before, after: backup, structural: structuralDirectories({ root, excluded }) }), ...leftover]
  if (changed.length > 0 || backup.unportable + residue.unportable > 0) throw new DestinationMovedError(root, changed)
}
