import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { isUnderPath, rankPaths, type DirectoryEntry } from '@dltech/atlas-core'

import { listWorkspaceFiles } from './workspace-file-list'

export const MAX_MENTION_BYTES = 128 * 1024
export const MAX_VIEW_BYTES = 2 * 1024 * 1024

export enum EFileLoad {
  Text = 'text',
  Listing = 'listing',
  Refused = 'refused',
}

export type ViewedFile =
  | { type: EFileLoad.Text; path: string; content: string; truncated: boolean; bytes: number }
  | { type: EFileLoad.Refused; path: string; reason: string }

export type LoadedFile =
  | { type: EFileLoad.Text; path: string; content: string; truncated: boolean }
  | { type: EFileLoad.Listing; path: string; content: string }
  | { type: EFileLoad.Refused; path: string; reason: string }

const HOME_PREFIX = '~'

export function resolveMentionPath(args: { root: string; path: string }): string {
  const { path } = args
  if (path === HOME_PREFIX) return homedir()
  if (path.startsWith(`${HOME_PREFIX}/`)) return join(homedir(), path.slice(2))
  if (isAbsolute(path)) return path

  return resolve(args.root, path)
}

const missingPathOrThrow = (error: unknown): null => {
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
    return null
  throw error
}

const entriesOf = async (directory: string): Promise<readonly DirectoryEntry[]> => {
  const read = await readdir(directory, { withFileTypes: true }).catch(missingPathOrThrow)
  if (read === null) return []

  return read
    .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export type FileSearchResult = {
  paths: { path: string; positions: number[] }[]
  truncated: boolean
}

export type ReachableRoots = () => readonly string[] | undefined

const reachable = (args: { roots: readonly string[]; path: string }): boolean =>
  args.roots.some((root) => isUnderPath({ directory: root, path: args.path }))

const aboveARoot = (args: { roots: readonly string[]; directory: string }): boolean =>
  args.roots.some((root) => isUnderPath({ directory: args.directory, path: root }))

export class FileBrowser {
  private readonly root: string
  private readonly reachableRoots: ReachableRoots | undefined
  private readonly levels = new Map<string, Promise<readonly DirectoryEntry[]>>()
  private readonly known = new Map<string, Promise<boolean>>()
  private listing: Promise<string[]> | undefined

  constructor(args: { root: string; reachableRoots?: ReachableRoots | undefined }) {
    this.root = args.root
    this.reachableRoots = args.reachableRoots
  }

  atRoot(root: string): FileBrowser {
    const reachableRoots = this.reachableRoots
    if (reachableRoots === undefined) return new FileBrowser({ root })

    const from = this.root
    return new FileBrowser({
      root,
      reachableRoots: () => reachableRoots()?.map((held) => (held === from ? root : held)),
    })
  }

  list(directory: string): Promise<readonly DirectoryEntry[]> {
    const held = this.levels.get(directory)
    if (held !== undefined) return held

    const reading = this.listLevel(directory).catch((error: unknown) => {
      if (this.levels.get(directory) === reading) this.levels.delete(directory)
      throw error
    })
    this.levels.set(directory, reading)
    return reading
  }

  private async listLevel(directory: string): Promise<readonly DirectoryEntry[]> {
    const full = resolveMentionPath({ root: this.root, path: directory })
    const roots = this.reachableRoots?.()
    if (roots === undefined || reachable({ roots, path: full })) return entriesOf(full)
    if (!aboveARoot({ roots, directory: full })) return []

    const entries = await entriesOf(full)
    return entries.filter((entry) => {
      const path = join(full, entry.name)
      return reachable({ roots, path }) || aboveARoot({ roots, directory: path })
    })
  }

  exists(path: string): Promise<boolean> {
    const held = this.known.get(path)
    if (held !== undefined) return held

    const asking = this.checkExists(path).catch((error: unknown) => {
      if (this.known.get(path) === asking) this.known.delete(path)
      throw error
    })
    this.known.set(path, asking)
    return asking
  }

  private async checkExists(path: string): Promise<boolean> {
    const full = resolveMentionPath({ root: this.root, path })
    const roots = this.reachableRoots?.()
    if (roots !== undefined && !reachable({ roots, path: full })) return false

    return await stat(full)
      .then(() => true)
      .catch((error: unknown) => {
        missingPathOrThrow(error)
        return false
      })
  }

  async search(args: { query: string; limit: number }): Promise<FileSearchResult> {
    if (args.query.trim() === '') return { paths: [], truncated: false }
    this.listing ??= listWorkspaceFiles({ root: this.root }).catch((error: unknown) => {
      this.listing = undefined
      throw error
    })
    const roots = this.reachableRoots?.()
    const listed = await this.listing
    const paths =
      roots === undefined
        ? listed
        : listed.filter((path) => reachable({ roots, path: join(this.root, path) }))
    const { matches, truncated } = rankPaths({ query: args.query, paths, limit: args.limit })
    return { paths: matches.map(({ path, positions }) => ({ path, positions })), truncated }
  }

  forget(): void {
    this.listing = undefined
    this.levels.clear()
    this.known.clear()
  }

  async load(path: string): Promise<LoadedFile> {
    const full = resolveMentionPath({ root: this.root, path })
    const roots = this.reachableRoots?.()
    if (roots !== undefined && !reachable({ roots, path: full })) {
      return {
        type: EFileLoad.Refused,
        path,
        reason: 'it is outside what the sandbox can reach',
      }
    }

    const found = await stat(full).catch(missingPathOrThrow)
    if (found === null) return { type: EFileLoad.Refused, path, reason: 'it does not exist' }

    if (found.isDirectory()) {
      const entries = await entriesOf(full)
      const listed = entries
        .map((entry) => (entry.isDirectory ? `${entry.name}/` : entry.name))
        .sort()

      return { type: EFileLoad.Listing, path, content: listed.join('\n') }
    }

    if (!found.isFile()) return { type: EFileLoad.Refused, path, reason: 'it is not a file' }

    const read = await readFile(full)
    if (read.includes(0)) return { type: EFileLoad.Refused, path, reason: 'it is binary' }

    const truncated = read.byteLength > MAX_MENTION_BYTES
    const kept = truncated ? read.subarray(0, MAX_MENTION_BYTES) : read

    return { type: EFileLoad.Text, path, content: kept.toString('utf8'), truncated }
  }

  async read(path: string): Promise<ViewedFile> {
    const full = resolveMentionPath({ root: this.root, path })
    const roots = this.reachableRoots?.()
    if (roots !== undefined && !reachable({ roots, path: full })) {
      return {
        type: EFileLoad.Refused,
        path,
        reason: 'it is outside what the sandbox can reach',
      }
    }

    const found = await stat(full).catch(missingPathOrThrow)
    if (found === null) return { type: EFileLoad.Refused, path, reason: 'it does not exist' }
    if (!found.isFile()) return { type: EFileLoad.Refused, path, reason: 'it is not a file' }

    const handle = await open(full, 'r')
    const buffer = Buffer.alloc(Math.min(found.size, MAX_VIEW_BYTES))
    const { bytesRead } = await handle
      .read(buffer, 0, buffer.length, 0)
      .finally(() => handle.close())
    const read = buffer.subarray(0, bytesRead)
    if (read.includes(0)) return { type: EFileLoad.Refused, path, reason: 'it is binary' }

    return {
      type: EFileLoad.Text,
      path,
      content: read.toString('utf8'),
      truncated: found.size > MAX_VIEW_BYTES,
      bytes: found.size,
    }
  }
}
