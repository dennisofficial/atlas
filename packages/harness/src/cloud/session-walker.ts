import { lstat, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

export class SessionWalkError extends Error {
  readonly path: string
  readonly code: string | undefined

  constructor(args: { path: string; cause: unknown }) {
    const reason = args.cause instanceof Error ? args.cause.message : String(args.cause)
    super(`cannot read ${args.path}: ${reason}`, { cause: args.cause })
    this.name = 'SessionWalkError'
    this.path = args.path
    this.code = errorCodeOf(args.cause)
  }
}

const errorCodeOf = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined

enum EEntryKind {
  File = 'file',
  Directory = 'directory',
  Other = 'other',
}

const kindOf = async (args: { path: string; entry: Dirent }): Promise<EEntryKind> => {
  if (args.entry.isSymbolicLink()) return EEntryKind.Other
  if (args.entry.isFile()) return EEntryKind.File
  if (args.entry.isDirectory()) return EEntryKind.Directory
  try {
    const info = await lstat(args.path)
    if (info.isFile()) return EEntryKind.File
    return info.isDirectory() ? EEntryKind.Directory : EEntryKind.Other
  } catch (cause) {
    throw new SessionWalkError({ path: args.path, cause })
  }
}

const listDirectory = async (args: { directory: string; rootMissingIsAbsent: boolean }): Promise<Dirent[] | undefined> => {
  try {
    return await readdir(args.directory, { withFileTypes: true })
  } catch (cause) {
    if (args.rootMissingIsAbsent && errorCodeOf(cause) === 'ENOENT') return undefined
    throw new SessionWalkError({ path: args.directory, cause })
  }
}

const visit = async (args: {
  directory: string
  prefix: string
  isRoot: boolean
  found: string[]
}): Promise<boolean> => {
  const entries = await listDirectory({ directory: args.directory, rootMissingIsAbsent: args.isRoot })
  if (entries === undefined) return false
  for (const entry of entries) {
    const path = join(args.directory, entry.name)
    const key = `${args.prefix}${entry.name}`
    const kind = await kindOf({ path, entry })
    if (kind === EEntryKind.File) args.found.push(key)
    if (kind === EEntryKind.Directory) {
      await visit({ directory: path, prefix: `${key}/`, isRoot: false, found: args.found })
    }
  }
  return true
}

export async function walkRegularFiles(args: { root: string }): Promise<readonly string[] | undefined> {
  const found: string[] = []
  const present = await visit({ directory: args.root, prefix: '', isRoot: true, found })
  if (!present) return undefined
  return found.sort()
}
