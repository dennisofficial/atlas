import { createHash } from 'node:crypto'
import { createReadStream, type Dirent } from 'node:fs'
import { lstat, readdir, readlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export enum EEntryKind {
  File = 'file',
  Directory = 'dir',
  Symlink = 'symlink',
}

export type TreeEntry = {
  path: string
  kind: EEntryKind
  mode: number
  target: string | null
}

export type UnportableEntry = { path: string; kind: string }

export type TreeWalk = { entries: TreeEntry[]; unportable: UnportableEntry[] }

export type SkipRule = (args: { path: string; absolute: string }) => boolean

const PERMISSION_BITS = 0o7777
const NESTED_GIT_NAME = '.git'

const unportableKindOf = (dirent: Dirent): string => {
  if (dirent.isSocket()) return 'socket'
  if (dirent.isFIFO()) return 'fifo'
  if (dirent.isBlockDevice()) return 'block device'
  if (dirent.isCharacterDevice()) return 'character device'
  return 'unknown'
}

export const hashFile = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', fail)
    stream.on('end', () => done(hash.digest('hex')))
  })

export const treeSkipRule = ({
  root,
  excludedRoots,
}: {
  root: string
  excludedRoots: readonly string[]
}): SkipRule => {
  const excluded = new Set(excludedRoots.map((excludedRoot) => resolve(excludedRoot)))
  return ({ path }) => path === NESTED_GIT_NAME || excluded.has(join(root, path))
}

const byCodePoint = (left: TreeEntry, right: TreeEntry): number => {
  if (left.path === right.path) return 0
  return left.path < right.path ? -1 : 1
}

export async function walkTree({
  root,
  isSkipped,
}: {
  root: string
  isSkipped: SkipRule
}): Promise<TreeWalk> {
  const entries: TreeEntry[] = []
  const unportable: UnportableEntry[] = []

  const visit = async (relative: string): Promise<void> => {
    const directory = relative === '' ? root : join(root, relative)
    const dirents = await readdir(directory, { withFileTypes: true })
    const descend: string[] = []
    await Promise.all(
      dirents.map(async (dirent) => {
        const path = relative === '' ? dirent.name : `${relative}/${dirent.name}`
        const absolute = join(root, path)
        if (isSkipped({ path, absolute })) return
        if (dirent.isDirectory()) {
          entries.push({ path, kind: EEntryKind.Directory, mode: (await lstat(absolute)).mode & PERMISSION_BITS, target: null })
          descend.push(path)
          return
        }
        if (dirent.isSymbolicLink()) {
          const target = await readlink(absolute)
          entries.push({ path, kind: EEntryKind.Symlink, mode: 0, target })
          return
        }
        if (dirent.isFile()) {
          const info = await lstat(absolute)
          entries.push({ path, kind: EEntryKind.File, mode: info.mode & PERMISSION_BITS, target: null })
          return
        }
        unportable.push({ path, kind: unportableKindOf(dirent) })
      }),
    )
    for (const path of descend.sort()) await visit(path)
  }

  await visit('')
  return { entries: entries.sort(byCodePoint), unportable }
}

export function assertPortable({ unportable, label }: { unportable: readonly UnportableEntry[]; label: string }): void {
  if (unportable.length === 0) return
  const listed = unportable.map((entry) => `${entry.kind} ${entry.path}`).join(', ')
  throw new Error(`Cannot capture ${label}: non-portable entries cannot be archived (${listed})`)
}
