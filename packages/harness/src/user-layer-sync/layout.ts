import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export enum EUserLayerTree {
  Skills = 'skills',
  Instructions = 'instructions',
}

export type WatchTarget = {
  directory: string
  recursive: boolean
  accept?: ((name: string) => boolean) | undefined
}

export type TreeLayout = {
  tree: EUserLayerTree
  scan: () => Promise<ReadonlyMap<string, string>>
  locate: (key: string) => { path: string } | null
  watchTargets: () => Promise<readonly WatchTarget[]>
}

const CONFLICT_MARKER = '.conflict-'
const PARTIAL_SUFFIX = '.atlas-partial'
const IGNORED_NAMES: ReadonlySet<string> = new Set(['.DS_Store'])

export const basenameOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1)

export const isConflictCopyKey = (key: string): boolean => basenameOf(key).includes(CONFLICT_MARKER)

export const isSyncableName = (name: string): boolean =>
  !name.includes(CONFLICT_MARKER) && !name.endsWith(PARTIAL_SUFFIX) && !IGNORED_NAMES.has(name)

export async function walkFiles(directory: string): Promise<ReadonlyMap<string, string>> {
  let entries
  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true })
  } catch {
    return new Map()
  }

  const files = new Map<string, string>()
  for (const entry of entries) {
    if (!entry.isFile() || !isSyncableName(entry.name)) continue
    const path = join(entry.parentPath, entry.name)
    files.set(relative(directory, path).split(sep).join('/'), path)
  }
  return files
}

export async function flatFiles(args: {
  directory: string
  accept: (name: string) => boolean
}): Promise<ReadonlyMap<string, string>> {
  let entries
  try {
    entries = await readdir(args.directory, { withFileTypes: true })
  } catch {
    return new Map()
  }

  const files = new Map<string, string>()
  for (const entry of entries) {
    if (!entry.isFile() || !isSyncableName(entry.name) || !args.accept(entry.name)) continue
    files.set(entry.name, join(args.directory, entry.name))
  }
  return files
}

export async function directoryExists(directory: string): Promise<boolean> {
  try {
    await readdir(directory)
    return true
  } catch {
    return false
  }
}
